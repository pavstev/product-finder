import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Logger } from 'pino';
import type { Options } from 'pino-http';
import { isHealthCheck } from './health-path.js';
import { genReqId } from './request-id.js';

// The chosen id is logged as `requestId`, and a client could send a very long raw header.
function withoutRequestIdHeader(req: { headers?: Record<string, unknown> }) {
  if (!req.headers) {
    return req;
  }
  const { 'x-request-id': _raw, ...headers } = req.headers;
  return { ...req, headers };
}

/** Options for pino-http: one line per request, none for health checks. The problem filter logs the stack. */
export function httpLogOptions(logger: Logger): Options {
  return {
    logger,
    genReqId: (req: IncomingMessage, res: ServerResponse) => genReqId(req, res),
    customAttributeKeys: { reqId: 'requestId' },
    quietReqLogger: true,
    autoLogging: { ignore: (req) => isHealthCheck(req.url) },
    serializers: { req: withoutRequestIdHeader },
    customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? 'error' : 'info'),
    customErrorMessage: () => 'request completed',
    customErrorObject: (_req, _res, _error, fields: { res: unknown; responseTime: unknown }) => ({
      res: fields.res,
      responseTime: fields.responseTime,
    }),
  };
}
