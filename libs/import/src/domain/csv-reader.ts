import { parse } from 'csv-parse/sync';
import { type CsvColumn, CsvFileError, type ImportIssue, type RawRow, REQUIRED_COLUMNS } from './types.js';

export interface CsvReadResult {
  rows: RawRow[];
  issues: ImportIssue[];
}

interface ParsedLine {
  record: string[];
  raw: string;
  info: { lines: number };
}

/** csv-parse only gives the line a record ends on, and `raw` also holds the empty lines skipped before it. */
function startLine({ raw, info }: ParsedLine): number {
  const inner = raw.replace(/^\n+/, '').replace(/\n$/, '');
  return info.lines - (inner.match(/\n/g)?.length ?? 0);
}

/** csv-parse counts a CRLF inside a quoted field as two lines. With LF only, line numbers are exact. */
function parseLines(content: string): ParsedLine[] {
  try {
    return parse(content.replace(/\r\n?/g, '\n'), {
      bom: true,
      info: true,
      raw: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as unknown as ParsedLine[];
  } catch (error) {
    throw new CsvFileError(`The file is not valid CSV: ${(error as Error).message}`);
  }
}

function readHeader(first: ParsedLine | undefined): string[] {
  if (!first) {
    throw new CsvFileError('The file is empty.');
  }
  const header = first.record.map((name) => name.trim().toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new CsvFileError(`Missing column(s): ${missing.join(', ')}.`);
  }
  return header;
}

/** Read the PIM export. Extra columns warn. Throws CsvFileError for a missing column or invalid CSV. */
export function readCsv(content: string): CsvReadResult {
  const lines = parseLines(content);
  const header = readHeader(lines[0]);

  const issues: ImportIssue[] = [];
  const extra = header.filter((name) => !(REQUIRED_COLUMNS as readonly string[]).includes(name));
  if (extra.length > 0) {
    issues.push({ line: 1, level: 'warning', message: `Ignored extra column(s): ${extra.join(', ')}.` });
  }

  const index = Object.fromEntries(
    REQUIRED_COLUMNS.map((column) => [column, header.indexOf(column)]),
  ) as Record<CsvColumn, number>;

  const rows = lines.slice(1).map((parsed): RawRow => {
    const { record } = parsed;
    const fields = Object.fromEntries(
      REQUIRED_COLUMNS.map((column) => [column, record[index[column]] ?? '']),
    ) as Record<CsvColumn, string>;
    const row: RawRow = { line: startLine(parsed), fields };
    if (record.length !== header.length) {
      row.problem = `Expected ${header.length} fields but found ${record.length}.`;
    }
    return row;
  });

  return { rows, issues };
}
