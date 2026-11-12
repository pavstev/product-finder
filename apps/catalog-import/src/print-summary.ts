import { formatSummary, type ImportSummary } from '@product-finder/import';

/** A locked run did nothing, so one line says it all. */
export function printSummary(summary: ImportSummary): void {
  console.log(
    summary.status === 'LOCKED'
      ? `Import LOCKED (${summary.file}): ${summary.message}`
      : formatSummary(summary),
  );
}
