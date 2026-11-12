import { HttpClient, HttpEventType, type HttpRequest, type HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { defer, filter, mergeMap, type Observable, of, throwError } from 'rxjs';
import { DEFAULT_STATE, PAGE_SIZE, type SearchState } from '../url-state/search-query';
import type {
  CatalogStatus,
  CreateReview,
  Facets,
  Page,
  ProductDetail,
  ProductSummary,
  Review,
} from './catalog-types';
import {
  createReviewRequest,
  getCatalogStatusRequest,
  getFacetsRequest,
  getProductRequest,
  listReviewsRequest,
  searchProductsRequest,
} from './generated/@angular/common.gen';
import { createClient } from './generated/client';
import { client as defaultClient } from './generated/client.gen';
import type { GetFacetsData, SearchProductsData } from './generated/types.gen';

type SearchQuery = NonNullable<SearchProductsData['query']>;
type FacetQuery = NonNullable<GetFacetsData['query']>;

/** An empty list means no filter. It must not reach the URL as `key=`. */
function listOrUndefined<T>(values: T[]): T[] | undefined {
  return values.length > 0 ? values : undefined;
}

/** The search state as the typed query of GET /products. */
function toSearchQuery(state: SearchState): SearchQuery {
  return {
    q: state.q.trim() || undefined,
    function: listOrUndefined(state.function),
    applicationArea: listOrUndefined(state.applicationArea),
    region: state.region ? [state.region] : undefined,
    certifications: listOrUndefined(state.certifications),
    status: listOrUndefined(state.status),
    sort: state.sort,
    page: state.page,
    pageSize: PAGE_SIZE,
  };
}

/** The filters of the search state as the query of GET /products/facets. Sort and page do not change facets. */
function toFacetQuery(state: SearchState): FacetQuery {
  const { sort: _sort, page: _page, pageSize: _pageSize, ...filters } = toSearchQuery(state);
  return filters;
}

/** The client for the API: generated builders make each request. Methods return cold Observables. */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly http = inject(HttpClient);
  // Not the shared singleton of the generated code, so specs need no provider and no reset.
  private readonly client = createClient({
    baseUrl: defaultClient.getConfig().baseUrl,
    httpClient: this.http,
    // Every list param in openapi.json is form style with explode false.
    querySerializer: { array: { explode: false } },
  });

  search(state: SearchState): Observable<Page<ProductSummary>> {
    return this.send(() => searchProductsRequest({ client: this.client, query: toSearchQuery(state) }));
  }

  /** Filter values with counts for the filters of the search, so the counts follow the search. */
  facets(state: SearchState = DEFAULT_STATE): Observable<Facets> {
    return this.send(() => getFacetsRequest({ client: this.client, query: toFacetQuery(state) }));
  }

  product(sku: string): Observable<ProductDetail> {
    return this.send(() => getProductRequest({ client: this.client, path: { sku } }));
  }

  reviews(sku: string, page = 1, pageSize = 10): Observable<Page<Review>> {
    return this.send(() =>
      listReviewsRequest({ client: this.client, path: { sku }, query: { page, pageSize } }),
    );
  }

  createReview(sku: string, review: CreateReview): Observable<Review> {
    return this.send(() => createReviewRequest({ client: this.client, path: { sku }, body: review }));
  }

  catalogStatus(): Observable<CatalogStatus> {
    return this.send(() => getCatalogStatusRequest({ client: this.client }));
  }

  /** Builds the request on subscribe. HttpClient.request aborts the fetch when the subscriber leaves. */
  private send<T>(build: () => HttpRequest<T>): Observable<T> {
    return defer(() => this.http.request<T>(build())).pipe(
      filter((event): event is HttpResponse<T> => event.type === HttpEventType.Response),
      // Every route in the contract answers 200 or 201 with a JSON body. An empty body is a broken answer.
      mergeMap((response) =>
        response.body === null
          ? throwError(() => new Error('The API answered without a body.'))
          : of(response.body),
      ),
    );
  }
}
