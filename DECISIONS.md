# Decisions

## 1. Problem and architecture

Customers cannot explore the catalogue on their own. They ask sales, and sales search an old spreadsheet that still lists products we no longer sell. So v1 has three jobs:

1. Let customers find fitting products fast, on a phone, and share exactly what they see.
2. Never show stale data as current. The PIM export is the single source of truth, and the app says clearly when a product is phased out or gone.
3. Let customers share experience through reviews, without the nightly import ever touching them.

```text
browser ---> web (nginx :8080) --/api--> api (Nest :3000) ---> PostgreSQL 17
scheduler -> catalog-import job (reads the PIM CSV) ----------> PostgreSQL 17
```

One Nx monorepo, one `package.json`: four apps (`api`, `catalog-import`, `web`, `web-e2e`), five libs and `tools/perf`.

| Lib       | Holds                                                                                 | May use            |
| --------- | ------------------------------------------------------------------------------------- | ------------------ |
| `shared`  | Pure domain rules: SKU, limits, search, visibility. Runs in the browser and in Node.  | nothing            |
| `server`  | The only Prisma code, the only rating writer, zod config, logs, probes, OpenTelemetry | `shared`           |
| `api-lib` | Catalog (search, facets, detail), reviews, HTTP setup, errors, rate limits            | `server`, `shared` |
| `import`  | Pure pipeline and ports (parse, normalise, dedupe, hash, plan), and the DB adapters   | `server`, `shared` |
| `web-lib` | Search, product page, generated API client, UI parts, URL state                       | `shared`           |

ESLint enforces the boundaries. Two data rules hold it together: the import writes only PIM columns and reviews write only reviews and the rating aggregates; products are never deleted (`ON DELETE RESTRICT` on reviews).

## 2. Key decisions

| Decision                                                                                    | Instead of                     | Why                                                                                        |
| ------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------ |
| Import is a CLI run as a nightly job                                                        | Admin endpoint; worker         | No auth, so an endpoint would let anyone change the catalogue. The exit code is the alert. |
| Upsert by SKU, skip rows whose content hash is unchanged                                    | Truncate and reload            | Truncate breaks review links. A re-run is a no-op.                                         |
| Missing products get `inLatestExport = false`                                               | Delete them                    | Deleting destroys reviews and shared links.                                                |
| Abort below 50% of current products (`--force` overrides)                                   | No guard                       | A truncated export would hide the catalogue.                                               |
| One transaction per run, logged in `import_run`, advisory lock                              | Row by row                     | A failed run changes nothing. One import at a time.                                        |
| `pg_trgm` on one lower-cased `search_text`, ranked by SKU match, then name                  | Full-text search; OpenSearch   | Users type parts of names and SKUs ("glucos", "P-1001"). Numbers in section 3.             |
| Page numbers up to row 10,000 (50 per page), keyset cursors beyond                          | Cursors only                   | Users share "page 3". Cursors keep deep pages fast.                                        |
| Search shows Active and Phase-out; detail works for every product                           | Hide all but Active            | Shared links never break.                                                                  |
| `Global` matches every region; certifications mean ALL selected                             | Exact match; ANY               | An EMEA buyer expects global products. Halal and Vegan means both.                         |
| Rating aggregates on the product, one atomic SQL update per review                          | Compute on read                | Sorting by rating needs an indexed column.                                                 |
| All search state in the URL; signal stores cache results 30 s, facets per session           | Component state; NgRx Store    | The link is the share feature. "Back to results" needs no reload.                          |
| OpenAPI generated from the Nest DTOs, not committed; typed Angular client generated from it | Hand-written or committed spec | One source. Types cannot drift from the API.                                               |
| NestJS 11 on CommonJS, Jest 30                                                              | Nest 12 and ESM; Vitest        | Stable `@nx/nest` supports Nest below 12. The brief fixes Jest.                            |
| JSON logs, live and ready probes, OpenTelemetry (off unless configured)                     | A vendor agent                 | Cheap to keep, nothing to run by default.                                                  |

## 3. Numbers at 50,000 products

Synthetic catalogue from `tools/perf`. Desktop (Ryzen 9 3900X), Postgres 17 in Docker, built API in one Node process, one request at a time.

