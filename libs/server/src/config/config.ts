// One schema for every environment variable. The OpenTelemetry preload runs before it and reads two keys itself.
// The error names each bad key and never prints a value, because one is a database URL with a password.
import { z } from 'zod';

// Loads .env first, so every entry that reads the config also gets the file.
import './load-env.js';

// Node runs a timer longer than this after 1 ms. PostgreSQL's lock_timeout has the same limit.
const MAX_MILLIS = 2_147_483_647;
const MAX_PORT = 65_535;
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** The default of every key that has one. */
export const CONFIG_DEFAULTS = {
  PORT: 3000,
  CORS_ORIGIN: 'http://localhost:4200',
  TRUST_PROXY: false,
  THROTTLE_READ_PER_MIN: 600,
  THROTTLE_WRITE_PER_MIN: 20,
  REVIEW_TX_MAX_WAIT_MS: 2000,
  REVIEW_TX_TIMEOUT_MS: 5000,
  IMPORT_TX_TIMEOUT_MS: 300_000,
  CATALOG_FILE: 'data/products.csv',
  SEED_DEMO_REVIEWS: false,
  LOG_LEVEL: 'info',
  NODE_ENV: 'production',
} as const;

/** A string that `parse` accepts, or one issue with a fixed message. The message never holds the value. */
function fromString<T>(message: string, parse: (raw: string) => T | undefined) {
  return z.string({ error: 'is required' }).transform((raw, ctx) => {
    const value = parse(raw);
    if (value === undefined) {
      ctx.addIssue({ code: 'custom', message });
      return z.NEVER;
    }
    return value;
  });
}

function wholeNumber(min: number, max: number) {
  return fromString(`must be a whole number from ${min} to ${max}`, (raw) => {
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined;
  });
}

const millis = () => wholeNumber(1, MAX_MILLIS);

const url = () => fromString('must be a URL', (raw) => (URL.canParse(raw) ? raw : undefined));

const DATABASE_PROTOCOLS = ['postgres:', 'postgresql:'];

// A URL with another protocol gets its own message. Neither message holds the value.
const databaseUrl = () =>
  z.string({ error: 'is required' }).transform((raw, ctx) => {
    if (!URL.canParse(raw)) {
      ctx.addIssue({ code: 'custom', message: 'must be a URL' });
      return z.NEVER;
    }
    if (!DATABASE_PROTOCOLS.includes(new URL(raw).protocol)) {
      ctx.addIssue({ code: 'custom', message: 'must use the postgres: or postgresql: protocol' });
      return z.NEVER;
    }
    return raw;
  });

const text = () => fromString('must not be empty', (raw) => raw);

const schema = z.object({
  DATABASE_URL: databaseUrl(),
  PORT: wholeNumber(1, MAX_PORT).default(CONFIG_DEFAULTS.PORT),
  CORS_ORIGIN: text().default(CONFIG_DEFAULTS.CORS_ORIGIN),
  // The number of proxy hops that Express trusts, or false.
  TRUST_PROXY: fromString('must be false or a whole number of proxy hops, 0 or more', (raw) =>
    raw.toLowerCase() === 'false' ? false : /^\d+$/.test(raw) ? Number(raw) : undefined,
  ).default(CONFIG_DEFAULTS.TRUST_PROXY),
  THROTTLE_READ_PER_MIN: wholeNumber(1, MAX_MILLIS).default(CONFIG_DEFAULTS.THROTTLE_READ_PER_MIN),
  THROTTLE_WRITE_PER_MIN: wholeNumber(1, MAX_MILLIS).default(CONFIG_DEFAULTS.THROTTLE_WRITE_PER_MIN),
  REVIEW_TX_MAX_WAIT_MS: millis().default(CONFIG_DEFAULTS.REVIEW_TX_MAX_WAIT_MS),
  REVIEW_TX_TIMEOUT_MS: millis().default(CONFIG_DEFAULTS.REVIEW_TX_TIMEOUT_MS),
  IMPORT_TX_TIMEOUT_MS: millis().default(CONFIG_DEFAULTS.IMPORT_TX_TIMEOUT_MS),
  // Relative to the working directory. A `--file` argument of the import wins.
  CATALOG_FILE: text().default(CONFIG_DEFAULTS.CATALOG_FILE),
  SEED_DEMO_REVIEWS: fromString('must be true or false', (raw) =>
    raw === 'true' ? true : raw === 'false' ? false : undefined,
  ).default(CONFIG_DEFAULTS.SEED_DEMO_REVIEWS),
  LOG_LEVEL: fromString(`must be one of ${LOG_LEVELS.join(', ')}`, (raw) =>
    LOG_LEVELS.find((level) => level === raw.toLowerCase()),
  ).default(CONFIG_DEFAULTS.LOG_LEVEL),
  // development turns on the readable log format. Any other value gives JSON lines.
  NODE_ENV: text().default(CONFIG_DEFAULTS.NODE_ENV),
  // The OpenTelemetry preload reads these two first. They are checked here too, so a bad endpoint stops the start.
  OTEL_EXPORTER_OTLP_ENDPOINT: url().optional(),
  OTEL_SERVICE_NAME: text().optional(),
});

export type AppConfig = z.output<typeof schema>;

// Injection token of the AppConfig in the API.
export const APP_CONFIG = 'APP_CONFIG';

/** Thrown by loadConfig. The message lists every bad key and never a value. */
export class InvalidConfigError extends Error {
  override readonly name = 'InvalidConfigError';
}

/** Validates the environment. A blank value counts as unset. Throws one InvalidConfigError that lists every bad key. */
export function loadConfig(env: Readonly<Record<string, string | undefined>> = process.env): AppConfig {
  const input: Record<string, string> = {};
  for (const key of Object.keys(schema.shape)) {
    const value = env[key]?.trim();
    if (value) {
      input[key] = value;
    }
  }
  const result = schema.safeParse(input);
  if (!result.success) {
    // Only the key and message, never the issue object.
    const lines = result.error.issues.map((issue) => `- ${String(issue.path[0])}: ${issue.message}`);
    throw new InvalidConfigError(`Invalid configuration:\n${lines.join('\n')}`);
  }
  return result.data;
}
