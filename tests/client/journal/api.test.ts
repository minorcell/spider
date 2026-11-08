import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSpiderDb } from '@/src/client/storage/db';
import { Diary } from '@/src/client/journal/diary';
import { openJournal } from '@/src/client/journal/api';
import { WorkerJournal } from '@/src/client/worker/client';
import type { JournalReply, JournalRequest } from '@/src/client/worker/protocol';
import { blankSession } from '@/src/client/journal/session';

vi.mock('@/src/client/local/backend', () => ({ connectLocalJournal: () => () => {} }));
vi.mock('@/src/client/storage/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/client/storage/client')>();
  const { createDbRepository } = await import('@/src/client/storage/direct');
  return {
    ...actual,
    createStorageWorker: () => ({
      repository: createDbRepository(),
      connect: () => ({}) as MessagePort,
      close() {},
      onFailure: () => () => {},
    }),
  };
});

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
      if (!('method' in request)) return;
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
