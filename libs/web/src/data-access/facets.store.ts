import { inject } from '@angular/core';
import { signalStore, withMethods, withState } from '@ngrx/signals';
import { type SearchState, toQueryParams } from '../url-state/search-query';
import { cachedQueryMethods, initialQueryState, queryKey } from './cached-query';
import { CatalogApi } from './catalog-api.service';
import type { Facets } from './catalog-types';

/** Facet answers kept, one per facet query. */
export const FACETS_CACHE_SIZE = 20;

/** The key of the facets: the search text and the filters. Sort and page do not change the counts. */
export function facetsKey(state: SearchState): string {
  const { sort: _sort, page: _page, ...filters } = toQueryParams(state);
  return queryKey(filters);
}

/** The filter options with counts. They change only with the nightly import, so they never go stale. */
export const FacetsStore = signalStore(
  { providedIn: 'root' },
  withState(initialQueryState<Facets>()),
  withMethods((store) => {
    const api = inject(CatalogApi);
    return cachedQueryMethods(store, {
      keyOf: facetsKey,
      fetch: (state) => api.facets(state),
      maxEntries: FACETS_CACHE_SIZE,
      freshForMs: Number.POSITIVE_INFINITY,
    });
  }),
);
