import { convertToParamMap } from '@angular/router';
import { FACET_VALUE_MAX } from '@product-finder/shared';
import {
  activeFilterCount,
  DEFAULT_STATE,
  type FilterOptions,
  isPageOverCap,
  LAST_PAGE,
  PAGE_SIZE,
  parseSearchQuery,
  type SearchState,
  SORT_OPTIONS,
  sortOptionsFor,
  toQueryParams,
  unknownFilters,
  withDiscontinued,
  withSearchText,
} from './search-query';

// The filter lists of the `facets` fixture in data-access/testing. The URL state does not import data-access.
const facets: FilterOptions = {
  functions: ['Emulsifier', 'Surfactant'],
  applicationAreas: ['Home Care'],
  regions: ['EMEA', 'Global'],
  certifications: ['Halal', 'Kosher'],
};

const parse = (params: Record<string, string>) => parseSearchQuery(convertToParamMap(params));

describe('LAST_PAGE', () => {
  it('is the deepest page the API answers with page numbers at the page size of the web', () => {
    expect(LAST_PAGE * PAGE_SIZE).toBeLessThanOrEqual(10_000);
    expect((LAST_PAGE + 1) * PAGE_SIZE).toBeGreaterThan(10_000);
  });
});

describe('parseSearchQuery', () => {
  it('reads every field with comma lists', () => {
    expect(
      parse({
        q: ' glucos ',
        function: 'Emulsifier,Surfactant',
        applicationArea: 'Home Care',
        region: 'EMEA',
        certifications: 'Halal, Vegan',
        status: 'ACTIVE,PHASE_OUT,DISCONTINUED',
        sort: '-rating',
        page: '3',
      }),
    ).toEqual({
      q: 'glucos',
      function: ['Emulsifier', 'Surfactant'],
      applicationArea: ['Home Care'],
      region: 'EMEA',
      certifications: ['Halal', 'Vegan'],
      status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      sort: '-rating',
      page: 3,
    });
  });

  it('falls back to defaults for broken values', () => {
    const state = parse({ sort: 'price', page: '-2', status: 'SOLD,ACTIVE', function: ',,' });
    expect(state).toMatchObject({ sort: 'name', page: 1, status: ['ACTIVE'], function: [] });
    expect(parse({ page: 'abc' }).page).toBe(1);
    expect(parse({ page: '1.5' }).page).toBe(1);
  });

  it('keeps values from an edited link inside the API limits', () => {
    // page * pageSize stops at row 10,000: page 500 of 20. A deeper page would be a 400.
    expect(parse({ page: '500' }).page).toBe(500);
    expect(parse({ q: `  ${'x'.repeat(120)}` }).q).toBe('x'.repeat(100));
  });

  it('moves a page past the cap to the last page the cap allows, not to page 1', () => {
    // An old link could ask for any page up to 10,000.
    expect(parse({ page: String(LAST_PAGE + 1) }).page).toBe(LAST_PAGE);
    expect(parse({ page: '600' }).page).toBe(LAST_PAGE);
    expect(parse({ page: '10000' }).page).toBe(LAST_PAGE);
    expect(parse({ page: '1e300' }).page).toBe(LAST_PAGE);
  });

  it('drops a filter value over 100 characters, as the API would answer 400', () => {
    const long = 'x'.repeat(101);
    const ok = 'y'.repeat(100);
    const state = parse({
      function: `Emulsifier,${long}`,
      applicationArea: ok,
      region: long,
      certifications: `${long},Halal`,
    });
    expect(state.function).toEqual(['Emulsifier']);
    expect(state.applicationArea).toEqual([ok]);
    expect(state.region).toBeNull();
    expect(state.certifications).toEqual(['Halal']);
  });

  it('counts a filter value in code points, as the import and the API do (FACET_VALUE_MAX)', () => {
    // 100 code points, but 101 UTF-16 units: the emoji is two of them.
    const astral = `${'x'.repeat(99)}\u{1F600}`;
    const tooLong = `${'x'.repeat(100)}\u{1F600}`;
    expect(FACET_VALUE_MAX).toBe(100);
    expect(parse({ function: astral }).function).toEqual([astral]);
    expect(parse({ applicationArea: tooLong }).applicationArea).toEqual([]);
  });

  it('keeps the first 50 values of a longer filter list', () => {
    const values = Array.from({ length: 60 }, (_, i) => `Value ${i}`);
    const state = parse({ function: values.join(',') });
    expect(state.function).toEqual(values.slice(0, 50));
  });

  it('keeps a filter list of exactly 50 values whole', () => {
    const values = Array.from({ length: 50 }, (_, i) => `Value ${i}`);
    expect(parse({ certifications: values.join(',') }).certifications).toEqual(values);
  });

  it('drops duplicate values', () => {
    expect(parse({ certifications: 'Halal,Halal' }).certifications).toEqual(['Halal']);
  });

  it('keeps filter values that are not offered as options, so the page can show them', () => {
    expect(parse({ function: 'Retired', region: 'Mars' })).toMatchObject({
      function: ['Retired'],
      region: 'Mars',
    });
  });
});