| What                                  | Result         |
| ------------------------------------- | -------------- |
| First import, empty database          | 20.0 s         |
| Same file again (no-op)               | 1.57 s         |
| Text search `q=glyc`, p95             | 75.9 ms        |
| Facets, warm cache, p95               | 2.8 to 3.7 ms  |
| Row 39,951 by cursor / by offset, p95 | 10.0 / 93.6 ms |

Under load (50 connections) a text search does 112 requests a second at p95 481 ms: fine for one instance, not for a campaign.

Import exit codes (`EXIT_CODE_TABLE` in `libs/import/src/domain/cli-args.ts`): 0 success or no-op, 1 failed and rolled back, 2 aborted by the 50% guard, 3 another import holds the lock, 4 bad arguments or config. A scheduler alerts on 1, 2 and 4.

## 4. How the CSV defects are handled

The file is described as an unmodified export. I measured it before coding: 202 rows, 200 distinct SKUs.

| Found                                                     | Rule                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| P-10013 twice, identical                                  | Keep one.                                                                                     |
| P-10151 twice: Active and Discontinued                    | Keep the stricter status (Discontinued), log a warning. Never advertise what may not be sold. |
| Status as `active`, `ACTIVE`, `Phase out`                 | Ignore case and separators. An unknown status rejects the row.                                |
| Spaces around name and region (P-10016, P-10059)          | Trim and collapse whitespace.                                                                 |
| P-10119 has no name                                       | Reject the row. An existing product keeps its data and is not marked missing.                 |
| Launch year empty (P-10091) or `n/a` (P-10105)            | Store `null`, log a warning, import the product.                                              |
| Empty certifications (66 rows)                            | Empty list.                                                                                   |
| P-10067 certifications end with a pipe (`Halal\|Vegan\|`) | Split, trim, drop empty items: Halal, Vegan.                                                  |

Result on the real file: 199 products, 1 rejected row, 2 duplicates handled. Each rule has a unit test with the real values.

## 5. Assumptions

- The CSV is a full snapshot every night, not a delta. A missing SKU means "no longer exported".
- SKU is the stable business key: any printable text of 1 to 64 characters.
- When the export contradicts itself, the safer status wins.
- The export is UTF-8 (a BOM is fine). A Windows-1252 file is read with a warning. Broken UTF-8 fails the run.
- Reviews are public and anonymous: a display name, no e-mail (GDPR). Only Active and Phase-out products take reviews.
- English UI only. Function and application area are open PIM lists, so they are strings. Status is an enum, because logic depends on it.

## 6. Risks

| Risk                                     | Handling                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A truncated export hides the catalogue   | 50% guard, one transaction, `import_run` log, exit code 2.                                                |
| Spam on the public review form           | Validation, length limits, 20 posts a minute per IP. No moderation yet.                                   |
| Concurrent reviews corrupt the average   | One atomic SQL update. `recomputeRatings` rebuilds aggregates; only the demo seed calls it today.         |
| Many phones share one IP at a trade fair | Separate read (600 a minute) and write limits. Counters live in each API instance.                        |
| A client fakes its IP                    | The API trusts one proxy hop (`TRUST_PROXY=1`). Compose binds the API port to 127.0.0.1.                  |
| Hostile input                            | `%` and `_` are plain text, NUL gives 400. Covered by adversarial e2e specs for the API and the import.   |
| PrimeNG 21+ needs a license key          | Without a key the UI shows a badge; I did not hide it. The key is a setting. BASF needs a Commercial key. |

## 7. Left out, and next steps

Left out on purpose: auth, moderation, editing or deleting reviews, admin UI, i18n, CI and git hooks. `pnpm check` is the gate for now.

Next steps, in order:

1. CI that runs `pnpm check` and the e2e tests.
2. Review moderation: report button, queue, CAPTCHA or sign-in.
3. OpenSearch for typos, synonyms or many languages; a shared Redis rate-limit store for several API instances.
4. An outbox for reviews, with one consumer that owns the aggregates.
5. For trade fairs: an offline app shell (PWA) and link previews.
6. With the PIM team: a versioned CSV contract and a "replaced by" SKU for phase-out products.
7. Nest 12 and ESM when `@nx/nest` supports it. A PrimeNG Commercial license before go-live.
