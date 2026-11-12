// Tests pass a fake clock, so a TTL test needs no real waiting.
type Clock = () => number;

interface LruCacheOptions {
  maxEntries: number;
  ttlMs: number;
  clock?: Clock;
}

interface Entry<V> {
  value: V;
  expiresAt: number;
}

// A small in-memory LRU cache with a time to live, for one API process. No package needed.
// A Map keeps insertion order, so its first key is the least recently used. A read does not extend the time to live.
export class LruCache<V> {
  private readonly entries = new Map<string, Entry<V>>();
  private readonly clock: Clock;

  constructor(private readonly options: LruCacheOptions) {
    if (!(options.maxEntries >= 1)) {
      throw new Error('LruCache maxEntries must be at least 1.');
    }
    if (!(options.ttlMs >= 1)) {
      throw new Error('LruCache ttlMs must be at least 1.');
    }
    this.clock = options.clock ?? (() => performance.now());
  }

  get size(): number {
    return this.entries.size;
  }

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    this.entries.delete(key);
    if (entry.expiresAt <= this.clock()) {
      return undefined;
    }
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.clock() + this.options.ttlMs });
    while (this.entries.size > this.options.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /** Deletes the key only while it still holds this value, so a failed load removes only its own entry. */
  deleteIfSame(key: string, value: V): void {
    if (this.entries.get(key)?.value === value) {
      this.entries.delete(key);
    }
  }
}
