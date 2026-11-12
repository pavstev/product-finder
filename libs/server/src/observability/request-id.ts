import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const REQUEST_ID_HEADER = 'X-Request-Id';

// A client may send 1 to 128 characters of letters, digits, dash, underscore and dot.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

// Anything else could forge a log line, so it gets a new UUID.
function safeRequestId(candidate: unknown, generate: () => string = randomUUID): string {
  return typeof candidate === 'string' && SAFE_REQUEST_ID.test(candidate) ? candidate : generate();
}

/** pino-http `genReqId`: keeps a safe client id or makes one, and sets it on the response. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const id = safeRequestId(req.headers['x-request-id']);
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

// Register before the body parsers, so a request that a parser rejects still gets its id.
// pino-http keeps a `req.id` that is already set.
export function requestIdMiddleware(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  (req as { id?: unknown }).id = genReqId(req, res);
  next();
}
