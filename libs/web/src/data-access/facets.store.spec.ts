import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { DEFAULT_STATE, type SearchState, withSearchText } from '../url-state/search-query';
import { CatalogApi } from './catalog-api.service';
import type { Facets } from './catalog-types';
import { FacetsStore, facetsKey } from './facets.store';
import { facets, facetValue } from './testing/fixtures';

function search(q = '', changes: Partial<SearchState> = {}): SearchState {
  return { ...withSearchText(DEFAULT_STATE, q), ...changes };
}

/** Facets with one function, so a test can tell the answers apart. */
function facetsWith(fn: string): Facets {
  return { ...facets, functions: [facetValue(fn, 3)] };
}

describe('FacetsStore', () => {
  let api: { facets: jest.Mock };
  let store: InstanceType<typeof FacetsStore>;
  const shownFunction = () => store.result()?.functions[0]?.value;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
    api = { facets: jest.fn((state: SearchState) => of(facetsWith(state.q || 'all'))) };
    TestBed.configureTestingModule({ providers: [{ provide: CatalogApi, useValue: api }] });
    store = TestBed.inject(FacetsStore);
  });

  afterEach(() => jest.useRealTimers());

  it('keys the facets by the search text and the filters, not by sort or page', () => {
    expect(facetsKey(search('soap', { page: 3, sort: '-rating' }))).toBe(facetsKey(search('soap')));
    expect(facetsKey(search('soap', { region: 'EMEA', page: 2 }))).toBe('q=soap&region=EMEA');
    expect(facetsKey(DEFAULT_STATE)).toBe('');
  });

  it('loads once per facet query: a new sort or page asks for nothing', () => {
    store.load(search('soap'));
    store.load(search('soap', { page: 2, sort: '-rating' }));
    expect(api.facets).toHaveBeenCalledTimes(1);
    expect(api.facets).toHaveBeenCalledWith(search('soap'));
    expect(store.status()).toBe('success');
    expect(shownFunction()).toBe('soap');
  });

  it('cancels the facets of older filters when the filters change', () => {
    const soap$ = new Subject<Facets>();
    api.facets.mockReturnValueOnce(soap$);
    store.load(search('soap'));
    store.load(search('glyc'));
    expect(soap$.observed).toBe(false);
    expect(shownFunction()).toBe('glyc');
  });
});
