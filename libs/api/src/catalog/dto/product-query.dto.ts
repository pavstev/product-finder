import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional, PickType } from '@nestjs/swagger';
import {
  DEFAULT_SORT,
  DEFAULT_VISIBLE_STATUSES,
  FACET_VALUE_MAX,
  hasSearchText,
  LIST_ITEMS_MAX,
  PAGE_DEPTH_MAX,
  PRODUCT_STATUSES,
  type ProductStatus,
  RELEVANCE_SORT,
  SEARCH_QUERY_MAX,
  SORT_KEYS,
  type SortKey,
} from '@product-finder/shared';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateBy,
  type ValidationArguments,
} from 'class-validator';
import { ApiPageSizeDefault, PaginationQueryDto } from '../../http/pagination.js';
import { IsPlainText } from '../../http/text-validators.js';
import { toList, trimToUndefined } from '../../http/transforms.js';
import { MAX_TERMS, type ProductSearch } from '../products.query.js';
import { CURSOR_MAX_LENGTH, cursorProblem } from '../search-cursor.js';
import { PRODUCT_STATUS_ENUM } from './enums.js';

export const DEFAULT_PRODUCT_PAGE_SIZE = 20;

// The validators of a comma-list filter. Listed in reverse so they register in the order of the old stacked decorators.
function StringListFilter(): PropertyDecorator {
  return applyDecorators(
    IsPlainText({ each: true }),
    MaxLength(FACET_VALUE_MAX, { each: true }),
    IsString({ each: true }),
    ArrayMaxSize(LIST_ITEMS_MAX),
    IsArray(),
    Transform(({ value }) => toList(value)),
    IsOptional(),
  );
}

// Swagger keeps `style` and `explode` on the query parameter. They are spread in, because the ApiProperty options type does not list them.
// The contract names the comma form, which the web client sends. toList also takes repeated keys.
const COMMA_LIST = { style: 'form', explode: false } as const;
const COMMA_LIST_TEXT = 'Comma-separated. Repeated keys work too.';

// Swagger moves no maxLength into the items of a query list, so the description states it.
function listFilter(description: string, example: string[]) {
  return {
    ...COMMA_LIST,
    type: String,
    isArray: true,
    maxItems: LIST_ITEMS_MAX,
    description: `${description} ${COMMA_LIST_TEXT} Each value has at most ${FACET_VALUE_MAX} characters.`,
    example,
  };
}

