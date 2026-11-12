import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '@product-finder/server';
import { HealthService } from './health.service.js';

function serviceWith(query: () => Promise<unknown>) {
  const ping = jest.fn((_timeoutMs: number) => query());
  const service = new HealthService({ ping } as unknown as PrismaService);
  return { service, ping };
}

/** A query that the test settles by hand. */
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('HealthService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  describe('ready', () => {
    it('throws a 503 when the query fails', async () => {
      const { service } = serviceWith(() => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:1')));
      const failure = await service.ready().catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(ServiceUnavailableException);
      expect((failure as ServiceUnavailableException).message).toBe('Database is not reachable.');
    });

    it('throws a 503 after 1 second when the query hangs', async () => {
      jest.useFakeTimers();
      const { service } = serviceWith(() => new Promise(() => undefined));
      const outcome = service.ready().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(999);
      let settled = false;
      void outcome.then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(await outcome).toBeInstanceOf(ServiceUnavailableException);
    });

    it('runs one query for concurrent probes', async () => {
      const query = deferred();
      const { service, ping } = serviceWith(() => query.promise);
      const first = service.ready();
      const second = service.ready();
      query.resolve(undefined);
      await expect(Promise.all([first, second])).resolves.toEqual([{ status: 'ok' }, { status: 'ok' }]);
      expect(ping).toHaveBeenCalledTimes(1);
    });

    it('lets a probe that joined a hung query time out too, then starts one new query', async () => {
      jest.useFakeTimers();
      const { service, ping } = serviceWith(() => new Promise(() => undefined));
      const first = service.ready().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(500);
      const joined = service.ready().catch((e: unknown) => e);
      await jest.advanceTimersByTimeAsync(500);
      expect(await first).toBeInstanceOf(ServiceUnavailableException);
      expect(ping).toHaveBeenCalledTimes(1);

      // The first timeout dropped the shared query. The next probe starts its own.
      const next = service.ready().catch((e: unknown) => e);
      expect(ping).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(500);
      expect(await joined).toBeInstanceOf(ServiceUnavailableException);
      // The joined probe timing out does not drop the newer query.
      service.ready().catch(() => undefined);
      expect(ping).toHaveBeenCalledTimes(2);
      await jest.advanceTimersByTimeAsync(1000);
      expect(await next).toBeInstanceOf(ServiceUnavailableException);
    });
  });
});
