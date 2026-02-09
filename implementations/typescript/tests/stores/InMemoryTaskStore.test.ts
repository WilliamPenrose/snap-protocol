import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryTaskStore } from '../../src/stores/InMemoryTaskStore.js';
import type { Task } from '../../src/types/task.js';

const makeTask = (id: string): Task => ({
  id,
  status: { state: 'submitted', timestamp: new Date().toISOString() },
});

describe('InMemoryTaskStore', () => {
  let store: InMemoryTaskStore;

  beforeEach(() => {
    store = new InMemoryTaskStore();
  });

  it('returns undefined for unknown task', async () => {
    expect(await store.get('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves a task', async () => {
    const task = makeTask('task-1');
    await store.set('task-1', task);
    expect(await store.get('task-1')).toEqual(task);
  });

  it('overwrites an existing task', async () => {
    const task1 = makeTask('task-1');
    await store.set('task-1', task1);

    const task1Updated: Task = {
      ...task1,
      status: { state: 'completed', timestamp: new Date().toISOString() },
    };
    await store.set('task-1', task1Updated);

    const result = await store.get('task-1');
    expect(result?.status.state).toBe('completed');
  });

  it('deletes a task', async () => {
    await store.set('task-1', makeTask('task-1'));
    await store.delete('task-1');
    expect(await store.get('task-1')).toBeUndefined();
  });

  it('delete on nonexistent task does not throw', async () => {
    await expect(store.delete('nonexistent')).resolves.toBeUndefined();
  });

  it('tracks size correctly', async () => {
    expect(store.size).toBe(0);
    await store.set('task-1', makeTask('task-1'));
    expect(store.size).toBe(1);
    await store.set('task-2', makeTask('task-2'));
    expect(store.size).toBe(2);
    await store.delete('task-1');
    expect(store.size).toBe(1);
  });

  it('clears all tasks', async () => {
    await store.set('task-1', makeTask('task-1'));
    await store.set('task-2', makeTask('task-2'));
    store.clear();
    expect(store.size).toBe(0);
    expect(await store.get('task-1')).toBeUndefined();
  });

  it('stores tasks with full data including artifacts and history', async () => {
    const task: Task = {
      id: 'task-full',
      contextId: 'ctx-1',
      status: { state: 'working', timestamp: new Date().toISOString(), message: 'Processing' },
      artifacts: [
        { artifactId: 'art-1', parts: [{ type: 'text', text: 'result' }] },
      ],
      history: [
        { messageId: 'msg-1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
        { messageId: 'msg-2', role: 'agent', parts: [{ type: 'text', text: 'hi' }] },
      ],
    };

    await store.set('task-full', task);
    const retrieved = await store.get('task-full');
    expect(retrieved).toEqual(task);
    expect(retrieved?.artifacts).toHaveLength(1);
    expect(retrieved?.history).toHaveLength(2);
  });

  // --- Edge cases ---

  it('handles concurrent set operations', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(store.set(`task-${i}`, makeTask(`task-${i}`)));
    }
    await Promise.all(promises);
    expect(store.size).toBe(100);

    for (let i = 0; i < 100; i++) {
      expect(await store.get(`task-${i}`)).toBeDefined();
    }
  });

  it('handles concurrent delete operations', async () => {
    for (let i = 0; i < 10; i++) {
      await store.set(`task-${i}`, makeTask(`task-${i}`));
    }

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(store.delete(`task-${i}`));
    }
    await Promise.all(promises);
    expect(store.size).toBe(0);
  });

  it('set and get with empty string id', async () => {
    const task = makeTask('');
    await store.set('', task);
    expect(await store.get('')).toEqual(task);
    expect(store.size).toBe(1);
  });

  it('stores task at key independent of task.id', async () => {
    const task = makeTask('real-id');
    await store.set('storage-key', task);
    expect(await store.get('storage-key')).toEqual(task);
    expect(await store.get('real-id')).toBeUndefined();
  });

  it('get returns the same reference (not a copy)', async () => {
    const task = makeTask('task-ref');
    await store.set('task-ref', task);
    const a = await store.get('task-ref');
    const b = await store.get('task-ref');
    expect(a).toBe(b);
  });

  it('clear then set works correctly', async () => {
    await store.set('task-1', makeTask('task-1'));
    store.clear();
    await store.set('task-2', makeTask('task-2'));
    expect(store.size).toBe(1);
    expect(await store.get('task-1')).toBeUndefined();
    expect(await store.get('task-2')).toBeDefined();
  });

  it('stores all task states', async () => {
    const states = ['submitted', 'working', 'input-required', 'completed', 'canceled', 'failed'] as const;
    for (const state of states) {
      const task: Task = { id: `task-${state}`, status: { state, timestamp: new Date().toISOString() } };
      await store.set(`task-${state}`, task);
      const retrieved = await store.get(`task-${state}`);
      expect(retrieved?.status.state).toBe(state);
    }
    expect(store.size).toBe(states.length);
  });
});
