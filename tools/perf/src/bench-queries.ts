import path from 'node:path';
import type { Client } from 'pg';
import { type BenchQuery, QUERIES, queryUrl, withCursor } from '../queries.js';
import {
  formatMs,
  type LoadSnapshot,
  loadSnapshot,
  machineInfo,
  markdownTable,
  type ProductCounts,
  productCounts,
  productTable,
  startApi,
  THROTTLE_READ_PER_MIN,
  withClient,
  writeJson,
} from './harness.js';
import { perfDatabase, type QueryOptions, readQueryOptions, UsageError } from './options.js';
import { type Summary, summarize } from './stats.js';

// Starts the built API on the perf database and sends each query of queries.ts as an HTTP call:
// the warm-up requests, then the timed ones. Writes <out>/queries-run<N>.json.
// With --cold a new succeeded import run is recorded before each facets request, so the facet cache
// misses every time. Those runs are deleted at the end. Use another --out.

interface QueryResult {
  id: string;
  title: string;
  path: string;
  status: number;
  note?: string;
  /** Matches for a search, from the response. */
  total?: number;
  /** Response body size in bytes. */
  bytes?: number;
  /** The first and last SKU of a search page, to show which rows it read. */
  firstSku?: string;
  lastSku?: string;
  /** Request start to the last body byte, per timed request. */
  samplesMs?: number[];
  summary?: Summary;
  /** The problem detail when the API refuses the query. */
  detail?: string;
}

interface TimedResponse {
  status: number;
  ms: number;
  body: string;
}

async function timedGet(url: string): Promise<TimedResponse> {
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.text();
  return { status: response.status, ms: performance.now() - started, body };
}

/** The source of the import runs that --cold records. The run deletes them at the end. */
const COLD_SOURCE = 'bench-queries --cold';

