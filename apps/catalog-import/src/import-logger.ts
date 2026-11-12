import type { ImportLogger } from '@product-finder/import';
import { createLogger, type Logger, type LoggerConfig } from '@product-finder/server/client';

// Logs go to stderr. Stdout is the command output, and `status --json` must stay valid JSON.
export const IMPORT_LOG_FD = 2;

/** One phase is one info line. */
export function pinoImportLogger(logger: Logger): ImportLogger {
  return {
    phase: (phase, fields) => {
      logger.info({ phase, ...fields }, `import ${phase}`);
    },
    warn: (message) => {
      logger.warn(message);
    },
    error: (message) => {
      logger.error(message);
    },
  };
}

export function createImportLogger(config: LoggerConfig): ImportLogger {
  return pinoImportLogger(createLogger(config, { service: 'catalog-import', fd: IMPORT_LOG_FD }));
}
