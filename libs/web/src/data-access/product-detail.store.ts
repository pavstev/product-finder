import type { HttpErrorResponse } from '@angular/common/http';
import { computed, inject } from '@angular/core';
import { patchState, signalStore, withComputed, withHooks, withMethods, withState } from '@ngrx/signals';
import { catchError, combineLatest, of, type Subscription } from 'rxjs';
import { CatalogApi } from './catalog-api.service';
import { CatalogSearchStore } from './catalog-search.store';
import type { CreateReview, Page, ProductDetail, Review } from './catalog-types';

/** Reviews per page. The list and the first-page refresh use the same size. */
export const REVIEW_PAGE_SIZE = 10;

const STALE_DETAIL = 'The latest data could not be loaded. You see the last loaded data.';

/** Seconds to wait when a 429 has no usable Retry-After header. */
const RETRY_FALLBACK_SECONDS = 60;

export type DetailStatus = 'idle' | 'loading' | 'ready' | 'not-found' | 'error';
export type ReviewsStatus = 'loading' | 'ready' | 'error';

/** A toast message for the page. A new `id` is a new toast. One slot: two in the same tick show only the last. */
export interface ToastNotice {
  id: number;
  severity: 'warn';
  summary: string;
  detail: string;
}

interface ProductDetailState {
  sku: string | null;
  status: DetailStatus;
  /** The last good product. It stays on screen while it reloads and when a reload fails. */
  product: ProductDetail | null;
  /** The shown review page. It stays on screen while the next page loads. */
  reviews: Page<Review> | null;
  reviewsStatus: ReviewsStatus;
  reviewPage: number;
  submitting: boolean;
  /** Why the last review could not be sent. Shown by the form. */
  lastError: string | null;
  /** Set by a 409: the product takes no more reviews. The form is hidden. */
  closedReason: string | null;
  toast: ToastNotice | null;
}

const initialState: ProductDetailState = {
  sku: null,
  status: 'idle',
  product: null,
  reviews: null,
  reviewsStatus: 'loading',
  reviewPage: 1,
  submitting: false,
  lastError: null,
  closedReason: null,
  toast: null,
};

/** Seconds from a Retry-After header (a number or an HTTP date), at least 1. A bad header gives the fallback. */
export function retryAfterSeconds(header: string | null): number {
  const value = header?.trim() ?? '';
  if (value === '') {
    return RETRY_FALLBACK_SECONDS;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    return Math.max(1, Math.ceil(Number(value)));
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return RETRY_FALLBACK_SECONDS;
  }
  return Math.max(1, Math.ceil((date - Date.now()) / 1000));
}

export interface ReviewSubmitProblem {
  message: string;
  /** True for a 409: the product takes no more reviews. */
  closed?: true;
}

/** Message for a failed POST. */
export function reviewSubmitProblem(error: HttpErrorResponse): ReviewSubmitProblem {
  switch (error.status) {
    case 400:
      return { message: 'Some fields are not valid. Please check them and try again.' };
    case 404:
      return { message: 'This product no longer exists.' };
    case 409: {
      // The API answers with a problem body (RFC 9457): the reason is in `detail`.
      const body = error.error as { detail?: unknown; message?: unknown } | null;
      const reason =
        typeof body?.detail === 'string'
          ? body.detail
          : typeof body?.message === 'string'
            ? body.message
            : 'This product no longer accepts reviews.';
      return { message: reason, closed: true };
    }
    case 429:
      return {
        message: `Too many reviews from this network. Try again in ${retryAfterSeconds(error.headers.get('Retry-After') ?? null)} seconds.`,
      };
    case 503:
      // The database was busy: an import held the product row, no connection was free in time, or the
      // connection broke during the write. In the last case the review may be stored, so the user
      // checks before a second post. A blind retry could store it twice.
      return {
        message: 'We could not confirm the review. Reload the page to check before you post it again.',
      };
    default:
      return { message: 'Your review could not be sent. Please try again later.' };
  }
}

