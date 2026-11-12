import type { ProductPageDto } from './generated/types.gen';

// The generated API types under the names the pages use.
export type {
  CatalogStatusDto as CatalogStatus,
  CreateReviewDto as CreateReview,
  FacetsDto as Facets,
  FacetValueDto as FacetValue,
  ProblemDetailsDto as ProblemDetails,
  ProductDetailDto as ProductDetail,
  ProductStatus,
  ProductSummaryDto as ProductSummary,
  ReviewDto as Review,
} from './generated/types.gen';

/** One page of items. ProductPageDto and ReviewPageDto are this with their item type. */
export type Page<T> = Omit<ProductPageDto, 'items'> & { items: T[] };