describe('isPageOverCap', () => {
  const over = (params: Record<string, string>) => isPageOverCap(convertToParamMap(params));

  it('is true for a whole page number past LAST_PAGE, the pages the parser moves to LAST_PAGE', () => {
    expect(over({ page: String(LAST_PAGE + 1) })).toBe(true);
    expect(over({ page: '10000' })).toBe(true);
  });

  it('is false for a page inside the cap, a missing page and a broken value', () => {
    expect(over({ page: String(LAST_PAGE) })).toBe(false);
    expect(over({ page: '3' })).toBe(false);
    expect(over({})).toBe(false);
    for (const page of ['abc', '600.5', '-600', '0', '', 'Infinity']) {
      expect(over({ page })).toBe(false);
    }
  });
});

describe('toQueryParams', () => {
  it('leaves defaults out so links stay short', () => {
    expect(toQueryParams(DEFAULT_STATE)).toEqual({
      q: null,
      function: null,
      applicationArea: null,
      region: null,
      certifications: null,
      status: null,
      sort: null,
      page: null,
    });
  });

  it('round-trips through the URL', () => {
    const state: SearchState = {
      q: 'kosher soap',
      function: ['Surfactant'],
      applicationArea: ['Home Care', 'Personal Care'],
      region: 'Global',
      certifications: ['Halal'],
      status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      sort: '-launchYear',
      page: 2,
    };
    const params = Object.fromEntries(
      Object.entries(toQueryParams(state)).filter(([, value]) => value !== null),
    ) as Record<string, string | number>;
    expect(params).toEqual({
      q: 'kosher soap',
      function: 'Surfactant',
      applicationArea: 'Home Care,Personal Care',
      region: 'Global',
      certifications: 'Halal',
      status: 'ACTIVE,PHASE_OUT,DISCONTINUED',
      sort: '-launchYear',
      page: 2,
    });
    expect(parse(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])))).toEqual(state);
  });
});

describe('sort and search text', () => {
  it('sorts a link with a search text and no sort by Best match, like the API', () => {
    expect(parse({ q: 'glucos' }).sort).toBe('relevance');
    expect(parse({ q: 'glucos', sort: 'name' }).sort).toBe('name');
    expect(parse({ q: 'glucos', sort: 'price' }).sort).toBe('relevance');
  });

  it('falls back to the default sort for Best match without a search text, as the API answers 400', () => {
    expect(parse({ sort: 'relevance' }).sort).toBe('name');
    expect(parse({ q: '   ', sort: 'relevance' }).sort).toBe('name');
  });

  it('never writes Best match without a search text', () => {
    expect(toQueryParams({ ...DEFAULT_STATE, sort: 'relevance' })).toMatchObject({ sort: null });
    expect(toQueryParams({ ...DEFAULT_STATE, q: '  ', sort: 'relevance' })).toMatchObject({ sort: null });
  });

  it('round-trips a chosen sort that is not the default of the search text', () => {
    const state: SearchState = { ...DEFAULT_STATE, q: 'soap', sort: 'name' };
    const params = toQueryParams(state);
    expect(params).toMatchObject({ q: 'soap', sort: 'name' });
    expect(parse({ q: 'soap', sort: 'name' })).toEqual(state);
  });

  it('switches to Best match when a search text is typed with the default sort, from page 1', () => {
    const next = withSearchText({ ...DEFAULT_STATE, region: 'EMEA', page: 3 }, 'glucos');
    expect(next).toEqual({ ...DEFAULT_STATE, region: 'EMEA', q: 'glucos', sort: 'relevance', page: 1 });
    expect(toQueryParams(next)).toMatchObject({ q: 'glucos', region: 'EMEA', sort: null, page: null });
  });

  it('offers Best match first, and only when there is a search text', () => {
    expect(sortOptionsFor('glucos')[0]).toEqual({ value: 'relevance', label: 'Best match' });
    expect(sortOptionsFor('glucos')).toEqual(SORT_OPTIONS);
    for (const q of ['', '   ']) {
      expect(sortOptionsFor(q).map((option) => option.value)).toEqual([
        'name',
        '-name',
        '-rating',
        '-reviews',
        '-launchYear',
        'launchYear',
      ]);
    }
  });
});

describe('filters', () => {
  it('maps the discontinued checkbox to the status list and resets the page', () => {
    const on = withDiscontinued({ ...DEFAULT_STATE, page: 4 }, true);
    expect(on).toMatchObject({ status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'], page: 1 });
    expect(withDiscontinued(on, false).status).toEqual([]);
  });

  it('counts active filters but not the search text or sort', () => {
    expect(activeFilterCount({ ...DEFAULT_STATE, q: 'x', sort: '-rating' })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_STATE,
        function: ['A', 'B'],
        region: 'EMEA',
        status: ['ACTIVE', 'PHASE_OUT', 'DISCONTINUED'],
      }),
    ).toBe(4);
  });

  it('counts a status list from a link as one filter, unless it is the default', () => {
    expect(activeFilterCount({ ...DEFAULT_STATE, status: ['ACTIVE'] })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_STATE, status: ['PHASE_OUT', 'ACTIVE'] })).toBe(0);
  });
});

describe('unknownFilters', () => {
  it('lists values that are not in the facets and a status list the checkbox cannot show', () => {
    const state: SearchState = {
      ...DEFAULT_STATE,
      function: ['Surfactant', 'Retired'],
      applicationArea: ['Home Care'],
      region: 'Mars',
      certifications: ['Halal', 'Organic'],
      status: ['ACTIVE'],
    };
    expect(unknownFilters(state, facets)).toEqual([
      { field: 'function', value: 'Retired' },
      { field: 'region', value: 'Mars' },
      { field: 'certifications', value: 'Organic' },
      { field: 'status', value: 'ACTIVE' },
    ]);
  });
});
