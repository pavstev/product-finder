import { describe, expect, it } from '@jest/globals';
import { Controller, Get, Injectable, Module, Param, Query } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiOkResponse, ApiOperation, ApiProperty, type OpenAPIObject } from '@nestjs/swagger';
import { API_PREFIX } from './configure-app.js';
import {
  ApiDatabaseBusyResponse,
  ApiProblemResponse,
  ApiRateLimitResponse,
  ApiSkuParam,
  buildOpenApiDocument,
} from './openapi.js';
import { ApiPageSizeDefault, PaginationQueryDto } from './pagination.js';
import { RETRY_AFTER_SECONDS } from './problem-details.filter.js';
import { RATE_LIMIT_BLOCK_SECONDS } from './rate-limit.guard.js';

class ThingDto {
  @ApiProperty({ type: String, example: 'T-1' })
  id: string;
}

@ApiPageSizeDefault(7)
class ThingQueryDto extends PaginationQueryDto {}

/** Throws when Nest builds it. The emitter runs in preview mode, which must never build providers. */
@Injectable()
class NeedsDatabase {
  constructor() {
    throw new Error('A provider ran.');
  }

  find(id: string): ThingDto {
    return { id };
  }
}

@Controller('things')
class ThingsController {
  constructor(private readonly db: NeedsDatabase) {}

  @Get()
  @ApiOperation({ summary: 'List things.' })
  @ApiOkResponse({ type: ThingDto, isArray: true, description: 'Some things.' })
  listThings(@Query() query: ThingQueryDto): ThingDto[] {
    return [this.db.find(String(query.page))];
  }

  @Get(':sku')
  @ApiOperation({ summary: 'Get one thing.' })
  @ApiSkuParam()
  @ApiOkResponse({ type: ThingDto, description: 'The thing.' })
  @ApiProblemResponse(404, 'No thing has this SKU.')
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  getThing(@Param('sku') sku: string): ThingDto {
    return this.db.find(sku);
  }
}

@Module({ controllers: [ThingsController], providers: [NeedsDatabase] })
class ThingsModule {}

async function documentOf(): Promise<OpenAPIObject> {
  const app = await NestFactory.create(ThingsModule, { preview: true, logger: false });
  app.setGlobalPrefix(API_PREFIX);
  return buildOpenApiDocument(app);
}

const PROBLEM_CONTENT = {
  'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetailsDto' } },
};

describe('buildOpenApiDocument', () => {
  it('names each operation after its controller method, without building providers', async () => {
    const document = await documentOf();
    expect(document.paths['/things'].get?.operationId).toBe('listThings');
    expect(document.paths['/things/{sku}'].get?.operationId).toBe('getThing');
  });

  it('answers errors as problem details, with the Retry-After each one really sends', async () => {
    const document = await documentOf();
    const responses = document.paths['/things/{sku}'].get?.responses ?? {};
    expect(responses['404']).toEqual({ description: 'No thing has this SKU.', content: PROBLEM_CONTENT });
    expect(responses['429']).toMatchObject({
      content: PROBLEM_CONTENT,
      headers: {
        'Retry-After': {
          schema: {
            type: 'integer',
            minimum: 1,
            maximum: RATE_LIMIT_BLOCK_SECONDS,
            example: RATE_LIMIT_BLOCK_SECONDS,
          },
        },
      },
    });
    expect(responses['503']).toMatchObject({
      content: PROBLEM_CONTENT,
      headers: { 'Retry-After': { schema: { type: 'integer', example: RETRY_AFTER_SECONDS } } },
    });
    expect(document.components?.schemas?.ProblemDetailsDto).toMatchObject({
      type: 'object',
      required: ['type', 'title', 'status', 'detail', 'instance'],
    });
  });
});
