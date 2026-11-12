import type { ParamMap, Params } from '@angular/router';
import {
  codePointLength,
  DEFAULT_SORT,
  DEFAULT_VISIBLE_STATUSES,
  defaultSortFor,
  FACET_VALUE_MAX,
  hasSearchText,
  lastPageFor,
  LIST_ITEMS_MAX,
  PRODUCT_STATUSES,
  type ProductStatus,
  RELEVANCE_SORT,
  SEARCH_QUERY_MAX,
  SORT_KEYS,
  type SortKey,
} from '@product-finder/shared';

/** The search page state. It lives in the URL query, so a copied link reproduces the view. */
export interface SearchState {
  q: string;
  function: string[];
  applicationArea: string[];
  region: string | null;
  certifications: string[];
  /** Empty means the API default (active and phase-out). */
  status: ProductStatus[];
  sort: SortKey;
  page: number;
}

/** Labels for the sort keys of shared, in the order the select shows them. One label per key. */
const SORT_LABELS = {
  relevance: 'Best match',
  name: 'Name A to Z',
  '-name': 'Name Z to A',
  '-rating': 'Best rated',
  '-reviews': 'Most reviewed',
  '-launchYear': 'Newest launch',
  launchYear: 'Oldest launch',
} as const satisfies Record<SortKey, string>;

export interface SortOption {
  value: SortKey;
  label: string;
}

export const SORT_OPTIONS: readonly SortOption[] = (Object.keys(SORT_LABELS) as SortKey[]).map((value) => ({
  value,
  label: SORT_LABELS[value],
}));

/** The sort options for a search text. Best match ranks by the text, so it shows only when there is one. */
export function sortOptionsFor(q: string): readonly SortOption[] {
  return hasSearchText(q) ? SORT_OPTIONS : SORT_OPTIONS.filter((option) => option.value !== RELEVANCE_SORT);
}

/** The sort a state can use. Best match without a search text falls back to the default (the API answers 400). */
function usableSort(q: string, sort: SortKey): SortKey {
  return sort === RELEVANCE_SORT && !hasSearchText(q) ? defaultSortFor(q) : sort;
}

export const PAGE_SIZE = 20;

/** The deepest page the web links to. The API answers 400 to a deeper page. */
export const LAST_PAGE = lastPageFor(PAGE_SIZE);

export const DEFAULT_STATE: SearchState = {
  q: '',
  function: [],
  applicationArea: [],
  region: null,
  certifications: [],
  status: [],
  sort: DEFAULT_SORT,
  page: 1,
};

/** Values over FACET_VALUE_MAX code points are dropped, counted like the import, so every stored value fits. */
function list(value: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && codePointLength(part) <= FACET_VALUE_MAX);
}

/** A filter list without duplicates, cut to the API limit. */
function filterList(value: string | null): string[] {
  return unique(list(value)).slice(0, LIST_ITEMS_MAX);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/** Same values in any order. Both lists have no duplicates. */
function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && b.every((value) => a.includes(value));
}

/** The page of the URL as a whole number from 1, or null when it is missing or broken. */
function urlPage(params: ParamMap): number | null {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : null;
}

/** The URL asks for a page past LAST_PAGE. The parser shows LAST_PAGE, so the page puts it into the URL. */
export function isPageOverCap(params: ParamMap): boolean {
  return (urlPage(params) ?? 1) > LAST_PAGE;
}

/**
 * URL to state. Broken values fall back to the defaults, so an edited link never breaks the page.
 * A page past LAST_PAGE becomes LAST_PAGE, not 1: the search page then moves to the last page with results.
 */
export function parseSearchQuery(params: ParamMap): SearchState {
  const sort = SORT_KEYS.find((key) => key === params.get('sort'));
  const status = list(params.get('status')).filter((value): value is ProductStatus =>
    (PRODUCT_STATUSES as readonly string[]).includes(value),
  );
  // Same limit as the API. A longer value from an edited link would give a 400.
  const q = (params.get('q') ?? '').trim().slice(0, SEARCH_QUERY_MAX).trim();
  return {
    q,
    function: filterList(params.get('function')),
    applicationArea: filterList(params.get('applicationArea')),
    region: list(params.get('region'))[0] ?? null,
    certifications: filterList(params.get('certifications')),
    status: unique(status) as ProductStatus[],
    sort: usableSort(q, sort ?? defaultSortFor(q)),
    page: Math.min(urlPage(params) ?? 1, LAST_PAGE),
  };
}

