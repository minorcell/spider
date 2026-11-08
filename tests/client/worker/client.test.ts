import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { blankSession } from '@/src/client/journal/session';
import { createDbRepository } from '@/src/client/storage/direct';
import type { PersistenceRepository } from '@/src/client/storage/repository';
import { createWorkerJournal, WorkerJournal, type WorkerPort } from '@/src/client/worker/client';
import type { JournalReply, JournalRequest, JournalState } from '@/src/client/worker/protocol';

const storage = vi.hoisted(() => ({
  repository: { readSnapshot: vi.fn(async () => null) },
  connect: vi.fn(() => ({}) as MessagePort),
  close: vi.fn(),
  onFailure: vi.fn(() => vi.fn()),
}));
vi.mock('@/src/client/storage/client', () => ({ createStorageWorker: () => storage }));
vi.mock('@/src/client/local/backend', () => ({ connectLocalJournal: vi.fn(() => vi.fn()) }));
let repository: PersistenceRepository;
beforeEach(() => {
  repository = createDbRepository();
});

const STATE: JournalState = {
  date: '2026-11-02',
  session: blankSession('2026-11-02'),
  behind: false,
  dismissed: false,
};

class Port implements WorkerPort {
  onmessage: ((event: MessageEvent<JournalReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: JournalRequest[] = [];

  postMessage(request: JournalRequest): void {
    this.requests.push(request);
  }

  get last(): JournalRequest {
    return this.requests[this.requests.length - 1];
  }

  respond(reply: JournalReply): void {
    this.onmessage?.({ data: reply } as MessageEvent<JournalReply>);
  }
}

function call<T>(port: Port, start: () => Promise<T>, value: unknown): Promise<T> {
  const pending = start();
  port.respond({ id: port.last.id, ok: true, value });
  return pending;
}

function open(port: Port): WorkerJournal {
  const journal = new WorkerJournal(port, repository);
  void journal.open();
  port.respond({ id: port.last.id, ok: true, value: STATE });
  return journal;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerJournal', () => {
  it('keeps the last state when a dismissal fails without an unhandled rejection', async () => {
    const port = new Port();
    const journal = open(port);
    await Promise.resolve();
    journal.dismissed = true;
    port.respond({ id: port.last.id, ok: false, error: 'worker unavailable' });
    await Promise.resolve();
    expect(journal.dismissed).toBe(false);
  });

  it('reads empty defaults before the worker answers', () => {
    const journal = new WorkerJournal(new Port(), repository);
    expect(journal.date).toBe('');
    expect(journal.session.messages).toEqual([]);
    expect(journal.behind()).toBe(false);
    expect(journal.dismissed).toBe(false);
  });

  it('opens and answers every journal call', async () => {
    const port = new Port();
    const journal = new WorkerJournal(port, repository);
    const opened = journal.open();
    expect(port.last).toEqual({ id: 1, method: 'open' });
    port.respond({ id: 1, ok: true, value: STATE });
    await opened;
    expect(journal.date).toBe('2026-11-02');
    expect(journal.session.messages).toEqual([]);

    expect(await call(port, () => journal.save(), STATE)).toBeUndefined();
    await call(
      port,
      () =>
        journal.record(
          [
            { role: 'user', content: '走' },
            { role: 'assistant', content: '好。' },
          ],
          {
            baseURL: 'x',
            model: 'm',
            apiKey: 'k',
            contextTokens: null,
            autoMemory: false,
            thinking: true,
          },
        ),
      { ...STATE, behind: true },
    );
    expect(port.last.method).toBe('record');
    expect((port.last as { args: unknown[] }).args[0]).toEqual([
      { role: 'user', content: '走' },
      { role: 'assistant', content: '好。' },
    ]);
    expect(journal.behind()).toBe(true);

    const settings = {
      baseURL: 'x',
      model: 'm',
      apiKey: 'k',
      contextTokens: null,
      autoMemory: false,
      thinking: true,
    };
    expect(await call(port, () => journal.digest(settings), STATE)).toBeUndefined();
    expect(await call(port, () => journal.backfill(settings), STATE)).toBeUndefined();
    expect(await call(port, () => journal.pages(), [])).toEqual([]);
    expect(await call(port, () => journal.read('2026-11-02'), null)).toBeNull();
    expect(
      await call(port, () => journal.write({ date: '2026-11-02', line: '行' }), {
        date: '2026-11-02',
        line: '行',
        noted: '',
        summary: '',
      }),
    ).toMatchObject({ line: '行' });
    const api = journal.api();
    expect(await call(port, () => api.list(), [{ date: 'd', description: 'l' }])).toEqual([
      { date: 'd', line: 'l' },
    ]);
    expect(await call(port, () => api.get('d'), null)).toBeNull();
    expect(
      await call(port, () => api.write({ date: 'd' }), {
        date: 'd',
        line: '',
        noted: '',
        summary: '',
      }),
    ).toMatchObject({ date: 'd' });
  });

  it('dismisses the leave dialog and records usage', async () => {
    const port = new Port();
    const journal = open(port);
    journal.dismissed = true;
    expect(port.last).toMatchObject({ method: 'dismiss', args: [true] });
    port.respond({ id: port.last.id, ok: true, value: { ...STATE, dismissed: true } });
    await Promise.resolve();
    expect(journal.dismissed).toBe(true);
  });

  it('sends usage and snapshots directly to storage while a digest is pending', async () => {
    const port = new Port();
    const journal = new WorkerJournal(port, repository);
    const digest = journal.digest({} as never);
    const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };
    const now = new Date('2026-11-02T10:00:00Z');
    await journal.recordUsage(usage, now, { kind: 'summary', modelId: 'm' });
    await journal.recordUsage(null);
    expect((await journal.readUsage('2026-11-02', '7')).today.total).toBeGreaterThanOrEqual(3);
    const call = (await journal.readUsage('2026-11-02')).requests[0];
    const recordCall = vi.spyOn(repository, 'recordUsageCall').mockResolvedValue();
    const recordCalls = vi.spyOn(repository, 'recordUsageCalls').mockResolvedValue();
    await journal.recordUsageCall(call);
    await journal.recordUsageCalls([call]);
    expect(recordCall).toHaveBeenCalledWith(call);
    expect(recordCalls).toHaveBeenCalledWith([call]);
    expect(await journal.readSnapshot()).toBeNull();
    const record = { id: 'current' } as never;
    await journal.putSnapshot(record);
    expect(await journal.readSnapshot()).toEqual(record);
    await journal.sweepSnapshots('2026-11-02');
    await journal.removeSnapshot();
    expect(await journal.readSnapshot()).toBeNull();
    expect(port.requests).toHaveLength(1);
    expect(port.last.method).toBe('digest');
    port.respond({ id: port.last.id, ok: true, value: STATE });
    await digest;
  });

  it('ignores unknown replies and rejects failed ones', async () => {
    const port = new Port();
    const journal = open(port);
    port.respond({ id: 999, ok: true, value: null });

    const pending = journal.pages();
    port.respond({ id: port.last.id, ok: false, error: 'no database' });
    await expect(pending).rejects.toThrow('no database');
  });

  it('rejects everything pending when the worker errors', async () => {
    const port = new Port();
    const journal = open(port);
    const pending = journal.pages();
    port.onerror?.({ message: 'worker died' } as ErrorEvent);
    await expect(pending).rejects.toThrow('worker died');
  });

  it('rejects when posting fails and does not leave a pending request', async () => {
    const port = new Port();
    port.postMessage = () => {
      throw new Error('cannot clone');
    };
    const journal = new WorkerJournal(port, repository);
    await expect(journal.pages()).rejects.toThrow('cannot clone');
    await expect(journal.pages()).rejects.toThrow('cannot clone');

    const plainPort = new Port();
    plainPort.postMessage = () => {
      throw 'cannot clone';
    };
    await expect(new WorkerJournal(plainPort, repository).pages()).rejects.toThrow('cannot clone');
  });

  it('starts the real worker from the page', async () => {
    class FakeWorker {
      static last: FakeWorker | null = null;
      onmessage: ((event: MessageEvent<JournalReply>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly url: URL;
      readonly options: WorkerOptions;

      constructor(url: URL, options: WorkerOptions) {
        this.url = url;
        this.options = options;
        FakeWorker.last = this;
      }

      postMessage(request: JournalRequest): void {
        queueMicrotask(() => {
          if (!('method' in request)) return;
          this.onmessage?.({
            data: { id: request.id, ok: true, value: STATE },
          } as MessageEvent<JournalReply>);
        });
      }
    }

    vi.stubGlobal('Worker', FakeWorker);
    const journal = await createWorkerJournal();
    expect(journal.date).toBe('2026-11-02');
    expect(FakeWorker.last?.url.pathname.endsWith('/journal.worker.ts')).toBe(true);
    expect(FakeWorker.last?.options).toEqual({ type: 'module' });
  });
});

it('relays storage failure and cleans up each connection when the diary worker fails', async () => {
  class Worker {
    static last: Worker;
    onmessage: ((event: MessageEvent<JournalReply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent) => void) | null = null;
    terminate = vi.fn();
    requests: unknown[] = [];
    constructor() {
      Worker.last = this;
    }
    postMessage(request: JournalRequest) {
      this.requests.push(request);
      if (!('method' in request)) return;
      queueMicrotask(() =>
        this.onmessage?.({
          data: { id: request.id, ok: true, value: STATE },
        } as MessageEvent<JournalReply>),
      );
    }
  }
  vi.stubGlobal('Worker', Worker);
  const journal = await createWorkerJournal();
  const listener = storage.onFailure.mock.calls.at(-1)![0] as (error: Error) => void;
  listener(new Error('storage died'));
  expect(Worker.last.requests).toContainEqual({ event: 'storageFailure', error: 'storage died' });
  Worker.last.postMessage = () => {
    throw new Error('diary gone');
  };
  expect(() => listener(new Error('storage died again'))).not.toThrow();
  Worker.last.onmessageerror?.({} as MessageEvent);
  Worker.last.onerror?.({ message: 'second failure' } as ErrorEvent);
  expect(Worker.last.terminate).toHaveBeenCalledOnce();
  await expect(journal.pages()).rejects.toThrow('无法读取');
});

it('cleans up before a diary Worker exists if storage readiness fails', async () => {
  storage.repository.readSnapshot.mockRejectedValueOnce(new Error('storage blocked'));
  await expect(createWorkerJournal()).rejects.toThrow('storage blocked');
  expect(storage.close).toHaveBeenCalled();
});

it('cleans up transferred connections if diary initialization fails', async () => {
  class Worker {
    static last: Worker;
    onmessage: ((event: MessageEvent<JournalReply>) => void) | null = null;
    onerror = null;
    terminate = vi.fn();
    constructor() {
      Worker.last = this;
    }
    postMessage(request: JournalRequest) {
      if (!('method' in request)) return;
      queueMicrotask(() =>
        this.onmessage?.({
          data: { id: request.id, ok: false, error: 'diary cannot open' },
        } as MessageEvent<JournalReply>),
      );
    }
  }
  vi.stubGlobal('Worker', Worker);
  await expect(createWorkerJournal()).rejects.toThrow('diary cannot open');
  expect(Worker.last.terminate).toHaveBeenCalledOnce();
});
