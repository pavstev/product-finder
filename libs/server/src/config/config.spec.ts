import { describe, expect, it } from '@jest/globals';
import { InvalidConfigError, loadConfig } from './config.js';

const DATABASE_URL = 'postgresql://product_finder:product_finder@localhost:5432/product_finder';
// A database URL with a password, and a PORT: neither may show up in an error.
const SECRET_URL = 'postgres://app:s3cr3t-Passw0rd@db.internal:5432/products';
const SECRET_PORT = 'port-99999-secret';

/** The message of the error that loadConfig throws for this environment. */
function errorOf(env: Record<string, string | undefined>): string {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidConfigError);
    return (error as Error).message;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig defaults', () => {
  it('parses a valid environment and fills the defaults', () => {
    expect(loadConfig({ DATABASE_URL })).toEqual({
      DATABASE_URL,
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
    });
  });
});

describe('loadConfig errors', () => {
  it('gives one error that names a wrong PORT and a missing DATABASE_URL', () => {
    const message = errorOf({ PORT: 'abc' });
    expect(message).toMatch(/^Invalid configuration:/);
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message.split('\n').filter((line) => line.startsWith('- '))).toHaveLength(2);
  });

  it('does not put any input value in the error text', () => {
    const wrongPort = errorOf({ DATABASE_URL: SECRET_URL, PORT: SECRET_PORT });
    expect(wrongPort).toContain('PORT');
    expect(wrongPort).not.toContain('s3cr3t');
    expect(wrongPort).not.toContain(SECRET_PORT);
    expect(wrongPort).not.toContain('db.internal');

    const wrongUrl = errorOf({
      DATABASE_URL: 'postgres://app:s3cr3t-Passw0rd@bad host:5432/x',
      PORT: SECRET_PORT,
    });
    expect(wrongUrl).toContain('DATABASE_URL: must be a URL');
    expect(wrongUrl).not.toContain('s3cr3t');
    expect(wrongUrl).not.toContain(SECRET_PORT);
  });

  it('lists every bad key in one error', () => {
    const message = errorOf({
      DATABASE_URL: 'nope',
      PORT: '0',
      TRUST_PROXY: 'x',
      REVIEW_TX_TIMEOUT_MS: '0',
      SEED_DEMO_REVIEWS: 'maybe',
      LOG_LEVEL: 'x',
    });
    const names = [
      'DATABASE_URL',
      'PORT',
      'TRUST_PROXY',
      'REVIEW_TX_TIMEOUT_MS',
      'SEED_DEMO_REVIEWS',
      'LOG_LEVEL',
    ];
    for (const name of names) {
      expect(message).toContain(`- ${name}: `);
    }
  });
});
