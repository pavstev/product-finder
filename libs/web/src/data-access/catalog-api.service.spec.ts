import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_STATE } from '../url-state/search-query';
import { CatalogApi } from './catalog-api.service';

/** The query of a request as a URLSearchParams. The HttpRequest keeps it in the URL, not in `params`. */
function queryOf(urlWithParams: string): URLSearchParams {
  return new URL(urlWithParams, 'http://localhost').searchParams;
}

describe('CatalogApi', () => {
  let api: CatalogApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(CatalogApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('searches with the state as comma lists', () => {
    api.search({ ...DEFAULT_STATE, q: 'soap', certifications: ['Halal', 'Vegan'], page: 2 }).subscribe();
    const req = http.expectOne((r) => r.url.startsWith('/api/products?'));
    expect(req.request.method).toBe('GET');
    const query = queryOf(req.request.urlWithParams);
    expect(query.get('q')).toBe('soap');
    expect(query.get('certifications')).toBe('Halal,Vegan');
    expect(query.get('page')).toBe('2');
    expect(query.get('pageSize')).toBe('20');
    expect(query.has('region')).toBe(false);
    expect(query.has('function')).toBe(false);
    req.flush({ items: [], total: 0, page: 2, pageSize: 20 });
  });

  it('loads a product with an encoded SKU and cancels the request on unsubscribe', () => {
    api.product('P 1/2').subscribe();
    http.expectOne('/api/products/P%201%2F2').flush({});

    const subscription = api.product('P-1').subscribe();
    const pending = http.expectOne('/api/products/P-1');
    expect(pending.cancelled).toBe(false);
    subscription.unsubscribe();
    expect(pending.cancelled).toBe(true);
  });

  it('posts a review and passes an HTTP error to the caller as an HttpErrorResponse', () => {
    const review = { rating: 5, body: 'Very good product.', authorName: 'Ana' };
    api.createReview('P-1', review).subscribe();
    const req = http.expectOne('/api/products/P-1/reviews');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(review);
    req.flush({});

    let failure: unknown;
    api.createReview('P-1', review).subscribe({ error: (error: unknown) => (failure = error) });
    http
      .expectOne('/api/products/P-1/reviews')
      .flush({ status: 429, title: 'Too Many Requests' }, { status: 429, statusText: 'Too Many Requests' });
    expect(failure).toBeInstanceOf(HttpErrorResponse);
    expect((failure as HttpErrorResponse).status).toBe(429);
  });
});