/** A new succeeded import run is a new catalog version, so the next facets request misses the API cache. */
async function newCatalogVersion(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO import_run (id, source, status, started_at, finished_at)
     VALUES (gen_random_uuid(), $1, 'SUCCEEDED', clock_timestamp(), clock_timestamp())`,
    [COLD_SOURCE],
  );
}

async function timeRequests(
  url: string,
  id: string,
  options: QueryOptions,
  beforeEach?: () => Promise<void>,
): Promise<{ last: TimedResponse; samplesMs: number[] }> {
  let last: TimedResponse = { status: 0, ms: 0, body: '' };
  for (let i = 0; i < options.warmup; i++) {
    await beforeEach?.();
    last = await timedGet(url);
  }
  const samplesMs: number[] = [];
  for (let i = 0; i < options.timed; i++) {
    await beforeEach?.();
    last = await timedGet(url);
    if (last.status !== 200) {
      throw new Error(`${id} answered ${last.status}: ${last.body}`);
    }
    samplesMs.push(last.ms);
  }
  return { last, samplesMs };
}

async function measure(
  baseUrl: string,
  query: BenchQuery,
  options: QueryOptions,
  beforeEach?: () => Promise<void>,
): Promise<QueryResult> {
  const url = queryUrl(baseUrl, query);
  const base = {
    id: query.id,
    title: query.title,
    path: query.path,
    ...(query.note && { note: query.note }),
  };
  if (query.expectStatus !== 200) {
    const { status, body } = await timedGet(url);
    if (status !== query.expectStatus) {
      throw new Error(`${query.id} answered ${status}, expected ${query.expectStatus}: ${body}`);
    }
    return { ...base, status, detail: (JSON.parse(body) as { detail?: string }).detail };
  }
  const { last, samplesMs } = await timeRequests(url, query.id, options, beforeEach);
  const { total, items } = JSON.parse(last.body) as { total?: number; items?: { sku: string }[] };
  return {
    ...base,
    status: last.status,
    ...(total !== undefined && { total }),
    ...(items && items.length > 0 && { firstSku: items[0].sku, lastSku: items[items.length - 1].sku }),
    bytes: Buffer.byteLength(last.body),
    samplesMs,
    summary: summarize(samplesMs),
  };
}

/** The query with the cursor its walk leads to: the nextCursor after cursorAfterPages pages of its path. */
async function withWalkedCursor(baseUrl: string, query: BenchQuery): Promise<BenchQuery> {
  if (query.cursorAfterPages === undefined) {
    return query;
  }
  let cursor: string | null = null;
  for (let page = 1; page <= query.cursorAfterPages; page++) {
    const response = await fetch(queryUrl(baseUrl, { ...query, path: withCursor(query.path, cursor) }));
    const body = (await response.json()) as { nextCursor?: string | null };
    if (response.status !== 200 || !body.nextCursor) {
      throw new Error(
        `${query.id}: page ${page} of the cursor walk answered ${response.status} without nextCursor.`,
      );
    }
    cursor = body.nextCursor;
  }
  return { ...query, path: withCursor(query.path, cursor) };
}

async function measureAll(
  client: Client,
  baseUrl: string,
  queries: readonly BenchQuery[],
  options: QueryOptions,
): Promise<QueryResult[]> {
  const results: QueryResult[] = [];
  try {
    for (const query of queries) {
      const cold = options.cold && query.endpoint === 'facets';
      results.push(
        await measure(baseUrl, query, options, cold ? () => newCatalogVersion(client) : undefined),
      );
    }
  } finally {
    if (options.cold) {
      await client.query('DELETE FROM import_run WHERE source = $1', [COLD_SOURCE]);
    }
  }
  return results;
}

/** Start the API, walk the cursors, then time every query. The API stops at the end. */
async function runQueries(
  dbUrl: string,
  queries: readonly BenchQuery[],
  options: QueryOptions,
): Promise<QueryResult[]> {
  const api = await startApi(dbUrl, options.port);
  try {
    const walked: BenchQuery[] = [];
    for (const query of queries) {
      walked.push(await withWalkedCursor(api.baseUrl, query));
    }
    return await withClient(dbUrl, (client) => measureAll(client, api.baseUrl, walked, options));
  } finally {
    await api.stop();
  }
}

export async function benchQueries(args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const options = readQueryOptions(args, env);
  const db = perfDatabase(options.databaseUrl);
  const queries =
    options.only.length > 0 ? QUERIES.filter((query) => options.only.includes(query.id)) : QUERIES;
  const machine = await machineInfo(db.url);
  const products = await productCounts(db.url);
  if (products.total === 0) {
    throw new UsageError(`${db.name} has no products. Run pnpm nx run perf:bench first.`);
  }

  const table = await productTable(db.url);
  const load: LoadSnapshot = await loadSnapshot(options.container);
  const results = await runQueries(db.url, queries, options);

  writeJson(path.join(options.out, `queries-run${options.run}.json`), {
    benchmark: 'queries',
    run: options.run,
    cold: options.cold,
    machine,
    database: db.name,
    products,
    productTable: table,
    load,
    warmup: options.warmup,
    timed: options.timed,
    throttleReadPerMin: Number(THROTTLE_READ_PER_MIN),
    results,
  });

  printReport(options, products, load, results);
}

function printReport(
  options: QueryOptions,
  products: ProductCounts,
  load: LoadSnapshot,
  results: QueryResult[],
): void {
  const cold = options.cold ? ' (cold: a new catalog version before each facets request)' : '';
  console.log(`Run ${options.run}${cold}: ${products.listed} listed of ${products.total} products.`);
  console.log(`Load before: host CPU ${load.hostCpuBusyPercent}%, db ${load.dbContainer}\n`);
  console.log(
    markdownTable(
      ['ID', 'Query', 'Status', 'Matches', 'Median (ms)', 'p95 (ms)', 'p99 (ms)', 'Max (ms)'],
      results.map((result) => [
        result.id,
        result.title,
        result.status,
        result.total ?? '',
        result.summary ? formatMs(result.summary.median) : 'not timed',
        result.summary ? formatMs(result.summary.p95) : '',
        result.summary ? formatMs(result.summary.p99) : '',
        result.summary ? formatMs(result.summary.max) : '',
      ]),
    ),
  );
}
