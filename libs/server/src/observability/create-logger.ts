import {
  type DestinationStream,
  type Logger,
  pino,
  stdTimeFunctions,
  type TransportSingleOptions,
} from 'pino';
import { REDACT_CENSOR, REDACT_PATHS } from './redaction.js';
import { traceFields } from './tracing.js';

export interface LoggerConfig {
  LOG_LEVEL: string;
  NODE_ENV: string;
}

// Re-exported so callers need no import of pino.
export type { Logger };

interface LoggerOptions {
  /** Added to every line, so the API and the import job can be told apart. */
  service: string;
  /** 1 (stdout, the default) or 2 (stderr). */
  fd?: 1 | 2;
  /** Test seam: write here instead of the file descriptor. */
  stream?: DestinationStream;
}

// Only NODE_ENV=development gives the readable format. Everything else gives JSON.
export function prettyTransport(
  config: Pick<LoggerConfig, 'NODE_ENV'>,
  fd: 1 | 2,
): TransportSingleOptions | undefined {
  if (config.NODE_ENV !== 'development') {
    return undefined;
  }
  return {
    target: 'pino-pretty',
    options: {
      destination: fd,
      colorize: true,
      translateTime: 'SYS:HH:MM:ss.l',
      ignore: 'pid,hostname,service,req,res',
    },
  };
}

/** The pino logger of the API and the import job. The `mixin` adds trace ids and also works under Jest. */
export function createLogger(config: LoggerConfig, { service, fd = 1, stream }: LoggerOptions): Logger {
  const options = {
    level: config.LOG_LEVEL,
    base: { service },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    redact: { paths: [...REDACT_PATHS], censor: REDACT_CENSOR },
    mixin: traceFields,
  };
  if (stream) {
    return pino(options, stream);
  }
  const transport = prettyTransport(config, fd);
  // Sync, so a short job loses no line when the process exits.
  return transport ? pino({ ...options, transport }) : pino(options, pino.destination({ fd, sync: true }));
}
