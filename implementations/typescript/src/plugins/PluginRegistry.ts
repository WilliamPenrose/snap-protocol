import type { TransportPlugin, ReplayStore, TaskStore, Middleware } from '../types/plugin.js';

export class PluginRegistry {
  private transports = new Map<string, TransportPlugin>();
  private middlewares: Middleware[] = [];
  private replayStore?: ReplayStore;
  private taskStore?: TaskStore;

  registerTransport(plugin: TransportPlugin): void {
    this.transports.set(plugin.name, plugin);
  }

  getTransport(name: string): TransportPlugin | undefined {
    return this.transports.get(name);
  }

  getTransportNames(): string[] {
    return [...this.transports.keys()];
  }

  registerMiddleware(middleware: Middleware): void {
    this.middlewares.push(middleware);
  }

  getMiddlewareChain(): ReadonlyArray<Middleware> {
    return this.middlewares;
  }

  setReplayStore(store: ReplayStore): void {
    this.replayStore = store;
  }

  getReplayStore(): ReplayStore | undefined {
    return this.replayStore;
  }

  setTaskStore(store: TaskStore): void {
    this.taskStore = store;
  }

  getTaskStore(): TaskStore | undefined {
    return this.taskStore;
  }
}
