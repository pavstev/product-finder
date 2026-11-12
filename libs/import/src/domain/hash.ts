import { createHash } from 'node:crypto';
import type { NormalizedProduct, PreparedProduct } from './types.js';

/** Part of the hash input. Bump it when search_text is built differently: the next import rewrites every row. */
export const SEARCH_TEXT_VERSION = 1;

/** sha256 of the search text version and the PIM fields in a fixed order. Same input gives the same hash. */
export function sourceHash(product: NormalizedProduct, searchTextVersion = SEARCH_TEXT_VERSION): string {
  const ordered = [
    searchTextVersion,
    product.sku,
    product.name,
    product.chemicalName,
    product.function,
    product.applicationArea,
    product.region,
    product.certifications,
    product.status,
    product.launchYear,
    product.description,
  ];
  return createHash('sha256').update(JSON.stringify(ordered)).digest('hex');
}

/** One lower-cased string of every searchable field, for the pg_trgm index. Bump SEARCH_TEXT_VERSION on change. */
function searchText(product: NormalizedProduct): string {
  return [
    product.sku,
    product.name,
    product.chemicalName,
    product.function,
    product.applicationArea,
    product.region,
    ...product.certifications,
    product.description,
  ]
    .filter((part): part is string => !!part)
    .join(' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function prepareProduct(product: NormalizedProduct): PreparedProduct {
  return { ...product, sourceHash: sourceHash(product), searchText: searchText(product) };
}
