export { CATALOG_STALE_AFTER_HOURS, isCatalogStale } from './catalog-freshness.js';
export {
  CERTIFICATIONS_MAX,
  FACET_BYTES_MAX,
  FACET_VALUE_MAX,
  LIST_ITEMS_MAX,
  PRODUCT_NAME_MAX,
} from './product-limits.js';
export { REVIEW_LIMITS } from './review.js';
export {
  DEFAULT_SORT,
  defaultSortFor,
  hasSearchText,
  lastPageFor,
  PAGE_DEPTH_MAX,
  PAGE_MAX,
  PAGE_SIZE_MAX,
  RELEVANCE_SORT,
  SEARCH_QUERY_MAX,
  SORT_KEYS,
  type SortKey,
} from './search.js';
export { displaySku, MAX_SKU_LENGTH, normalizeSku, type SkuProblem, skuProblem } from './sku.js';
export { codePointLength, hasControlCharacters } from './text.js';
export {
  DEFAULT_VISIBLE_STATUSES,
  effectiveStatuses,
  GLOBAL_REGION,
  isReviewable,
  PRODUCT_STATUSES,
  type ProductStatus,
  regionsToMatch,
  type VisibilityFields,
} from './visibility.js';
