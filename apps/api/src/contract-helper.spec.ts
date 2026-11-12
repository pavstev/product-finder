import { beforeAll, describe, expect, it } from '@jest/globals';
import { NestFactory } from '@nestjs/core';
import { buildOpenApiDocument, configureApp } from '@product-finder/api';
import { loadConfig } from '@product-finder/server';
import { type ContractResponse, expectMatchesContract, setContractDocument } from '../test/contract.js';
import { AppModule } from './app.module.js';

// The e2e tests call expectMatchesContract on every response. These tests need no database.
// They prove the helper checks something: a bad body must fail it.
// The document is built in process, in Nest preview mode: no provider is built, so no database is reached.

beforeAll(async () => {
  const app = await NestFactory.create(AppModule, { preview: true, logger: false, abortOnError: false });
  configureApp(app, loadConfig({ DATABASE_URL: 'postgresql://openapi.invalid:5432/openapi' }));
  setContractDocument(buildOpenApiDocument(app));
});

const json = (status: number, body: unknown): ContractResponse => ({
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body,
});

const problem = (status: number, body: unknown): ContractResponse => ({
  status,
  headers: { 'content-type': 'application/problem+json; charset=utf-8' },
  body,
});

describe('expectMatchesContract', () => {
  it('accepts a body that fits the documented schema', () => {
    expect(() => {
      expectMatchesContract(
        json(200, { lastImportAt: null, lastSuccessfulImportAt: null, listedProducts: 0, stale: true }),
        'getCatalogStatus',
      );
    }).not.toThrow();
    expect(() => {
      expectMatchesContract(
        json(200, {
          lastImportAt: '2026-11-12T02:00:00.000Z',
          lastSuccessfulImportAt: '2026-11-12T02:00:00.000Z',
          listedProducts: 169,
          stale: false,
        }),
        'getCatalogStatus',
      );
    }).not.toThrow();
  });

  it('fails a fake body with a missing required field, and names the field', () => {
    const fake = json(200, { lastImportAt: null, lastSuccessfulImportAt: null, stale: true });
    expect(() => {
      expectMatchesContract(fake, 'getCatalogStatus');
    }).toThrow(/listedProducts/);
    expect(() => {
      expectMatchesContract(fake, 'getCatalogStatus');
    }).toThrow(/getCatalogStatus \(GET \/catalog\/status\)/);
  });

  it('fails a field of the wrong type, and reports every error', () => {
    const fake = json(200, {
      lastImportAt: 5,
      lastSuccessfulImportAt: null,
      listedProducts: 'many',
      stale: false,
    });
    expect(() => {
      expectMatchesContract(fake, 'getCatalogStatus');
    }).toThrow(/body\/lastImportAt[\s\S]*body\/listedProducts/);
  });

  it('fails through a nested $ref, such as a page item that has no sku', () => {
    const page = { items: [{}], total: 1, page: 1, pageSize: 20 };
    expect(() => {
      expectMatchesContract(json(200, page), 'searchProducts');
    }).toThrow(/body\/items\/0.*sku/);
  });

  it('checks formats', () => {
    const fake = json(200, {
      lastImportAt: 'yesterday',
      lastSuccessfulImportAt: null,
      listedProducts: 1,
      stale: false,
    });
    expect(() => {
      expectMatchesContract(fake, 'getCatalogStatus');
    }).toThrow(/date-time/);
  });

  it('checks a problem body against the problem schema', () => {
    const ok = {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'Product P-99999 not found.',
      instance: '/api/products/P-99999',
    };
    expect(() => {
      expectMatchesContract(problem(404, ok), 'getProduct');
    }).not.toThrow();
    const { detail: _detail, ...withoutDetail } = ok;
    expect(() => {
      expectMatchesContract(problem(404, withoutDetail), 'getProduct');
    }).toThrow(/detail/);
  });

  it('fails a status the document does not list for the operation', () => {
    expect(() => {
      expectMatchesContract(json(201, { status: 'ok' }), 'getHealth');
    }).toThrow(/does not document/);
  });

  it('fails a content type the document does not list for the status', () => {
    const wrongType = json(404, {
      type: 'about:blank',
      title: 'Not Found',
      status: 404,
      detail: 'x',
      instance: '/',
    });
    expect(() => {
      expectMatchesContract(wrongType, 'getProduct');
    }).toThrow(/application\/json.*does not document/);
  });

  it('accepts a documented answer without a body, such as a 304, and fails one with a body', () => {
    // supertest gives {} as the body of an empty answer.
    const notModified: ContractResponse = { status: 304, headers: {}, body: {} };
    expect(() => {
      expectMatchesContract(notModified, 'getFacets');
    }).not.toThrow();
    expect(() => {
      expectMatchesContract(notModified, 'getCatalogStatus');
    }).not.toThrow();
    expect(() => {
      expectMatchesContract(json(304, { lastImportAt: null }), 'getCatalogStatus');
    }).toThrow(/documents no body/);
  });

  it('fails an unknown operation id', () => {
    expect(() => {
      expectMatchesContract(json(200, {}), 'noSuchOperation');
    }).toThrow(/no operation "noSuchOperation"/);
  });
});
