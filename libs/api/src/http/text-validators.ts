import { codePointLength, hasControlCharacters } from '@product-finder/shared';
import { buildMessage, ValidateBy, type ValidationOptions } from 'class-validator';

/** Length from min to max in code points, as PostgreSQL varchar(n) counts. class-validator's Length does not. */
export function TextLength(min: number, max: number, options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'textLength',
      constraints: [min, max],
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') {
            return false;
          }
          const length = codePointLength(value);
          return length >= min && length <= max;
        },
        defaultMessage: buildMessage(
          (prefix) => `${prefix}$property must be $constraint1 to $constraint2 characters long`,
          options,
        ),
      },
    },
    options,
  );
}

/** Plain text: no control characters except tab and line breaks. */
export function IsPlainText(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isPlainText',
      validator: {
        validate: (value: unknown) => typeof value === 'string' && !hasControlCharacters(value),
        defaultMessage: buildMessage(
          (prefix) => `${prefix}$property must not contain control characters`,
          options,
        ),
      },
    },
    options,
  );
}
