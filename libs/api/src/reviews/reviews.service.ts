import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  type LoggerService,
  NotFoundException,
} from '@nestjs/common';
import {
  APP_CONFIG,
  type AppConfig,
  createReviewMetrics,
  incrementRating,
  PrismaService,
  type ReviewMetrics,
} from '@product-finder/server';
import { isReviewable, normalizeSku } from '@product-finder/shared';
import { toSkipTake } from '../http/pagination.js';
import type { CreateReviewDto } from './dto/create-review.dto.js';
import {
  DEFAULT_REVIEW_PAGE_SIZE,
  type ReviewDto,
  type ReviewPageDto,
  type ReviewQueryDto,
} from './dto/review.dto.js';

const REVIEW_SELECT = {
  id: true,
  rating: true,
  title: true,
  body: true,
  authorName: true,
  createdAt: true,
} as const;

// Limits of the review write transaction, in milliseconds.
interface ReviewTransactionLimits {
  maxWait: number;
  timeout: number;
}

// Node runs a timer longer than this after 1 ms. PostgreSQL's lock_timeout has the same limit.
const MAX_MILLIS = 2_147_483_647;

function isMillis(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= MAX_MILLIS;
}

/** SET LOCAL takes no bind parameters, so the value is checked here before it goes into the text. */
export function lockTimeoutStatement(ms: number): string {
  if (!isMillis(ms)) {
    throw new Error(`The lock timeout must be a whole number of milliseconds from 1 to ${MAX_MILLIS}.`);
  }
  return `SET LOCAL lock_timeout = '${ms}ms'`;
}

type ProductRef = { id: string; sku: string } & Parameters<typeof isReviewable>[0];

function notReviewable(sku: string): ConflictException {
  return new ConflictException(
    `Product ${sku} is no longer sold, so it cannot get new reviews. Existing reviews stay visible.`,
  );
}

@Injectable()
export class ReviewsService {
  // Test seam: runs inside the transaction after the insert, before the aggregate update.
  beforeAggregateUpdate?: () => Promise<void>;

  readonly transactionLimits: ReviewTransactionLimits;

  // Test seam. Only the sku, the rating and the outcome are logged: never the text or the author.
  logger: Pick<LoggerService, 'log'> = new Logger(ReviewsService.name);

  // reviews_created_total, counted after the transaction commits. Test seam.
  metrics: ReviewMetrics = createReviewMetrics();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) config: Pick<AppConfig, 'REVIEW_TX_MAX_WAIT_MS' | 'REVIEW_TX_TIMEOUT_MS'>,
  ) {
    this.transactionLimits = {
      maxWait: config.REVIEW_TX_MAX_WAIT_MS,
      timeout: config.REVIEW_TX_TIMEOUT_MS,
    };
  }

  /** Newest first. Works for every product, also discontinued ones. */
  async list(sku: string, query: ReviewQueryDto): Promise<ReviewPageDto> {
    const product = await this.findProduct(sku);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_REVIEW_PAGE_SIZE;
    const where = { productId: product.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.review.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: REVIEW_SELECT,
        ...toSkipTake(page, pageSize),
      }),
      this.prisma.review.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  /**
   * Stores the review and updates the product aggregates in one transaction (see incrementRating).
   * A row lock held longer than the transaction timeout, such as the nightly import, ends the wait with a 503.
   */
  async create(sku: string, dto: CreateReviewDto): Promise<ReviewDto> {
    const product = await this.findProduct(sku);
    try {
      const review = await this.store(product, dto);
      this.metrics.created();
      this.logger.log({ sku: product.sku, rating: dto.rating, outcome: 'created' }, 'Review created');
      return review;
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.log(
          { sku: product.sku, rating: dto.rating, outcome: 'not_reviewable' },
          'Review not stored',
        );
      }
      throw error;
    }
  }

  private async store(product: ProductRef, dto: CreateReviewDto): Promise<ReviewDto> {
    // Early check: a fast 409 without a transaction.
    if (!isReviewable(product)) {
      throw notReviewable(product.sku);
    }

    return this.prisma.$transaction(async (tx) => {
      // Prisma's transaction timeout does not cancel a statement that waits on a row lock. This does.
      await tx.$executeRawUnsafe(lockTimeoutStatement(this.transactionLimits.timeout));
      const review = await tx.review.create({
        data: {
          productId: product.id,
          rating: dto.rating,
          title: dto.title ?? null,
          body: dto.body,
          authorName: dto.authorName,
        },
        select: REVIEW_SELECT,
      });
      await this.beforeAggregateUpdate?.();
      const counted = await incrementRating(tx, product.id, dto.rating);
      if (!counted) {
        throw notReviewable(product.sku);
      }
      return review;
    }, this.transactionLimits);
  }

  private async findProduct(sku: string) {
    const product = await this.prisma.product.findUnique({
      where: { sku: normalizeSku(sku) },
      select: { id: true, sku: true, status: true, inLatestExport: true },
    });
    if (!product) {
      throw new NotFoundException(`Product ${normalizeSku(sku)} not found.`);
    }
    return product;
  }
}
