import type { LanguageModelUsage } from 'ai';
import type { ChatSession } from '@/src/client/journal/session';
import type { UsageCall, UsageCallMeta, UsageRange } from '@/src/client/journal/usage';
import type { WorldRecord } from '@/src/shared/sim/snapshot';
import type { MemoryPatch, PersistenceRepository } from '@/src/client/storage/repository';
import type { StorageMethod, StorageReply, StorageRequest } from '@/src/client/storage/protocol';

export interface StorageClientPort {
  onmessage: ((event: MessageEvent<StorageReply>) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(request: StorageRequest): void;
  start?(): void;
  close?(): void;
}

export class StorageClient implements PersistenceRepository {
  #seq = 0;
  #failure: Error | null = null;
  readonly #pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void }
  >();

  constructor(private readonly port: StorageClientPort) {
    port.onmessage = ({ data: reply }) => {
      const pending = this.#pending.get(reply.id);
      if (!pending) return;
      this.#pending.delete(reply.id);
      if (reply.ok) pending.resolve(reply.value);
      else pending.reject(new Error(reply.error));
    };
    port.onmessageerror = () => this.fail(new Error('Storage message could not be decoded'));
    port.start?.();
  }

  loadSession(date: string) {
    return this.#call('loadSession', [date]);
  }
  saveSession(session: ChatSession) {
    return this.#call('saveSession', [session]);
  }
  listMemories() {
    return this.#call('listMemories', []);
  }
  getMemory(date: string) {
    return this.#call('getMemory', [date]);
  }
  patchMemory(patch: MemoryPatch) {
    return this.#call('patchMemory', [patch]);
  }
  recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now = new Date(),
    meta?: UsageCallMeta,
  ) {
    return this.#call('recordUsage', [usage, now, meta]);
  }
  recordUsageCall(call: UsageCall) {
    return this.#call('recordUsageCall', [call]);
  }
  recordUsageCalls(calls: UsageCall[]) {
    return this.#call('recordUsageCalls', [calls]);
  }
  readUsage(today: string, range?: UsageRange) {
    return this.#call('readUsage', [today, range]);
  }
  readSnapshot() {
    return this.#call('readSnapshot', []);
  }
  putSnapshot(record: WorldRecord) {
    return this.#call('putSnapshot', [record]);
  }
  removeSnapshot() {
    return this.#call('removeSnapshot', []);
  }
  sweepSnapshots(today: string) {
    return this.#call('sweepSnapshots', [today]);
  }

  fail(error: Error): void {
    this.#failure ??= error;
    for (const pending of this.#pending.values()) pending.reject(this.#failure);
    this.#pending.clear();
  }

  close(): void {
    this.fail(new Error('Storage connection closed'));
    this.port.close?.();
  }

  #call<K extends StorageMethod>(
    method: K,
    args: Parameters<PersistenceRepository[K]>,
  ): ReturnType<PersistenceRepository[K]> {
    const id = ++this.#seq;
    const result = new Promise<unknown>((resolve, reject) => {
      if (this.#failure) {
        reject(this.#failure);
        return;
      }
      this.#pending.set(id, { resolve, reject });
      try {
        this.port.postMessage({ id, method, args } as StorageRequest);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return result as ReturnType<PersistenceRepository[K]>;
  }
}

export interface StorageWorker {
  repository: StorageClient;
  connect(): MessagePort;
  onFailure(listener: (error: Error) => void): () => void;
  close(): void;
}

export function createStorageWorker(): StorageWorker {
  const worker = new Worker(new URL('./storage.worker.ts', import.meta.url), { type: 'module' });
  const connect = (): MessagePort => {
    const channel = new MessageChannel();
    worker.postMessage({ event: 'storageConnect', port: channel.port1 }, [channel.port1]);
    return channel.port2;
  };
  let repository: StorageClient;
  try {
    repository = new StorageClient(connect());
  } catch (error) {
    worker.terminate();
    throw error;
  }
  let failure: Error | null = null;
  const listeners = new Set<(error: Error) => void>();
  const fail = (error: Error): void => {
    if (failure) return;
    failure = error;
    repository.fail(error);
    repository.close();
    worker.terminate();
    for (const listener of listeners) listener(error);
  };
  worker.onerror = (event) => fail(new Error(event.message || 'Storage Worker failed'));
  worker.onmessageerror = () => fail(new Error('Storage Worker message could not be decoded'));
  return {
    repository,
    connect,
    onFailure(listener) {
      listeners.add(listener);
      if (failure) listener(failure);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      fail(new Error('Storage Worker closed'));
    },
  };
}
