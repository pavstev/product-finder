import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { DEFAULT_STATE } from '../url-state/search-query';
import { CatalogApi } from './catalog-api.service';
import { CatalogSearchStore } from './catalog-search.store';
import type { CreateReview, Page, ProductDetail, Review } from './catalog-types';
import { ProductDetailStore, retryAfterSeconds, reviewSubmitProblem } from './product-detail.store';
import { detail, page, review, summary } from './testing/fixtures';

const draft: CreateReview = { rating: 5, body: 'Ten or more characters.', authorName: 'Ana' };

function reviewsOf(count: number, total = count): Page<Review> {
  return {
    items: Array.from({ length: count }, (_, i) => review({ id: `r${i + 1}`, title: `Review ${i + 1}` })),
    total,
    page: 1,
    pageSize: 10,
  };
}

function problem(status: number, headers: Record<string, string> = {}, error: unknown = null) {
  return new HttpErrorResponse({ status, headers: new HttpHeaders(headers), error });
}

describe('ProductDetailStore', () => {
  let api: { product: jest.Mock; reviews: jest.Mock; createReview: jest.Mock; search: jest.Mock };
  let store: InstanceType<typeof ProductDetailStore>;

  beforeEach(() => {
    api = {
      product: jest.fn(() => of(detail())),
      reviews: jest.fn(() => of(reviewsOf(2))),
      createReview: jest.fn(),
      search: jest.fn(() => of(page([summary()]))),
    };
    TestBed.configureTestingModule({
      providers: [ProductDetailStore, { provide: CatalogApi, useValue: api }],
    });
    store = TestBed.inject(ProductDetailStore);
  });

  describe('load', () => {
    it('loads the product and the first review page', () => {
      store.load('P-10001');
      expect(api.product).toHaveBeenCalledWith('P-10001');
      expect(api.reviews).toHaveBeenCalledWith('P-10001', 1, 10);
      expect(store.status()).toBe('ready');
      expect(store.product()?.name).toBe('Quorin SF 470');
      expect(store.reviews()?.items).toHaveLength(2);
      expect(store.reviewsStatus()).toBe('ready');
      expect(store.canReview()).toBe(true);
    });

    it('treats 404 and 400 as not found and other errors as an error', () => {
      for (const [status, expected] of [
        [404, 'not-found'],
        [400, 'not-found'],
        [500, 'error'],
        [0, 'error'],
      ] as const) {
        api.product.mockReturnValue(throwError(() => problem(status)));
        store.load('P-1');
        expect(store.status()).toBe(expected);
        expect(store.product()).toBeNull();
      }
    });

    it('shows a review error without hiding the product', () => {
      api.reviews.mockReturnValue(throwError(() => problem(500)));
      store.load('P-10001');
      expect(store.status()).toBe('ready');
      expect(store.reviewsStatus()).toBe('error');
    });

    it('drops the answers of an earlier SKU', () => {
      const first$ = new Subject<ProductDetail>();
      api.product.mockReturnValueOnce(first$);
      store.load('P-1');
      api.product.mockReturnValueOnce(of(detail({ sku: 'P-2', name: 'Second' })));
      store.load('P-2');
      first$.next(detail({ sku: 'P-1', name: 'First' }));
      expect(store.product()?.name).toBe('Second');
    });
  });

  describe('refresh', () => {
    beforeEach(() => {
      store.load('P-10001');
    });

    it('keeps the product and reviews on screen while it reloads', () => {
      const product$ = new Subject<ProductDetail>();
      const reviews$ = new Subject<Page<Review>>();
      api.product.mockReturnValue(product$);
      api.reviews.mockReturnValue(reviews$);
      store.refresh();
      expect(store.status()).toBe('ready');
      expect(store.product()?.name).toBe('Quorin SF 470');
      expect(store.reviews()?.items).toHaveLength(2);

      product$.next(detail({ name: 'Renamed', ratingAvg: 3, reviewCount: 3 }));
      reviews$.next(reviewsOf(3));
      expect(store.product()?.name).toBe('Renamed');
      expect(store.reviews()?.items).toHaveLength(3);
    });

    it('keeps the product and reviews on an error and raises a toast', () => {
      api.product.mockReturnValue(throwError(() => problem(503)));
      store.refresh();
      expect(store.status()).toBe('ready');
      expect(store.product()?.name).toBe('Quorin SF 470');
      expect(store.reviews()?.items).toHaveLength(2);
      expect(store.toast()).toMatchObject({ severity: 'warn' });
    });

    it('keeps the old reviews when only the review reload fails', () => {
      api.product.mockReturnValue(of(detail({ name: 'Renamed' })));
      api.reviews.mockReturnValue(throwError(() => problem(500)));
      store.refresh();
      expect(store.product()?.name).toBe('Renamed');
      expect(store.reviews()?.items).toHaveLength(2);
      expect(store.reviewsStatus()).toBe('ready');
      expect(store.toast()).not.toBeNull();
    });
  });

  describe('destroy', () => {
    it('cancels the requests in flight, so nothing lands on a store nobody reads', () => {
      const product$ = new Subject<ProductDetail>();
      const reviews$ = new Subject<Page<Review>>();
      api.product.mockReturnValue(product$);
      api.reviews.mockReturnValue(reviews$);
      store.load('P-10001');
      expect(product$.observed).toBe(true);
      expect(reviews$.observed).toBe(true);

      TestBed.resetTestingModule();

      expect(product$.observed).toBe(false);
      expect(reviews$.observed).toBe(false);
    });
  });

  describe('submitReview', () => {
    beforeEach(() => {
      store.load('P-10001');
    });

    it('puts the new review on top at once, then refreshes in the background', async () => {
      const created = review({ id: 'new', title: 'Brand new' });
      const product$ = new Subject<ProductDetail>();
      const reviews$ = new Subject<Page<Review>>();
      api.createReview.mockReturnValue(of(created));
      api.product.mockReturnValue(product$);
      api.reviews.mockReturnValue(reviews$);
      api.product.mockClear();
      api.reviews.mockClear();

      const ok = await store.submitReview(draft);

      expect(ok).toBe(true);
      expect(api.createReview).toHaveBeenCalledWith('P-10001', draft);
      expect(store.submitting()).toBe(false);
      expect(store.reviews()?.items.map((r) => r.id)).toEqual(['new', 'r1', 'r2']);
      expect(store.reviews()?.total).toBe(3);
      expect(api.product).toHaveBeenCalledTimes(1);
      expect(api.reviews).toHaveBeenCalledWith('P-10001', 1, 10);

      product$.next(detail({ ratingAvg: 4.6, reviewCount: 3 }));
      reviews$.next(reviewsOf(3));
      expect(store.product()?.reviewCount).toBe(3);
      expect(store.toast()).toBeNull();
    });

    it('sends nothing while another submit is in flight', async () => {
      const post$ = new Subject<Review>();
      api.createReview.mockReturnValue(post$);
      void store.submitReview(draft);
      expect(await store.submitReview(draft)).toBe(false);
      expect(api.createReview).toHaveBeenCalledTimes(1);
    });

    it('shows the reason of a 409 from the problem body and hides the form', async () => {
      api.createReview.mockReturnValue(
        throwError(() => problem(409, {}, { status: 409, detail: 'Product P-10001 is no longer sold.' })),
      );
      const ok = await store.submitReview(draft);
      expect(ok).toBe(false);
      expect(store.closedReason()).toBe('Product P-10001 is no longer sold.');
      expect(store.canReview()).toBe(false);
      expect(store.submitting()).toBe(false);
      expect(store.reviews()?.items).toHaveLength(2);
    });

    it('builds the 429 message from Retry-After in seconds', async () => {
      api.createReview.mockReturnValue(throwError(() => problem(429, { 'Retry-After': '42' })));
      await store.submitReview(draft);
      expect(store.lastError()).toBe('Too many reviews from this network. Try again in 42 seconds.');
      expect(store.closedReason()).toBeNull();
      expect(store.canReview()).toBe(true);
    });

    describe('when the user moves to another product during the POST', () => {
      beforeEach(() => {
        api.product.mockReturnValue(of(detail({ sku: 'P-2', name: 'Second' })));
      });

      it.each([
        [409, { status: 409, detail: 'Product P-10001 is no longer sold.' }],
        [429, null],
        [500, null],
      ])('ignores a %s answer for the old product', async (status, body) => {
        const post$ = new Subject<Review>();
        api.createReview.mockReturnValue(post$);
        const pending = store.submitReview(draft);
        store.load('P-2');

        post$.error(problem(status, {}, body));

        expect(await pending).toBe(false);
        expect(store.sku()).toBe('P-2');
        expect(store.closedReason()).toBeNull();
        expect(store.lastError()).toBeNull();
        expect(store.canReview()).toBe(true);
        expect(store.product()?.name).toBe('Second');
        expect(store.toast()).toBeNull();
      });

      it('does not put the review of the old product into the list of the new one', async () => {
        const post$ = new Subject<Review>();
        api.createReview.mockReturnValue(post$);
        const pending = store.submitReview(draft);
        store.load('P-2');

        post$.next(review({ id: 'old' }));
        await pending;

        expect(store.reviews()?.items.map((r) => r.id)).toEqual(['r1', 'r2']);
      });
    });

    it('re-fetches the product after a 409 so the banner matches the note', async () => {
      api.createReview.mockReturnValue(throwError(() => problem(409, {}, { detail: 'No longer sold.' })));
      api.product.mockClear();
      api.product.mockReturnValue(of(detail({ status: 'DISCONTINUED', reviewable: false })));

      await store.submitReview(draft);

      expect(api.product).toHaveBeenCalledTimes(1);
      expect(store.product()?.status).toBe('DISCONTINUED');
      expect(store.closedReason()).toBe('No longer sold.');
      expect(store.toast()).toBeNull();
    });

    it('does not re-fetch the product after a 429', async () => {
      api.createReview.mockReturnValue(throwError(() => problem(429)));
      api.product.mockClear();
      await store.submitReview(draft);
      expect(api.product).not.toHaveBeenCalled();
    });

    describe('the cached search results', () => {
      let search: InstanceType<typeof CatalogSearchStore>;

      /** The search the user came from. Its answer is fresh and in the root search store. */
      beforeEach(() => {
        search = TestBed.inject(CatalogSearchStore);
        search.load(DEFAULT_STATE);
        expect(api.search).toHaveBeenCalledTimes(1);
      });

      it('go stale when a review is published, so back to results shows the new rating and count', async () => {
        api.createReview.mockReturnValue(of(review({ id: 'new' })));
        await store.submitReview(draft);

        search.load(DEFAULT_STATE);
        expect(api.search).toHaveBeenCalledTimes(2);
      });

      it('go stale too when the user moved to another product during the POST', async () => {
        const post$ = new Subject<Review>();
        api.createReview.mockReturnValue(post$);
        const pending = store.submitReview(draft);
        store.load('P-2');
        post$.next(review({ id: 'old' }));
        await pending;

        search.load(DEFAULT_STATE);
        expect(api.search).toHaveBeenCalledTimes(2);
      });

      it('stay fresh when the review was not published', async () => {
        api.createReview.mockReturnValue(throwError(() => problem(429)));
        await store.submitReview(draft);

        search.load(DEFAULT_STATE);
        expect(api.search).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe('retryAfterSeconds', () => {
  afterEach(() => jest.useRealTimers());

  it('reads a number of seconds', () => {
    expect(retryAfterSeconds('5')).toBe(5);
    expect(retryAfterSeconds(' 120 ')).toBe(120);
  });

  it('reads an HTTP date relative to now', () => {
    jest.useFakeTimers({ now: new Date('2026-11-12T10:00:00Z') });
    expect(retryAfterSeconds('Thu, 12 Nov 2026 10:00:30 GMT')).toBe(30);
    expect(retryAfterSeconds('Thu, 12 Nov 2026 09:00:00 GMT')).toBe(1);
  });
});

describe('reviewSubmitProblem', () => {
  it('says on a 503 that the review may be stored, so the user checks before a second post', () => {
    // The API sends 503 also when the connection broke during the write, which may have committed.
    expect(reviewSubmitProblem(problem(503))).toEqual({
      message: 'We could not confirm the review. Reload the page to check before you post it again.',
    });
  });

  it('reads a 409 reason from the problem detail first, then the message', () => {
    const body = { status: 409, detail: 'Product P-2 is no longer sold.' };
    expect(reviewSubmitProblem(problem(409, {}, body))).toEqual({
      message: 'Product P-2 is no longer sold.',
      closed: true,
    });
    expect(reviewSubmitProblem(problem(409, {}, { ...body, message: 'Old.' })).message).toBe(
      'Product P-2 is no longer sold.',
    );
    expect(reviewSubmitProblem(problem(409, {}, { message: 'Old.' })).message).toBe('Old.');
  });
});
