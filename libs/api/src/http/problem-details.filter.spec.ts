import { describe, expect, it, jest } from '@jest/globals';
import { type ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { ProbeUnavailableException, ProblemDetailsFilter } from './problem-details.filter.js';

/** The part of an Express response the filter uses. */
class FakeResponse {
  statusCode = 200;
  headersSent = false;
  ended = false;
  body: unknown;
  readonly headers = new Map<string, string>();

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  removeHeader(name: string): void {
    this.headers.delete(name.toLowerCase());
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  json(body: unknown): this {
    this.body = body;
    return this;
  }

  end(): this {
    this.ended = true;
    return this;
  }
}

function handle(exception: unknown, response = new FakeResponse(), url = '/api/products/P-1?q=x') {
  const logger = { error: jest.fn(), log: jest.fn() };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', originalUrl: url, url }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  new ProblemDetailsFilter(logger).catch(exception, host);
  return { response, logger, text: JSON.stringify(response.body) };
}

/**
 * An error with the shape of Prisma's PrismaClientKnownRequestError: an Error with that name, a
 * P-code and an optional meta. api/http may not import the db lib, so the spec builds it by hand.
 */
function knownRequestError(
  message: string,
  fields: { code: string; meta?: Record<string, unknown> },
  name = 'PrismaClientKnownRequestError',
): Error {
  return Object.assign(new Error(message), { name, clientVersion: '7.10.1', ...fields });
}

function prismaError(code: string): Error {
  return knownRequestError(`Invalid prisma.review.create() invocation: secret table detail (${code})`, {
    code,
  });
}

/**
 * A PostgreSQL error as Prisma 7 with @prisma/adapter-pg reports it (shape seen in an e2e probe):
 * P2039 for a model query, P2010 for a raw query, the SQLSTATE in meta.driverAdapterError.cause.
 */
function postgresError(
  code: 'P2039' | 'P2010',
  sqlState: string,
  message = 'canceling statement due to lock timeout',
): Error {
  const driverAdapterError = Object.assign(new Error(message), {
    name: 'DriverAdapterError',
    cause: {
      originalCode: sqlState,
      originalMessage: message,
      kind: 'postgres',
      code: sqlState,
      severity: 'ERROR',
    },
  });
  return knownRequestError(
    `Invalid \`tx.review.create()\` invocation in D:\\app\\reviews.service.ts:97:25\n` +
      `Database error. Code: \`${sqlState}\`. Message: \`${message}\``,
    {
      code,
      meta: code === 'P2039' ? { modelName: 'Review', driverAdapterError } : { driverAdapterError },
    },
  );
}

/**
 * A pg or pg-pool connection error as Prisma 7 hands it on (shape seen in a probe, pinned in
 * libs/server/src/db/pool-error-shape.spec.ts): a plain Error with the driver message.
 * Prisma adds clientVersion. There is no code, so only the message tells them apart.
 */
function poolError(message: string): Error {
  return Object.assign(new Error(message), { clientVersion: '7.10.1' });
}

function httpError(statusCode: number, message: string, expose: boolean): Error {
  return Object.assign(new Error(message), { name: 'HttpError', status: statusCode, statusCode, expose });
}

describe('ProblemDetailsFilter logging', () => {
  it('sends a probe 503 as problem JSON and logs nothing, the route logs the state change', () => {
    const { response, logger } = handle(new ProbeUnavailableException('Database is not reachable.'));
    expect(response.statusCode).toBe(503);
    expect(response.getHeader('content-type')).toBe('application/problem+json');
    expect(response.body).toMatchObject({ status: 503, detail: 'Database is not reachable.' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });
});

describe('ProblemDetailsFilter', () => {
  it('turns an HttpException into problem JSON', () => {
    const { response, logger } = handle(new NotFoundException('Product P-1 not found.'));
    expect(response.statusCode).toBe(404);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Product P-1 not found.',
      instance: '/api/products/P-1',
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('404 GET /api/products/P-1: Product P-1 not found.');
  });

  it('sends Cache-Control: no-store on every problem answer', () => {
    for (const error of [new NotFoundException('x'), new BadRequestException(['x']), prismaError('P2034')]) {
      expect(handle(error).response.headers.get('cache-control')).toBe('no-store');
    }
  });

  it('answers a 5xx http error with a generic 500 and logs it', () => {
    const error = httpError(503, 'EACCES secret path', false);
    const { response, logger, text } = handle(error);
    expect(response.statusCode).toBe(500);
    expect(text).not.toMatch(/secret|EACCES/);
    expect(logger.error).toHaveBeenCalledWith(error.message, error.stack);
  });

  it('maps Prisma P2025 (record not found) to 404 without the Prisma message', () => {
    const { response, text } = handle(prismaError('P2025'));
    expect(response.statusCode).toBe(404);
    expect(response.body).toMatchObject({ title: 'Not Found', status: 404 });
    expect(text).not.toMatch(/prisma|secret|P2025/i);
  });

  it.each(['P2034', 'P2028'])('maps Prisma %s to 503 with Retry-After: 5 and logs it', (code) => {
    const { response, logger, text } = handle(prismaError(code));
    expect(response.statusCode).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.body).toMatchObject({ type: 'about:blank', title: 'Service Unavailable', status: 503 });
    expect(text).not.toMatch(/prisma|secret|P20/i);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(code), expect.any(String));
  });

  it.each(['P2039', 'P2010'] as const)(
    'maps a PostgreSQL lock timeout (55P03) reported as %s to 503 with Retry-After: 5',
    (code) => {
      const { response, logger, text } = handle(postgresError(code, '55P03'));
      expect(response.statusCode).toBe(503);
      expect(response.headers.get('retry-after')).toBe('5');
      expect(response.headers.get('content-type')).toBe('application/problem+json');
      expect(response.body).toEqual({
        type: 'about:blank',
        title: 'Service Unavailable',
        status: 503,
        detail: 'The database is busy. Please try again in a few seconds.',
        instance: '/api/products/P-1',
      });
      expect(text).not.toMatch(/55P03|lock|canceling|review|P20|\.ts/i);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('55P03'), expect.any(String));
    },
  );

  it.each(['P2039', 'P2010'] as const)(
    'maps a PostgreSQL statement timeout (57014) reported as %s to the busy 503',
    (code) => {
      const { response, logger, text } = handle(
        postgresError(code, '57014', 'canceling statement due to statement timeout'),
      );
      expect(response.statusCode).toBe(503);
      expect(response.headers.get('retry-after')).toBe('5');
      expect(response.body).toMatchObject({ status: 503, title: 'Service Unavailable' });
      expect(text).not.toMatch(/57014|statement|canceling|P20/i);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('57014'), expect.any(String));
    },
  );

  // No free connection in time, no answer in time, or a connection that broke. Any route that reads
  // the database can get these, not only a transaction, so they get the same busy answer as P2028.
  it.each([
    // pg-pool: every connection is in use for connectionTimeoutMillis.
    'timeout exceeded when trying to connect',
    // pg: a new connection did not sign in within connectionTimeoutMillis.
    'Connection terminated due to connection timeout',
    // pg: no answer within query_timeout, the read timeout of the API pool.
    'Query read timeout',
    // pg: the connection broke during the query.
    'Connection terminated unexpectedly',
  ])('answers the pool error "%s" with the busy 503 and Retry-After: 5', (message) => {
    const error = poolError(message);
    const { response, logger, text } = handle(error);
    expect(response.statusCode).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.body).toEqual({
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The database is busy. Please try again in a few seconds.',
      instance: '/api/products/P-1',
    });
    expect(text).not.toMatch(/terminated|exceeded|connection timeout|read timeout/i);
    expect(logger.error).toHaveBeenCalledWith(message, error.stack);
  });

  // @prisma/adapter-pg reports these socket and server errors with a kind, and Prisma gives them a P1 or P2 code.
  it.each([
    ['P1001', 'DatabaseNotReachable'],
    ['P1008', 'SocketTimeout'],
    ['P1017', 'ConnectionClosed'],
    ['P2037', 'TooManyConnections'],
  ])('maps the Prisma connection error %s (%s) to the busy 503', (code, kind) => {
    const error = knownRequestError(`Can't reach database server (${code})`, {
      code,
      meta: { driverAdapterError: { name: 'DriverAdapterError', cause: { kind } } },
    });
    const { response, text } = handle(error);
    expect(response.statusCode).toBe(503);
    expect(response.headers.get('retry-after')).toBe('5');
    expect(text).not.toMatch(/reach|P1|P2/);
  });

  it('keeps a 500 for a sign-in or database name error, which a retry cannot fix', () => {
    for (const code of ['P1000', 'P1003']) {
      expect(handle(prismaError(code)).response.statusCode).toBe(500);
    }
  });

  it('keeps a 500 for another plain error, also one that only looks like a pool error', () => {
    for (const message of [
      'timeout exceeded when trying to connect to the cache',
      'query read timeout',
      'connection terminated unexpectedly',
      'Something went wrong',
    ]) {
      const { response } = handle(poolError(message));
      expect({ message, status: response.statusCode }).toEqual({ message, status: 500 });
    }
  });

  it('answers another PostgreSQL error with a generic 500', () => {
    const { response, text } = handle(postgresError('P2010', '42P01'));
    expect(response.statusCode).toBe(500);
    expect(response.headers.get('retry-after')).toBeUndefined();
    expect(text).not.toMatch(/42P01|canceling|P20/i);
  });

  // P2025 would be a 404 from Prisma, so this also fails when the name check is missing.
  it.each(['P2002', 'P2025'])('answers an error with code %s but another name with a generic 500', (code) => {
    const error = knownRequestError('not from Prisma', { code }, 'SomeOtherError');
    const { response, logger } = handle(error);
    expect(response.statusCode).toBe(500);
    expect(response.body).toMatchObject({ title: 'Internal Server Error', status: 500 });
    expect(logger.error).toHaveBeenCalledWith(error.message, error.stack);
  });
});
