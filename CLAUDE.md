# Product Finder

Catalogue search with reviews. An Nx monorepo: NestJS API, Angular web app, a catalogue import CLI, and shared libraries.

## Stack

- NestJS 11 API, CommonJS. Relative imports keep their `.js` ending. Import Jest globals from `@jest/globals`.
- Prisma 7 on Postgres 17 (Docker). Angular 22 with PrimeNG 22.
- Jest 30, Playwright with axe, Nx 24, ESLint and Prettier. Node 24, pnpm 9.9.0.

## Commands (repo root)

- `pnpm install`: installs and runs `prisma generate` (postinstall).
- `pnpm run setup`: Postgres, `apps/api/.env`, migrations, seed.
- `pnpm dev`: API and web together. `pnpm db:up`: Postgres only.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`: run per project through Nx.
- `pnpm test:e2e`: API and import e2e against the test database.
- `pnpm format`, `pnpm format:check`: Prettier. `pnpm check` runs everything.
- `nx run catalog-import:import --args="--dry-run"`: import without writing.
- `nx run api:openapi`, `nx run web-lib:generate`: API contract and web client (generated, gitignored).
- `docker compose up --build`: whole stack.

## Data rules

- Only `libs/server/src/db` imports Prisma. ESLint enforces this.
- Only `libs/server/src/ratings` writes `review_count`, `rating_sum` and `rating_avg`. ESLint enforces this.
- The import owns product PIM fields. It never writes rating columns. Products are never deleted.
- Schema changes need a new migration. Never edit a migration or generated code.

## Boundaries

- `web` uses `shared` only. `api` and `import` use `server` and `shared`. `server` uses `shared`. `shared` uses nothing.
- Import other projects only through their `@product-finder/*` alias. `api` never imports `@product-finder/web`.

## Other

- The PrimeNG key is `NG_PRIMENG_LICENSE` in `apps/web/.env.local`, gitignored. Never commit it.
- Review writes allow 20 a minute per IP by default.
- Docs: `README.md`, `DECISIONS.md`, `AI_USAGE.md`. Plain short sentences. No em dashes.
