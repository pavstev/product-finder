# web

Angular 22 app shell with PrimeNG 22.

- Owns: `src/main.ts`, `src/app` (config, routes, PrimeNG license), `public`, nginx and security header configs, `proxy.conf.json`.
- Pages come from `libs/web` through lazy entries: `@product-finder/web/search`, `/product`, `/not-found`.
- Entry point: `src/main.ts`.
- Rule: keep page and feature code in `libs/web`. The PrimeNG key goes in `apps/web/.env.local` only.
- Run: `pnpm dev:web`. Build: `nx run web:build`.
- Tests: `nx run web:typecheck`. Specs live in `libs/web`.
