import { type AddressInfo, createServer, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from '@jest/globals';
import { API_QUERY_TIMEOUT_MS, apiPoolConfig, poolConfig } from './database-pool.js';
import { PrismaService } from './prisma.service.js';

describe('apiPoolConfig', () => {
  it('adds a 10 s read timeout on the client and the same statement_timeout on the server', () => {
    expect(apiPoolConfig('postgresql://u:p@db:5432/x')).toEqual({
      ...poolConfig('postgresql://u:p@db:5432/x'),
      query_timeout: API_QUERY_TIMEOUT_MS,
      statement_timeout: API_QUERY_TIMEOUT_MS,
    });
    expect(API_QUERY_TIMEOUT_MS).toBe(10_000);
    expect(apiPoolConfig('postgresql://u:p@db:5432/x', 250)).toMatchObject({
      query_timeout: 250,
      statement_timeout: 250,
    });
  });

  it('leaves the shared settings without a read timeout, so no import statement is cut', () => {
    const shared = poolConfig('postgresql://u:p@db:5432/x');
    expect(shared).not.toHaveProperty('query_timeout');
    expect(shared).not.toHaveProperty('statement_timeout');
  });
});

/**
 * A fake PostgreSQL server. It lets every client sign in, then never answers a query:
 * a connection to a primary that failed over and left the TCP link half open.
 */
async function silentServer() {
  let connections = 0;
  let open = 0;
  const startups: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    connections += 1;
    open += 1;
    let signedIn = false;
    socket.on('data', (data) => {
      if (signedIn) {
        return; // A query. No answer, ever.
      }
      signedIn = true;
      startups.push(data);
      // AuthenticationOk ('R', length 8, code 0), then ReadyForQuery ('Z', length 5, idle).
      socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
    });
    socket.on('error', () => undefined);
    socket.on('close', () => {
      sockets.delete(socket);
      open -= 1;
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `postgresql://u:p@127.0.0.1:${port}/x`,
    connections: () => connections,
    open: () => open,
    startups,
    /** Cuts every connection, so a query that waits for an answer fails. */
    destroyAll: () => {
      for (const socket of sockets) {
        socket.destroy();
      }
    },
    close: () =>
      new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      ),
  };
}

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !condition(); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('PrismaService.ping', () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const step of cleanup.splice(0).reverse()) {
      await step();
    }
  });

  it('gives up on a query with no answer and drops that connection, so the next ping opens a new one', async () => {
    const fake = await silentServer();
    cleanup.push(fake.close);
    const prisma = new PrismaService({ DATABASE_URL: fake.url });
    cleanup.push(() => prisma.onApplicationShutdown());

    const started = Date.now();
    await expect(prisma.ping(100)).rejects.toThrow('Query read timeout');
    expect(Date.now() - started).toBeLessThan(2000);
    // pg ended the hung connection, so it is not handed out again.
    await until(() => fake.open() === 0);
    expect(fake.open()).toBe(0);

    await expect(prisma.ping(100)).rejects.toThrow('Query read timeout');
    expect(fake.connections()).toBe(2);
  });

  it('asks the server to stop a statement after the read timeout of the API', async () => {
    const fake = await silentServer();
    cleanup.push(fake.close);
    const prisma = new PrismaService({ DATABASE_URL: fake.url });
    cleanup.push(() => prisma.onApplicationShutdown());

    await expect(prisma.ping(50)).rejects.toThrow('Query read timeout');
    expect(fake.startups[0]?.toString('utf8')).toContain(`\0statement_timeout\0${API_QUERY_TIMEOUT_MS}\0`);
  });
});
