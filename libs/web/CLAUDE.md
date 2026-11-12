# web-lib (`@product-finder/web`)

Angular feature code for the web app: search, product detail, shared UI, URL state and the data-access layer.

- Owns: `src/search`, `src/product`, `src/ui`, `src/url-state`, `src/data-access`.
- Entries: `src/index.ts` (app shell) and the lazy pages `@product-finder/web/search`, `/product`, `/not-found`.
- Rule: depend on `shared` only. Never hand-edit `src/data-access/generated`. Regenerate it with `nx run web-lib:generate`.
- Generation needs the API contract, which `nx run api:openapi` writes.
- Tests: `nx run web-lib:test`. Typecheck: `nx run web-lib:typecheck`.
