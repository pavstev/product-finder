import { BreakpointObserver } from '@angular/cdk/layout';
import { formatNumber, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  LOCALE_ID,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { SEARCH_QUERY_MAX } from '@product-finder/shared';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DrawerModule } from 'primeng/drawer';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { SelectModule } from 'primeng/select';
import { SkeletonModule } from 'primeng/skeleton';
import { debounceTime, map, Subject } from 'rxjs';
import { CatalogSearchStore } from '../data-access/catalog-search.store';
import type { Facets, FacetValue, ProductStatus } from '../data-access/catalog-types';
import { FacetsStore } from '../data-access/facets.store';
import { RATE_LIMITED_MESSAGE } from '../ui/http-messages';
import { PageTitle } from '../ui/page-title.service';
import { ProductCard } from '../ui/product-card.component';
import { statusView } from '../ui/status-tag.component';
import {
  activeFilterCount,
  DEFAULT_STATE,
  type FilterChip,
  type FilterOptions,
  includesDiscontinued,
  isPageOverCap,
  LAST_PAGE,
  PAGE_SIZE,
  parseSearchQuery,
  type SearchState,
  sortOptionsFor,
  toQueryParams,
  unknownFilters,
  withDiscontinued,
  withoutFilters,
  withSearchText,
} from '../url-state/search-query';

type ListField = 'function' | 'applicationArea' | 'certifications';

const EMPTY_FACETS: Facets = {
  functions: [],
  applicationAreas: [],
  regions: [],
  certifications: [],
  statuses: [],
};
const CHIP_FIELDS: Record<FilterChip['field'], string> = {
  function: 'Function',
  applicationArea: 'Application area',
  region: 'Region',
  certifications: 'Certification',
  status: 'Status',
};
export const SEARCH_DEBOUNCE_MS = 300;

/** The values of each facet, for the chips of link filters that no control offers. */
function toFilterValues(facets: Facets | null): FilterOptions | null {
  const values = (list: FacetValue[]) => list.map((item) => item.value);
  return (
    facets && {
      functions: values(facets.functions),
      applicationAreas: values(facets.applicationAreas),
      regions: values(facets.regions),
      certifications: values(facets.certifications),
    }
  );
}

interface FilterOption {
  label: string;
  value: string;
  disabled: boolean;
}

/** Options like "EMEA (1,204)". A value left without products is disabled, unless picked: a picked one can go. */
function toOptions(values: FacetValue[], picked: string[], locale: string): FilterOption[] {
  return values.map(({ value, count }) => ({
    label: `${value} (${formatNumber(count, locale, '1.0-0')})`,
    value,
    disabled: count === 0 && !picked.includes(value),
  }));
}

function chipLabel(chip: FilterChip): string {
  const value =
    chip.field === 'status'
      ? chip.value
          .split(',')
          .map((status) => statusView(status as ProductStatus).label)
          .join(', ')
      : chip.value;
  return `${CHIP_FIELDS[chip.field]}: ${value}`;
}

