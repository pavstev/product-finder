import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createSearchMetrics, type SearchMetrics, startTimer } from '@product-finder/server';
import { PAGE_DEPTH_MAX } from '@product-finder/shared';
import type { Request, Response } from 'express';
import {
  ApiDatabaseBusyResponse,
  ApiProblemResponse,
  ApiRateLimitResponse,
  ApiSkuParam,
} from '../http/openapi.js';
import { ParseSkuPipe } from '../http/parse-sku.pipe.js';
import {
  ApiNotModified,
  CATALOG_CACHE_HEADERS,
  CatalogVersion,
  catalogEtag,
  notModified,
} from './catalog-version.js';
import { FacetQueryDto, ProductQueryDto } from './dto/product-query.dto.js';
import { FacetsDto, ProductDetailDto, ProductPageDto } from './dto/product.dto.js';
import { facetQueryKey, normalizeFacetSearch } from './facets.query.js';
import { ProductsService } from './products.service.js';

// The method names are the operationIds in the OpenAPI document. The generated client uses them.
// Every route here reads the database, so each can get the busy-database 503.
@ApiTags('products')
@Controller('products')
export class ProductsController {
  // product_search_duration_seconds. Test seam.
  searchMetrics: SearchMetrics = createSearchMetrics();

  constructor(
    private readonly products: ProductsService,
    private readonly catalogVersion: CatalogVersion,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Search the listed products, one page at a time.',
    description:
      `Page by \`page\`, up to page * pageSize = ${PAGE_DEPTH_MAX}, or by \`cursor\` to any depth. ` +
      'Each answer holds `nextCursor` for the page after it. Sort relevance pages by `page` only.',
  })
  @ApiOkResponse({ type: ProductPageDto, description: 'One page of matches.' })
  @ApiProblemResponse(
    400,
    'A query value is not valid. `errors` lists each problem. ' +
      `Also a page past page * pageSize = ${PAGE_DEPTH_MAX} (the text says to use cursor), ` +
      'and a cursor with page, with sort relevance or of another sort.',
  )
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  async searchProducts(@Query() query: ProductQueryDto): Promise<ProductPageDto> {
    // Every search counts, also a failed one. `q` is trimmed, and a blank one is undefined.
    const elapsed = startTimer();
    try {
      return await this.products.search(query);
    } finally {
      this.searchMetrics.record(elapsed(), query.q !== undefined);
    }
  }

  @Get('facets')
  @ApiOperation({
    summary: 'List the filter values among the listed products, with counts for the search filters.',
    description:
      'Each function, application area and region count uses every filter except its own. ' +
      'The certification counts use every filter. Values follow `status` only, so a value can count 0.',
  })
  @ApiOkResponse({
    type: FacetsDto,
    description: 'The filter values, sorted, with counts.',
    headers: CATALOG_CACHE_HEADERS,
  })
  @ApiNotModified()
  @ApiProblemResponse(400, 'A query value is not valid. `errors` lists each problem.')
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  async getFacets(
    @Query() query: FacetQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FacetsDto | undefined> {
    const version = await this.catalogVersion.current();
    const search = normalizeFacetSearch(query);
    if (notModified(req, res, catalogEtag(version, facetQueryKey(search)))) {
      return undefined;
    }
    return this.products.facets(search, version);
  }

  @Get(':sku')
  @ApiOperation({ summary: 'Get one product. Works for every product ever imported.' })
  @ApiSkuParam()
  @ApiOkResponse({ type: ProductDetailDto, description: 'The product.' })
  @ApiProblemResponse(400, 'The SKU is empty, too long or has control characters.')
  @ApiProblemResponse(404, 'No product has this SKU.')
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  getProduct(@Param('sku', ParseSkuPipe) sku: string): Promise<ProductDetailDto> {
    return this.products.findBySku(sku);
  }
}
