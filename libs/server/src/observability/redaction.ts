// Review text and author names are not here: pino-http never logs a request body.

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
] as const;

export const REDACT_CENSOR = '[Redacted]';
