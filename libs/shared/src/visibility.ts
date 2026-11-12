/** Product statuses in the PIM export. The Prisma enum must have the same values (status-parity.spec.ts). */
export const PRODUCT_STATUSES = ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// A product is listed when it is in the latest export and has a requested status.
// The detail page works for every product ever imported, so shared links never break.
export const DEFAULT_VISIBLE_STATUSES: readonly ProductStatus[] = ['ACTIVE', 'PHASE_OUT'];
export const GLOBAL_REGION = 'Global';

export interface VisibilityFields {
  inLatestExport: boolean;
  status: ProductStatus;
}

/** Active and phase-out unless the user asked for other statuses. */
export function effectiveStatuses(requested: readonly ProductStatus[] | undefined): readonly ProductStatus[] {
  return requested && requested.length > 0 ? requested : DEFAULT_VISIBLE_STATUSES;
}

/** Reviews only for products we still sell. The review insert repeats this rule in SQL (incrementRating). */
export function isReviewable(product: VisibilityFields): boolean {
  return product.inLatestExport && DEFAULT_VISIBLE_STATUSES.includes(product.status);
}

/** A product sold globally matches every region filter. */
export function regionsToMatch(regions: string[]): string[] {
  return regions.includes(GLOBAL_REGION) ? [...regions] : [...regions, GLOBAL_REGION];
}
