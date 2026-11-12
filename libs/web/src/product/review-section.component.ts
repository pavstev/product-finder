import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { MessageModule } from 'primeng/message';
import { PaginatorModule, type PaginatorState } from 'primeng/paginator';
import { ProductDetailStore, REVIEW_PAGE_SIZE } from '../data-access/product-detail.store';
import { RatingStars } from '../ui/rating-stars.component';
import { ReviewForm } from './review-form.component';

/** The reviews of one product, newest first, and the form. State is in ProductDetailStore. */
@Component({
  selector: 'app-review-section',
  imports: [DatePipe, MessageModule, PaginatorModule, RatingStars, ReviewForm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section aria-labelledby="reviews-title">
      <h2 id="reviews-title">Customer reviews</h2>
      @let r = store.reviews();
      @if (r === null && store.reviewsStatus() === 'error') {
        <p-message severity="error">Reviews could not be loaded.</p-message>
      } @else if (r === null) {
        <p>Loading reviews...</p>
      } @else {
        @if (r.total === 0) {
          <p class="none">No reviews yet. Be the first to share your experience.</p>
        } @else {
          <div [attr.aria-busy]="store.reviewsStatus() === 'loading'">
            <ul class="reviews">
              @for (review of r.items; track review.id) {
                <li>
                  <article>
                    <header>
                      <app-rating-stars [rating]="review.rating" />
                      @if (review.title) {
                        <h3>{{ review.title }}</h3>
                      }
                    </header>
                    <!-- Interpolation escapes HTML: user text is always shown as plain text. -->
                    <p class="body">{{ review.body }}</p>
                    <p class="by">
                      {{ review.authorName }},
                      <time [attr.datetime]="review.createdAt">{{
                        review.createdAt | date: 'mediumDate'
                      }}</time>
                    </p>
                  </article>
                </li>
              }
            </ul>
            @if (r.total > pageSize) {
              <p-paginator
                [first]="(store.reviewPage() - 1) * pageSize"
                [rows]="pageSize"
                [totalRecords]="r.total"
                (onPageChange)="onPage($event)"
              />
            }
          </div>
        }
      }
      @if (store.closedReason(); as reason) {
        <div #closedNote tabindex="-1" class="closed">
          <p-message severity="info" icon="pi pi-info-circle">{{ reason }}</p-message>
        </div>
      } @else {
        <app-review-form />
      }
    </section>
  `,
  styles: `
    .reviews {
      list-style: none;
      padding: 0;
      margin: 0 0 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    article {
      border-bottom: 1px solid var(--p-content-border-color);
      padding-bottom: 1rem;
    }
    h3 {
      margin: 0.3rem 0 0;
      font-size: 1rem;
    }
    .body {
      white-space: pre-line;
      margin: 0.5rem 0;
    }
    .by,
    .none {
      color: var(--p-text-muted-color);
      font-size: 0.875rem;
      margin: 0;
    }
    .none {
      margin-bottom: 1.5rem;
    }
    .closed {
      outline: none;
    }
  `,
})
export class ReviewSection {
  protected readonly store = inject(ProductDetailStore);
  protected readonly pageSize = REVIEW_PAGE_SIZE;
  private readonly closedNote = viewChild<ElementRef<HTMLElement>>('closedNote');

  constructor() {
    // The form disappears on a 409. Its button held the focus, so the note takes it.
    effect(() => {
      if (this.store.closedReason()) {
        this.closedNote()?.nativeElement.focus();
      }
    });
  }

  protected onPage(event: PaginatorState): void {
    this.store.loadReviews(Math.floor((event.first ?? 0) / REVIEW_PAGE_SIZE) + 1);
  }
}
