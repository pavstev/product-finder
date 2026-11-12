import { ApiProperty } from '@nestjs/swagger';
import { PAGE_MAX, PAGE_SIZE_MAX, REVIEW_LIMITS } from '@product-finder/shared';
import { ApiPageSizeDefault, PaginationQueryDto } from '../../http/pagination.js';

export const DEFAULT_REVIEW_PAGE_SIZE = 10;

@ApiPageSizeDefault(DEFAULT_REVIEW_PAGE_SIZE)
export class ReviewQueryDto extends PaginationQueryDto {}

export class ReviewDto {
  @ApiProperty({ type: String, format: 'uuid', example: '0b7e6f0e-4a8c-4d55-9a37-6c1f2f4b9d21' })
  id: string;
  @ApiProperty({
    type: 'integer',
    minimum: REVIEW_LIMITS.rating.min,
    maximum: REVIEW_LIMITS.rating.max,
    example: 5,
  })
  rating: number;
  @ApiProperty({ type: String, nullable: true, example: 'Stable emulsions' })
  title: string | null;
  @ApiProperty({ type: String, example: 'Gives stable emulsions at a low dose. Easy to handle.' })
  body: string;
  @ApiProperty({ type: String, example: 'Ana K.' })
  authorName: string;
  @ApiProperty({ type: String, format: 'date-time', example: '2026-11-10T09:30:00.000Z' })
  createdAt: Date;
}

/** Newest first. Item examples come from the item schema, so the list itself has none. */
export class ReviewPageDto {
  @ApiProperty({ type: ReviewDto, isArray: true })
  items: ReviewDto[];
  @ApiProperty({ type: 'integer', minimum: 0, example: 3, description: 'Reviews across all pages.' })
  total: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: PAGE_MAX, example: 1 })
  page: number;
  @ApiProperty({ type: 'integer', minimum: 1, maximum: PAGE_SIZE_MAX, example: DEFAULT_REVIEW_PAGE_SIZE })
  pageSize: number;
}
