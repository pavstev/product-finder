// Nest-free entry of the server lib (@product-finder/server/client), so the import and tools/perf never load Nest.
// Importing the config loads .env as a side effect, so import this first in every entry point.
export type { PrismaClient, Product } from './generated/client.js';
export { Prisma } from './generated/client.js';
export { ProductStatus } from './generated/enums.js';
export { PRISMA_CONFIG, prismaCliEntry } from './prisma-cli.js';
export { createPrismaClient } from './prisma-client.factory.js';
export {
  APP_CONFIG,
  type AppConfig,
  CONFIG_DEFAULTS,
  InvalidConfigError,
  loadConfig,
} from '../config/config.js';

export { incrementRating } from '../ratings/increment-rating.js';
export { recomputeRatings } from '../ratings/recompute-ratings.js';

export { createLogger, type Logger, type LoggerConfig } from '../observability/create-logger.js';
export { httpLogOptions } from '../observability/http-log.js';
export {
  createImportMetrics,
  createReviewMetrics,
  createSearchMetrics,
  type ImportMetrics,
  type ImportOutcomeLabel,
  type ImportRunRecord,
  type ReviewMetrics,
  type SearchMetrics,
  startTimer,
} from '../observability/metrics.js';
export { flushOtel } from '../observability/otel-handle.js';
export { requestIdMiddleware } from '../observability/request-id.js';
export { inSpan } from '../observability/tracing.js';
