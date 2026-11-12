import pg from 'pg';

// pg has no connect timeout by default, so a dead host would hold a request until the kernel gave up.
export const DB_CONNECT_TIMEOUT_MS = 5000;

// Keepalive finds a dead peer on an idle connection.
export const DB_KEEPALIVE_DELAY_MS = 10_000;

// The timestamp columns have no time zone and Prisma reads them as UTC, so now() in SQL must be UTC too.
// An `options` parameter in DATABASE_URL replaces this one.
const SESSION_OPTIONS = '-c TimeZone=UTC';

/** The pg pool settings shared by the API and the import. */
export function poolConfig(connectionString: string): pg.PoolConfig {
  return {
    connectionString,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    keepAlive: true,
    keepAliveInitialDelayMillis: DB_KEEPALIVE_DELAY_MS,
    options: SESSION_OPTIONS,
  };
}

// The client gives up (query_timeout) so a half-open TCP link fails too. The server stops the statement
// after the same time (statement_timeout). The API answers a timed-out query with the busy 503.
export const API_QUERY_TIMEOUT_MS = 10_000;

/** The API pool settings: poolConfig plus the query timeout. The import has long statements, so it uses poolConfig alone. */
export function apiPoolConfig(
  connectionString: string,
  queryTimeoutMs = API_QUERY_TIMEOUT_MS,
): pg.PoolConfig {
  return {
    ...poolConfig(connectionString),
    query_timeout: queryTimeoutMs,
    statement_timeout: queryTimeoutMs,
  };
}

/** The API pool. An idle connection that drops emits `error`, and without a listener Node would crash. pg has already removed it. */
export function createApiPool(connectionString: string, queryTimeoutMs = API_QUERY_TIMEOUT_MS): pg.Pool {
  const pool = new pg.Pool(apiPoolConfig(connectionString, queryTimeoutMs));
  pool.on('error', () => undefined);
  return pool;
}
