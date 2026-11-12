/** Turns `a,b` or `?x=a&x=b` into a trimmed string list without empty items. Non-strings pass through for validation to reject. */
export function toList(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parts = Array.isArray(value) ? value : [value];
  if (!parts.every((part) => typeof part === 'string')) {
    return value;
  }
  return parts
    .flatMap((part) => part.split(','))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Trims a string. Other values pass through. */
export function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

/** Trims a string and turns an empty result into undefined. */
export function trimToUndefined(value: unknown): unknown {
  const trimmed = trimString(value);
  return trimmed === '' ? undefined : trimmed;
}
