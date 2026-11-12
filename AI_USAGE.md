# AI usage

## Tools

- **Claude Code** (desktop app) as the coding agent, for scaffolding, implementation, tests and first drafts of the docs.
- The agent ran commands itself (install, migrations, tests, Docker builds) and checked the web app in a built-in browser. I reviewed every diff before it went in.

## What I did and what I delegated

**I did myself:**

- Read the brief and measured the CSV before any code (202 rows, 200 SKUs, the defects in DECISIONS.md section 4). The data rules come from that analysis.
- The product decisions: what v1 is for, what stays out, the assumptions, and the ownership rule "the import owns PIM columns, reviews own the aggregates, products are never deleted".
- The structure: Nx, the five libs and their boundary rules, the choice of NestJS 11 on CommonJS.
- A written spec of the API, the visibility rules, the import algorithm and the tests that matter. The agent worked against it, so I could check its output against a written standard.
- Review of the results and the final call on every trade-off below.

**Delegated to the agent:** scaffolding, the import, API and web against the spec, the unit and e2e tests, Docker files, and first drafts of README and parts of DECISIONS. It also ran the app in a browser to check the flows (search, filters in the URL, review submit, back navigation, mobile drawer).

## Where I rejected or changed the agent's output

1. **Generator defaults rejected.** The generators set up Vitest, extra linters, an `AGENTS.md` that asks for telemetry, and AI skill folders. The brief fixes Jest, and extra tooling is noise for a reviewer. I removed all of it and kept Jest in every project and one lint setup (ESLint and Prettier).

   Evidence: `package.json:102` (Jest 30, no Vitest in the repo), `jest.config.ts:5` (one Jest config for every project).

2. **A license notice I did not let the agent hide.** PrimeNG 22 shows an "Invalid PrimeUI License" badge without a key. Hiding it with CSS would be a one-liner and would also circumvent a license. I kept the badge, made the key a setting read from `apps/web/.env.local`, and wrote it down as a business risk in DECISIONS.md.

   Evidence: `apps/web/primeng-license.plugin.mjs:3`, DECISIONS.md section 6 (last row).

3. **A bug found only in the browser.** Unit tests were green, but the 404 page showed an empty heading. The router option `withComponentInputBinding()` sets every component input that has no route value to `undefined`, which wiped the defaults. Nothing used route-input binding, so I removed it. The router setup stays without it.

   Evidence: `apps/web/src/app/app.config.ts:50` (router without input binding), `libs/web/src/ui/not-found.page.ts:31` (the default heading).

## How I kept control

- The spec came first, and tests were written against it, not against the implementation.
- Each run of the agent ended with the same checks: lint, typecheck, test, e2e, and `docker compose up --build` from an empty volume.
- Anything that changes behaviour for users (status rules, what is reviewable, the import guard) is a pure function with a unit test, so it is easy to review line by line.
