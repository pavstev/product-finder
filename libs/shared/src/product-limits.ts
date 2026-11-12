/** Longest product name in code points, after trimming. A name-sorted cursor and the B-tree index on `name` must fit it. */
export const PRODUCT_NAME_MAX = 200;

/** Longest facet value in code points. The import rejects a longer one and the API refuses it as a filter. */
export const FACET_VALUE_MAX = 100;

/** Most values in one filter list. The API refuses a longer list with a 400. */
export const LIST_ITEMS_MAX = 50;

/** Most certifications of one product, without duplicates. */
export const CERTIFICATIONS_MAX = 20;

/** Most UTF-8 bytes of one product's facet values together. PostgreSQL refuses a B-tree entry over 2,704 bytes in product_facets_idx. */
export const FACET_BYTES_MAX = 2000;
