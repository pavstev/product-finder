import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Icon class for each of the 5 stars: full, half or empty. */
export function starIcons(rating: number | null): string[] {
  const value = rating ?? 0;
  return [1, 2, 3, 4, 5].map((star) => {
    if (value >= star - 0.25) {
      return 'pi pi-star-fill';
    }
    if (value >= star - 0.75) {
      return 'pi pi-star-half-fill';
    }
    return 'pi pi-star';
  });
}

/** Read-only rating with the number and the review count as text, for screen readers too. */
@Component({
  selector: 'app-rating-stars',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="stars" aria-hidden="true">
      @for (icon of icons(); track $index) {
        <i [class]="icon"></i>
      }
    </span>
    <span class="text">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.875rem;
    }
    .stars {
      color: var(--p-yellow-500);
      display: inline-flex;
      gap: 0.1rem;
    }
    .text {
      color: var(--p-text-muted-color);
    }
  `,
})
export class RatingStars {
  readonly rating = input<number | null>(null);
  readonly count = input<number | null>(null);

  protected readonly icons = computed(() => starIcons(this.rating()));
  protected readonly label = computed(() => {
    const count = this.count();
    const rating = this.rating();
    if (count === 0 || rating === null) {
      return 'No reviews yet';
    }
    const reviews = count === null ? '' : ` (${count} ${count === 1 ? 'review' : 'reviews'})`;
    return `${rating.toFixed(1)} of 5${reviews}`;
  });
}
