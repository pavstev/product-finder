import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { CatalogModule, RateLimitGuard, rateLimitOptions, ReviewsModule } from '@product-finder/api';
import {
  APP_CONFIG,
  type AppConfig,
  createLogger,
  httpLogOptions,
  loadConfig,
  PrismaModule,
} from '@product-finder/server';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigModule } from './config/app-config.module.js';
import { HealthModule } from './health/health.module.js';
import { OtelShutdown } from './otel-shutdown.js';

@Module({
  imports: [
    // A bad or missing variable stops the start with one message that names every bad key.
    ConfigModule.forRoot({ isGlobal: true, validate: loadConfig }),
    AppConfigModule,
    // JSON logs on stdout, one "request completed" line per request. main.ts makes it the logger of Nest too.
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: httpLogOptions(createLogger(config, { service: 'api' })),
      }),
    }),
    PrismaModule,
    // Per client IP: a high `read` limit for GET, a tight `write` limit for the review POST.
    ThrottlerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: rateLimitOptions }),
    CatalogModule,
    ReviewsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }, OtelShutdown],
})
export class AppModule {}
