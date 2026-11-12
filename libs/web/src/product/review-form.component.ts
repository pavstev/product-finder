import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { REVIEW_LIMITS } from '@product-finder/shared';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { RatingModule } from 'primeng/rating';
import { TextareaModule } from 'primeng/textarea';
import { ProductDetailStore } from '../data-access/product-detail.store';
import { ratingRequired, trimmedLength } from './review-validators';

@Component({
  selector: 'app-review-form',
  imports: [ReactiveFormsModule, ButtonModule, InputTextModule, MessageModule, RatingModule, TextareaModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './review-form.component.html',
  styleUrl: './review-form.component.scss',
})
export class ReviewForm {
  private readonly store = inject(ProductDetailStore);
  private readonly toast = inject(MessageService);

  protected readonly rules = REVIEW_LIMITS;
  protected readonly reviewable = this.store.canReview;
  protected readonly submitting = this.store.submitting;
  protected readonly error = this.store.lastError;

  protected readonly form = inject(FormBuilder).nonNullable.group({
    rating: [0, ratingRequired],
    // The title is optional, so its minimum here is 0.
    title: ['', trimmedLength(0, REVIEW_LIMITS.title.max)],
    body: ['', trimmedLength(REVIEW_LIMITS.body.min, REVIEW_LIMITS.body.max)],
    authorName: ['', trimmedLength(REVIEW_LIMITS.authorName.min, REVIEW_LIMITS.authorName.max)],
  });

  constructor() {
    effect(() => {
      if (this.reviewable()) {
        this.form.enable();
      } else {
        this.form.disable();
      }
    });
  }

  /** Show a field error only after the user touched the field or tried to submit. */
  protected invalid(name: keyof typeof this.form.controls): boolean {
    const control = this.form.controls[name];
    return control.invalid && (control.touched || control.dirty);
  }

  protected async submit(): Promise<void> {
    // A disabled form is never "invalid" in Angular, so check reviewable explicitly.
    if (!this.reviewable() || this.submitting()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const value = this.form.getRawValue();
    const published = await this.store.submitReview({
      rating: value.rating,
      title: value.title.trim() || undefined,
      body: value.body.trim(),
      authorName: value.authorName.trim(),
    });
    // On a failure the form keeps what the user typed. The store holds the reason.
    if (published) {
      this.form.reset();
      this.toast.add({ severity: 'success', summary: 'Thank you', detail: 'Your review is published.' });
    }
  }
}
