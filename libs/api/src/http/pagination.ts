import { ApiPropertyOptional } from '@nestjs/swagger';
import { PAGE_MAX, PAGE_SIZE_MAX } from '@product-finder/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

// Each list has its own default page size: the service applies it, and ApiPageSizeDefault documents it.
export class PaginationQueryDto {
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: PAGE_MAX,
    default: 1,
    example: 1,
    description: 'Page number, from 1.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_MAX)
  page?: number;

  // No default or example here: ApiPageSizeDefault sets both from each list's own constant.
  @ApiPropertyOptional({
    type: 'integer',
    minimum: 1,
    maximum: PAGE_SIZE_MAX,
    description: 'Items per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGE_SIZE_MAX)
  pageSize?: number;
}

// Adds the OpenAPI default of pageSize to a subclass without redeclaring the field.
// The type is repeated, because without one Swagger takes the design type (number) and loses `integer`.
export function ApiPageSizeDefault(size: number): ClassDecorator {
  return (target) => {
    ApiPropertyOptional({ type: 'integer', default: size, example: size })(
      target.prototype as object,
      'pageSize',
    );
  };
}

export function toSkipTake(page: number, pageSize: number): { skip: number; take: number } {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
