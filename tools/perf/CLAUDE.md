# perf (`tools/perf`)

Performance tools. A seeded synthetic catalogue generator, and a bench that times imports and API queries.

- Owns: `src/generate-catalog.ts`, `src/bench*.ts`, `src/harness.ts`, `queries.ts`.
- Entry point: `src/main.ts` (generator). Bench: `src/bench.ts`.
- Rule: the bench drops and recreates `product_finder_perf`. Never point it at a real database.
- Generate: `nx run perf:generate-catalog --args="--rows=50000 --seed=42 --out=tmp/perf"`.
- Bench: `nx run perf:bench`, after generate. Results go to `tmp/perf/results`.
- Tests: `nx run perf:test`.
