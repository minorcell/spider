import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '../../../src/client/journal/db.js';
import { Diary } from '../../../src/client/journal/diary.js';
import { openJournal } from '../../../src/client/journal/api.js';
import { WorkerJournal } from '../../../src/client/worker/client.js';
import type { JournalReply, JournalRequest } from '../../../src/client/worker/protocol.js';
import { blankSession } from '../../../src/client/journal/session.js';

const STATE = {
  date: '2026-11-02',
  session: blankSession('2026-11-02'),
  behind: false,
  dismissed: false,
};

class FakeWorker {
  onmessage: ((event: MessageEvent<JournalReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(request: JournalRequest): void {
    queueMicrotask(() => {
      this.onmessage?.({
        data: { id: request.id, ok: true, value: STATE },
      } as MessageEvent<JournalReply>);
    });
  }
}

function BrokenWorker(): never {
  throw new Error('worker blocked');
}

beforeEach(async () => {
  await resetSpiderDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openJournal', () => {
  it('opens a Diary and a direct snapshot store without a Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    const { journal, store } = await openJournal();
    expect(journal).toBeInstanceOf(Diary);
    expect(await store.readSnapshot()).toBeNull();
  });

  it('uses the worker when the page has one', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const { journal, store } = await openJournal();
    expect(journal).toBeInstanceOf(WorkerJournal);
    expect(store).toBe(journal);
    expect(journal.date).toBe('2026-11-02');
  });

  it('falls back to direct storage when a worker cannot start', async () => {
    vi.stubGlobal('Worker', BrokenWorker);
    const { journal, store } = await openJournal();
    expect(journal).toBeInstanceOf(Diary);
    expect(await store.readSnapshot()).toBeNull();
  });
});
