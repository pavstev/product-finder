import { Writable } from 'node:stream';
import { describe, expect, it } from '@jest/globals';
import { createLogger } from './create-logger.js';
import { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';

/** A stream that keeps what the logger writes, one parsed JSON object per line. */
function capture() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return {
    stream,
    raw: () => chunks.join(''),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

const production = { LOG_LEVEL: 'info', NODE_ENV: 'production' } as const;

describe('REDACT_PATHS', () => {
  it('names the three secret fields of a request and a response', () => {
    expect([...REDACT_PATHS]).toEqual([
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
    ]);
  });
});

describe('createLogger redaction', () => {
  it('replaces the Authorization header, the Cookie header and Set-Cookie', () => {
    const out = capture();
    createLogger(production, { service: 'api', stream: out.stream }).info(
      {
        req: {
          id: 'abc-123',
          headers: { authorization: 'Bearer tok-1234', cookie: 'session=s3cr3t', accept: 'application/json' },
        },
        res: { headers: { 'set-cookie': ['session=n3w-s3cr3t; HttpOnly'], 'content-type': 'text/plain' } },
      },
      'request completed',
    );
    const [line] = out.lines();
    expect(line).toMatchObject({
      req: {
        id: 'abc-123',
        headers: { authorization: REDACT_CENSOR, cookie: REDACT_CENSOR, accept: 'application/json' },
      },
      res: { headers: { 'set-cookie': REDACT_CENSOR, 'content-type': 'text/plain' } },
    });
    expect(out.raw()).not.toMatch(/tok-1234|s3cr3t|n3w-s3cr3t/);
  });
});
