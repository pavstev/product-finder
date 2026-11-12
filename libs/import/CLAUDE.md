# import (`@product-finder/import`)

Catalogue import logic, used by the catalog-import CLI and the perf tools.

- Owns: `src/domain` (CSV parsing, decoding, dedupe, import planning) and `src/adapters` (file source, Prisma writer, import run log, demo reviews).
- Entry point: `src/index.ts`.
- Rule: the import writes product PIM fields only. It never writes rating columns, and it never deletes products.
- Tests: `nx run import:test`. Typecheck: `nx run import:typecheck`.
