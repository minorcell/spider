import type { LanguageModelUsage } from 'ai';
import type { WorldRecord } from '../../shared/sim/snapshot.js';
import type { Journal } from '../journal/api.js';
import type { MemoryPage } from '../journal/db.js';
import type { MemoryApi, MemoryView, MemoryWrite } from '../journal/diary.js';
import { blankSession, type ChatSession, type Trace } from '../journal/session.js';
import type { SnapshotStore } from '../journal/store.js';
import type { UsageSnapshot } from '../journal/usage.js';
import type { PilotSettings } from '../settings.js';
import type { JournalReply, JournalRequest, JournalResultMap } from './protocol.js';

/** The slice of Worker the client needs. Tests supply their own. */
export interface WorkerPort {
  postMessage(message: JournalRequest): void;
  onmessage: ((event: MessageEvent<JournalReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface Waiter {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/** A Diary-shaped proxy whose methods are messages to the journal worker. */
export class WorkerJournal implements Journal, SnapshotStore {
  readonly #port: WorkerPort;
  readonly #pending = new Map<number, Waiter>();
  #seq = 0;
  #state: JournalResultMap['open'] | null = null;
  #failure: Error | null = null;

  constructor(port: WorkerPort) {
    this.#port = port;
    port.onmessage = (event) => this.#receive(event.data);
    port.onerror = (event) => this.#fail(new Error(event.message));
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
    void this.#call<'dismiss'>((id) => ({ id, method: 'dismiss', args: [value] })).then((state) => {
      this.#state = state;
    });
  }

  behind(): boolean {
    return this.#state?.behind ?? false;
  }

  async save(): Promise<void> {
    this.#state = await this.#call<'save'>((id) => ({ id, method: 'save' }));
  }

  async indexBlock(): Promise<string> {
    return this.#call<'indexBlock'>((id) => ({ id, method: 'indexBlock' }));
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

  async record(
    user: string,
    assistant: string,
    tools: Trace[],
    settings: PilotSettings,
  ): Promise<void> {
    this.#state = await this.#call<'record'>((id) => ({
      id,
      method: 'record',
      args: [user, assistant, tools, settings],
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

  async recordUsage(usage: LanguageModelUsage | null | undefined, now = new Date()): Promise<void> {
    this.#state = await this.#call<'recordUsage'>((id) => ({
      id,
      method: 'recordUsage',
      args: [usage, now.getTime()],
    }));
  }

  async readUsage(today: string): Promise<UsageSnapshot> {
    return this.#call<'readUsage'>((id) => ({ id, method: 'readUsage', args: [today] }));
  }

  async readSnapshot(): Promise<unknown> {
    return this.#call<'snapshotRead'>((id) => ({ id, method: 'snapshotRead' }));
  }

  async putSnapshot(record: WorldRecord): Promise<void> {
    await this.#call<'snapshotPut'>((id) => ({ id, method: 'snapshotPut', args: [record] }));
  }

  async removeSnapshot(): Promise<void> {
    await this.#call<'snapshotRemove'>((id) => ({ id, method: 'snapshotRemove' }));
  }

  async sweepSnapshots(today: string): Promise<void> {
    await this.#call<'snapshotSweep'>((id) => ({
      id,
      method: 'snapshotSweep',
      args: [today],
    }));
  }

  #receive(reply: JournalReply): void {
    const waiter = this.#pending.get(reply.id);
    if (!waiter) return;
    this.#pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error));
  }

  #fail(error: Error): void {
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
        this.#failure ??= failure;
        reject(failure);
      }
    });
  }
}

/** Start the browser worker and wait for its first state. */
export async function createWorkerJournal(): Promise<WorkerJournal> {
  const worker = new Worker(new URL('./journal.worker.ts', import.meta.url), { type: 'module' });
  const journal = new WorkerJournal(worker as unknown as WorkerPort);
  await journal.open();
  return journal;
}