// A key sent more than once reaches the validators as an array (`?q=a&q=b`).
// A rule that reads another field skips such a value: that field's own IsString or IsIn reports it.
function isTextOrMissing(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function queryOf(args?: ValidationArguments): Record<string, unknown> {
  return (args?.object ?? {}) as Record<string, unknown>;
}

// The relevance sort ranks by the search text, so it needs one. `q` is trimmed before this runs.
function RelevanceNeedsSearchText(): PropertyDecorator {
  return ValidateBy({
    name: 'relevanceNeedsSearchText',
    validator: {
      validate: (value: unknown, args?: ValidationArguments) => {
        const { q } = queryOf(args);
        return value !== RELEVANCE_SORT || !isTextOrMissing(q) || hasSearchText(q);
      },
      defaultMessage: () => `sort ${RELEVANCE_SORT} needs a search text in q`,
    },
  });
}

// A cursor fits only its own sort, never relevance, and never with page (cursorProblem).
function CursorFitsQuery(): PropertyDecorator {
  const problem = (args?: ValidationArguments) => {
    const query = queryOf(args);
    if (typeof args?.value !== 'string' || !isTextOrMissing(query.q) || !isTextOrMissing(query.sort)) {
      return undefined;
    }
    return cursorProblem(args.value, query);
  };
  return ValidateBy({
    name: 'cursorFitsQuery',
    validator: {
      validate: (_value: unknown, args?: ValidationArguments) => problem(args) === undefined,
      defaultMessage: (args?: ValidationArguments) => problem(args) ?? 'cursor is not valid',
    },
  });
}

// The OpenAPI text of `page` here: the depth rule. The service checks the rule, not a validator,
// because class-validator drops the inherited validators of a property when a subclass adds one.
function ApiPageDepth(): ClassDecorator {
  return (target) => {
    ApiPropertyOptional({
      type: 'integer',
      description: `Page number, from 1. page * pageSize must be at most ${PAGE_DEPTH_MAX}, else 400: use cursor to read further.`,
    })(target.prototype as object, 'page');
  };
}

/** Query of GET /api/products. Lists are comma-separated (`?region=EMEA,Global`). */
@ApiPageSizeDefault(DEFAULT_PRODUCT_PAGE_SIZE)
@ApiPageDepth()
export class ProductQueryDto extends PaginationQueryDto implements ProductSearch {
  @ApiPropertyOptional({
    type: String,
    maxLength: SEARCH_QUERY_MAX,
    example: 'glucoside home',
    description: `Words to find in name, SKU, chemistry and text. Every word must match. The first ${MAX_TERMS} words count.`,
  })
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX)
  @IsPlainText()
  q?: string;

  @ApiPropertyOptional(listFilter('Functions. Any of them matches.', ['Surfactant', 'Emulsifier']))
  @StringListFilter()
  function?: string[];

  @ApiPropertyOptional(listFilter('Application areas. Any of them matches.', ['Home Care']))
  @StringListFilter()
  applicationArea?: string[];

  @ApiPropertyOptional(listFilter('Regions. Any of them matches. Global products always match.', ['EMEA']))
  @StringListFilter()
  region?: string[];

  @ApiPropertyOptional(listFilter('Certifications. A product must have all of them.', ['Halal', 'Vegan']))
  @StringListFilter()
  certifications?: string[];

  @ApiPropertyOptional({
    ...COMMA_LIST,
    ...PRODUCT_STATUS_ENUM,
    isArray: true,
    example: [...DEFAULT_VISIBLE_STATUSES],
    description: `Statuses to list. Default ${DEFAULT_VISIBLE_STATUSES.join(',')}. Add DISCONTINUED to include it. ${COMMA_LIST_TEXT}`,
  })
  @IsOptional()
  @Transform(({ value }) => toList(value))
  @IsArray()
  @IsIn(PRODUCT_STATUSES, { each: true })
  status?: ProductStatus[];

  @ApiPropertyOptional({
    type: 'string',
    enum: [...SORT_KEYS],
    enumName: 'ProductSort',
    example: '-rating',
    // Swagger turns an enum query parameter into a bare $ref and drops `default`, so the text says it.
    // The default depends on q, so there is no single `default` value.
    description:
      `Sort key. Default ${RELEVANCE_SORT} when q is set, else ${DEFAULT_SORT}. ` +
      `${RELEVANCE_SORT} puts an exact SKU first, then SKUs that start with q, then names most like q, then by name. ` +
      `${RELEVANCE_SORT} needs q: without q it is a 400. ${RELEVANCE_SORT} has no cursor. ` +
      'A leading - sorts descending. Products without a value for the key come last. Any other key is a 400.',
  })
  @IsOptional()
  @IsIn(SORT_KEYS)
  @RelevanceNeedsSearchText()
  sort?: SortKey;

  @ApiPropertyOptional({
    type: String,
    maxLength: CURSOR_MAX_LENGTH,
    example: 'eyJ2IjoxLCJzb3J0IjoibmFtZSIsImtleSI6IlF1b3JpbiBTRiA0NzAiLCJza3UiOiJQLTEwMDAxIn0',
    description:
      'The nextCursor of an earlier answer. The page then starts after the last row of that answer, ' +
      'with no offset. Send the same filters and sort again. ' +
      'A cursor holds only the sort key and SKU of that row, not the filters: with other filters, ' +
      'the page has the rows of the current search after that key. It is not a security token. ' +
      `Page numbers stop at page * pageSize = ${PAGE_DEPTH_MAX}. Use a cursor to read further. ` +
      `Not with page. Not with sort ${RELEVANCE_SORT}, which is the default when q is set: set another sort to use a cursor. ` +
      'A cursor of another sort, or one that is not a nextCursor, is a 400.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(CURSOR_MAX_LENGTH)
  @CursorFitsQuery()
  cursor?: string;
}

/** Query of GET /api/products/facets: the filters of the search, with the same rules. */
export class FacetQueryDto extends PickType(ProductQueryDto, [
  'q',
  'function',
  'applicationArea',
  'region',
  'certifications',
  'status',
] as const) {}