/** State of one product detail page. Provide it on the page component, not in root. */
export const ProductDetailStore = signalStore(
  withState(initialState),
  withComputed((store) => ({
    /** The form is shown and enabled. */
    canReview: computed(() => (store.product()?.reviewable ?? false) && store.closedReason() === null),
  })),
  withMethods((store) => {
    const api = inject(CatalogApi);
    const search = inject(CatalogSearchStore);
    let toastId = 0;
    let productSub: Subscription | undefined;
    let pageSub: Subscription | undefined;
    let refreshSub: Subscription | undefined;
    /** Counts the moves of the shown review page. A refresh that started before a move must not undo it. */
    let pageEpoch = 0;

    const raiseToast = (summary: string, detail: string): void => {
      patchState(store, { toast: { id: ++toastId, severity: 'warn', summary, detail } });
    };

    /** Cancels the GETs. The POST is not here on purpose: a sent review should still be published. */
    const cancelAll = (): void => {
      productSub?.unsubscribe();
      pageSub?.unsubscribe();
      refreshSub?.unsubscribe();
    };

    /** Reload the product and one review page. On an error everything shown stays. */
    const refreshFrom = (page: number, summary: string, detail: string): void => {
      const sku = store.sku();
      if (!sku) {
        return;
      }
      refreshSub?.unsubscribe();
      const epoch = pageEpoch;
      refreshSub = combineLatest([
        api.product(sku).pipe(catchError(() => of(null))),
        api.reviews(sku, page, REVIEW_PAGE_SIZE).pipe(catchError(() => of(null))),
      ]).subscribe(([product, reviews]) => {
        // A page the user opened meanwhile wins over the refreshed one.
        const takeReviews = reviews !== null && epoch === pageEpoch;
        patchState(store, {
          ...(product ? { product, status: 'ready' as const } : {}),
          ...(takeReviews ? { reviews, reviewPage: page, reviewsStatus: 'ready' as const } : {}),
          // Nothing was ever shown, so a failed reload is an error and not a spinner without end.
          ...(reviews === null && epoch === pageEpoch && store.reviews() === null
            ? { reviewsStatus: 'error' as const }
            : {}),
        });
        if (product === null || reviews === null) {
          raiseToast(summary, detail);
        }
      });
    };

    const loadReviews = (page: number): void => {
      const sku = store.sku();
      if (!sku) {
        return;
      }
      pageSub?.unsubscribe();
      pageEpoch++;
      patchState(store, { reviewsStatus: 'loading' });
      pageSub = api.reviews(sku, page, REVIEW_PAGE_SIZE).subscribe({
        next: (reviews) => {
          patchState(store, { reviews, reviewPage: page, reviewsStatus: 'ready' });
        },
        error: () => {
          if (store.reviews()) {
            patchState(store, { reviewsStatus: 'ready' });
            raiseToast('Reviews not loaded', 'The page of reviews could not be loaded. Try again.');
          } else {
            patchState(store, { reviewsStatus: 'error' });
          }
        },
      });
    };

    const load = (sku: string): void => {
      cancelAll();
      patchState(store, { ...initialState, sku, status: 'loading' });
      productSub = api.product(sku).subscribe({
        next: (product) => {
          patchState(store, { product, status: 'ready' });
        },
        error: (error: HttpErrorResponse) => {
          patchState(store, { status: error.status === 404 || error.status === 400 ? 'not-found' : 'error' });
        },
      });
      loadReviews(1);
    };

    /** Puts the new review on top of page 1 at once when page 1 is shown. */
    const showPublished = (created: Review): void => {
      const loaded = store.reviews();
      if (loaded && store.reviewPage() === 1) {
        patchState(store, {
          submitting: false,
          reviewsStatus: 'ready',
          reviews: {
            items: [created, ...loaded.items].slice(0, REVIEW_PAGE_SIZE),
            total: loaded.total + 1,
            page: 1,
            pageSize: REVIEW_PAGE_SIZE,
          },
        });
      } else {
        // No page 1 on screen yet. The background refresh brings it, with the new review.
        patchState(store, { submitting: false, reviewsStatus: loaded ? 'ready' : 'loading' });
      }
    };

    const reviewPublished = (sku: string, created: Review): void => {
      // The rating and the count changed, so the cached result cards are old. Also when the user
      // moved on: the review is published either way.
      search.markStale();
      if (store.sku() !== sku) {
        return;
      }
      // A page change in flight would replace the list with an older view.
      pageSub?.unsubscribe();
      pageEpoch++;
      showPublished(created);
      refreshFrom(
        1,
        'Rating not updated',
        'Your review is published. Reload the page to see the new rating.',
      );
    };

    const reviewRejected = (sku: string, error: HttpErrorResponse): void => {
      // The user moved to another product. The answer is not about the one on screen.
      if (store.sku() !== sku) {
        return;
      }
      const problem = reviewSubmitProblem(error);
      patchState(
        store,
        problem.closed
          ? { submitting: false, closedReason: problem.message }
          : { submitting: false, lastError: problem.message },
      );
      if (problem.closed) {
        // The product left sale. Re-read it so the status banner matches the note.
        refreshFrom(store.reviewPage(), 'Not updated', STALE_DETAIL);
      }
    };

    return {
      /** Starts over for a SKU: skeleton, then product and first review page. */
      load,
      /** Retry after an error. */
      reload(): void {
        const sku = store.sku();
        if (sku) {
          load(sku);
        }
      },
      /** Reloads product and the shown review page in the background. Errors keep what is shown. */
      refresh(): void {
        refreshFrom(store.reviewPage(), 'Not updated', STALE_DETAIL);
      },
      loadReviews,
      /** Sends a review. Resolves true when it was published. */
      submitReview(review: CreateReview): Promise<boolean> {
        const sku = store.sku();
        if (!sku || store.submitting()) {
          return Promise.resolve(false);
        }
        patchState(store, { submitting: true, lastError: null });
        return new Promise<boolean>((resolve) => {
          api.createReview(sku, review).subscribe({
            next: (created) => {
              reviewPublished(sku, created);
              resolve(true);
            },
            error: (error: HttpErrorResponse) => {
              reviewRejected(sku, error);
              resolve(false);
            },
          });
        });
      },
      /** For the destroy hook. */
      _cancelAll: cancelAll,
    };
  }),
  withHooks({
    onDestroy: (store) => {
      store._cancelAll();
    },
  }),
);
