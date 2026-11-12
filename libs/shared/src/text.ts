/** Length in code points, as PostgreSQL varchar(n) counts. class-validator's Length skips U+FE0F and `.length` counts UTF-16 units. */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

// Smaller than the SKU rule on purpose: free text may hold tabs and line breaks. PostgreSQL cannot store NUL.
const TEXT_CONTROL_CHARACTER = /(?![\t\n\r])\p{Cc}/u;

export function hasControlCharacters(text: string): boolean {
  return TEXT_CONTROL_CHARACTER.test(text);
}
