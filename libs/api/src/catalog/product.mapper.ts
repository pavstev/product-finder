import type { Product } from '@product-finder/server';
import { isReviewable } from '@product-finder/shared';
import type { ProductDetailDto, ProductSummaryDto } from './dto/product.dto.js';

// Columns the summary needs. Keeps search queries small.
export const SUMMARY_SELECT = {
  sku: true,
  name: true,
  chemicalName: true,
  function: true,
  applicationArea: true,
  region: true,
  certifications: true,
  status: true,
  launchYear: true,
  ratingAvg: true,
  reviewCount: true,
} as const;

/** A row with the summary columns: from findMany with SUMMARY_SELECT, or from the relevance SQL. */
export type SummaryRow = Pick<Product, keyof typeof SUMMARY_SELECT>;

export function toSummary(row: SummaryRow): ProductSummaryDto {
  return {
    sku: row.sku,
    name: row.name,
    chemicalName: row.chemicalName,
    function: row.function,
    applicationArea: row.applicationArea,
    region: row.region,
    certifications: row.certifications,
    status: row.status,
    launchYear: row.launchYear,
    ratingAvg: row.ratingAvg,
    reviewCount: row.reviewCount,
  };
}

export function toDetail(row: Product): ProductDetailDto {
  // Object.assign keeps the summary a plain object, as the spread did, without spreading a DTO class.
  return Object.assign(toSummary(row), {
    description: row.description,
    inLatestExport: row.inLatestExport,
    reviewable: isReviewable(row),
    updatedAt: row.updatedAt,
  });
}
