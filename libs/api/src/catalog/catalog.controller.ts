import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isCatalogStale } from '@product-finder/shared';
import type { Request, Response } from 'express';
import { ApiDatabaseBusyResponse, ApiRateLimitResponse } from '../http/openapi.js';
import {
  ApiNotModified,
  CATALOG_CACHE_HEADERS,
  CatalogVersion,
  catalogStatusEtag,
  notModified,
} from './catalog-version.js';
import { CatalogService } from './catalog.service.js';
import { CatalogStatusDto } from './dto/catalog-status.dto.js';

// The method name is the operationId in the OpenAPI document. Plain reads, no transaction.
@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly catalogVersion: CatalogVersion,
  ) {}

  @Get('status')
  @ApiOperation({
    summary: 'Get the time of the last import, whether it is stale and the number of listed products.',
  })
  @ApiOkResponse({
    type: CatalogStatusDto,
    description: 'The catalogue status.',
    headers: CATALOG_CACHE_HEADERS,
  })
  @ApiNotModified()
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  async getCatalogStatus(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CatalogStatusDto | undefined> {
    // `stale` flips with time alone, so the ETag holds it and lastSuccessfulImportAt, not only the version.
    // The status reads after this, so the body is never older than the ETag.
    const latest = await this.catalogVersion.latest();
    const stale = isCatalogStale(latest.finishedAt, new Date());
    if (notModified(req, res, catalogStatusEtag(latest.version, latest.finishedAt, stale))) {
      return undefined;
    }
    return this.catalog.status();
  }
}
