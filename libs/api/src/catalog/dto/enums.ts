import { PRODUCT_STATUSES } from '@product-finder/shared';

/** OpenAPI options of a product status. Spread into every status property so they share one component. */
export const PRODUCT_STATUS_ENUM = {
  type: 'string',
  enum: [...PRODUCT_STATUSES],
  enumName: 'ProductStatus',
} as const;
