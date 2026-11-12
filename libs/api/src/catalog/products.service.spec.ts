import { describe, expect, it, jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '@product-finder/server';
import type { ProductStatus } from '@product-finder/shared';
import type { ProductQueryDto } from './dto/product-query.dto.js';
import type { FacetCountRow } from './facets.query.js';
import type { SummaryRow } from './product.mapper.js';
import { ProductsService } from './products.service.js';
import { decodeCursor, encodeCursor } from './search-cursor.js';

const STATUS: { status: ProductStatus[] } = { status: ['ACTIVE', 'PHASE_OUT'] };

function row(sku: string, name = `Name ${sku}`): SummaryRow {
  return {
    sku,
    name,
    chemicalName: null,
    function: 'Surfactant',
    applicationArea: 'Home Care',
    region: 'EMEA',
    certifications: [],
    status: 'ACTIVE',
    launchYear: null,
    ratingAvg: null,
    reviewCount: 0,
  };
}

/** A PrismaService with jest mocks. $transaction runs the given promises, as the array form does. */
function setup() {
  const queryRaw = jest.fn((..._args: unknown[]): Promise<unknown[]> =>
    Promise.resolve([] as FacetCountRow[]),
  );
  const findMany = jest.fn((_args: Record<string, unknown>): Promise<SummaryRow[]> => Promise.resolve([]));
  const count = jest.fn((_args: unknown) => Promise.resolve(0));
  const prisma = {
    $queryRaw: queryRaw,
    $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
    product: { findMany, count },
  } as unknown as PrismaService;
  return { service: new ProductsService(prisma), queryRaw, findMany, count };
}

describe('ProductsService.facets cache', () => {
  it('misses for a new catalog version', async () => {
    const { service, queryRaw } = setup();
    await service.facets({ ...STATUS }, 'v1');
    await service.facets({ ...STATUS }, 'v2');
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

describe('ProductsService.search paging', () => {
  const query = (fields: Partial<ProductQueryDto>) => fields as ProductQueryDto;

  it('reads one row more than the page, to know whether a next page exists', async () => {
    const { service, findMany } = setup();
    findMany.mockResolvedValueOnce([row('P-1'), row('P-2'), row('P-3')]);
    const page = await service.search(query({ page: 4, pageSize: 2 }));

    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 6, take: 3 });
    expect(page.items.map((item) => item.sku)).toEqual(['P-1', 'P-2']);
    expect(page).toMatchObject({ page: 4, pageSize: 2 });
    expect(decodeCursor(page.nextCursor as string)).toEqual({ sort: 'name', key: 'Name P-2', sku: 'P-2' });
  });

  it('has no next cursor on the last page', async () => {
    const { service, findMany } = setup();
    findMany.mockResolvedValueOnce([row('P-1')]);
    expect((await service.search(query({ pageSize: 2 }))).nextCursor).toBeNull();
  });

  it('starts after the cursor row without an offset, as page 1', async () => {
    const { service, findMany } = setup();
    const cursor = encodeCursor({ sort: 'name', key: 'Beta', sku: 'P-5' });
    const page = await service.search(query({ cursor, pageSize: 2 }));

    const args = findMany.mock.calls[0][0] as { where: { AND: unknown[] }; skip?: number; take: number };
    expect(args.skip).toBeUndefined();
    expect(args.take).toBe(3);
    expect(args.where.AND.at(-1)).toEqual({
      name: { gte: 'Beta' },
      OR: [{ name: { gt: 'Beta' } }, { sku: { gt: 'P-5' } }],
    });
    expect(page).toMatchObject({ page: 1, nextCursor: null });
  });

  it('answers 400 past page * pageSize 10,000 and to a cursor that does not fit, before any SQL', async () => {
    const { service, findMany, queryRaw } = setup();
    /** The `errors` of the problem body: the message list of the BadRequestException. */
    const errorsOf = async (fields: Partial<ProductQueryDto>) => {
      const error = await service.search(query(fields)).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BadRequestException);
      return ((error as BadRequestException).getResponse() as { message: string[] }).message;
    };
    expect(await errorsOf({ page: 201, pageSize: 50 })).toEqual([expect.stringContaining('use cursor')]);
    expect(await errorsOf({ page: 201, pageSize: 50, q: 'x' })).toEqual([
      expect.stringContaining('use cursor'),
    ]);
    expect(await errorsOf({ cursor: 'abc' })).toEqual([expect.stringContaining('cursor is not valid')]);
    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('sends no next cursor for relevance', async () => {
    const { service, queryRaw } = setup();
    queryRaw.mockResolvedValueOnce([row('P-1'), row('P-2')]).mockResolvedValueOnce([{ total: 9 }]);
    const page = await service.search(query({ q: 'soap', pageSize: 2 }));
    expect(page).toMatchObject({ total: 9, nextCursor: null });
    expect(page.items).toHaveLength(2);
  });
});
