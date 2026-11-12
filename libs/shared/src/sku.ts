import { codePointLength } from './text.js';

/** Longest SKU, in code points. The API and the import use the same limit. */
export const MAX_SKU_LENGTH = 64;

/** Control (Cc) and format (Cf) characters, for example NUL or the bidi override U+202E. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** SKUs in URLs are case-insensitive. The import stores them upper-cased. */
export function normalizeSku(sku: string): string {
  return sku.trim().toUpperCase();
}

/** Why a SKU is not allowed: wrong length, or control or format characters. */
export type SkuProblem = 'length' | 'characters';

// The one SKU rule, for the API path parameter and the import. Call it with a trimmed SKU.
// A product that breaks it could be listed but never opened, so the import must not store it.
export function skuProblem(sku: string): SkuProblem | null {
  const length = codePointLength(sku);
  if (length < 1 || length > MAX_SKU_LENGTH) {
    return 'length';
  }
  return CONTROL_OR_FORMAT.test(sku) ? 'characters' : null;
}

// PostgreSQL jsonb cannot store NUL, so a raw bad SKU must never reach the stored issues.
export function displaySku(sku: string): string {
  const escaped = Array.from(sku)
    .slice(0, MAX_SKU_LENGTH + 1)
    .map((char) => (CONTROL_OR_FORMAT.test(char) ? escapeCodePoint(char) : char))
    .join('');
  return codePointLength(sku) > MAX_SKU_LENGTH + 1 ? `${escaped}...` : escaped;
}

function escapeCodePoint(char: string): string {
  const hex = (char.codePointAt(0) ?? 0).toString(16).toUpperCase();
  return `\\u{${hex}}`;
}