/** State to URL query. Default values are left out (null removes them), so links stay short. */
export function toQueryParams(state: SearchState): Params {
  const join = (values: string[]) => (values.length > 0 ? values.join(',') : null);
  const q = state.q.trim();
  const sort = usableSort(q, state.sort);
  return {
    q: q || null,
    function: join(state.function),
    applicationArea: join(state.applicationArea),
    region: state.region || null,
    certifications: join(state.certifications),
    status: join(state.status),
    sort: sort === defaultSortFor(q) ? null : sort,
    page: state.page > 1 ? state.page : null,
  };
}

/** A new search text, from page 1. A default sort follows the text, so the API never gets relevance without q. */
export function withSearchText(state: SearchState, q: string): SearchState {
  const sort = state.sort === defaultSortFor(state.q) ? defaultSortFor(q) : state.sort;
  return { ...state, q, sort: usableSort(q, sort), page: 1 };
}

export function includesDiscontinued(state: SearchState): boolean {
  return state.status.includes('DISCONTINUED');
}

/** The checkbox "Include discontinued products" maps to the status list. */
export function withDiscontinued(state: SearchState, include: boolean): SearchState {
  return { ...state, status: include ? [...PRODUCT_STATUSES] : [], page: 1 };
}

/** Number of active filters, for the "Filters (n)" button. Text and sort do not count; statuses count once. */
export function activeFilterCount(state: SearchState): number {
  const statusFilter = state.status.length > 0 && !sameValues(state.status, DEFAULT_VISIBLE_STATUSES);
  return (
    state.function.length +
    state.applicationArea.length +
    (state.region ? 1 : 0) +
    state.certifications.length +
    (statusFilter ? 1 : 0)
  );
}

/** The values the filter controls offer. Its own type, so the URL state does not import data-access. */
export interface FilterOptions {
  functions: string[];
  applicationAreas: string[];
  regions: string[];
  certifications: string[];
}

/** A filter from the URL that the filter controls cannot show. The page shows it as a chip. */
export interface FilterChip {
  field: 'function' | 'applicationArea' | 'region' | 'certifications' | 'status';
  /** One value. For `status` the whole list, comma-separated. */
  value: string;
}

/** Filters from an old or edited link that the controls cannot show. Without facets only the status is checked. */
export function unknownFilters(state: SearchState, facets: FilterOptions | null): FilterChip[] {
  const chips: FilterChip[] = [];
  if (facets) {
    const add = (field: FilterChip['field'], values: string[], offered: string[]) => {
      for (const value of values.filter((v) => !offered.includes(v))) {
        chips.push({ field, value });
      }
    };
    add('function', state.function, facets.functions);
    add('applicationArea', state.applicationArea, facets.applicationAreas);
    add('region', state.region ? [state.region] : [], facets.regions);
    add('certifications', state.certifications, facets.certifications);
  }
  const status = state.status;
  if (
    status.length > 0 &&
    !sameValues(status, DEFAULT_VISIBLE_STATUSES) &&
    !sameValues(status, PRODUCT_STATUSES)
  ) {
    chips.push({ field: 'status', value: status.join(',') });
  }
  return chips;
}

/** The state without the given chips. Removing the status chip goes back to the default status. */
export function withoutFilters(state: SearchState, chips: FilterChip[]): SearchState {
  const keep = (field: FilterChip['field'], values: string[]) =>
    values.filter((value) => !chips.some((chip) => chip.field === field && chip.value === value));
  return {
    ...state,
    function: keep('function', state.function),
    applicationArea: keep('applicationArea', state.applicationArea),
    region: keep('region', state.region ? [state.region] : [])[0] ?? null,
    certifications: keep('certifications', state.certifications),
    status: chips.some((chip) => chip.field === 'status') ? [] : state.status,
  };
}
