import type { ReplayStore } from '../types/plugin.js';

/**
 * In-memory replay store using a Map of Sets.
 * Key format: `${from}:${id}` for efficient lookup.
 */
export class InMemoryReplayStore implements ReplayStore {
  private readonly seen = new Map<string, number>();
  private readonly maxAge: number;

  /**
   * @param maxAge Maximum age in milliseconds before entries expire.
   *              Defaults to 1 hour (3_600_000 ms). Set to 0 to disable expiry.
   */
  constructor(maxAge = 3_600_000) {
    this.maxAge = maxAge;
  }

  async hasSeen(from: string, id: string): Promise<boolean> {
    const key = `${from}:${id}`;
    const ts = this.seen.get(key);
    if (ts === undefined) return false;

    if (this.maxAge > 0 && Date.now() - ts > this.maxAge) {
      this.seen.delete(key);
      return false;
    }

    return true;
  }

  async markSeen(from: string, id: string, _timestamp: number): Promise<void> {
    const key = `${from}:${id}`;
    this.seen.set(key, Date.now());
  }

  /** Returns the number of entries currently tracked. */
  get size(): number {
    return this.seen.size;
  }

  /** Remove all entries. */
  clear(): void {
    this.seen.clear();
  }
}
