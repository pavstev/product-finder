// The `status` command output: the last import runs as a table or as JSON. Pure, no database.

export type ImportRunStatusValue = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'ABORTED';

/** One import_run row, as `status` shows it. A locked run is stored as ABORTED. */
export interface ImportRunRow {
  id: string;
  source: string;
  status: ImportRunStatusValue;
  startedAt: Date;
  finishedAt: Date | null;
  rowsRead: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  duplicates: number;
  markedMissing: number;
  error: string | null;
}

/** The read side of the import_run table. Newest run first. */
export interface ImportRunReader {
  lastRuns(limit: number): Promise<ImportRunRow[]>;
}

const MAX_ERROR_LINE = 200;

/** UTC, to the second: "2026-11-12 02:30:05Z". */
function time(date: Date): string {
  return `${date.toISOString().slice(0, 19).replace('T', ' ')}Z`;
}

/** One line: line breaks become spaces, and a long text ends in "...". */
function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 3)}...` : line;
}

/** The runs as a table. Counts are right-aligned, source is last because it is the longest. */
export function formatRunsTable(runs: readonly ImportRunRow[]): string {
  if (runs.length === 0) {
    return 'No import runs yet.';
  }
  const header = [
    'STARTED',
    'STATUS',
    'READ',
    'CREATED',
    'UPDATED',
    'UNCHANGED',
    'REJECTED',
    'DUPLICATES',
    'MISSING',
  ];
  const cells = runs.map((run) => [
    time(run.startedAt),
    run.status,
    String(run.rowsRead),
    String(run.created),
    String(run.updated),
    String(run.unchanged),
    String(run.rejected),
    String(run.duplicates),
    String(run.markedMissing),
  ]);
  const widths = header.map((title, i) => Math.max(title.length, ...cells.map((row) => row[i].length)));
  const line = (row: string[], source: string) =>
    `${row.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  ')}  ${source}`;
  const lines = [line(header, 'SOURCE'), ...cells.map((row, i) => line(row, runs[i].source))];

  const failed = runs.filter((run) => run.error);
  if (failed.length > 0) {
    lines.push('', 'Errors:');
    for (const run of failed) {
      const prefix = `  ${time(run.startedAt)} ${run.status}: `;
      lines.push(prefix + oneLine(run.error ?? '', MAX_ERROR_LINE - prefix.length));
    }
  }
  return lines.join('\n');
}

/** The runs as a JSON array with ISO dates. */
export function formatRunsJson(runs: readonly ImportRunRow[]): string {
  return JSON.stringify(runs, null, 2);
}
