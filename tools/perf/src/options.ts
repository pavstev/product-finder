import { parseArgs } from 'node:util';
import { QUERIES } from '../queries.js';

/** The local perf database on the dev Postgres container (docker-compose.yml, DB_PORT 5433 here). */
export const DEFAULT_PERF_DATABASE_URL =
  'postgresql://product_finder:product_finder@localhost:5433/product_finder_perf';
const DEFAULT_CONTAINER = 'basf-product-finder-db-1';
const DEFAULT_OUT = 'tmp/perf/results';
/** Not 3000, so a dev API can keep running. */
const DEFAULT_PORT = '3100';

export class UsageError extends Error {}

type Env = Readonly<Record<string, string | undefined>>;

export interface PerfDatabase {
  name: string;
  url: string;
  /** The same server, database postgres: for DROP and CREATE DATABASE. */
  adminUrl: string;
}

/** A perf run drops its database, so it only talks to Postgres on this machine. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** Check the URL names a perf database on this machine. The import benchmark drops and creates it. */
export function perfDatabase(url: string): PerfDatabase {
  const parsed = new URL(url);
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new UsageError(
      `The perf database must be on localhost or 127.0.0.1, not "${parsed.hostname}". A run drops it.`,
    );
  }
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new UsageError(`The perf database name has only lower-case letters, digits and _, not "${name}".`);
  }
  if (!name.endsWith('_perf')) {
    throw new UsageError(`The perf database name must end in _perf, not "${name}". A run drops it.`);
  }
  const admin = new URL(url);
  admin.pathname = '/postgres';
  return { name, url, adminUrl: admin.toString() };
}

function databaseUrl(env: Env): string {
  // Never DATABASE_URL: Nx loads .env files into the task, and that one names the dev database.
  return perfDatabase(env.PERF_DATABASE_URL ?? DEFAULT_PERF_DATABASE_URL).url;
}

function parse<T extends Record<string, { type: 'string' | 'boolean'; default?: string | boolean }>>(
  args: string[],
  options: T,
) {
  try {
    return parseArgs({ args, options, strict: true, allowPositionals: false }).values;
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
}

function wholeNumber(flag: string, value: string, min = 1): number {
  const number = Number(value);
  if (!/^\d+$/.test(value) || number < min) {
    throw new UsageError(`${flag} must be a whole number of at least ${min}, not "${value}".`);
  }
  return number;
}

function queryIds(value: string): string[] {
  const ids = value === '' ? [] : value.split(',').map((id) => id.trim());
  for (const id of ids) {
    const query = QUERIES.find((candidate) => candidate.id === id);
    if (!query) {
      throw new UsageError(`Unknown query ${id}. The IDs are ${QUERIES.map((q) => q.id).join(', ')}.`);
    }
  }
  return ids;
}

export interface ImportOptions {
  databaseUrl: string;
  file: string;
  changedFile: string;
  out: string;
  container: string;
}

export function readImportOptions(args: string[], env: Env): ImportOptions {
  const values = parse(args, {
    file: { type: 'string', default: 'tmp/perf/products-50000.csv' },
    'changed-file': { type: 'string', default: 'tmp/perf/products-50000-changed.csv' },
    out: { type: 'string', default: DEFAULT_OUT },
    container: { type: 'string', default: DEFAULT_CONTAINER },
  });
  return {
    databaseUrl: databaseUrl(env),
    file: values.file,
    changedFile: values['changed-file'],
    out: values.out,
    container: values.container,
  };
}

export interface QueryOptions {
  databaseUrl: string;
  out: string;
  container: string;
  port: number;
  run: number;
  warmup: number;
  timed: number;
  /** Before each facets request, record a new succeeded import run, so the API facet cache misses. */
  cold: boolean;
  /** Query IDs to run. Empty means all. */
  only: string[];
}

export function readQueryOptions(args: string[], env: Env): QueryOptions {
  const values = parse(args, {
    run: { type: 'string', default: '1' },
    warmup: { type: 'string', default: '5' },
    timed: { type: 'string', default: '50' },
    cold: { type: 'boolean', default: false },
    only: { type: 'string', default: '' },
    port: { type: 'string', default: DEFAULT_PORT },
    out: { type: 'string', default: DEFAULT_OUT },
    container: { type: 'string', default: DEFAULT_CONTAINER },
  });
  return {
    databaseUrl: databaseUrl(env),
    out: values.out,
    container: values.container,
    port: wholeNumber('--port', values.port),
    run: wholeNumber('--run', values.run),
    warmup: wholeNumber('--warmup', values.warmup, 0),
    timed: wholeNumber('--timed', values.timed),
    cold: values.cold,
    only: queryIds(values.only),
  };
}
