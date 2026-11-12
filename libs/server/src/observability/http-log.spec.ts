import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from '@jest/globals';
import { pinoHttp } from 'pino-http';
import { createLogger } from './create-logger.js';
import { httpLogOptions } from './http-log.js';
import { requestIdMiddleware } from './request-id.js';

const REVIEW_TEXT = 'Great emulsifier, the batch smelled of burnt-caramel-77';
const AUTHOR = 'Hildegard Zimmermann-Secret';

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      resolve();
    });
  });
  server = undefined;
});

/**
 * A plain HTTP server behind the same pino-http middleware as the API. It reads the body, as the
 * review POST does, and answers with the status that the test picks.
 */
async function start(answer: (req: IncomingMessage, res: ServerResponse) => void) {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
      done();
    },
  });
  const logger = createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'production' }, { service: 'api', stream });
  const middleware = pinoHttp(httpLogOptions(logger));
  // The same order as configureApp and the Logger module: the id first, then the request log.
  server = createServer((req, res) => {
    requestIdMiddleware(req, res, () => {
      middleware(req, res, () => {
        req.resume();
        answer(req, res);
      });
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, lines };
}

/** The "request completed" line. It is written after the response, so wait until it is there. */
async function completed(lines: Record<string, unknown>[]): Promise<Record<string, unknown>> {
  for (let tries = 0; tries < 50; tries += 1) {
    const found = lines.find((line) => line.msg === 'request completed');
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('no request completed line');
}

describe('httpLogOptions', () => {
  it('never logs the review text, the author name or a secret header', async () => {
    const { url, lines } = await start((_req, res) => {
      res.setHeader('Set-Cookie', 'session=resp-s3cr3t');
      res.statusCode = 201;
      res.end('{}');
    });
    await fetch(`${url}/api/products/P-10001/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-1234',
        Cookie: 'session=req-s3cr3t',
      },
      body: JSON.stringify({ rating: 4, body: REVIEW_TEXT, authorName: AUTHOR }),
    });
    const line = await completed(lines);
    const text = JSON.stringify(lines);
    expect(text).not.toContain('burnt-caramel-77');
    expect(text).not.toContain('Zimmermann');
    expect(text).not.toMatch(/tok-1234|req-s3cr3t|resp-s3cr3t/);
    expect(line).toMatchObject({
      req: { method: 'POST', url: '/api/products/P-10001/reviews', headers: { authorization: '[Redacted]' } },
      res: { statusCode: 201 },
    });
  });
});
