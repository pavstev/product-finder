# shared (`@product-finder/shared`)

Pure rules used by web, api and import.

- Owns: search and paging limits, SKU rules, review limits, product visibility, catalogue freshness, text helpers.
- Entry point: `src/index.ts`.
- Rule: import no other workspace project. Every rule used by two sides lives here.
- Tests: `nx run shared:test`. Typecheck: `nx run shared:typecheck`.
