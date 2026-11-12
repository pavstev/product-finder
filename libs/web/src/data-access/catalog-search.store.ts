import { inject } from '@angular/core';
import { signalStore, withMethods, withState } from '@ngrx/signals';
import { type SearchState, toQueryParams } from '../url-state/search-query';
import { cachedQueryMethods, initialQueryState, queryKey } from './cached-query';
import { CatalogApi } from './catalog-api.service';
import type { Page, ProductSummary } from './catalog-types';

/** Search answers kept for back and forward. */
export const SEARCH_CACHE_SIZE = 20;

/** A search answer younger than this shows without a request. An older one shows and refreshes. */
export const SEARCH_FRESH_MS = 30_000;

/** The normalized query string of a search, from toQueryParams. Equal states give equal keys. */
export function searchKey(state: SearchState): string {
  return queryKey(toQueryParams(state));
}

/** The search results, cached per query. In root, so the cache outlives the page. A new review marks it stale. */
export const CatalogSearchStore = signalStore(
  { providedIn: 'root' },
  withState(initialQueryState<Page<ProductSummary>>()),
  withMethods((store) => {
    const api = inject(CatalogApi);
    return cachedQueryMethods(store, {
      keyOf: searchKey,
      fetch: (state) => api.search(state),
      maxEntries: SEARCH_CACHE_SIZE,
      freshForMs: SEARCH_FRESH_MS,
    });
  }),
);
