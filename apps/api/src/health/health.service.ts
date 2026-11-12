import { Injectable, Logger } from '@nestjs/common';
import { ProbeUnavailableException } from '@product-finder/api';
import { PrismaService } from '@product-finder/server';
import type { HealthDto } from './health.dto.js';

// Probes run every few seconds and must not pile up.
export const READINESS_TIMEOUT_MS = 1000;

// A failing probe is logged once when it starts to fail and once when it recovers, without a stack.
// The text is fixed, because a driver message can hold a connection string.
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private databaseDown = false;
  // The shared SELECT 1. Probes that arrive meanwhile join it. A probe that times out drops it.
  private pending?: Promise<void>;

  constructor(private readonly prisma: PrismaService) {}

  live(): HealthDto {
    return { status: 'ok' };
  }

  async ready(): Promise<HealthDto> {
    try {
      await this.selectOne();
    } catch (error) {
      if (!this.databaseDown) {
        this.databaseDown = true;
        const reason =
          error instanceof TimeoutError ? `no answer within ${READINESS_TIMEOUT_MS} ms` : 'query failed';
        this.logger.warn(`Readiness is failing: the database does not answer (${reason}).`);
      }
      throw new ProbeUnavailableException('Database is not reachable.');
    }
    if (this.databaseDown) {
      this.databaseDown = false;
      this.logger.log('Readiness is back: the database answers.');
    }
    return { status: 'ok' };
  }

  /**
   * Waits for the shared SELECT 1 for READINESS_TIMEOUT_MS, then drops it, so a hung connection cannot
   * keep readiness at 503. Dropped queries do not pile up: each has its own read timeout (PrismaService.ping).
   */
  private async selectOne(): Promise<void> {
    const query = this.pending ?? this.startQuery();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(new TimeoutError());
      }, READINESS_TIMEOUT_MS);
    });
    try {
      await Promise.race([query, timeout]);
    } catch (error) {
      if (error instanceof TimeoutError && this.pending === query) {
        this.pending = undefined;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private startQuery(): Promise<void> {
    const query = this.prisma.ping(READINESS_TIMEOUT_MS);
    this.pending = query;
    const settled = () => {
      if (this.pending === query) {
        this.pending = undefined;
      }
    };
    // Also reads a late failure, so it is never unhandled.
    query.then(settled, settled);
    return query;
  }
}

class TimeoutError extends Error {}
