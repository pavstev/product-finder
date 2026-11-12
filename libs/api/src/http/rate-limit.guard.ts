import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '@product-finder/server';
import type { Request } from 'express';

// The library default names its exception class.
const RATE_LIMIT_MESSAGE = 'Too many requests. Please wait a minute and try again.';

const ONE_MINUTE_MS = 60_000;

// The throttlers set no blockDuration, so a block lasts one window. The first 429 gets this Retry-After, later ones count down.
export const RATE_LIMIT_BLOCK_SECONDS = ONE_MINUTE_MS / 1000;

// Every other method counts as a write.
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isRead(context: ExecutionContext): boolean {
  return READ_METHODS.has(context.switchToHttp().getRequest<Request>().method);
}

/** Two limits per client IP and route, in memory per instance: `read` is high (shared IPs), `write` is tight. */
export function rateLimitOptions(
  config: Pick<AppConfig, 'THROTTLE_READ_PER_MIN' | 'THROTTLE_WRITE_PER_MIN'>,
): ThrottlerModuleOptions {
  return {
    errorMessage: RATE_LIMIT_MESSAGE,
    throttlers: [
      {
        name: 'read',
        ttl: ONE_MINUTE_MS,
        limit: config.THROTTLE_READ_PER_MIN,
        skipIf: (context) => !isRead(context),
      },
      {
        name: 'write',
        ttl: ONE_MINUTE_MS,
        limit: config.THROTTLE_WRITE_PER_MIN,
        skipIf: isRead,
      },
    ],
  };
}

// A named throttler sends only its own header, such as Retry-After-write, so this adds the standard Retry-After.
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    this.setResponseHeader(this.getRequestResponse(context).res, 'Retry-After', detail.timeToBlockExpire);
    await super.throwThrottlingException(context, detail);
  }
}
