import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MessageService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, Subject, throwError } from 'rxjs';
import { CatalogApi } from '../data-access/catalog-api.service';
import type { Review } from '../data-access/catalog-types';
import { ProductDetailStore } from '../data-access/product-detail.store';
import { detail, page } from '../data-access/testing/fixtures';
import { ReviewForm } from './review-form.component';
import { trimmedLength } from './review-validators';

const created: Review = {
  id: 'r1',
  rating: 4,
  title: null,
  body: 'Works well in our lotion.',
  authorName: 'Ana',
  createdAt: '2026-11-10T10:00:00.000Z',
};

describe('trimmedLength', () => {
  const control = (value: string) => ({ value }) as never;

  it('counts code points like the API and the database, not UTF-16 units', () => {
    // Each emoji is one code point but two UTF-16 units.
    expect(trimmedLength(10, 20)(control('😀'.repeat(5)))).toMatchObject({ minlength: expect.anything() });
    expect(trimmedLength(2, 5)(control('😀😀😀'))).toBeNull();
    // "❤️" is two code points (heart + variation selector).
    expect(trimmedLength(2, 60)(control('❤️'.repeat(31)))).toMatchObject({
      maxlength: expect.anything(),
    });
  });

  it('makes a field required when min > 0 and optional when min = 0', () => {
    expect(trimmedLength(2, 60)(control('   '))).toEqual({ required: true });
    expect(trimmedLength(0, 120)(control(''))).toBeNull();
  });
});

describe('ReviewForm', () => {
  let fixture: ComponentFixture<ReviewForm>;
  let el: HTMLElement;
  let api: { product: jest.Mock; reviews: jest.Mock; createReview: jest.Mock };
  let store: InstanceType<typeof ProductDetailStore>;
  let toast: { add: jest.Mock };

  beforeEach(async () => {
    api = {
      product: jest.fn(() => of(detail())),
      reviews: jest.fn(() => of(page([]))),
      createReview: jest.fn(() => of(created)),
    };
    toast = { add: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        providePrimeNG(),
        ProductDetailStore,
        { provide: CatalogApi, useValue: api },
        { provide: MessageService, useValue: toast },
      ],
    });
    store = TestBed.inject(ProductDetailStore);
    store.load('P-10001');
    fixture = TestBed.createComponent(ReviewForm);
    await fixture.whenStable();
    el = fixture.nativeElement;
  });

  function type(selector: string, value: string): void {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
  }

  async function rate(stars: number): Promise<void> {
    const options = el.querySelectorAll('p-rating [data-pc-section="option"]');
    (options[stars - 1] as HTMLElement).click();
    await fixture.whenStable();
  }

  async function submit(): Promise<void> {
    (el.querySelector('button[type=submit]') as HTMLButtonElement).click();
    await fixture.whenStable();
  }

  it('shows errors and sends nothing when the form is empty', async () => {
    await submit();
    expect(api.createReview).not.toHaveBeenCalled();
    const errors = [...el.querySelectorAll('.error')].map((e) => e.textContent.trim());
    expect(errors).toEqual([
      'Please choose 1 to 5 stars.',
      'Please write 10 to 2000 characters.',
      'Please enter 2 to 60 characters.',
    ]);
  });

  it('sends trimmed values, resets the form and shows the new review at once', async () => {
    // The background refresh stays pending, so the list is the one built from the POST.
    api.reviews.mockReturnValue(new Subject());
    await rate(4);
    type('#review-title', '   ');
    type('#review-body', '  Works well in our lotion.  ');
    type('#review-author', ' Ana ');
    await submit();

    expect(api.createReview).toHaveBeenCalledWith('P-10001', {
      rating: 4,
      title: undefined,
      body: 'Works well in our lotion.',
      authorName: 'Ana',
    });
    expect(store.reviews()?.items[0]).toEqual(created);
    expect(toast.add).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
    expect((el.querySelector('#review-body') as HTMLTextAreaElement).value).toBe('');
  });

  it('shows the rate limit with the seconds to wait and keeps what was typed', async () => {
    api.createReview.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 429, headers: new HttpHeaders({ 'Retry-After': '30' }) }),
      ),
    );
    await rate(5);
    type('#review-body', 'Ten or more characters.');
    type('#review-author', 'Ana');
    await submit();
    expect(el.textContent).toContain('Too many reviews from this network. Try again in 30 seconds.');
    expect((el.querySelector('#review-body') as HTMLTextAreaElement).value).toBe('Ten or more characters.');
    expect(toast.add).not.toHaveBeenCalled();
  });
});
