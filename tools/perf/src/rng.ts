/** A seeded source of numbers in [0, 1). The same seed gives the same sequence on every machine. */
export type Random = () => number;

/** A value with its weight. A weight is a relative count, for example the rows in the real export. */
export type Weighted<T> = readonly [value: T, weight: number];

/** mulberry32: a small PRNG for test data, not for secrets. 32-bit integer steps keep it platform independent. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number from min to max, both included. */
export function randomInt(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** One item, each with the same chance. */
export function pick<T>(random: Random, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** One value, with a chance in proportion to its weight. */
export function pickWeighted<T>(random: Random, items: readonly Weighted<T>[]): T {
  const total = items.reduce((sum, [, weight]) => sum + weight, 0);
  let left = random() * total;
  for (const [value, weight] of items) {
    left -= weight;
    if (left < 0) {
      return value;
    }
  }
  return items[items.length - 1][0];
}

/** `count` different indexes below `size`, in random order. A partial Fisher-Yates shuffle. */
export function sampleIndexes(random: Random, size: number, count: number): number[] {
  const pool = Array.from({ length: size }, (_, index) => index);
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(random() * (size - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, count);
}
