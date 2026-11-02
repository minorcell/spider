import { afterEach, describe, expect, it, vi } from 'vitest';
import { blankSession } from '../../../src/client/journal/session.js';
import {
  createWorkerJournal,
  WorkerJournal,
  type WorkerPort,
} from '../../../src/client/worker/client.js';
import type {
  JournalReply,
  JournalRequest,
  JournalState,
} from '../../../src/client/worker/protocol.js';

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

/** Fire one call, take the request it posted, and answer it. */
function call<T>(port: Port, start: () => Promise<T>, value: unknown): Promise<T> {
  const pending = start();
  port.respond({ id: port.last.id, ok: true, value });
  return pending;
}

function open(port: Port): WorkerJournal {
  const journal = new WorkerJournal(port);
  void journal.open();
  port.respond({ id: port.last.id, ok: true, value: STATE });
  return journal;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WorkerJournal', () => {
  it('reads empty defaults before the worker answers', () => {
    const journal = new WorkerJournal(new Port());
    expect(journal.date).toBe('');
    expect(journal.session.turns).toEqual([]);
    expect(journal.behind()).toBe(false);
    expect(journal.dismissed).toBe(false);
  });

  it('opens and answers every journal call', async () => {
    const port = new Port();
    const journal = new WorkerJournal(port);
    const opened = journal.open();
    expect(port.last).toEqual({ id: 1, method: 'open' });
    port.respond({ id: 1, ok: true, value: STATE });
    await opened;
    expect(journal.date).toBe('2026-11-02');
    expect(journal.session.turns).toEqual([]);

    expect(await call(port, () => journal.save(), STATE)).toBeUndefined();
    await call(
      port,
      () =>
        journal.record('走', '好。', [], {
          baseURL: 'x',
          model: 'm',
          apiKey: 'k',
          contextTokens: null,
          compact: false,
          compactKb: null,
          autoMemory: false,
        }),
      { ...STATE, behind: true },
    );
    expect(port.last.method).toBe('record');
    expect((port.last as { args: unknown[] }).args.slice(0, 3)).toEqual(['走', '好。', []]);
    expect(journal.behind()).toBe(true);

    const settings = {
      baseURL: 'x',
      model: 'm',
      apiKey: 'k',
      contextTokens: null,
      compact: false,
      compactKb: null,
      autoMemory: false,
    };
    expect(await call(port, () => journal.digest(settings), STATE)).toBeUndefined();
    expect(await call(port, () => journal.backfill(settings), STATE)).toBeUndefined();
    expect(await call(port, () => journal.indexBlock(), '目录')).toBe('目录');
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

    const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 };
    const now = new Date('2026-11-02T10:00:00Z');
    await call(port, () => journal.recordUsage(usage, now), STATE);
    expect(port.last).toMatchObject({
      method: 'recordUsage',
      args: [usage, now.getTime()],
    });
    await call(
      port,
      () => journal.recordUsage(usage, now, { kind: 'summary', modelId: 'm' }),
      STATE,
    );
    expect(port.last).toMatchObject({
      method: 'recordUsage',
      args: [usage, now.getTime(), { kind: 'summary', modelId: 'm' }],
    });
    expect(await call(port, () => journal.readUsage('2026-11-02'), { days: [] })).toEqual({
      days: [],
    });

    const recorded = {
      id: 'c1:0',
      ts: now.getTime(),
      date: '2026-11-02',
      kind: 'agent' as const,
      sessionId: '2026-11-02',
      turnId: 't',
      step: 0,
      provider: 'openai-compatible',
      modelId: 'deepseek-chat',
      total: 3,
      input: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      output: { total: 2, text: 2, reasoning: 0 },
      tools: [],
      timing: { responseMs: 10, stepMs: 12 },
      finishReason: 'stop',
    };
    await call(port, () => journal.recordUsageCall(recorded), STATE);
    expect(port.last).toMatchObject({ method: 'recordUsageCall', args: [recorded] });
    await call(port, () => journal.recordUsageCalls([recorded]), null);
    expect(port.last).toMatchObject({ method: 'recordUsageCalls', args: [[recorded]] });
    expect(await call(port, () => journal.readUsage('2026-11-02', '7'), { range: '7' })).toEqual({
      range: '7',
    });
  });

  it('proxies the snapshot store', async () => {
    const port = new Port();
    const journal = open(port);
    const record = { id: 'current' } as never;
    expect(await call(port, () => journal.readSnapshot(), null)).toBeNull();
    await call(port, () => journal.putSnapshot(record), null);
    expect(port.last).toMatchObject({ method: 'snapshotPut', args: [record] });
    await call(port, () => journal.removeSnapshot(), null);
    expect(port.last).toMatchObject({ method: 'snapshotRemove' });
    await call(port, () => journal.sweepSnapshots('2026-11-02'), null);
    expect(port.last).toMatchObject({ method: 'snapshotSweep', args: ['2026-11-02'] });
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
    const journal = new WorkerJournal(port);
    await expect(journal.pages()).rejects.toThrow('cannot clone');
    await expect(journal.pages()).rejects.toThrow('cannot clone');

    const plainPort = new Port();
    plainPort.postMessage = () => {
      throw 'cannot clone';
    };
    await expect(new WorkerJournal(plainPort).pages()).rejects.toThrow('cannot clone');
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
