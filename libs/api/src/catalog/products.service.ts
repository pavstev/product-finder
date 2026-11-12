import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@product-finder/server';
import { normalizeSku, RELEVANCE_SORT } from '@product-finder/shared';
import { toSkipTake } from '../http/pagination.js';
import { DEFAULT_PRODUCT_PAGE_SIZE, type ProductQueryDto } from './dto/product-query.dto.js';
import type { FacetsDto, ProductDetailDto, ProductPageDto } from './dto/product.dto.js';
import {
  buildFacetSql,
  type FacetCountRow,
  facetCacheKey,
  hasFacetFilters,
  toFacets,
} from './facets.query.js';
import { LruCache } from './lru-cache.js';
import { SUMMARY_SELECT, type SummaryRow, toDetail, toSummary } from './product.mapper.js';
import {
  buildOrderBy,
  buildSearchSql,
  buildWhere,
  effectiveSort,
  type PagedSearch,
  type ProductSearch,
  pageDepthProblem,
} from './products.query.js';
import { cursorAfter, cursorProblem, decodeCursor, encodeCursor, keysetWhere } from './search-cursor.js';

// Facets per catalog version and normalized query, per API process.
const FACET_CACHE = { maxEntries: 500, ttlMs: 60_000 } as const;

@Injectable()
export class ProductsService {
  // Holds the pending answer, so equal requests that arrive together run the SQL once. A failed load removes its entry.
  private readonly facetCache = new LruCache<Promise<FacetsDto>>(FACET_CACHE);

  constructor(private readonly prisma: PrismaService) {}

  /** One page by offset or after a cursor. Both read one extra row to know if nextCursor exists. */
  async search(query: ProductQueryDto): Promise<ProductPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PRODUCT_PAGE_SIZE;
    const problem =
      query.cursor === undefined ? pageDepthProblem(page, pageSize) : cursorProblem(query.cursor, query);
    if (problem) {
      throw new BadRequestException([problem]);
    }
    const sort = effectiveSort(query);
    if (sort === RELEVANCE_SORT) {
      return this.searchByRelevance({
        q: query.q,
        function: query.function,
        applicationArea: query.applicationArea,
        region: query.region,
        certifications: query.certifications,
        status: query.status,
        sort: query.sort,
        page,
        pageSize,
      });
    }
    // cursorProblem has checked the cursor, so it decodes, and for this sort.
    const cursor = query.cursor === undefined ? undefined : decodeCursor(query.cursor);
    const where = buildWhere(query);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where: cursor ? { AND: [...where.AND, keysetWhere(cursor)] } : where,
        orderBy: buildOrderBy(sort),
        select: SUMMARY_SELECT,
        skip: cursor ? undefined : toSkipTake(page, pageSize).skip,
        take: pageSize + 1,
      }),
      this.prisma.product.count({ where }),
    ]);
    const items = rows.slice(0, pageSize);
    const last = items.at(-1);
    return {
      items: items.map(toSummary),
      total,
      // With a cursor, page is 1: the DTO refuses page and cursor together.
      page,
      pageSize,
      nextCursor: rows.length > pageSize && last ? encodeCursor(cursorAfter(sort, last)) : null,
    };
  }

  // Prisma cannot order by word_similarity(), so relevance runs raw SQL: the page and the count. No cursor.
  private async searchByRelevance(search: PagedSearch): Promise<ProductPageDto> {
    const sql = buildSearchSql(search);
    const [rows, counted] = await this.prisma.$transaction([
      this.prisma.$queryRaw<SummaryRow[]>(sql.page),
      this.prisma.$queryRaw<{ total: number }[]>(sql.count),
    ]);
    return {
      items: rows.map(toSummary),
      total: counted[0].total,
      page: search.page,
      pageSize: search.pageSize,
      nextCursor: null,
    };
  }

  /** Filter values and counts for a normalized facet search, cached per catalog version. */
  facets(search: ProductSearch, version: string): Promise<FacetsDto> {
    const key = facetCacheKey(version, search);
    const cached = this.facetCache.get(key);
    if (cached) {
      return cached;
    }
    const loading = this.loadFacets(search, version);
    this.facetCache.set(key, loading);
    loading.catch(() => {
      this.facetCache.deleteIfSame(key, loading);
    });
    return loading;
  }

  // One statement. With filters, the values come from the unfiltered facets, which are cached too.
  private async loadFacets(search: ProductSearch, version: string): Promise<FacetsDto> {
    const [rows, base] = await Promise.all([
      this.prisma.$queryRaw<FacetCountRow[]>(buildFacetSql(search)),
      hasFacetFilters(search) ? this.facets({ status: search.status }, version) : undefined,
    ]);
    return toFacets(rows, base);
  }

  // Works for every product ever imported, so shared links never break.
  async findBySku(sku: string): Promise<ProductDetailDto> {
    const product = await this.prisma.product.findUnique({ where: { sku: normalizeSku(sku) } });
    if (!product) {
      throw new NotFoundException(`Product ${normalizeSku(sku)} not found.`);
    }
    return toDetail(product);
  }
}
