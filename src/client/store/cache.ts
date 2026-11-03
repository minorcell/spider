export interface CacheAdapter<Value> {
  read(): Promise<unknown>;
  write(value: Value): Promise<void>;
}

export interface RecoveryBuffer<Value> {
  read(): unknown;
  write(value: Value): boolean;
}

export class PersistentCache<Value> {
  readonly #adapter: CacheAdapter<Value>;
  readonly #recovery: RecoveryBuffer<Value>;
  #value: Value | null = null;
  #revision = 0;
  #storedRevision = 0;
  #tail: Promise<void> = Promise.resolve();

  constructor(adapter: CacheAdapter<Value>, recovery: RecoveryBuffer<Value>) {
    this.#adapter = adapter;
    this.#recovery = recovery;
  }

  readPersistent(): Promise<unknown> {
    return this.#adapter.read();
  }

  readRecovery(): unknown {
    return this.#recovery.read();
  }

  peek(): Value | null {
    return structuredClone(this.#value);
  }

  hydrate(value: Value | null): void {
    if (this.pending()) return;
    this.#value = structuredClone(value);
  }

  stage(value: Value): boolean {
    this.#value = structuredClone(value);
    this.#revision += 1;
    try {
      return this.#recovery.write(structuredClone(this.#value));
    } catch {
      return false;
    }
  }

  pending(): boolean {
    return this.#storedRevision < this.#revision;
  }

  flush(): Promise<void> {
    const task = this.#tail.then(() => this.#writePending());
    this.#tail = task.catch(() => undefined);
    return task;
  }

  async #writePending(): Promise<void> {
    if (!this.pending()) return;
    const revision = this.#revision;
    const value = structuredClone(this.#value as Value);
    await this.#adapter.write(value);
    this.#storedRevision = revision;
    return this.#writePending();
  }
}
