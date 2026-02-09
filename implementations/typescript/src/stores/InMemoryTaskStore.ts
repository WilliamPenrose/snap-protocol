import type { Task } from '../types/task.js';
import type { TaskStore } from '../types/plugin.js';

/** In-memory task store backed by a Map. */
export class InMemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, Task>();

  async get(taskId: string): Promise<Task | undefined> {
    return this.tasks.get(taskId);
  }

  async set(taskId: string, task: Task): Promise<void> {
    this.tasks.set(taskId, task);
  }

  async delete(taskId: string): Promise<void> {
    this.tasks.delete(taskId);
  }

  /** Returns the number of tasks currently stored. */
  get size(): number {
    return this.tasks.size;
  }

  /** Remove all tasks. */
  clear(): void {
    this.tasks.clear();
  }
}
