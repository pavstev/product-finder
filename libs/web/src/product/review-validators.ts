import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { codePointLength, REVIEW_LIMITS } from '@product-finder/shared';

/**
 * Length check on the trimmed value. `min = 0` makes the field optional.
 * Counts code points like the API: `.length` counts UTF-16 units, so five emoji would pass a minimum of 10.
 */
export function trimmedLength(min: number, max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = typeof control.value === 'string' ? control.value.trim() : '';
    const length = codePointLength(value);
    if (min > 0 && length === 0) {
      return { required: true };
    }
    if (length > 0 && length < min) {
      return { minlength: { requiredLength: min, actualLength: length } };
    }
    if (length > max) {
      return { maxlength: { requiredLength: max, actualLength: length } };
    }
    return null;
  };
}

export function ratingRequired(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  const { min, max } = REVIEW_LIMITS.rating;
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? null
    : { required: true };
}
