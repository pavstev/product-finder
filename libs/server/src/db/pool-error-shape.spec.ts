import { type AddressInfo, createServer, type Socket } from 'node:net';
import { describe, expect, it } from '@jest/globals';
import { PrismaPg } from '@prisma/adapter-pg';
import { createApiPool } from './database-pool.js';
import { PrismaClient } from './generated/client.js';

// Consumer: libs/api/src/http/problem-details.filter.ts answers these errors with the busy 503.
// It matches the pg and pg-pool ones by message, because they have no code. If a pg, pg-pool or Prisma
// upgrade changes a message or a code, this fails, instead of the API silently answering 500 again.

/** A fake server. `silent` never answers. `signin` lets the client sign in, then never answers a query. */
async function fakeServer(mode: 'silent' | 'signin') {
  const sockets = new Set<Socket>();
  let connections = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    connections += 1;
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    let signedIn = mode === 'silent';
    socket.on('data', () => {
      if (!signedIn) {
        signedIn = true;
        // AuthenticationOk, then ReadyForQuery (idle).
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    url: `postgresql://u:p@127.0.0.1:${port}/x`,
    connections: () => connections,
    /** Cuts every connection, then stops listening. */
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}

/** A client with short limits, so the timeouts come in milliseconds. */
function clientFor(url: string, max = 10) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url, connectionTimeoutMillis: 200, max }),
  });
}

async function failure(query: Promise<unknown>): Promise<Error> {
  const error = await query.then(
    () => new Error('the query should have failed'),
    (e: unknown) => e as Error,
  );
  expect(error).toBeInstanceOf(Error);
  return error;
}

describe('connection errors as Prisma hands them on', () => {
  it('is a plain error "Connection terminated due to connection timeout" when a new connection does not sign in', async () => {
    const server = await fakeServer('silent');
    const prisma = clientFor(server.url);
    try {
      const error = await failure(prisma.product.findFirst());
      expect(error.constructor).toBe(Error);
      expect(error.message).toBe('Connection terminated due to connection timeout');
      expect((error as { code?: unknown }).code).toBeUndefined();
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      await server.close();
    }
  });

  it('is a plain error "timeout exceeded when trying to connect" when every connection is in use', async () => {
    const server = await fakeServer('signin');
    const prisma = clientFor(server.url, 1);
    try {
      // One query that never gets an answer holds the only connection.
      const hung = failure(prisma.$queryRaw`SELECT 1`);
      await new Promise((resolve) => setTimeout(resolve, 100));
      const error = await failure(prisma.product.findFirst());
      expect(error.constructor).toBe(Error);
      expect(error.message).toBe('timeout exceeded when trying to connect');

      // The connection breaks under the hung query.
      await server.close();
      const broken = await hung;
      expect(broken.constructor).toBe(Error);
      expect(broken.message).toBe('Connection terminated unexpectedly');
    } finally {
      await prisma.$disconnect().catch(() => undefined);
    }
  });

  it('is a plain error "Query read timeout" when the API pool gets no answer in time, and drops that connection', async () => {
    const server = await fakeServer('signin');
    // The API pool, with a short read timeout instead of API_QUERY_TIMEOUT_MS.
    const pool = createApiPool(server.url, 200);
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
      const error = await failure(prisma.product.findFirst());
      expect(error.constructor).toBe(Error);
      expect(error.message).toBe('Query read timeout');
      expect((error as { code?: unknown }).code).toBeUndefined();

      // pg-pool ended the connection that hung, so the next query opens a new one.
      await failure(prisma.product.findFirst());
      expect(server.connections()).toBe(2);
    } finally {
      await prisma.$disconnect().catch(() => undefined);
      await pool.end();
      await server.close();
    }
  });
});
