import { describe, expect, it } from '@jest/globals';
import { EXIT_CODE_TABLE, EXIT_CODES, exitCodeFor } from './cli-args.js';

describe('exitCodeFor', () => {
  it('maps every outcome to the documented exit code', () => {
    expect(exitCodeFor('SUCCEEDED')).toBe(0);
    expect(exitCodeFor('DRY_RUN')).toBe(0);
    expect(exitCodeFor('FAILED')).toBe(1);
    expect(exitCodeFor('ABORTED')).toBe(2);
    expect(exitCodeFor('LOCKED')).toBe(3);
    expect(exitCodeFor('BAD_ARGUMENTS')).toBe(4);
  });

  it('has one table row per code, 0 to 4, each with a meaning and an alert flag', () => {
    expect(EXIT_CODE_TABLE.map((row) => row.code)).toEqual([0, 1, 2, 3, 4]);
    expect(EXIT_CODE_TABLE.map((row) => row.alert)).toEqual([
      'no',
      'yes',
      'yes, the export is likely broken',
      'no, unless it repeats',
      'yes',
    ]);
    expect(EXIT_CODE_TABLE.every((row) => row.meaning.length > 0)).toBe(true);
  });

  it('keeps EXIT_CODES in step with the table', () => {
    expect(Object.values(EXIT_CODES).sort()).toEqual([0, 1, 2, 3, 4]);
    expect(EXIT_CODES.badArguments).toBe(4);
  });
});
