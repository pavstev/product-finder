import type { INestApplication } from '@nestjs/common';
import {
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  DocumentBuilder,
  getSchemaPath,
  type HeaderObject,
  type OpenAPIObject,
  SwaggerModule,
} from '@nestjs/swagger';
import { MAX_SKU_LENGTH, PAGE_SIZE_MAX } from '@product-finder/shared';
import { API_PREFIX } from './configure-app.js';
import { PROBLEM_CONTENT_TYPE, type ProblemDetails, RETRY_AFTER_SECONDS } from './problem-details.filter.js';
import { RATE_LIMIT_BLOCK_SECONDS } from './rate-limit.guard.js';

// `info.version` of the OpenAPI document, bumped by hand. The catalog ETags hash it, so a changed answer never gets a 304.
export const API_CONTRACT_VERSION = '2.2.1';

// A real validation message of the API, for the examples.
const VALIDATION_EXAMPLE = `pageSize must not be greater than ${PAGE_SIZE_MAX}`;

// Every error body (RFC 9457). It implements the filter's ProblemDetails, so the two cannot drift apart.
export class ProblemDetailsDto implements ProblemDetails {
  @ApiProperty({
    type: String,
    example: 'about:blank',
    description: 'Always about:blank. The status code says what kind of problem it is.',
  })
  type: string;

  @ApiProperty({ type: String, example: 'Bad Request', description: 'The standard text of the status code.' })
  title: string;

  @ApiProperty({ type: 'integer', minimum: 400, maximum: 599, example: 400 })
  status: number;

  @ApiProperty({
    type: String,
    example: VALIDATION_EXAMPLE,
    description: 'What went wrong, for people. A validation error joins its messages with "; ".',
  })
  detail: string;

  @ApiProperty({
    type: String,
    example: '/api/products',
    description: 'The request path, without the query string.',
  })
  instance: string;

  @ApiPropertyOptional({
    type: String,
    isArray: true,
    example: [VALIDATION_EXAMPLE],
    description: 'The validation messages. Only a 400 from validation has them.',
  })
  errors?: string[];
}

// The 429 text of a route under the `read` limit.
const READ_LIMIT_TEXT = 'Too many requests from this IP in a minute. Retry after the Retry-After seconds.';

// The 503 text of a busy database.
const DATABASE_BUSY_TEXT = 'The database is busy. Retry after the Retry-After seconds.';

// RateLimitGuard sends the time left in the block: the full window first, then less.
const RATE_LIMIT_RETRY_AFTER: HeaderObject = {
  description: 'Seconds until this IP may send again.',
  schema: {
    type: 'integer',
    minimum: 1,
    maximum: RATE_LIMIT_BLOCK_SECONDS,
    example: RATE_LIMIT_BLOCK_SECONDS,
  },
};

// ProblemDetailsFilter sends a fixed wait for a busy database.
const DATABASE_BUSY_RETRY_AFTER: HeaderObject = {
  description: 'Seconds to wait before the next try.',
  schema: { type: 'integer', minimum: 1, example: RETRY_AFTER_SECONDS },
};

function problemResponse(status: number, description: string, retryAfter?: HeaderObject) {
  return ApiResponse({
    status,
    description,
    content: { [PROBLEM_CONTENT_TYPE]: { schema: { $ref: getSchemaPath(ProblemDetailsDto) } } },
    ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}),
  });
}

/** An error answer of a route: a problem body, sent as application/problem+json. */
export function ApiProblemResponse(status: number, description: string): MethodDecorator & ClassDecorator {
  return problemResponse(status, description);
}

/** The 429 of the rate limit, with its Retry-After. */
export function ApiRateLimitResponse(description = READ_LIMIT_TEXT): MethodDecorator & ClassDecorator {
  return problemResponse(429, description, RATE_LIMIT_RETRY_AFTER);
}

/** The 503 for a busy database, with its Retry-After. Every route that reads the database can get it. */
export function ApiDatabaseBusyResponse(): MethodDecorator & ClassDecorator {
  return problemResponse(503, DATABASE_BUSY_TEXT, DATABASE_BUSY_RETRY_AFTER);
}

/** The `:sku` path parameter, with the limits that ParseSkuPipe checks. */
export function ApiSkuParam(): MethodDecorator & ClassDecorator {
  return ApiParam({
    name: 'sku',
    description: 'Trimmed first. Any case works. No control or format characters.',
    schema: { type: 'string', minLength: 1, maxLength: MAX_SKU_LENGTH, example: 'P-10001' },
  });
}

/** The OpenAPI document of the app. Paths leave out the global prefix, which the server URL holds. */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Product Finder API')
    .setDescription('Search the BASF Care Chemicals catalogue and read or write product reviews.')
    .setVersion(API_CONTRACT_VERSION)
    .addServer(`/${API_PREFIX}`, 'The API on the host that serves this document.')
    .build();
  // No route needs a sign-in.
  return SwaggerModule.createDocument(
    app,
    { ...config, security: [] },
    {
      ignoreGlobalPrefix: true,
      operationIdFactory: (_controller, method) => method,
      extraModels: [ProblemDetailsDto],
    },
  );
}

/** Swagger UI at /api/docs. */
export function setupSwagger(app: INestApplication): void {
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApiDocument(app));
}

// Arrays keep their order, because in OpenAPI it can carry meaning.
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    return Object.fromEntries(keys.map((key) => [key, sortKeys(object[key])]));
  }
  return value;
}

/** JSON with sorted keys at every depth, so the same content gives the same bytes on every machine. */
export function toStableJson(value: unknown): string {
  return `${JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value))), null, 2)}\n`;
}
