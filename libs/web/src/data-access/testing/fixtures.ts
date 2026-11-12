import type { Facets, FacetValue, Page, ProductDetail, ProductSummary, Review } from '../catalog-types';

export function summary(overrides: Partial<ProductSummary> = {}): ProductSummary {
  return {
    sku: 'P-10001',
    name: 'Quorin SF 470',
    chemicalName: 'Sodium Laureth Sulfate',
    function: 'Surfactant',
    applicationArea: 'Home Care',
    region: 'EMEA',
    certifications: ['Kosher'],
    status: 'ACTIVE',
    launchYear: 2012,
    ratingAvg: 4.5,
    reviewCount: 2,
    ...overrides,
  };
}

export function detail(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    ...summary(),
    description: 'Surfactant for home care.',
    inLatestExport: true,
    reviewable: true,
    updatedAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

export function review(overrides: Partial<Review> = {}): Review {
  return {
    id: 'r1',
    rating: 4,
    title: 'Good foam',
    body: 'Works well in our lotion.',
    authorName: 'Ana',
    createdAt: '2026-11-10T10:00:00.000Z',
    ...overrides,
  };
}

export function page<T>(items: T[], total = items.length): Page<T> {
  return { items, total, page: 1, pageSize: 20 };
}

/** A facet value with its count. */
export function facetValue(value: string, count = 1): FacetValue {
  return { value, count };
}

export const facets: Facets = {
  functions: [facetValue('Emulsifier', 1204), facetValue('Surfactant', 12)],
  applicationAreas: [facetValue('Home Care', 7)],
  regions: [facetValue('EMEA', 5), facetValue('Global', 2)],
  certifications: [facetValue('Halal', 0), facetValue('Kosher', 4)],
  statuses: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
};
