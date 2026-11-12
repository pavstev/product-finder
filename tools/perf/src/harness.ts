import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';
import { cpuBusyShare } from './stats.js';

// Process and database wiring shared by the benchmarks.

export const IMPORT_CLI = 'dist/apps/catalog-import/main.js';
export const API_MAIN = 'dist/apps/api/main.js';
/** High enough that the read rate limit never answers 429 during a run. */
export const THROTTLE_READ_PER_MIN = '10000000';

export interface ProcessResult {
  code: number | null;
  ms: number;
  output: string;
}

/** Run `node <args>` from the workspace root and time it from spawn to exit. */
export function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code, ms: performance.now() - started, output });
    });
  });
}

/** Run a command and give its output, or throw with it when the exit code is not 0. */
export function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(output);
      } else {
        reject(new Error(`${command} exited with ${code}: ${output}`));
      }
    });
  });
}

export async function withClient<T>(url: string, work: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

export interface ProductCounts {
  total: number;
  listed: number;
}

/** All products, and those the last import listed. */
export function productCounts(url: string): Promise<ProductCounts> {
  return withClient(url, async (client) => {
    const { rows } = await client.query<ProductCounts>(
      `SELECT count(*)::int AS total, (count(*) FILTER (WHERE in_latest_export))::int AS listed FROM product`,
    );
    return rows[0];
  });
}

export interface RunningApi {
  baseUrl: string;
  stop(): Promise<void>;
}

/** Characters of API output kept for an error message. */
const OUTPUT_TAIL = 20_000;

interface ApiProcess {
  child: ChildProcess;
  /** The end of the API output, for error messages. */
  tail(): string;
  stop(): Promise<void>;
}

function spawnApi(databaseUrl: string, port: number): ApiProcess {
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    NODE_ENV: 'production',
    // At info the API logs one JSON line per request, which costs time in a run.
    LOG_LEVEL: 'warn',
    THROTTLE_READ_PER_MIN,
  };
  const child: ChildProcess = spawn(process.execPath, [API_MAIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const keep = (chunk: unknown) => {
    output = (output + String(chunk)).slice(-OUTPUT_TAIL);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  const exited = new Promise<void>((resolve) =>
    child.on('exit', () => {
      resolve();
    }),
  );
  const stop = async () => {
    if (child.exitCode === null) {
      child.kill();
    }
    await exited;
  };
  return { child, tail: () => output, stop };
}

async function waitUntilReady(api: ApiProcess, baseUrl: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (api.child.exitCode !== null) {
      throw new Error(`The API exited with ${api.child.exitCode}:\n${api.tail()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health/ready`);
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await sleep(250);
  }
  await api.stop();
  throw new Error(`The API did not answer /api/health/ready within 30 s:\n${api.tail()}`);
}

/** Start the built API on the given database and wait until /api/health/ready answers 200. */
export async function startApi(databaseUrl: string, port: number): Promise<RunningApi> {
  const api = spawnApi(databaseUrl, port);
  const baseUrl = `http://localhost:${port}/api`;
  await waitUntilReady(api, baseUrl);
  return { baseUrl, stop: () => api.stop() };
}

export interface LoadSnapshot {
  at: string;
  /** Busy share of all host cores over one second, in percent. */
  hostCpuBusyPercent: number;
  /** `docker stats --no-stream` of the db container: CPU share and memory. */
  dbContainer: string;
}

/** What else the machine is doing right before a timed block. The machine is shared. */
export async function loadSnapshot(container: string): Promise<LoadSnapshot> {
  const before = os.cpus();
  await sleep(1000);
  const hostCpuBusyPercent = Math.round(cpuBusyShare(before, os.cpus()) * 10) / 10;
  let dbContainer: string;
  try {
    dbContainer = (
      await runCommand('docker', [
        'stats',
        '--no-stream',
        '--format',
        'CPU {{.CPUPerc}}, memory {{.MemUsage}}',
        container,
      ])
    ).trim();
  } catch (error) {
    dbContainer = `unknown: ${(error as Error).message.split('\n')[0]}`;
  }
  return { at: new Date().toISOString(), hostCpuBusyPercent, dbContainer };
}

export interface MachineInfo {
  cpu: string;
  logicalCores: number;
  ramGb: number;
  os: string;
  node: string;
  postgres: string;
  /** The planner and memory settings the report quotes, as SHOW prints them. */
  postgresSettings: Record<string, string>;
  /** `docker info`: VM, engine, kernel, CPUs and memory. */
  docker: string;
  /** `docker version`: the product that runs the engine, for example Docker Desktop and its version. */
  dockerPlatform: string;
}

const POSTGRES_SETTINGS = [
  'shared_buffers',
  'work_mem',
  'effective_cache_size',
  'max_parallel_workers_per_gather',
  'random_page_cost',
  'jit',
  'plan_cache_mode',
];

async function commandOutput(command: string, args: string[]): Promise<string> {
  try {
    return (await runCommand(command, args)).trim();
  } catch (error) {
    return `unknown: ${(error as Error).message.split('\n')[0]}`;
  }
}

export async function machineInfo(databaseUrl: string): Promise<MachineInfo> {
  const { postgres, postgresSettings } = await withClient(databaseUrl, async (client) => {
    const version = await client.query<{ version: string }>('SELECT version()');
    const settings = await client.query<{ name: string; value: string }>(
      'SELECT name, current_setting(name) AS value FROM unnest($1::text[]) AS name',
      [POSTGRES_SETTINGS],
    );
    return {
      postgres: version.rows[0].version,
      postgresSettings: Object.fromEntries(settings.rows.map((row) => [row.name, row.value])),
    };
  });
  const docker = await commandOutput('docker', [
    'info',
    '--format',
    '{{.OperatingSystem}}, server {{.ServerVersion}}, kernel {{.KernelVersion}}, VM {{.NCPU}} CPUs, {{.MemTotal}} bytes',
  ]);
  const dockerPlatform = await commandOutput('docker', ['version', '--format', '{{.Server.Platform.Name}}']);
  return {
    cpu: os.cpus()[0]?.model.trim() ?? 'unknown',
    logicalCores: os.cpus().length,
    ramGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    os: `${os.version()} ${os.release()} ${os.arch()}`,
    node: process.version,
    postgres,
    postgresSettings,
    docker,
    dockerPlatform,
  };
}

export interface ProductTable {
  /** Rows per status, and how many of them the last import listed. */
  statuses: { status: string; total: number; listed: number }[];
  tableBytes: number;
  /** Table, indexes and TOAST. */
  totalBytes: number;
  pages: number;
  /** Pages the visibility map marks all-visible. Index-only scans skip the heap on those. */
  allVisiblePages: number;
  lastVacuum: string | null;
  lastAnalyze: string | null;
  indexes: { name: string; bytes: number; definition: string }[];
}

/** Sizes, status split, vacuum state and index definitions of the product table, as the run saw them. */
export async function productTable(databaseUrl: string): Promise<ProductTable> {
  return withClient(databaseUrl, async (client) => {
    const statuses = await client.query<{ status: string; total: number; listed: number }>(
      `SELECT status::text AS status, count(*)::int AS total,
              (count(*) FILTER (WHERE in_latest_export))::int AS listed
       FROM product GROUP BY status ORDER BY status`,
    );
    const table = await client.query<Omit<ProductTable, 'statuses' | 'indexes'>>(
      `SELECT pg_relation_size(c.oid)::float8 AS "tableBytes",
              pg_total_relation_size(c.oid)::float8 AS "totalBytes",
              c.relpages AS pages, c.relallvisible AS "allVisiblePages",
              greatest(s.last_vacuum, s.last_autovacuum)::text AS "lastVacuum",
              greatest(s.last_analyze, s.last_autoanalyze)::text AS "lastAnalyze"
       FROM pg_class c JOIN pg_stat_user_tables s ON s.relid = c.oid
       WHERE c.oid = 'product'::regclass`,
    );
    const indexes = await client.query<{ name: string; bytes: number; definition: string }>(
      `SELECT indexrelid::regclass::text AS name, pg_relation_size(indexrelid)::float8 AS bytes,
              pg_get_indexdef(indexrelid) AS definition
       FROM pg_index WHERE indrelid = 'product'::regclass ORDER BY 1`,
    );
    return { statuses: statuses.rows, ...table.rows[0], indexes: indexes.rows };
  });
}

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Round to 0.1 ms for tables. */
export function formatMs(value: number): string {
  return value.toFixed(1);
}

/** A Markdown table, for the console. */
export function markdownTable(header: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
  return [line(header), line(header.map(() => '---')), ...rows.map(line)].join('\n');
}
