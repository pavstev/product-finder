# api-lib (`@product-finder/api`)

Nest feature code for the API.

- Owns: `src/catalog` (products and facets), `src/reviews`, `src/http` (pipes, filters, pagination, rate limit, OpenAPI setup).
- Entry point: `src/index.ts`.
- Rule: depend on `server` and `shared` only, through their aliases.
- Tests: `nx run api-lib:test`. Typecheck: `nx run api-lib:typecheck`.
