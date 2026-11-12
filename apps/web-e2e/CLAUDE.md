# web-e2e

Playwright and axe tests of the running stack.

- Owns: `src/main-flow.spec.ts`, `src/fixtures.ts`, `playwright.config.ts`.
- Entry point: `src/main-flow.spec.ts`.
- Rule: import no project. Talk to the stack over HTTP only.
- Base URL: `E2E_BASE_URL`, default `http://localhost:8080`.
- Run: `docker compose up --build --wait`, then `nx run web-e2e:e2e`.
- The main flow posts one review per device project from one IP. The API allows 20 review writes a minute per IP, so keep the run small.
