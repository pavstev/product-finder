import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { REVIEW_LIMITS } from '@product-finder/shared';
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { IsPlainText, TextLength } from '../../http/text-validators.js';
import { trimString, trimToUndefined } from '../../http/transforms.js';

// Body of POST /api/products/:sku/reviews. Strings are trimmed before the checks. Lengths count code points.
export class CreateReviewDto {
  @ApiProperty({
    type: 'integer',
    minimum: REVIEW_LIMITS.rating.min,
    maximum: REVIEW_LIMITS.rating.max,
    example: 5,
  })
  @IsInt()
  @Min(REVIEW_LIMITS.rating.min)
  @Max(REVIEW_LIMITS.rating.max)
  rating: number;

  // IsOptional lets null through and the service stores null, so the contract says nullable.
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    minLength: REVIEW_LIMITS.title.min,
    maxLength: REVIEW_LIMITS.title.max,
    example: 'Stable emulsions',
    description: 'Trimmed first. Leave it out, or send null or blank text, for no title.',
  })
  @IsOptional()
  @Transform(({ value }) => trimToUndefined(value))
  @IsString()
  @TextLength(REVIEW_LIMITS.title.min, REVIEW_LIMITS.title.max)
  @IsPlainText()
  title?: string | null;

  @ApiProperty({
    type: String,
    minLength: REVIEW_LIMITS.body.min,
    maxLength: REVIEW_LIMITS.body.max,
    example: 'Gives stable emulsions at a low dose. Easy to handle.',
    description: 'Trimmed first. Plain text: line breaks and tabs are fine, other control characters not.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @TextLength(REVIEW_LIMITS.body.min, REVIEW_LIMITS.body.max)
  @IsPlainText()
  body: string;

  @ApiProperty({
    type: String,
    minLength: REVIEW_LIMITS.authorName.min,
    maxLength: REVIEW_LIMITS.authorName.max,
    example: 'Ana K.',
    description: 'Trimmed first. Shown with the review.',
  })
  @Transform(({ value }) => trimString(value))
  @IsString()
  @TextLength(REVIEW_LIMITS.authorName.min, REVIEW_LIMITS.authorName.max)
  @IsPlainText()
  authorName: string;
}
