import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAGE_MAX,
  PAGE_SIZE_MAX,
  PRODUCT_STATUSES,
  type ProductStatus,
  REVIEW_LIMITS,
} from '@product-finder/shared';
import { PRODUCT_STATUS_ENUM } from './enums.js';
import { DEFAULT_PRODUCT_PAGE_SIZE } from './product-query.dto.js';

export class ProductSummaryDto {
  @ApiProperty({
    type: String,
    example: 'P-10001',
    description: 'Stored upper-case. A link may use any case.',
  })
  sku: string;
  @ApiProperty({ type: String, example: 'Quorin SF 470' })
  name: string;
  @ApiProperty({ type: String, nullable: true, example: 'Sodium Laureth Sulfate' })
  chemicalName: string | null;
  @ApiProperty({ type: String, example: 'Surfactant' })
  function: string;
  @ApiProperty({ type: String, example: 'Home Care' })
  applicationArea: string;
  @ApiProperty({ type: String, example: 'EMEA' })
  region: string;
  @ApiProperty({ type: String, isArray: true, example: ['Kosher', 'RSPO Mass Balance'] })
  certifications: string[];
  @ApiProperty({ ...PRODUCT_STATUS_ENUM, example: 'ACTIVE' })
  status: ProductStatus;
  @ApiProperty({ type: 'integer', nullable: true, example: 2012 })
  launchYear: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    minimum: REVIEW_LIMITS.rating.min,
    maximum: REVIEW_LIMITS.rating.max,
    example: 4.5,
    description: 'Mean rating. Null until the first review.',
  })
  ratingAvg: number | null;
  @ApiProperty({ type: 'integer', minimum: 0, example: 2 })
  reviewCount: number;
}

export class ProductDetailDto extends ProductSummaryDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: 'Mild anionic surfactant for dishwashing liquids and hand soaps.',
  })
  description: string | null;
  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'False when the latest PIM export no longer contains the product.',
  })
  inLatestExport: boolean;
  @ApiProperty({
    type: Boolean,
    example: true,
    description: 'False for discontinued products and products outside the export.',
  })
  reviewable: boolean;
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-01T02:00:00.000Z' })
  updatedAt: Date;
}

/** Item examples come from the item schema, so the list itself has none. */
export class ProductPageDto {
  @ApiProperty({ type: ProductSummaryDto, isArray: true })
  items: ProductSummaryDto[];
  @ApiProperty({ type: 'integer', minimum: 0, example: 128, description: 'Matches across all pages.' })
  total: number;
  @ApiProperty({
    type: 'integer',
    minimum: 1,
    maximum: PAGE_MAX,
    example: 1,
    description: 'The page number. 1 on a page asked for with a cursor: it counts from the cursor.',
  })
  page: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: PAGE_SIZE_MAX, example: DEFAULT_PRODUCT_PAGE_SIZE })
  pageSize: number;
  // Optional in the contract, so clients built before 2.1.0 and other page types still fit.
  // The search always sends it.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'eyJ2IjoxLCJzb3J0IjoibmFtZSIsImtleSI6IlF1b3JpbiBTRiA0NzAiLCJza3UiOiJQLTEwMDAxIn0',
    description:
      'Send it as `cursor`, with the same filters and sort, for the page after this one. ' +
      'Null on the last page and for sort relevance, which has no cursor.',
  })
  nextCursor?: string | null;
}

export class FacetValueDto {
  @ApiProperty({ type: String, example: 'EMEA', description: 'A filter value, as the search takes it.' })
  value: string;
  @ApiProperty({
    type: 'integer',
    minimum: 0,
    example: 1204,
    description: 'Matches of a search with this value and the other filters. 0 when the filters leave none.',
  })
  count: number;
}

const FACET_TEXT = 'Every value of the listed products, sorted, with its count under the other filters.';

/** Item examples come from FacetValueDto, so the lists have none. */
export class FacetsDto {
  @ApiProperty({ type: FacetValueDto, isArray: true, description: FACET_TEXT })
  functions: FacetValueDto[];
  @ApiProperty({ type: FacetValueDto, isArray: true, description: FACET_TEXT })
  applicationAreas: FacetValueDto[];
  @ApiProperty({
    type: FacetValueDto,
    isArray: true,
    description: `${FACET_TEXT} A region search also lists Global products, so every other region counts them too.`,
  })
  regions: FacetValueDto[];
  @ApiProperty({
    type: FacetValueDto,
    isArray: true,
    description: `${FACET_TEXT} A product must have every certification, so these counts keep the certification filter: they say how many products are left if the value is picked too.`,
  })
  certifications: FacetValueDto[];
  @ApiProperty({
    ...PRODUCT_STATUS_ENUM,
    isArray: true,
    example: [...PRODUCT_STATUSES],
    description:
      'Always all three statuses, without counts: status picks what is listed, so it is a switch, not a filter list.',
  })
  statuses: ProductStatus[];
}
