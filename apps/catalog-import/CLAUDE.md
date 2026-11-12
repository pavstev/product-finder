# catalog-import

CLI for the catalogue. Commands: `migrate`, `seed`, `import`, `status`. It has its own Docker image.

- Owns: CLI wiring in `src/` (`cli.ts`, command files, config, summary output).
- Import logic lives in `libs/import` (`@product-finder/import`).
- Entry point: `src/main.ts`. OTel preload: `src/otel.ts`.
- Rule: keep import logic in `libs/import`. This app only wires the CLI.
- Run: `nx run catalog-import:import --args="--dry-run"`, `nx run catalog-import:seed`, `nx run catalog-import:status`.
- The import, seed and status targets read `apps/api/.env` when it exists.
- Tests: `nx run catalog-import:e2e` needs `TEST_DATABASE_URL`.
