import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../../src/plugins/PluginRegistry.js';
import type { TransportPlugin, Middleware, MiddlewareContext, NextFn, ReplayStore, TaskStore } from '../../src/types/plugin.js';
import type { SnapMessage } from '../../src/types/message.js';
import type { Task } from '../../src/types/task.js';

function makeTransport(name: string): TransportPlugin {
  return {
    name,
    async send() { return {} as SnapMessage; },
  };
}

function makeMiddleware(name: string): Middleware {
  return {
    name,
    async handle(_ctx: MiddlewareContext, next: NextFn) { await next(); },
  };
}

function makeReplayStore(): ReplayStore {
  return {
    async hasSeen() { return false; },
    async markSeen() {},
  };
}

function makeTaskStore(): TaskStore {
  return {
    async get() { return undefined; },
    async set() {},
    async delete() {},
  };
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  // --- Transport ---

  describe('registerTransport / getTransport', () => {
    it('registers and retrieves a transport by name', () => {
      const tp = makeTransport('http');
      registry.registerTransport(tp);
      expect(registry.getTransport('http')).toBe(tp);
    });

    it('returns undefined for unregistered transport name', () => {
      expect(registry.getTransport('nonexistent')).toBeUndefined();
    });

    it('overwrites transport with the same name', () => {
      const tp1 = makeTransport('http');
      const tp2 = makeTransport('http');
      registry.registerTransport(tp1);
      registry.registerTransport(tp2);
      expect(registry.getTransport('http')).toBe(tp2);
      expect(registry.getTransport('http')).not.toBe(tp1);
    });

    it('registers multiple transports with different names', () => {
      const http = makeTransport('http');
      const ws = makeTransport('ws');
      const nostr = makeTransport('nostr');
      registry.registerTransport(http);
      registry.registerTransport(ws);
      registry.registerTransport(nostr);
      expect(registry.getTransport('http')).toBe(http);
      expect(registry.getTransport('ws')).toBe(ws);
      expect(registry.getTransport('nostr')).toBe(nostr);
    });
  });

  describe('getTransportNames', () => {
    it('returns empty array when no transports registered', () => {
      expect(registry.getTransportNames()).toEqual([]);
    });

    it('returns all registered transport names', () => {
      registry.registerTransport(makeTransport('http'));
      registry.registerTransport(makeTransport('ws'));
      const names = registry.getTransportNames();
      expect(names).toContain('http');
      expect(names).toContain('ws');
      expect(names).toHaveLength(2);
    });

    it('returns a fresh array (not internal reference)', () => {
      registry.registerTransport(makeTransport('http'));
      const names1 = registry.getTransportNames();
      const names2 = registry.getTransportNames();
      expect(names1).toEqual(names2);
      expect(names1).not.toBe(names2);
    });
  });

  // --- Middleware ---

  describe('registerMiddleware / getMiddlewareChain', () => {
    it('returns empty array when no middleware registered', () => {
      expect(registry.getMiddlewareChain()).toEqual([]);
    });

    it('registers and retrieves middleware in order', () => {
      const mw1 = makeMiddleware('logger');
      const mw2 = makeMiddleware('auth');
      registry.registerMiddleware(mw1);
      registry.registerMiddleware(mw2);
      const chain = registry.getMiddlewareChain();
      expect(chain).toHaveLength(2);
      expect(chain[0]).toBe(mw1);
      expect(chain[1]).toBe(mw2);
    });

    it('returns a readonly array', () => {
      registry.registerMiddleware(makeMiddleware('test'));
      const chain = registry.getMiddlewareChain();
      // ReadonlyArray — type-level check, runtime is same array reference
      expect(chain).toHaveLength(1);
    });

    it('allows duplicate middleware (same name)', () => {
      const mw = makeMiddleware('logger');
      registry.registerMiddleware(mw);
      registry.registerMiddleware(mw);
      expect(registry.getMiddlewareChain()).toHaveLength(2);
    });
  });

  // --- Replay Store ---

  describe('setReplayStore / getReplayStore', () => {
    it('returns undefined when no replay store set', () => {
      expect(registry.getReplayStore()).toBeUndefined();
    });

    it('sets and gets a replay store', () => {
      const store = makeReplayStore();
      registry.setReplayStore(store);
      expect(registry.getReplayStore()).toBe(store);
    });

    it('replaces the previous replay store', () => {
      const store1 = makeReplayStore();
      const store2 = makeReplayStore();
      registry.setReplayStore(store1);
      registry.setReplayStore(store2);
      expect(registry.getReplayStore()).toBe(store2);
      expect(registry.getReplayStore()).not.toBe(store1);
    });
  });

  // --- Task Store ---

  describe('setTaskStore / getTaskStore', () => {
    it('returns undefined when no task store set', () => {
      expect(registry.getTaskStore()).toBeUndefined();
    });

    it('sets and gets a task store', () => {
      const store = makeTaskStore();
      registry.setTaskStore(store);
      expect(registry.getTaskStore()).toBe(store);
    });

    it('replaces the previous task store', () => {
      const store1 = makeTaskStore();
      const store2 = makeTaskStore();
      registry.setTaskStore(store1);
      registry.setTaskStore(store2);
      expect(registry.getTaskStore()).toBe(store2);
      expect(registry.getTaskStore()).not.toBe(store1);
    });
  });

  // --- Isolation between registries ---

  it('different registry instances are independent', () => {
    const r1 = new PluginRegistry();
    const r2 = new PluginRegistry();

    r1.registerTransport(makeTransport('http'));
    r1.registerMiddleware(makeMiddleware('logger'));
    r1.setReplayStore(makeReplayStore());
    r1.setTaskStore(makeTaskStore());

    expect(r2.getTransport('http')).toBeUndefined();
    expect(r2.getMiddlewareChain()).toHaveLength(0);
    expect(r2.getTransportNames()).toHaveLength(0);
    expect(r2.getReplayStore()).toBeUndefined();
    expect(r2.getTaskStore()).toBeUndefined();
  });
});
