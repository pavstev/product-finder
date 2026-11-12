/** The counts the import CLI prints. */
export interface ImportCounts {
  status: string;
  file: string;
  rowsRead: number;
  valid: number;
  created: number;
  updated: number;
  unchanged: number;
  rejected: number;
  duplicates: number;
  markedMissing: number;
}

// The perf tool runs the built CLI and reads its output, so it imports no import code.
const SUMMARY = new RegExp(
  [
    String.raw`Import (\w+) \((.+)\)`,
    String.raw`\s+rows read (\d+), valid products (\d+)`,
    String.raw`\s+created (\d+), updated (\d+), unchanged (\d+)`,
    String.raw`\s+rejected (\d+), duplicates (\d+), marked missing (\d+)`,
  ].join(String.raw`\r?\n`),
);

/** Read the summary out of the import CLI output. Throws when there is none. */
export function parseImportSummary(output: string): ImportCounts {
  const match = SUMMARY.exec(output);
  if (!match) {
    throw new Error(`No import summary in the output:\n${output}`);
  }
  const [status, file, ...counts] = match.slice(1);
  const [rowsRead, valid, created, updated, unchanged, rejected, duplicates, markedMissing] =
    counts.map(Number);
  return {
    status,
    file,
    rowsRead,
    valid,
    created,
    updated,
    unchanged,
    rejected,
    duplicates,
    markedMissing,
  };
}
