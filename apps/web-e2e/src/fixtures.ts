import { AxeBuilder } from '@axe-core/playwright';
import { type APIRequestContext, test as base, expect, type Locator, type Page } from '@playwright/test';

// An e2e project talks HTTP only and imports no other project.
// So the few API types and limits the specs read are written out here.

export type ProductStatus = 'ACTIVE' | 'PHASE_OUT' | 'DISCONTINUED';

export interface ProductSummary {
  sku: string;
  name: string;
  status: ProductStatus;
  region: string;
  ratingAvg: number | null;
  reviewCount: number;
}

export interface ProductDetail extends ProductSummary {
  inLatestExport: boolean;
  reviewable: boolean;
}

export interface ProductPage {
  items: ProductSummary[];
  total: number;
  page: number;
  pageSize: number;
}

/** Results per page on the search page (PAGE_SIZE in the web lib). */
export const PAGE_SIZE = 20;

/** The app shows the phone layout (filter drawer) below this width. */
const PHONE_MAX_WIDTH = 768;

/** Reads the API directly, so the specs pick their data from the stack and hard-code no SKU. */
export class CatalogClient {
  constructor(private readonly request: APIRequestContext) {}

  /** GET /api/products with the page size of the search page, unless the query sets one. */
  async search(query: Record<string, string | number> = {}): Promise<ProductPage> {
    const response = await this.request.get('/api/products', { params: { pageSize: PAGE_SIZE, ...query } });
    expect(response.status(), `GET /api/products ${JSON.stringify(query)}`).toBe(200);
    return (await response.json()) as ProductPage;
  }

  async product(sku: string): Promise<ProductDetail> {
    const response = await this.request.get(`/api/products/${encodeURIComponent(sku)}`);
    expect(response.status(), `GET /api/products/${sku}`).toBe(200);
    return (await response.json()) as ProductDetail;
  }

  /** The products of one status, sorted by name. Fails when the stack has none. */
  async withStatus(status: ProductStatus, count = 1): Promise<ProductSummary[]> {
    const { items } = await this.search({ status, sort: 'name', pageSize: count });
    expect(items.length, `products with status ${status}`).toBeGreaterThanOrEqual(count);
    return items;
  }
}

export const test = base.extend<{ api: CatalogClient }>({
  // The built-in request fixture has the baseURL of the config.
  api: async ({ request }, use) => {
    await use(new CatalogClient(request));
  },
});

export { expect };

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? PHONE_MAX_WIDTH) < PHONE_MAX_WIDTH;
}

/** The result count line, "14 products". It reads "Loading products..." while the search runs. */
export function resultCount(page: Page): Locator {
  return page.locator('main p.count');
}

/** The SKUs of the result cards, in page order, read from the card links. */
export async function resultSkus(page: Page): Promise<string[]> {
  const hrefs = await page
    .getByRole('article')
    .getByRole('link')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  return hrefs.map((href) => decodeURIComponent(href.replace(/^\/products\//, '')));
}

/** Waits until the cards show the given SKUs, in this order. */
export async function expectResults(page: Page, skus: string[]): Promise<void> {
  await expect(resultCount(page)).toHaveText(new RegExp(`^\\s*${skus.length === 0 ? 0 : '\\d+'} products?`));
  await expect.poll(() => resultSkus(page), { message: 'the result cards' }).toEqual(skus);
}

/** The filters: the side column on wide screens, the drawer on phones. Opens the drawer when needed. */
export async function openFilters(page: Page): Promise<Locator> {
  if (!isPhone(page)) {
    return page.getByRole('complementary', { name: 'Filters' });
  }
  await page.getByRole('button', { name: /Filters \(\d+\)/ }).click();
  const drawer = page
    .getByRole('complementary')
    .filter({ has: page.getByRole('button', { name: 'Show results' }) });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Closes the drawer on phones. The side column on wide screens stays. */
export async function closeFilters(page: Page): Promise<void> {
  if (!isPhone(page)) {
    return;
  }
  const done = page.getByRole('button', { name: 'Show results' });
  await done.click();
  await expect(done).toBeHidden();
}

/** The region select. Its id is side-region in the side column and drawer-region in the drawer. */
export function regionSelect(page: Page): Locator {
  return page.locator('#side-region, #drawer-region');
}

/** Picks an option of a PrimeNG select. The options open in an overlay on the body. */
export async function chooseOption(page: Page, select: Locator, option: RegExp): Promise<void> {
  await select.click();
  await page.getByRole('option', { name: option }).click();
}

/** The rating summary of the product on its detail page, "4.7 of 5 (3 reviews)". */
export function productRating(page: Page): Locator {
  return page.locator('article.product app-rating-stars');
}

/** The text RatingStars shows for an average and a count. */
export function ratingText(ratingAvg: number | null, reviewCount: number): string {
  if (reviewCount === 0 || ratingAvg === null) {
    return 'No reviews yet';
  }
  return `${ratingAvg.toFixed(1)} of 5 (${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'})`;
}

/** The WCAG 2.1 A and AA rules of axe. */
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21aa'];

/** The serious and critical axe violations of the page, short enough to read in a test report. */
export async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}
