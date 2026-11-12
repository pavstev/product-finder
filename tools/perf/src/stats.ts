/** Pure number helpers for the benchmarks. All times are in milliseconds. */

export interface Summary {
  count: number;
  min: number;
  median: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
}

function sorted(values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error('Cannot summarize an empty sample.');
  }
  return [...values].sort((a, b) => a - b);
}

/** Nearest-rank percentile: always one of the measured values, never an interpolation. */
export function percentile(values: readonly number[], p: number): number {
  if (!(p > 0 && p <= 100)) {
    throw new Error(`The percentile must be between 0 and 100, not ${p}.`);
  }
  const ordered = sorted(values);
  const rank = Math.ceil((p / 100) * ordered.length);
  return ordered[rank - 1];
}

/** The middle value, or the mean of the two middle values for an even count. */
export function median(values: readonly number[]): number {
  const ordered = sorted(values);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function summarize(values: readonly number[]): Summary {
  const ordered = sorted(values);
  return {
    count: ordered.length,
    min: ordered[0],
    median: median(ordered),
    p95: percentile(ordered, 95),
    p99: percentile(ordered, 99),
    max: ordered[ordered.length - 1],
    mean: ordered.reduce((sum, value) => sum + value, 0) / ordered.length,
  };
}

/** The part of os.cpus() this needs. */
export interface CpuSample {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

/** Busy share of all cores between two os.cpus() samples, in percent. Works where os.loadavg() does not. */
export function cpuBusyShare(before: readonly CpuSample[], after: readonly CpuSample[]): number {
  let busy = 0;
  let total = 0;
  after.forEach((core, index) => {
    const start = before[index].times;
    const end = core.times;
    const idle = end.idle - start.idle;
    const all = end.user + end.nice + end.sys + end.idle + end.irq;
    const startAll = start.user + start.nice + start.sys + start.idle + start.irq;
    total += all - startAll;
    busy += all - startAll - idle;
  });
  return total === 0 ? 0 : (busy / total) * 100;
}
