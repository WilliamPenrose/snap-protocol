import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { InMemoryReplayStore } from '../../src/stores/InMemoryReplayStore.js';

describe('InMemoryReplayStore', () => {
  let store: InMemoryReplayStore;

  beforeEach(() => {
    store = new InMemoryReplayStore();
  });

  it('returns false for unseen messages', async () => {
    expect(await store.hasSeen('alice', 'msg-1')).toBe(false);
  });

  it('returns true after marking a message as seen', async () => {
    await store.markSeen('alice', 'msg-1', Date.now());
    expect(await store.hasSeen('alice', 'msg-1')).toBe(true);
  });

  it('distinguishes different senders with the same message id', async () => {
    await store.markSeen('alice', 'msg-1', Date.now());
    expect(await store.hasSeen('bob', 'msg-1')).toBe(false);
  });

  it('distinguishes different message ids from the same sender', async () => {
    await store.markSeen('alice', 'msg-1', Date.now());
    expect(await store.hasSeen('alice', 'msg-2')).toBe(false);
  });

  it('expires entries older than maxAge', async () => {
    vi.useFakeTimers();
    try {
      const store60s = new InMemoryReplayStore(60_000); // 60s
      await store60s.markSeen('alice', 'msg-1', 0);

      // Entry should exist immediately
      expect(await store60s.hasSeen('alice', 'msg-1')).toBe(true);

      // Advance time past maxAge
      vi.advanceTimersByTime(120_000); // 2 minutes
      expect(await store60s.hasSeen('alice', 'msg-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not expire entries within maxAge', async () => {
    const store60s = new InMemoryReplayStore(60_000);
    await store60s.markSeen('alice', 'msg-1', Date.now());
    expect(await store60s.hasSeen('alice', 'msg-1')).toBe(true);
  });

  it('does not expire when maxAge is 0 (disabled)', async () => {
    const noExpiry = new InMemoryReplayStore(0);
    await noExpiry.markSeen('alice', 'msg-1', 1); // very old timestamp
    expect(await noExpiry.hasSeen('alice', 'msg-1')).toBe(true);
  });

  it('tracks size correctly', async () => {
    expect(store.size).toBe(0);
    await store.markSeen('alice', 'msg-1', Date.now());
    expect(store.size).toBe(1);
    await store.markSeen('bob', 'msg-2', Date.now());
    expect(store.size).toBe(2);
  });

  it('clears all entries', async () => {
    await store.markSeen('alice', 'msg-1', Date.now());
    await store.markSeen('bob', 'msg-2', Date.now());
    store.clear();
    expect(store.size).toBe(0);
    expect(await store.hasSeen('alice', 'msg-1')).toBe(false);
  });

  // --- Edge cases ---

  it('markSeen uses Date.now() for storage, ignores message timestamp', async () => {
    vi.useFakeTimers({ now: 1000 });
    try {
      const shortStore = new InMemoryReplayStore(500);
      // Pass a very different message timestamp — should be ignored
      await shortStore.markSeen('alice', 'msg-1', 999999);

      // Should be seen (stored at Date.now() = 1000)
      expect(await shortStore.hasSeen('alice', 'msg-1')).toBe(true);

      // Advance 600ms past maxAge (500ms)
      vi.advanceTimersByTime(600);
      expect(await shortStore.hasSeen('alice', 'msg-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('markSeen overwrites previous entry (refreshes timestamp)', async () => {
    vi.useFakeTimers({ now: 0 });
    try {
      const shortStore = new InMemoryReplayStore(1000);

      await shortStore.markSeen('alice', 'msg-1', 0);
      vi.advanceTimersByTime(800); // 800ms in

      // Re-mark at t=800
      await shortStore.markSeen('alice', 'msg-1', 0);
      vi.advanceTimersByTime(800); // now t=1600

      // Original would have expired at t=1000, but re-mark refreshed to t=800+1000=1800
      expect(await shortStore.hasSeen('alice', 'msg-1')).toBe(true);

      vi.advanceTimersByTime(300); // now t=1900 > 1800
      expect(await shortStore.hasSeen('alice', 'msg-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hasSeen deletes expired entries (lazy cleanup)', async () => {
    vi.useFakeTimers();
    try {
      const shortStore = new InMemoryReplayStore(100);
      await shortStore.markSeen('alice', 'msg-1', 0);
      expect(shortStore.size).toBe(1);

      vi.advanceTimersByTime(200);

      // hasSeen should delete the expired entry
      await shortStore.hasSeen('alice', 'msg-1');
      expect(shortStore.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('handles concurrent markSeen operations', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(store.markSeen(`sender-${i}`, `msg-${i}`, Date.now()));
    }
    await Promise.all(promises);
    expect(store.size).toBe(100);

    // Verify all are visible
    for (let i = 0; i < 100; i++) {
      expect(await store.hasSeen(`sender-${i}`, `msg-${i}`)).toBe(true);
    }
  });

  it('handles empty string sender and id', async () => {
    await store.markSeen('', '', Date.now());
    expect(await store.hasSeen('', '')).toBe(true);
    expect(store.size).toBe(1);
  });

  it('default maxAge is 1 hour', async () => {
    vi.useFakeTimers();
    try {
      const defaultStore = new InMemoryReplayStore();
      await defaultStore.markSeen('alice', 'msg-1', 0);

      // Should still be seen at 59 minutes
      vi.advanceTimersByTime(59 * 60 * 1000);
      expect(await defaultStore.hasSeen('alice', 'msg-1')).toBe(true);

      // Should be expired at 61 minutes
      vi.advanceTimersByTime(2 * 60 * 1000);
      expect(await defaultStore.hasSeen('alice', 'msg-1')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
