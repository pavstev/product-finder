import { type INestApplication, Logger, ValidationPipe } from '@nestjs/common';
import { type AppConfig, requestIdMiddleware } from '@product-finder/server';
import type { Application } from 'express';
import { ProblemDetailsFilter } from './problem-details.filter.js';

const TRUST_PROXY_OFF_NOTE = 'TRUST_PROXY is false. Behind a proxy all clients share one rate-limit bucket.';

/** Every route lives under /api. The OpenAPI document names it as its server URL. */
export const API_PREFIX = 'api';

/** Global setup shared by main.ts, the OpenAPI emitter and the e2e tests. Call it before init() or listen(). */
export function configureApp(
  app: INestApplication,
  config: Pick<AppConfig, 'CORS_ORIGIN' | 'TRUST_PROXY'>,
): void {
  // Before init(), which registers the body parsers, so a request that a parser rejects still gets its X-Request-Id.
  app.use(requestIdMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Every error body is an RFC 9457 problem.
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.enableCors({ origin: config.CORS_ORIGIN });
  app.enableShutdownHooks();
  // Behind nginx the client IP comes from X-Forwarded-For. Needed for per-IP rate limits.
  if (config.TRUST_PROXY !== false) {
    (app.getHttpAdapter().getInstance() as Application).set('trust proxy', config.TRUST_PROXY);
  } else {
    // False is the safe default: no client can fake its IP. Say what it costs behind a proxy.
    new Logger('RateLimit').log(TRUST_PROXY_OFF_NOTE);
  }
}
