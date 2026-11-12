import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiDatabaseBusyResponse,
  ApiProblemResponse,
  ApiRateLimitResponse,
  ApiSkuParam,
} from '../http/openapi.js';
import { ParseSkuPipe } from '../http/parse-sku.pipe.js';
import { CreateReviewDto } from './dto/create-review.dto.js';
import { ReviewDto, ReviewPageDto, ReviewQueryDto } from './dto/review.dto.js';
import { ReviewsService } from './reviews.service.js';

const NO_PRODUCT = 'No product has this SKU.';

// The method names are the operationIds in the OpenAPI document. The generated client uses them.
// Both routes run a transaction, so both can get the busy-database 503.
@ApiTags('reviews')
@Controller('products/:sku/reviews')
@ApiSkuParam()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'List the reviews of a product, newest first. Works for every product.' })
  @ApiOkResponse({ type: ReviewPageDto, description: 'One page of reviews.' })
  @ApiProblemResponse(400, 'The SKU or a page value is not valid.')
  @ApiProblemResponse(404, NO_PRODUCT)
  @ApiRateLimitResponse()
  @ApiDatabaseBusyResponse()
  listReviews(
    @Param('sku', ParseSkuPipe) sku: string,
    @Query() query: ReviewQueryDto,
  ): Promise<ReviewPageDto> {
    return this.reviews.list(sku, query);
  }

  // The only write flow, open to anyone, so it counts against the tight `write` limit only.
  @Post()
  @ApiOperation({ summary: 'Add a review to a product that is still sold.' })
  @ApiCreatedResponse({ type: ReviewDto, description: 'The stored review.' })
  @ApiProblemResponse(400, 'The SKU or the body is not valid. `errors` lists each validation problem.')
  @ApiProblemResponse(404, NO_PRODUCT)
  @ApiProblemResponse(409, 'The product is discontinued or not in the current catalogue.')
  @ApiProblemResponse(413, 'The body is larger than the JSON parser accepts.')
  @ApiRateLimitResponse('Too many reviews from this IP in a minute. Retry after the Retry-After seconds.')
  @ApiDatabaseBusyResponse()
  createReview(@Param('sku', ParseSkuPipe) sku: string, @Body() dto: CreateReviewDto): Promise<ReviewDto> {
    return this.reviews.create(sku, dto);
  }
}
