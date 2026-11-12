import { HttpErrorResponse, HttpHeaders, provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { CatalogApi } from '../data-access/catalog-api.service';
import { detail, page, review } from '../data-access/testing/fixtures';
import { ProductDetailPage, statusBanner } from './product-detail.page';

describe('statusBanner', () => {
  it('warns about phase-out and points to sales', () => {
    expect(statusBanner({ status: 'PHASE_OUT', inLatestExport: true })).toMatchObject({
      severity: 'warn',
      text: expect.stringContaining('successor'),
    });
  });

  it('says discontinued and missing products are no longer available', () => {
    for (const product of [
      { status: 'DISCONTINUED' as const, inLatestExport: true },
      { status: 'ACTIVE' as const, inLatestExport: false },
    ]) {
      expect(statusBanner(product)).toMatchObject({
        severity: 'error',
        text: expect.stringContaining('no longer'),
      });
    }
  });
});

describe('ProductDetailPage', () => {
  let api: { product: jest.Mock; reviews: jest.Mock; createReview: jest.Mock };

  beforeEach(() => {
    api = {
      product: jest.fn(() => of(detail())),
      reviews: jest.fn(() => of(page([]))),
      createReview: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'products/:sku', component: ProductDetailPage }]),
        provideHttpClient(),
        MessageService,
        { provide: CatalogApi, useValue: api },
      ],
    });
  });

  async function open(url: string): Promise<HTMLElement> {
    const harness = await RouterTestingHarness.create(url);
    await harness.fixture.whenStable();
    return harness.routeNativeElement as HTMLElement;
  }

  it('shows the product with an enabled review form', async () => {
    const el = await open('/products/P-10001');
    expect(api.product).toHaveBeenCalledWith('P-10001');
    expect(el.querySelector('h1')?.textContent).toBe('Quorin SF 470');
    expect(el.querySelector('app-status-tag')?.textContent).toContain('Active');
    expect(el.querySelector('.banner, p-message')).toBeNull();
    expect((el.querySelector('#review-body') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('shows a banner and a disabled form for a discontinued product', async () => {
    api.product.mockReturnValue(of(detail({ status: 'DISCONTINUED', reviewable: false })));
    const el = await open('/products/P-10151');
    expect(el.textContent).toContain('This product is no longer available');
    expect(el.textContent).toContain('Reviews are closed');
    expect((el.querySelector('#review-body') as HTMLTextAreaElement).disabled).toBe(true);
    expect((el.querySelector('app-review-form button[type=submit]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('shows the not-found page for an unknown SKU', async () => {
    api.product.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const el = await open('/products/NOPE');
    expect(el.querySelector('app-not-found h1')?.textContent).toBe('Product not found');
  });

  it('shows the not-found page when the API rejects the SKU as malformed (400)', async () => {
    api.product.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400 })));
    const el = await open('/products/P-1%E2%80%8B2');
    expect(el.querySelector('app-not-found h1')?.textContent).toBe('Product not found');
    expect(el.textContent).not.toContain('could not be loaded');
  });

  /** Fills and sends the review form of the open page. */
  async function sendReview(harness: RouterTestingHarness): Promise<void> {
    const el = harness.routeNativeElement as HTMLElement;
    (el.querySelectorAll('p-rating [data-pc-section="option"]')[4] as HTMLElement).click();
    for (const [selector, value] of [
      ['#review-body', 'Works well in our lotion.'],
      ['#review-author', 'Ana'],
    ]) {
      const input = el.querySelector(selector) as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    (el.querySelector('app-review-form button[type=submit]') as HTMLButtonElement).click();
    await harness.fixture.whenStable();
  }

  it('keeps the product on screen and shows a toast when the reload after a new review fails', async () => {
    const harness = await RouterTestingHarness.create('/products/P-10001');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    const toast = jest.spyOn(TestBed.inject(MessageService), 'add');
    api.createReview.mockReturnValue(of(review()));
    api.product.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));

    await sendReview(harness);

    expect(api.createReview).toHaveBeenCalledTimes(1);
    expect(api.product).toHaveBeenCalledTimes(2);
    expect(el.querySelector('h1')?.textContent).toBe('Quorin SF 470');
    expect(el.querySelector('app-review-section')).not.toBeNull();
    expect(el.textContent).not.toContain('could not be loaded');
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('shows the new review at the top at once and keeps it when the refresh fails', async () => {
    const harness = await RouterTestingHarness.create('/products/P-10001');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    api.reviews.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    api.product.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    api.createReview.mockReturnValue(of(review({ id: 'new', title: 'Brand new' })));

    await sendReview(harness);

    expect(el.querySelector('.reviews > li h3')?.textContent).toBe('Brand new');
    expect(el.querySelector('h1')?.textContent).toBe('Quorin SF 470');
  });

  it('hides the form and shows the reason when the product stops taking reviews (409)', async () => {
    const harness = await RouterTestingHarness.create('/products/P-10001');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    api.createReview.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { status: 409, detail: 'Product P-10001 is no longer sold.' },
          }),
      ),
    );

    await sendReview(harness);

    expect(el.querySelector('app-review-form')).toBeNull();
    const note = el.querySelector('.closed') as HTMLElement;
    expect(note.textContent).toContain('Product P-10001 is no longer sold.');
    expect(document.activeElement).toBe(note);
    expect(el.querySelector('h1')?.textContent).toBe('Quorin SF 470');
  });

  it('tells the user how long to wait after a 429 and keeps the form', async () => {
    const harness = await RouterTestingHarness.create('/products/P-10001');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    api.createReview.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '17' }) }),
      ),
    );

    await sendReview(harness);

    expect(el.textContent).toContain('Too many reviews from this network. Try again in 17 seconds.');
    expect(el.querySelector('app-review-form')).not.toBeNull();
  });

  it('asks the user to check before a second post after a 503, and keeps the form', async () => {
    const harness = await RouterTestingHarness.create('/products/P-10001');
    await harness.fixture.whenStable();
    const el = harness.routeNativeElement as HTMLElement;
    api.createReview.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 503, headers: new HttpHeaders({ 'Retry-After': '5' }) }),
      ),
    );

    await sendReview(harness);

    expect(el.textContent).toContain(
      'We could not confirm the review. Reload the page to check before you post it again.',
    );
    expect(el.querySelector('app-review-form')).not.toBeNull();
  });
});
