import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { createTestApp, expectProblem } from './helpers.js';

// Port 1 refuses the connection, so this app has a database that is down.
const DEAD_DATABASE_URL = 'postgresql://product_finder:product_finder@127.0.0.1:1/product_finder_test';

describe('probes with the database down', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp(DEAD_DATABASE_URL));
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/ready is a 503 problem, within about a second', async () => {
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/api/health/ready');
    expect(Date.now() - started).toBeLessThan(2500);
    const body = expectProblem(res, 503, 'getReadiness');
    expect(body.detail).toBe('Database is not reachable.');
  });

  it('GET /api/health is the same 503 problem', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expectProblem(res, 503, 'getHealth');
  });
});
