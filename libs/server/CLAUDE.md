# server (`@product-finder/server`)

Database and server plumbing shared by api and import.

- Owns: `src/db` (Prisma client and pool), `src/ratings` (rating writes), `src/config`, `src/observability` (logging, metrics, tracing).
- Entry point: `src/index.ts` (includes the Nest module). Nest-free entry: `@product-finder/server/client`. OTel preload: `@product-finder/server/otel`.
- Rule: only `src/db` imports Prisma, and only `src/ratings` writes rating columns. ESLint enforces both.
- Schema: `prisma/schema.prisma`. Generated client: `src/db/generated` (gitignored). Never edit it.
- Tests: `nx run server:test`.