@Component({
  selector: 'app-product-search',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    ButtonModule,
    CheckboxModule,
    DrawerModule,
    InputTextModule,
    MessageModule,
    MultiSelectModule,
    PaginatorModule,
    SelectModule,
    SkeletonModule,
    ProductCard,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './product-search.page.html',
  styleUrl: './product-search.page.scss',
})
export class ProductSearchPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly pageTitle = inject(PageTitle);
  protected readonly search = inject(CatalogSearchStore);
  protected readonly facets = inject(FacetsStore);

  private readonly state$ = this.route.queryParamMap.pipe(map(parseSearchQuery));
  private readonly typed$ = new Subject<string>();

  /** The single source of truth is the URL. */
  protected readonly state = toSignal(this.state$, { initialValue: DEFAULT_STATE });
  /** The URL asks for a page past LAST_PAGE. The state holds LAST_PAGE, so the URL must say so too. */
  private readonly pageOverCap = toSignal(this.route.queryParamMap.pipe(map(isPageOverCap)), {
    initialValue: false,
  });
  /** The results of the URL query. A cached page stays on screen while it refreshes. */
  protected readonly page = this.search.result;
  /** The last filter options that loaded. They stay while new ones load or when a load fails. */
  private readonly loadedFacets = linkedSignal<Facets | null, Facets | null>({
    source: this.facets.result,
    computation: (facets, previous) => facets ?? previous?.value ?? null,
  });

  /** Filters from the link that the controls cannot show. They show as chips. */
  protected readonly unknown = computed(() =>
    unknownFilters(this.state(), toFilterValues(this.loadedFacets())),
  );
  protected readonly chips = computed(() =>
    this.unknown().map((chip) => ({ ...chip, label: chipLabel(chip) })),
  );
  /** The state as the filter controls show it: without the values that show as chips. */
  protected readonly shown = computed(() => withoutFilters(this.state(), this.unknown()));

  private readonly locale = inject(LOCALE_ID);
  /** The options of each filter control, with counts. */
  protected readonly options = computed(() => {
    const facets = this.loadedFacets() ?? EMPTY_FACETS;
    const shown = this.shown();
    const options = (values: FacetValue[], picked: string[]) => toOptions(values, picked, this.locale);
    return {
      functions: options(facets.functions, shown.function),
      applicationAreas: options(facets.applicationAreas, shown.applicationArea),
      regions: options(facets.regions, shown.region ? [shown.region] : []),
      certifications: options(facets.certifications, shown.certifications),
    };
  });

  /** Page numbers stop at LAST_PAGE, where the API wants a cursor. The count above the grid stays exact. */
  protected readonly pagedTotal = computed(() => Math.min(this.page()?.total ?? 0, LAST_PAGE * PAGE_SIZE));

  /** For a page past the end (an old link, or fewer products now): the last page that has results. */
  protected readonly redirectPage = computed(() => {
    const page = this.page();
    if (!page || page.items.length > 0 || page.total === 0) {
      return null;
    }
    const last = Math.ceil(page.total / (page.pageSize > 0 ? page.pageSize : PAGE_SIZE));
    return last < this.state().page ? last : null;
  });
  /** A cached result shows at once, also while it refreshes, so back shows no skeleton. */
  protected readonly view = computed(() => {
    if (this.redirectPage() !== null) {
      return 'loading';
    }
    if (this.page()) {
      return 'ok';
    }
    return this.search.status() === 'error' ? 'error' : 'loading';
  });
  /** A refresh of a cached result failed. The old result stays on screen with a note. */
  protected readonly refreshFailed = computed(() => this.search.status() === 'error' && this.page() !== null);

  /** Why the search failed. A 429 is a limit on the network, not a broken connection. */
  protected readonly errorMessage = computed(() =>
    this.search.error()?.status === 429
      ? RATE_LIMITED_MESSAGE
      : 'The catalogue could not be loaded. Check your connection and try again.',
  );

  protected readonly isMobile = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 767.98px)')
      .pipe(map((result) => result.matches)),
    { initialValue: false },
  );
  protected readonly filtersOpen = signal(false);
  protected readonly searchText = signal('');
  protected readonly filterCount = computed(() => activeFilterCount(this.state()));
  protected readonly discontinued = computed(() => includesDiscontinued(this.shown()));
  protected readonly first = computed(() => (this.state().page - 1) * PAGE_SIZE);
  private readonly query = computed(() => this.state().q);

  /** Best match shows only when there is a search text. */
  protected readonly sortOptions = computed(() => [...sortOptionsFor(this.state().q)]);
  protected readonly pageSize = PAGE_SIZE;
  protected readonly queryMax = SEARCH_QUERY_MAX;
  protected readonly skeletons = Array.from({ length: 6 }, (_, i) => i);

  constructor() {
    // The query param map emits at once, so a cached result is in the store before the first render.
    this.search.load(this.state$);
    this.facets.load(this.state$);
    // Keep the search box in sync when the URL changes from outside (back button, shared link).
    effect(() => {
      const q = this.state().q;
      if (untracked(this.searchText).trim() !== q) {
        this.searchText.set(q);
      }
    });
    effect(() => {
      const q = this.query();
      this.pageTitle.set(q ? `"${q}"` : 'Search');
    });
    // replaceUrl, so the back button does not return to the empty page.
    effect(() => {
      const page = this.redirectPage();
      if (page !== null) {
        untracked(() => {
          this.update({ page }, true);
        });
      }
    });
    // A link past the page cap shows LAST_PAGE. Put that page into the URL, so a copied link matches.
    effect(() => {
      if (this.pageOverCap() && this.redirectPage() === null) {
        untracked(() => {
          this.update({ page: this.state().page }, true);
        });
      }
    });
    // No distinctUntilChanged: the URL can change without the box, so the same text must search again.
    this.typed$
      .pipe(
        map((text) => text.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        takeUntilDestroyed(),
      )
      .subscribe((q) => {
        if (q !== this.state().q) {
          // A default sort follows the text: Best match while there is one, name when it is cleared.
          this.update(withSearchText(this.state(), q), true);
        }
      });
  }

  protected onType(text: string): void {
    this.searchText.set(text);
    this.typed$.next(text);
  }

  /** Every change goes through the URL. Filter changes go back to page 1. */
  protected update(changes: Partial<SearchState>, replaceUrl = false): void {
    const next: SearchState = { ...this.state(), page: 1, ...changes };
    void this.router.navigate([], { relativeTo: this.route, queryParams: toQueryParams(next), replaceUrl });
  }

  /** A multiselect shows only the values it offers. The others stay until their chip is removed. */
  protected setList(field: ListField, values: string[] | null): void {
    const kept = this.unknown()
      .filter((chip) => chip.field === field)
      .map((chip) => chip.value);
    const changes: Partial<SearchState> = {};
    changes[field] = [...new Set([...(values ?? []), ...kept])];
    this.update(changes);
  }

  protected removeChip(chip: FilterChip): void {
    this.update({ ...withoutFilters(this.state(), [chip]), page: 1 });
  }

  protected setDiscontinued(include: boolean): void {
    const next = withDiscontinued(this.state(), include);
    this.update({ status: next.status });
  }

  protected onPage(event: PaginatorState): void {
    const page = Math.floor((event.first ?? 0) / (event.rows ?? PAGE_SIZE)) + 1;
    this.update({ page });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  protected clearFilters(): void {
    this.searchText.set('');
    this.update({ ...DEFAULT_STATE });
  }

  protected retry(): void {
    this.search.retry();
  }

  protected retryFacets(): void {
    this.facets.retry();
  }
}
