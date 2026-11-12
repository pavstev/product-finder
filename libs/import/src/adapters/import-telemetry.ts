import {
  createImportMetrics,
  type ImportMetrics,
  type ImportOutcomeLabel,
  type ImportRunRecord,
  inSpan,
  startTimer,
} from '@product-finder/server/client';
import type { ImportOutcome, ImportSummary } from '../domain/types.js';

// The span and the metrics of one import run. Both are no-ops unless the OpenTelemetry preload ran.

const OUTCOME_LABELS: Readonly<Record<ImportOutcome, ImportOutcomeLabel>> = {
  SUCCEEDED: 'succeeded',
  ABORTED: 'aborted',
  LOCKED: 'locked',
  DRY_RUN: 'dry_run',
};

/** Only a SUCCEEDED run wrote rows, so only it counts rows and sets the success time. */
export function importRunRecord(
  summary: ImportSummary,
  durationSeconds: number,
  finishedAt: Date,
): ImportRunRecord {
  const outcome = OUTCOME_LABELS[summary.status];
  if (summary.status !== 'SUCCEEDED') {
    return { outcome, durationSeconds };
  }
  return {
    outcome,
    durationSeconds,
    rows: {
      inserted: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      rejected: summary.rejected,
      missing: summary.markedMissing,
    },
    succeededAt: finishedAt,
  };
}

export interface ImportTelemetryDeps {
  metrics?: ImportMetrics;
  now?: () => Date;
  timer?: () => () => number;
}

/** The span makes the pg queries of the run one trace. A run that throws is recorded as `failed`. */
export function observeImport(
  run: () => Promise<ImportSummary>,
  { metrics = createImportMetrics(), now = () => new Date(), timer = startTimer }: ImportTelemetryDeps = {},
): Promise<ImportSummary> {
  return inSpan('catalog import', async (span) => {
    const elapsed = timer();
    try {
      const summary = await run();
      const record = importRunRecord(summary, elapsed(), now());
      metrics.recordRun(record);
      span.setAttribute('import.outcome', record.outcome);
      return summary;
    } catch (error) {
      metrics.recordRun({ outcome: 'failed', durationSeconds: elapsed() });
      span.setAttribute('import.outcome', 'failed');
      throw error;
    }
  });
}
