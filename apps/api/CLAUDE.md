# api

NestJS 11 HTTP app (CommonJS). It wires the modules and serves the catalogue and reviews API with its OpenAPI docs.

- Owns: `src/app.module.ts`, config, health, OpenAPI emit, OTel shutdown.
- Feature code lives in `libs/api` (`@product-finder/api`).
- Entry point: `src/main.ts`. OTel preload: `src/otel.ts`.
- Rule: keep feature code in `libs/api`. Never import `@product-finder/web`.
- Run: `pnpm dev:api`. Contract: `nx run api:openapi` writes `dist/contracts/openapi.json`.
- Tests: `nx run api:test`. `nx run api:e2e` needs `TEST_DATABASE_URL`.
