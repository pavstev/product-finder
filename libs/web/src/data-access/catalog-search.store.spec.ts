import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { DEFAULT_STATE, type SearchState, withSearchText } from '../url-state/search-query';
import { CatalogApi } from './catalog-api.service';
import { CatalogSearchStore, SEARCH_FRESH_MS, searchKey } from './catalog-search.store';
import type { Page, ProductSummary } from './catalog-types';
import { page, summary } from './testing/fixtures';

/** A search state as the URL gives it: a search text sorts by Best match. */
function search(q = '', changes: Partial<SearchState> = {}): SearchState {
  return { ...withSearchText(DEFAULT_STATE, q), ...changes };
}

/** One product named after the query, so a test can tell the pages apart. */
function resultFor(name: string): Page<ProductSummary> {
  return page([summary({ sku: `P-${name}`, name })]);
}

describe('CatalogSearchStore', () => {
  let api: { search: jest.Mock };
  let store: InstanceType<typeof CatalogSearchStore>;
  const shownName = () => store.result()?.items[0]?.name;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
    api = { search: jest.fn((state: SearchState) => of(resultFor(state.q))) };
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: api }] });
    store = TestBed.inject(CatalogSearchStore);
  });

  afterEach(() => jest.useRealTimers());

  it('keys a query by its normalized query string, so equal states share a key', () => {
    expect(searchKey(search('soap '))).toBe('q=soap');
    expect(searchKey(search('soap', { page: 2, region: 'EMEA' }))).toBe('q=soap&region=EMEA&page=2');
    // Best match without a search text is the default sort, as in the URL.
    expect(searchKey(search('', { sort: 'relevance', page: 1 }))).toBe(searchKey(DEFAULT_STATE));
    expect(searchKey(DEFAULT_STATE)).toBe('');
  });

  it('loads a query it has not seen', () => {
    const soap$ = new Subject<Page<ProductSummary>>();
    api.search.mockReturnValueOnce(soap$);
    store.load(search('soap'));
    expect(api.search).toHaveBeenCalledWith(search('soap'));
    expect(store.key()).toBe('q=soap');
    expect(store.status()).toBe('loading');
    expect(store.result()).toBeNull();

    soap$.next(resultFor('soap'));
    expect(store.status()).toBe('success');
    expect(shownName()).toBe('soap');
  });

  it('cancels the request of an older query when a newer query comes', () => {
    const soap$ = new Subject<Page<ProductSummary>>();
    const glyc$ = new Subject<Page<ProductSummary>>();
    api.search.mockReturnValueOnce(soap$).mockReturnValueOnce(glyc$);
    store.load(search('soap'));
    expect(soap$.observed).toBe(true);

    store.load(search('glyc'));
    expect(soap$.observed).toBe(false);
    glyc$.next(resultFor('glyc'));
    expect(store.key()).toBe('q=glyc');
    expect(shownName()).toBe('glyc');

    // The cancelled query has no cache entry, so it is fetched when it comes again.
    store.load(search('soap'));
    expect(api.search).toHaveBeenCalledTimes(3);
    expect(shownName()).toBe('soap');
  });

  it('keeps the last good result when a refresh fails, and a retry fetches again', () => {
    store.load(search('soap'));
    jest.advanceTimersByTime(SEARCH_FRESH_MS);
    const body = {
      type: 'about:blank',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The catalogue is being imported.',
      instance: '/api/products',
    };
    api.search.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503, error: body })));
    store.load(search('soap'));
    expect(store.status()).toBe('error');
    expect(shownName()).toBe('soap');
    expect(store.error()).toEqual(body);

    api.search.mockReturnValueOnce(of(resultFor('soap, new')));
    store.retry();
    expect(api.search).toHaveBeenCalledTimes(3);
    expect(store.status()).toBe('success');
    expect(store.error()).toBeNull();
    expect(shownName()).toBe('soap, new');
  });

  it('shows an error without a result when nothing was cached, and a retry fetches again', () => {
    api.search.mockReturnValueOnce(
      throwError(() => new HttpErrorResponse({ status: 429, statusText: 'Too Many Requests' })),
    );
    store.load(search('soap'));
    expect(store.status()).toBe('error');
    expect(store.result()).toBeNull();
    expect(store.error()).toMatchObject({ status: 429, title: 'Request failed' });

    store.retry();
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(store.status()).toBe('success');
    expect(shownName()).toBe('soap');
  });
});
