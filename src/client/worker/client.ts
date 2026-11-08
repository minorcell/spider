import { createStorageWorker } from '@/src/client/storage/client';
import type { PersistenceRepository } from '@/src/client/storage/repository';
import { connectLocalJournal } from '@/src/client/local/backend';
import type { LanguageModelUsage, ModelMessage } from 'ai';
import type { WorldRecord } from '@/src/shared/sim/snapshot';
import type { Journal } from '@/src/client/journal/api';
import type { MemoryPage } from '@/src/client/storage/db';
import type { MemoryApi, MemoryView, MemoryWrite } from '@/src/client/journal/diary';
import { blankSession, type ChatSession } from '@/src/client/journal/session';
import type { SnapshotStore } from '@/src/client/storage/snapshot';
import type {
  UsageCall,
  UsageCallMeta,
  UsageRange,
  UsageSnapshot,
} from '@/src/client/journal/usage';
import type { PilotSettings } from '@/src/client/settings';
import type {
  JournalControl,
  JournalReply,
  JournalRequest,
  JournalResultMap,
} from '@/src/client/worker/protocol';

export interface WorkerPort {
  postMessage(message: JournalRequest | JournalControl, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<JournalReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
}

interface Waiter {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

export class WorkerJournal implements Journal, SnapshotStore {
  readonly #port: WorkerPort;
  readonly #pending = new Map<number, Waiter>();
  #seq = 0;
  #state: JournalResultMap['open'] | null = null;
  #failure: Error | null = null;

  constructor(
    port: WorkerPort,
    readonly repository: PersistenceRepository,
    readonly onFailure: () => void = () => {},
  ) {
    this.#port = port;
    port.onmessage = (event) => this.#receive(event.data);
    port.onerror = (event) => this.#fail(new Error(event.message));
    port.onmessageerror = () => this.#fail(new Error('日记线程消息无法读取'));
  }

  async open(): Promise<void> {
    this.#state = await this.#call<'open'>((id) => ({ id, method: 'open' }));
  }

  get date(): string {
    return this.#state?.date ?? '';
  }

  get session(): ChatSession {
    return this.#state?.session ?? blankSession(this.date);
  }

  get dismissed(): boolean {
    return this.#state?.dismissed ?? false;
  }

  set dismissed(value: boolean) {
    void this.#call<'dismiss'>((id) => ({ id, method: 'dismiss', args: [value] })).then(
      (state) => {
        this.#state = state;
      },
      () => undefined,
    );
  }

  behind(): boolean {
    return this.#state?.behind ?? false;
  }

  async save(): Promise<void> {
    this.#state = await this.#call<'save'>((id) => ({ id, method: 'save' }));
  }

  api(): MemoryApi {
    return {
      list: async () => {
        const pages = await this.pages();
        return pages.map((page) => ({ date: page.date, line: page.description }));
      },
      get: (date) => this.read(date),
      write: (input) => this.write(input),
    };
  }

  async pages(): Promise<MemoryPage[]> {
    return this.#call<'pages'>((id) => ({ id, method: 'pages' }));
  }

  async read(date: string): Promise<MemoryView | null> {
    return this.#call<'read'>((id) => ({ id, method: 'read', args: [date] }));
  }

  async write(input: MemoryWrite): Promise<MemoryView> {
    return this.#call<'write'>((id) => ({ id, method: 'write', args: [input] }));
  }

  async record(messages: ModelMessage[], settings: PilotSettings): Promise<void> {
    this.#state = await this.#call<'record'>((id) => ({
      id,
      method: 'record',
      args: [messages, settings],
    }));
  }

  async digest(settings: PilotSettings): Promise<void> {
    this.#state = await this.#call<'digest'>((id) => ({ id, method: 'digest', args: [settings] }));
  }

  async backfill(settings: PilotSettings): Promise<void> {
    this.#state = await this.#call<'backfill'>((id) => ({
      id,
      method: 'backfill',
      args: [settings],
    }));
  }

  async recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now = new Date(),
    meta?: UsageCallMeta,
  ): Promise<void> {
    await this.repository.recordUsage(usage, now, meta);
  }

  async recordUsageCall(call: UsageCall): Promise<void> {
    await this.repository.recordUsageCall(call);
  }

  async recordUsageCalls(calls: UsageCall[]): Promise<void> {
    await this.repository.recordUsageCalls(calls);
  }

  async readUsage(today: string, range?: UsageRange): Promise<UsageSnapshot> {
    return this.repository.readUsage(today, range);
  }

  async readSnapshot(): Promise<unknown> {
    return this.repository.readSnapshot();
  }

  async putSnapshot(record: WorldRecord): Promise<void> {
    await this.repository.putSnapshot(record);
  }

  async removeSnapshot(): Promise<void> {
    await this.repository.removeSnapshot();
  }

  async sweepSnapshots(today: string): Promise<void> {
    await this.repository.sweepSnapshots(today);
  }

  #receive(reply: JournalReply): void {
    const waiter = this.#pending.get(reply.id);
    if (!waiter) return;
    this.#pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error));
  }

  #fail(error: Error): void {
    if (!this.#failure) this.onFailure();
    this.#failure ??= error;
    for (const waiter of this.#pending.values()) waiter.reject(error);
    this.#pending.clear();
  }

  #call<K extends keyof JournalResultMap>(
    make: (id: number) => JournalRequest,
  ): Promise<JournalResultMap[K]> {
    const id = ++this.#seq;
    return new Promise<JournalResultMap[K]>((resolve, reject) => {
      if (this.#failure) {
        reject(this.#failure);
        return;
      }
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      try {
        this.#port.postMessage(make(id));
      } catch (error) {
        this.#pending.delete(id);
        const failure = error instanceof Error ? error : new Error(String(error));
        this.#fail(failure);
        reject(failure);
      }
    });
  }
}

export async function createWorkerJournal(): Promise<WorkerJournal> {
  const storage = createStorageWorker();
  let worker: Worker | null = null;
  let disconnect = () => {};
  let stopStorageFailure = () => {};
  try {
    // Verify storage before opening the diary, so startup can fall back cleanly.
    await storage.repository.readSnapshot();
    worker = new Worker(new URL('./journal.worker.ts', import.meta.url), { type: 'module' });
    const diaryWorker = worker;
    const journal = new WorkerJournal(worker as unknown as WorkerPort, storage.repository, () => {
      disconnect();
      stopStorageFailure();
      storage.close();
      diaryWorker.terminate();
    });
    const port = storage.connect();
    worker.postMessage({ event: 'storagePort', port }, [port]);
    stopStorageFailure = storage.onFailure((error) => {
      try {
        diaryWorker.postMessage({ event: 'storageFailure', error: error.message });
      } catch {}
    });
    disconnect = connectLocalJournal(worker);
    await journal.open();
    return journal;
  } catch (error) {
    disconnect();
    stopStorageFailure();
    storage.close();
    worker?.terminate();
    throw error;
  }
}
