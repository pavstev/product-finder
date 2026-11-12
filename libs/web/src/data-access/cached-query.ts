import { HttpErrorResponse, HttpParams } from '@angular/common/http';
import type { Params } from '@angular/router';
import { getState, patchState, type WritableStateSource } from '@ngrx/signals';
import { type RxMethod, rxMethod } from '@ngrx/signals/rxjs-interop';
import { catchError, distinctUntilChanged, EMPTY, map, type Observable, pipe, switchMap, tap } from 'rxjs';
import type { SearchState } from '../url-state/search-query';
import type { ProblemDetails } from './catalog-types';

// The shared part of CatalogSearchStore and FacetsStore: a query cache with stale-while-revalidate.

export type QueryStatus = 'idle' | 'loading' | 'refreshing' | 'success' | 'error';

export interface QueryState<T> {
  /** The normalized query string of the shown query. */
  key: string | null;
  status: QueryStatus;
  /** The answer for `key`. It stays while a stale answer refreshes and when that refresh fails. */
  result: T | null;
  error: ProblemDetails | null;
}

export function initialQueryState<T>(): QueryState<T> {
  return { key: null, status: 'idle', result: null, error: null };
}

export interface CachedQueryOptions<T> {
  /** Equal keys must mean equal answers. */
  keyOf(state: SearchState): string;
  fetch(state: SearchState): Observable<T>;
  /** Answers kept. The least recently used goes out first. */
  maxEntries: number;
  /** An answer younger than this is shown without a request. Older ones show and refresh. */
  freshForMs: number;
}

/** A type, not an interface: `withMethods` wants an index signature, and only a type alias has one. */
export type CachedQueryMethods = {
  /** Shows the answer for a search state: from the cache, from the API, or both. */
  load: RxMethod<SearchState>;
  /** Fetches the last query again after an error. Without an error it does nothing. */
  retry(): void;
  /** Marks every kept answer stale, also the shown one. It still shows at once, then refreshes. */
  markStale(): void;
};

interface CacheEntry<T> {
  result: T;
  fetchedAt: number;
}

/** A small LRU cache of answers. A Map keeps insertion order, so the first key is the least recently used. */
class AnswerCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly maxEntries: number,
    private readonly freshForMs: number,
  ) {}

  isFresh(entry: CacheEntry<T>): boolean {
    return Date.now() - entry.fetchedAt < this.freshForMs;
  }

  peek(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key);
  }

  /** The entry, now the most recently used. */
  touch(key: string): CacheEntry<T> | undefined {
    const entry = this.entries.get(key);
    if (entry) {
      this.entries.delete(key);
      this.entries.set(key, entry);
    }
    return entry;
  }

  remember(key: string, result: T): void {
    this.entries.delete(key);
    this.entries.set(key, { result, fetchedAt: Date.now() });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  markAllStale(): void {
    for (const entry of this.entries.values()) {
      entry.fetchedAt = Number.NEGATIVE_INFINITY;
    }
  }
}

/** A query string from URL query params. Null and undefined values are left out. */
export function queryKey(params: Params): string {
  const fromObject: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      fromObject[name] = String(value);
    }
  }
  return new HttpParams({ fromObject }).toString();
}

function isProblemBody(body: unknown): body is Partial<ProblemDetails> & Pick<ProblemDetails, 'status'> {
  const value = body as Partial<ProblemDetails> | null;
  return typeof value === 'object' && value !== null && typeof value.status === 'number';
}

/** Any failed request as a problem detail (RFC 9457). Status 0 means no answer came. */
function toProblemDetails(error: unknown): ProblemDetails {
  if (error instanceof HttpErrorResponse) {
    const body: unknown = error.error;
    const problem = isProblemBody(body) ? body : null;
    return {
      type: problem?.type ?? 'about:blank',
      title: problem?.title ?? 'Request failed',
      status: problem?.status ?? error.status,
      detail: problem?.detail ?? error.message,
      instance: problem?.instance ?? '',
    };
  }
  return {
    type: 'about:blank',
    title: 'No answer',
    status: 0,
    detail: error instanceof Error ? error.message : 'The request failed.',
    instance: '',
  };
}

/** The shown query is up to date: its answer is on the way, or fresh. A stale or failed one is not. */
function isUpToDate<T>(
  store: WritableStateSource<QueryState<T>>,
  cache: AnswerCache<T>,
  key: string,
): boolean {
  const { key: shown, status } = getState(store);
  if (shown !== key) {
    return false;
  }
  if (status === 'loading' || status === 'refreshing') {
    return true;
  }
  const entry = cache.peek(key);
  return status === 'success' && entry !== undefined && cache.isFresh(entry);
}

function fetchAndRemember<T>(
  store: WritableStateSource<QueryState<T>>,
  cache: AnswerCache<T>,
  options: CachedQueryOptions<T>,
  state: SearchState,
  key: string,
): Observable<unknown> {
  return options.fetch(state).pipe(
    tap((result) => {
      cache.remember(key, result);
      patchState(store, { status: 'success', result, error: null });
    }),
    // The result stays: the old answer of a stale hit, or null for a miss.
    catchError((error: unknown) => {
      patchState(store, { status: 'error', error: toProblemDetails(error) });
      return EMPTY;
    }),
  );
}

function answer<T>(
  store: WritableStateSource<QueryState<T>>,
  cache: AnswerCache<T>,
  options: CachedQueryOptions<T>,
  state: SearchState,
  key: string,
): Observable<unknown> {
  const entry = cache.touch(key);
  if (entry && cache.isFresh(entry)) {
    patchState(store, { key, status: 'success', result: entry.result, error: null });
    return EMPTY;
  }
  patchState(
    store,
    entry
      ? { key, status: 'refreshing', result: entry.result, error: null }
      : { key, status: 'loading', result: null, error: null },
  );
  return fetchAndRemember(store, cache, options, state, key);
}

/** The methods of a cached query store. Call it in `withMethods`, so `rxMethod` has its injection context. */
export function cachedQueryMethods<T>(
  store: WritableStateSource<QueryState<T>>,
  options: CachedQueryOptions<T>,
): CachedQueryMethods {
  const cache = new AnswerCache<T>(options.maxEntries, options.freshForMs);
  let last: SearchState | null = null;

  const load = rxMethod<SearchState>(
    pipe(
      tap((state) => {
        last = state;
      }),
      map((state) => ({ state, key: options.keyOf(state) })),
      // The same key again is new only when its answer went stale or failed: a reopened page revalidates.
      distinctUntilChanged((before, next) => before.key === next.key && isUpToDate(store, cache, next.key)),
      switchMap(({ state, key }) => answer(store, cache, options, state, key)),
    ),
  );

  return {
    load,
    retry(): void {
      // Only after an error. A stale answer refreshes when the page asks for it, not on retry.
      if (last && getState(store).status === 'error') {
        load(last);
      }
    },
    markStale: () => {
      cache.markAllStale();
    },
  };
}
