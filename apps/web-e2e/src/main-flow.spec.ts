import {
  chooseOption,
  closeFilters,
  expect,
  expectResults,
  openFilters,
  productRating,
  ratingText,
  regionSelect,
  seriousViolations,
  test,
} from './fixtures';

// The one main flow, run on every device project of playwright.config.ts:
// search, filter, reload the link, open a product, publish a review. Axe checks each screen.
// Each project reviews its own product, so the parallel projects do not change each other's counts.
// The API allows 20 review writes a minute per IP, so three projects and a retry stay under it.
const PROJECTS = ['chromium', 'mobile-chrome', 'mobile-safari'];

test('search, filter, share the link and publish a review', async ({ page, api }, testInfo) => {
  // Search results and the filters. On a phone the filters open in a drawer.
  await page.goto('/products');
  await expectResults(
    page,
    (await api.search()).items.map((item) => item.sku),
  );
  expect(await seriousViolations(page), 'axe on the search page').toEqual([]);

  const filters = await openFilters(page);
  await expect(filters).toBeVisible();
  expect(await seriousViolations(page), 'axe with the filters open').toEqual([]);
  await chooseOption(page, regionSelect(page), /^EMEA \(/);
  await expect(page).toHaveURL(/[?&]region=EMEA/);
  await closeFilters(page);
  const emea = (await api.search({ region: 'EMEA' })).items.map((item) => item.sku);
  await expectResults(page, emea);

  // The link carries the whole search state: a reload shows the same results.
  await page.reload();
  await expect(page).toHaveURL(/[?&]region=EMEA/);
  await expectResults(page, emea);

  // A product page and a valid review.
  const index = Math.max(0, PROJECTS.indexOf(testInfo.project.name));
  const product = (await api.withStatus('ACTIVE', PROJECTS.length))[index];
  const before = await api.product(product.sku);
  expect(before.reviewable).toBe(true);
  // A rating away from the average, so the average must move.
  const rating = before.ratingAvg === null ? 4 : before.ratingAvg >= 3 ? 1 : 5;
  const body = `Playwright check on ${testInfo.project.name}, run ${Date.now()}. Easy to dose and stable.`;

  await page.goto(`/products/${encodeURIComponent(product.sku)}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(product.name);
  await expect(productRating(page)).toHaveText(ratingText(before.ratingAvg, before.reviewCount));

  const form = page.getByRole('form', { name: 'Write a review' });
  // The radio inputs of the rating are visually hidden. A user taps the star that holds one.
  const radio = form.getByRole('radio', { name: rating === 1 ? '1 star' : `${rating} stars` });
  await radio.locator('xpath=ancestor::div[1]').click();
  await expect(radio).toBeChecked();
  await form.getByRole('textbox', { name: 'Title (optional)' }).fill('Browser test review');
  await form.getByRole('textbox', { name: 'Your experience' }).fill(body);
  await form.getByRole('textbox', { name: 'Display name' }).fill('E2E Tester');
  await form.getByRole('button', { name: 'Publish review' }).click();

  await expect(page.getByText('Your review is published.')).toBeVisible();
  const reviews = page.getByRole('region', { name: 'Customer reviews' }).getByRole('listitem');
  await expect(reviews.first()).toContainText(body);
  const after = await api.product(product.sku);
  expect(after.reviewCount).toBe(before.reviewCount + 1);
  await expect(productRating(page)).toHaveText(ratingText(after.ratingAvg, after.reviewCount));
  // Reload first: axe on a toast that is still fading in reports low contrast.
  await page.reload();
  await expect(reviews.first()).toContainText(body);
  expect(await seriousViolations(page), 'axe on the product page with reviews').toEqual([]);
});
