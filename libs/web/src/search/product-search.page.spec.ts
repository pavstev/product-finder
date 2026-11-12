import { BreakpointObserver } from '@angular/cdk/layout';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { MultiSelect } from 'primeng/multiselect';
import { Paginator } from 'primeng/paginator';
import { of, Subject, throwError } from 'rxjs';
import { CatalogApi } from '../data-access/catalog-api.service';
import { SEARCH_FRESH_MS } from '../data-access/catalog-search.store';
import type { Page, ProductSummary } from '../data-access/catalog-types';
import { facets, facetValue, page, summary } from '../data-access/testing/fixtures';
import { LAST_PAGE, type SearchState } from '../url-state/search-query';
import { ProductSearchPage, SEARCH_DEBOUNCE_MS } from './product-search.page';

/** Stands in for the product page, so a test can leave the search page and come back. */
@Component({ template: '' })
class ProductStub {}

/** An option of a filter control, as the page builds it. */
interface FilterOption {
  label: string;
  value: string;
  disabled: boolean;
}

describe('ProductSearchPage', () => {
  let api: { search: jest.Mock; facets: jest.Mock };

  async function open(url: string) {
    const harness = await RouterTestingHarness.create(url);
    await harness.fixture.whenStable();
    return harness;
  }

  const currentUrl = () => TestBed.inject(Router).url;

  function typeSearch(harness: RouterTestingHarness, text: string): void {
    const el = harness.routeNativeElement as HTMLElement;
    const input = el.querySelector('#search-input') as HTMLInputElement;
    input.value = text;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Types on fake timers and runs the debounce out at once, so no test waits in real time.
   * Real timers come back before the navigation runs, because Angular schedules its work on timers.
   */
  async function typeAndWait(harness: RouterTestingHarness, text: string): Promise<void> {
    jest.useFakeTimers();
    try {
      typeSearch(harness, text);
      jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
      jest.runOnlyPendingTimers();
    } finally {
      jest.useRealTimers();
    }
    await harness.fixture.whenStable();
  }

  /** Narrow layout: filters live in a drawer and the toolbar shows "Filters (n)". */
  function usePhoneLayout(): void {
    TestBed.overrideProvider(BreakpointObserver, {
      useValue: { observe: () => of({ matches: true, breakpoints: {} }) },
    });
  }

  beforeEach(() => {
    api = {
      search: jest.fn(() => of(page([summary(), summary({ sku: 'P-2', name: 'Other' })], 2))),
      facets: jest.fn(() => of(facets)),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'products', component: ProductSearchPage },
          { path: 'products/:sku', component: ProductStub },
        ]),
        provideHttpClient(),
        MessageService,
        { provide: CatalogApi, useValue: api },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /**
   * Leaves the search for a product and comes back. Returns the page as its first render shows it,
   * before any later change detection, so a skeleton there would be caught.
   */
  async function backFromProduct(harness: RouterTestingHarness, url: string) {
    await harness.navigateByUrl('/products/P-10001');
    await TestBed.inject(Router).navigateByUrl(url);
    harness.fixture.detectChanges();
    const el = harness.fixture.nativeElement as HTMLElement;
    return {
      cards: el.querySelectorAll('app-product-card').length,
      skeletons: el.querySelectorAll('p-skeleton').length,
    };
  }

  it('searches with the state from the URL and shows the results', async () => {
    const harness = await open('/products?q=soap&region=EMEA&page=2');
    expect(api.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'soap', region: 'EMEA', page: 2 }),
    );
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelectorAll('app-product-card')).toHaveLength(2);
    expect(el.querySelector('.count')?.textContent).toContain('2 products');
    expect((el.querySelector('#search-input') as HTMLInputElement).value).toBe('soap');
  });

  it('shows a stale search at once and swaps in the new results when they arrive', async () => {
    const harness = await open('/products?q=soap');
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now + SEARCH_FRESH_MS);
    const fresh$ = new Subject<Page<ProductSummary>>();
    api.search.mockReturnValueOnce(fresh$);

    const firstRender = await backFromProduct(harness, '/products?q=soap');
    expect(firstRender).toEqual({ cards: 2, skeletons: 0 });
    expect(api.search).toHaveBeenCalledTimes(2);

    fresh$.next(page([summary({ name: 'Renamed' })], 1));
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelectorAll('app-product-card')).toHaveLength(1);
    expect(el.querySelector('.count')?.textContent).toContain('1 product');
  });

  it('keeps a stale search on screen when its refresh fails, with a retry', async () => {
    const harness = await open('/products?q=soap');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + SEARCH_FRESH_MS);
    api.search.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));

    const firstRender = await backFromProduct(harness, '/products?q=soap');
    expect(firstRender).toEqual({ cards: 2, skeletons: 0 });
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    const note = el.querySelector('.refresh-error') as HTMLElement;
    expect(note.textContent).toContain('could not be updated');
    expect(el.querySelectorAll('app-product-card')).toHaveLength(2);

    api.search.mockReturnValueOnce(of(page([summary({ name: 'Renamed' })], 1)));
    (note.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(api.search).toHaveBeenCalledTimes(3);
    expect(el.querySelector('.refresh-error')).toBeNull();
    expect(el.querySelectorAll('app-product-card')).toHaveLength(1);
  });

  it('writes the typed search into the URL after the debounce and resets the page', async () => {
    const harness = await open('/products?page=3');
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    jest.useFakeTimers();
    typeSearch(harness, 'glucos');
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    expect(navigate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(navigate).toHaveBeenCalledTimes(1);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();

    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products?q=glucos');
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'glucos', page: 1 }));
  });

  it('searches again when the same text is typed after the search was cleared', async () => {
    const harness = await open('/products');
    const el = harness.routeNativeElement as HTMLElement;

    await typeAndWait(harness, 'glucos');
    expect(currentUrl()).toBe('/products?q=glucos');

    // Clearing goes through the URL, not through the search box.
    (el.querySelector('.count button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products');

    await typeAndWait(harness, 'glucos');
    expect(currentUrl()).toBe('/products?q=glucos');
  });

  it('cuts a search text from an edited link to the API limit instead of failing', async () => {
    await open(`/products?q=${'a'.repeat(150)}`);
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'a'.repeat(100) }));
  });

  it('lets the search box take as many characters as the API allows, and no more', async () => {
    const harness = await open('/products');
    const input = (harness.routeNativeElement as HTMLElement).querySelector(
      '#search-input',
    ) as HTMLInputElement;
    expect(input.getAttribute('maxlength')).toBe('100');
  });

  it('puts the discontinued filter into the URL', async () => {
    const harness = await open('/products?function=Surfactant');
    const checkbox = (harness.routeNativeElement as HTMLElement).querySelector(
      '#side-discontinued',
    ) as HTMLInputElement;
    checkbox.click();
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products?function=Surfactant&status=ACTIVE,PHASE_OUT,DISCONTINUED');
  });

  it('removes a list filter when its multiselect is cleared', async () => {
    const harness = await open('/products?function=Surfactant&region=EMEA');
    const el = harness.routeNativeElement as HTMLElement;
    const multiselect = el.querySelector('#side-function')?.closest('p-multiselect');
    const clear = multiselect?.querySelector('.p-multiselect-clear-icon');
    expect(clear).toBeTruthy();

    // The clear icon sends null, not an empty list.
    clear?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products?region=EMEA');
  });

  it('loads the facets for the filters of the search, not again for a new page or sort', async () => {
    const harness = await open('/products?q=soap&function=Surfactant');
    expect(api.facets).toHaveBeenLastCalledWith(
      expect.objectContaining({ q: 'soap', function: ['Surfactant'], status: [] }),
    );

    await harness.navigateByUrl('/products?q=soap&function=Surfactant&page=2&sort=-rating');
    await harness.fixture.whenStable();
    expect(api.facets).toHaveBeenCalledTimes(1);

    await harness.navigateByUrl('/products?q=soap&function=Surfactant&region=EMEA');
    await harness.fixture.whenStable();
    expect(api.facets).toHaveBeenCalledTimes(2);
    expect(api.facets).toHaveBeenLastCalledWith(expect.objectContaining({ region: 'EMEA' }));

    await harness.navigateByUrl('/products?status=ACTIVE,PHASE_OUT,DISCONTINUED');
    await harness.fixture.whenStable();
    expect(api.facets).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'] }),
    );
  });

  it('shows the count of each option and disables an option with 0, unless it is picked', async () => {
    api.facets.mockReturnValue(
      of({ ...facets, functions: [facetValue('Emulsifier', 1204), facetValue('Surfactant', 0)] }),
    );
    const harness = await open('/products?function=Surfactant');
    const multiselects = harness.fixture.debugElement
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PrimeNG 22 still ships it; migrating changes the filter UI
      .queryAll(By.directive(MultiSelect))
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- PrimeNG 22 still ships it; migrating changes the filter UI
      .map((multiselect) => multiselect.componentInstance as MultiSelect);
    const [functions, , certifications] = multiselects.map(
      (multiselect) => multiselect.options() as FilterOption[],
    );

    expect(multiselects.map((multiselect) => multiselect.optionDisabled())).toEqual([
      'disabled',
      'disabled',
      'disabled',
    ]);
    expect(functions).toEqual([
      { label: 'Emulsifier (1,204)', value: 'Emulsifier', disabled: false },
      { label: 'Surfactant (0)', value: 'Surfactant', disabled: false },
    ]);
    expect(certifications).toEqual([
      { label: 'Halal (0)', value: 'Halal', disabled: true },
      { label: 'Kosher (4)', value: 'Kosher', disabled: false },
    ]);
    // The region select is a Select, like the sort. Read the protected options the page binds to it.
    const page = harness.routeDebugElement?.componentInstance as { options(): { regions: FilterOption[] } };
    expect(page.options().regions.map((option) => option.label)).toEqual(['EMEA (5)', 'Global (2)']);
  });

  it('keeps other filters when the sort changes', async () => {
    const harness = await open('/products?region=EMEA&page=2');
    // Calls the protected handler the sort select binds to.
    const page = harness.routeDebugElement?.componentInstance as
      { update(changes: object): void } | undefined;
    page?.update({ sort: '-rating' });
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products?region=EMEA&sort=-rating');
  });

  it('offers Best match in the sort menu only when there is a search text', async () => {
    const harness = await open('/products');
    const el = harness.routeNativeElement as HTMLElement;
    // Reads the protected options the sort select binds to.
    const sortValues = () => {
      const page = harness.routeDebugElement?.componentInstance as
        { sortOptions(): { value: string }[] } | undefined;
      if (!page) {
        throw new Error('The search page did not render.');
      }
      return page.sortOptions().map((option) => option.value);
    };
    expect(sortValues()).not.toContain('relevance');
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'name' }));

    await harness.navigateByUrl('/products?q=soap');
    await harness.fixture.whenStable();
    expect(sortValues()[0]).toBe('relevance');
    expect(el.querySelector('.sort')?.textContent).toContain('Best match');
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: 'soap', sort: 'relevance' }));
  });

  it('goes back to the default sort when the search text is cleared while sorting by Best match', async () => {
    const harness = await open('/products?q=soap&region=EMEA');
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'relevance' }));

    await typeAndWait(harness, '');
    expect(currentUrl()).toBe('/products?region=EMEA');
    expect(api.search).toHaveBeenLastCalledWith(expect.objectContaining({ q: '', sort: 'name' }));
  });

  it('shows an empty state with a button that clears all filters', async () => {
    api.search.mockReturnValue(of(page([], 0)));
    const harness = await open('/products?q=zzz&region=EMEA');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('No products match your search');
    (el.querySelector('.empty button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products');
  });

  it('shows an error with a retry button', async () => {
    api.search.mockReturnValueOnce(throwError(() => new Error('offline')));
    const harness = await open('/products');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('could not be loaded');
    (el.querySelector('p-message button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(api.search).toHaveBeenCalledTimes(2);
    expect(el.querySelectorAll('app-product-card')).toHaveLength(2);
  });

  it('says so when the search is rate limited (429), not "check your connection"', async () => {
    api.search.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 429 })));
    const harness = await open('/products');
    const el = harness.routeNativeElement as HTMLElement;
    expect(el.textContent).toContain('Too many requests from this network. Wait a minute and try again.');
    expect(el.textContent).not.toContain('Check your connection');
    expect(el.querySelector('p-message button')).not.toBeNull();
  });

  it('replaces a page past the end with the last page', async () => {
    api.search.mockImplementation((state: SearchState) =>
      of(
        state.page === 500
          ? { items: [], total: 40, page: 500, pageSize: 12 }
          : { items: [summary()], total: 40, page: state.page, pageSize: 12 },
      ),
    );
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');

    const harness = await open('/products?page=500');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ page: 4 }), replaceUrl: true }),
    );
    expect(currentUrl()).toBe('/products?page=4');
    expect((harness.routeNativeElement as HTMLElement).querySelectorAll('app-product-card')).toHaveLength(1);
  });

  /** The pages the search asked the API for. */
  const requestedPages = () => api.search.mock.calls.map(([state]) => (state as SearchState).page);

  it('moves a link past the page cap to the last page with results, and asks for no page past the cap', async () => {
    // An old link, from when pages went up to 10,000. The catalogue fills 4 pages of 12.
    api.search.mockImplementation((state: SearchState) =>
      of(
        state.page > 4
          ? { items: [], total: 40, page: state.page, pageSize: 12 }
          : { items: [summary()], total: 40, page: state.page, pageSize: 12 },
      ),
    );

    const harness = await open('/products?page=600');

    expect(currentUrl()).toBe('/products?page=4');
    expect(requestedPages()).toEqual([LAST_PAGE, 4]);
    expect((harness.routeNativeElement as HTMLElement).querySelectorAll('app-product-card')).toHaveLength(1);
  });

  it('offers no page past row 10,000, where the API wants a cursor, but counts every product', async () => {
    api.search.mockReturnValue(of(page([summary()], 44_938)));
    const navigate = jest.spyOn(TestBed.inject(Router), 'navigate');
    const harness = await open('/products?page=499');
    const paginator = harness.fixture.debugElement.query(By.directive(Paginator))
      .componentInstance as Paginator;

    expect(paginator.totalRecords()).toBe(10_000);
    expect(paginator.getPageCount()).toBe(500);
    expect((harness.routeNativeElement as HTMLElement).querySelector('.count')?.textContent).toContain(
      '44938 products',
    );
    paginator.changePage(paginator.getPageCount() - 1);
    await harness.fixture.whenStable();
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: expect.objectContaining({ page: 500 }) }),
    );
    expect(currentUrl()).toBe('/products?page=500');
  });

  it('shows a filter value from the link that is not an option as a chip that can be removed', async () => {
    usePhoneLayout();
    const harness = await open('/products?function=Retired&region=EMEA');
    const el = harness.routeNativeElement as HTMLElement;
    const chips = () => [...el.querySelectorAll('.link-filters li')].map((chip) => chip.textContent.trim());

    expect(chips()).toEqual(['Function: Retired']);
    expect(el.querySelector('.filters-button')?.textContent).toContain('Filters (2)');

    (el.querySelector('.link-filters button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(currentUrl()).toBe('/products?region=EMEA');
    expect(chips()).toEqual([]);
    expect(el.querySelector('.filters-button')?.textContent).toContain('Filters (1)');
  });

  it('shows an error with a retry button when the filters cannot be loaded', async () => {
    api.facets.mockReturnValueOnce(throwError(() => new Error('offline')));
    const harness = await open('/products');
    const el = harness.routeNativeElement as HTMLElement;
    const error = el.querySelector('.facets-error') as HTMLElement;
    expect(error.textContent).toContain('could not be loaded');

    (error.querySelector('button') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
    expect(api.facets).toHaveBeenCalledTimes(2);
    expect(el.querySelector('.facets-error')).toBeNull();
  });
});
