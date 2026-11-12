// Pure parts of the import CLI: flags in, exit code out.
import { parseArgs } from 'node:util';
import type { ImportOutcome } from './types.js';

const USAGE = 'Usage: pnpm import:products [--file <path>] [--force] [--dry-run]';

export interface CliArgs {
  file?: string;
  force: boolean;
  dryRun: boolean;
}

/** `pnpm import:products -- --dry-run` passes the literal `--` on to the script, so one is dropped. */
function withoutLeadingSeparator(argv: readonly string[]): string[] {
  return argv[0] === '--' ? argv.slice(1) : [...argv];
}

/** Node names the bad flag. The usage goes on the same line, so the fix is easy to see. */
function usageError(error: unknown, usage: string): Error {
  const reason = (error as Error).message.replace(/\.$/, '');
  return new Error(`${reason}. ${usage}`, { cause: error });
}

/** Strict mode stays on: unknown flags and stray arguments fail. */
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const args = withoutLeadingSeparator(argv);
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      options: {
        file: { type: 'string' },
        force: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
      },
    });
    return { file: values.file, force: values.force, dryRun: values['dry-run'] };
  } catch (error) {
    throw usageError(error, USAGE);
  }
}

const STATUS_USAGE = 'Usage: main.js status [--json]';

export interface StatusArgs {
  json: boolean;
}

export function parseStatusArgs(argv: readonly string[]): StatusArgs {
  const args = withoutLeadingSeparator(argv);
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      options: { json: { type: 'boolean', default: false } },
    });
    return { json: values.json };
  } catch (error) {
    throw usageError(error, STATUS_USAGE);
  }
}

/** A required setting is missing or wrong, such as DATABASE_URL. The commands exit with 4. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Exit codes of the CLI. */
export const EXIT_CODES = { ok: 0, failed: 1, aborted: 2, locked: 3, badArguments: 4 } as const;

/** What a command ends in. An import outcome, or one of the two ways a command stops early. */
export type ExitOutcome = ImportOutcome | 'FAILED' | 'BAD_ARGUMENTS';

export interface ExitCodeRow {
  code: number;
  meaning: string;
  /** Whether the scheduler should alert. */
  alert: string;
}

/** The exit-code table, in code order. */
export const EXIT_CODE_TABLE: readonly ExitCodeRow[] = [
  { code: EXIT_CODES.ok, meaning: 'success or no-op', alert: 'no' },
  { code: EXIT_CODES.failed, meaning: 'failed (error, rolled back)', alert: 'yes' },
  {
    code: EXIT_CODES.aborted,
    meaning: 'aborted by the 50% guard',
    alert: 'yes, the export is likely broken',
  },
  { code: EXIT_CODES.locked, meaning: 'another import holds the lock', alert: 'no, unless it repeats' },
  { code: EXIT_CODES.badArguments, meaning: 'bad arguments or config', alert: 'yes' },
];

const EXIT_CODE_BY_OUTCOME: Record<ExitOutcome, number> = {
  SUCCEEDED: EXIT_CODES.ok,
  DRY_RUN: EXIT_CODES.ok,
  FAILED: EXIT_CODES.failed,
  ABORTED: EXIT_CODES.aborted,
  LOCKED: EXIT_CODES.locked,
  BAD_ARGUMENTS: EXIT_CODES.badArguments,
};

/** The one place that maps an outcome to an exit code. */
export function exitCodeFor(outcome: ExitOutcome): number {
  return EXIT_CODE_BY_OUTCOME[outcome];
}
