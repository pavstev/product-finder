// The custom metrics of the API and the import job, so both use the same names, units and labels.
// The default meter is the no-op one unless the OpenTelemetry preload registered a provider.
import { type Meter, metrics } from '@opentelemetry/api';
import { INSTRUMENTATION_SCOPE } from './tracing.js';

const METRIC_NAMES = {
  importDuration: 'catalog_import_duration_seconds',
  importRows: 'catalog_import_rows_total',
  lastSuccess: 'catalog_last_success_timestamp_seconds',
  reviewsCreated: 'reviews_created_total',
  searchDuration: 'product_search_duration_seconds',
} as const;

/** The `outcome` label of catalog_import_duration_seconds. */
export type ImportOutcomeLabel = 'succeeded' | 'aborted' | 'locked' | 'dry_run' | 'failed';

/** The `result` label of catalog_import_rows_total, in this order. */
const IMPORT_ROW_RESULTS = ['inserted', 'updated', 'unchanged', 'rejected', 'missing'] as const;
type ImportRowResult = (typeof IMPORT_ROW_RESULTS)[number];

/** Seconds. A normal night takes seconds. The job is stopped after 30 minutes. */
const IMPORT_DURATION_BUCKETS = [0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600, 1200, 1800] as const;

/** Seconds, the same steps as the HTTP server duration up to 5 seconds. */
const SEARCH_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5] as const;

/** One import run, as the metrics see it. */
export interface ImportRunRecord {
  outcome: ImportOutcomeLabel;
  durationSeconds: number;
  /** Only a run that wrote rows has this. */
  rows?: Readonly<Record<ImportRowResult, number>>;
  /** Sets catalog_last_success_timestamp_seconds. */
  succeededAt?: Date;
}

export interface ImportMetrics {
  recordRun(run: ImportRunRecord): void;
}

export interface SearchMetrics {
  /** One product search, by whether it had a search text. */
  record(durationSeconds: number, hasQuery: boolean): void;
}

export interface ReviewMetrics {
  created(): void;
}

function defaultMeter(): Meter {
  return metrics.getMeter(INSTRUMENTATION_SCOPE);
}

export function createImportMetrics(meter: Meter = defaultMeter()): ImportMetrics {
  const duration = meter.createHistogram(METRIC_NAMES.importDuration, {
    description: 'Duration of one catalogue import run, by outcome.',
    unit: 's',
    advice: { explicitBucketBoundaries: [...IMPORT_DURATION_BUCKETS] },
  });
  const rows = meter.createCounter(METRIC_NAMES.importRows, {
    description: 'Rows of the PIM export that an import run wrote or dropped, by result.',
    unit: '{row}',
  });
  const lastSuccess = meter.createGauge(METRIC_NAMES.lastSuccess, {
    description: 'Unix time of the last import run that succeeded.',
    unit: 's',
  });
  return {
    recordRun({ outcome, durationSeconds, rows: counts, succeededAt }) {
      duration.record(durationSeconds, { outcome });
      if (counts) {
        for (const result of IMPORT_ROW_RESULTS) {
          rows.add(counts[result], { result });
        }
      }
      if (succeededAt) {
        lastSuccess.record(succeededAt.getTime() / 1000);
      }
    },
  };
}

export function createSearchMetrics(meter: Meter = defaultMeter()): SearchMetrics {
  const duration = meter.createHistogram(METRIC_NAMES.searchDuration, {
    description: 'Duration of one product search, by whether it had a search text.',
    unit: 's',
    advice: { explicitBucketBoundaries: [...SEARCH_DURATION_BUCKETS] },
  });
  return {
    record(durationSeconds, hasQuery) {
      duration.record(durationSeconds, { has_query: String(hasQuery) });
    },
  };
}

export function createReviewMetrics(meter: Meter = defaultMeter()): ReviewMetrics {
  const created = meter.createCounter(METRIC_NAMES.reviewsCreated, {
    description: 'Reviews stored.',
    unit: '{review}',
  });
  return {
    created() {
      created.add(1);
    },
  };
}

/** Returns a function that gives the seconds since the call. */
export function startTimer(now: () => number = () => performance.now()): () => number {
  const start = now();
  return () => (now() - start) / 1000;
}
