import { MessageChannel } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDbRepository } from '@/src/client/storage/direct';
import { resetSpiderDb } from '@/src/client/storage/db';
import {
  StorageClient,
  createStorageWorker,
  type StorageClientPort,
} from '@/src/client/storage/client';
import {
  attachStoragePort,
  createStorageHandler,
  type StorageServerPort,
} from '@/src/client/storage/handler';
import type { StorageReply } from '@/src/client/storage/protocol';
import { Diary } from '@/src/client/journal/diary';
import { blankSession } from '@/src/client/journal/session';
import { usageCallFromUsage } from '@/src/client/journal/usage';
import { captureBody, type WorldRecord } from '@/src/shared/sim/snapshot';
import { SimSession } from '@/src/shared/sim/session';
import type { PilotSettings } from '@/src/client/settings';

vi.mock('@/src/client/journal/summarize', () => ({ summarizeDiary: vi.fn() }));
const settings: PilotSettings = {
  provider: 'custom',
  baseURL: 'https://example.com',
  model: 'model',
  apiKey: 'key',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};
const now = new Date(2026, 10, 2, 12);
const usage = { inputTokens: 2, outputTokens: 3, totalTokens: 5 };
const resources: Array<{ close(): void }> = [];
function connect(handle = createStorageHandler(createDbRepository())): StorageClient {
  const channel = new MessageChannel();
  resources.push(channel.port1, channel.port2);
  attachStoragePort(channel.port1 as unknown as StorageServerPort, handle);
  const client = new StorageClient(channel.port2 as unknown as StorageClientPort);
  resources.push(client);
  return client;
}
function snapshot(seq: number): WorldRecord {
  return {
    ...captureBody(new SimSession(5, undefined, now.getTime()), null),
    id: 'current',
    format: 4,
    savedAt: 1,
    day: '2026-11-02',
    owner: 'test',
    seq,
    leaseUntil: 99,
  };
}
beforeEach(resetSpiderDb);
afterEach(() => {
  for (const resource of resources.splice(0)) resource.close();
  vi.unstubAllGlobals();
});

describe('storage MessagePort boundary', () => {
  it('round trips every typed persistence method with ordering across ports', async () => {
    const handle = createStorageHandler(createDbRepository());
    const client = connect(handle);
    const other = connect(handle);
    await client.saveSession(blankSession('2026-11-02'));
    expect(await client.loadSession('2026-11-02')).toEqual(blankSession('2026-11-02'));
    expect(await client.getMemory('missing')).toBeNull();
    await Promise.all([
      client.patchMemory({ date: '2026-11-02', noted: 'keep' }),
      other.patchMemory({ date: '2026-11-02', summary: 'new' }),
    ]);
    expect(await client.listMemories()).toEqual([
      expect.objectContaining({ noted: 'keep', summary: 'new' }),
    ]);
    await client.recordUsage(null);
    await client.recordUsage(usage, now);
    const call = usageCallFromUsage(usage, now)!;
    await client.recordUsageCall(call);
    await client.recordUsageCalls([{ ...call, id: 'batch' }]);
    expect((await client.readUsage('2026-11-02', '7')).today.total).toBe(15);
    const writing = client.putSnapshot(snapshot(1));
    const replacing = client.putSnapshot(snapshot(2));
    const reading = client.readSnapshot();
    await Promise.all([writing, replacing]);
    expect(await reading).toEqual(snapshot(2));
    await client.sweepSnapshots('2026-11-02');
    await client.removeSnapshot();
    expect(await client.readSnapshot()).toBeNull();
    const sessionOne = { ...blankSession('2026-11-02'), updatedAt: 1 };
    const sessionTwo = { ...sessionOne, updatedAt: 2 };
    await Promise.all([client.saveSession(sessionOne), client.saveSession(sessionTwo)]);
    expect(await client.loadSession('2026-11-02')).toEqual(sessionTwo);
  });

  it('serves usage and snapshots while Diary awaits inference, preserving a concurrent note', async () => {
    const client = connect();
    const diary = await Diary.open(now, client);
    await diary.record([{ role: 'user', content: 'hello' }], settings);
    const { summarizeDiary } = await import('@/src/client/journal/summarize');
    let finish!: (value: { line: string; summary: string }) => void;
    const started = Promise.withResolvers<void>();
    vi.mocked(summarizeDiary).mockImplementationOnce(() => {
      started.resolve();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const pending = diary.digest(settings);
    await started.promise;
    await diary.write({ date: diary.date, noted: 'written during summary' });
    await diary.recordUsage(usage, now);
    await diary.recordUsageCall(usageCallFromUsage(usage, now)!);
    await diary.recordUsageCalls([]);
    expect((await diary.readUsage(diary.date)).today.total).toBe(10);
    await client.putSnapshot(snapshot(7));
    expect(await client.readSnapshot()).toEqual(snapshot(7));
    finish({ line: 'digest line', summary: 'digest summary' });
    await pending;
    expect(await diary.read(diary.date)).toMatchObject({
      noted: 'written during summary',
      line: 'digest line',
      summary: 'digest summary',
    });
    expect(diary.behind()).toBe(false);
  });

  it('returns request errors and continues serving after failure', async () => {
    const repository = createDbRepository();
    vi.spyOn(repository, 'getMemory')
      .mockRejectedValueOnce('blocked')
      .mockRejectedValueOnce(new Error('unavailable'));
    const client = connect(createStorageHandler(repository));
    await expect(client.getMemory('date')).rejects.toThrow('blocked');
    await expect(client.getMemory('date')).rejects.toThrow('unavailable');
    expect(await client.getMemory('date')).toBeNull();
    await expect(
      createStorageHandler(repository)({ id: 1, method: 'unknown', args: [] } as never),
    ).rejects.toThrow('Unknown storage method');
  });
});

function fakePort(): StorageClientPort {
  return { onmessage: null, onmessageerror: null, postMessage: vi.fn() };
}

describe('storage client lifecycle', () => {
  it('ignores stale replies and rejects all pending and future requests on close', async () => {
    const port = fakePort();
    const client = new StorageClient(port);
    const first = expect(client.readSnapshot()).rejects.toThrow('Storage connection closed');
    const second = expect(client.listMemories()).rejects.toThrow('Storage connection closed');
    port.onmessage!({ data: { id: 999, ok: true, value: 'late' } } as MessageEvent<StorageReply>);
    client.close();
    await Promise.all([first, second]);
    client.fail(new Error('later'));
    await expect(client.readSnapshot()).rejects.toThrow('Storage connection closed');
  });

  it.each([new Error('clone failed'), 'clone failed'])(
    'latches synchronous post failures: %s',
    async (failure) => {
      const port = fakePort();
      port.postMessage = () => {
        throw failure;
      };
      const client = new StorageClient(port);
      await expect(client.readSnapshot()).rejects.toThrow('clone failed');
      await expect(client.readSnapshot()).rejects.toThrow('clone failed');
    },
  );

  it('rejects undecodable replies', async () => {
    const port = fakePort();
    const client = new StorageClient(port);
    const pending = expect(client.readSnapshot()).rejects.toThrow('could not be decoded');
    port.onmessageerror!({} as MessageEvent);
    await pending;
  });
});

class FakeStorageWorker {
  static last: FakeStorageWorker;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  handler = createStorageHandler(createDbRepository());
  constructor() {
    FakeStorageWorker.last = this;
  }
  postMessage(message: { event: string; port: MessagePort }, _transfer: unknown[]) {
    resources.push(message.port);
    attachStoragePort(message.port, this.handler);
  }
}

describe('storage Worker owner', () => {
  it('creates ports, reports failure to every subscriber, and terminates on close', async () => {
    vi.stubGlobal('Worker', FakeStorageWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
    const worker = createStorageWorker();
    const extra = worker.connect();
    resources.push(extra);
    const extraClient = new StorageClient(extra);
    resources.push(extraClient);
    expect(await worker.repository.readSnapshot()).toBeNull();
    expect(await extraClient.readSnapshot()).toBeNull();
    const listener = vi.fn();
    const unsubscribe = worker.onFailure(listener);
    unsubscribe();
    const heard = vi.fn((error: Error) => extraClient.fail(error));
    worker.onFailure(heard);
    const pending = expect(extraClient.readSnapshot()).rejects.toThrow('worker died');
    FakeStorageWorker.last.onerror!({ message: 'worker died' } as ErrorEvent);
    FakeStorageWorker.last.onmessageerror!();
    await pending;
    expect(FakeStorageWorker.last.terminate).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(heard).toHaveBeenCalledOnce();
    const late = vi.fn();
    worker.onFailure(late);
    expect(late).toHaveBeenCalledWith(expect.objectContaining({ message: 'worker died' }));
    await expect(worker.repository.readSnapshot()).rejects.toThrow('worker died');
    worker.close();
    expect(FakeStorageWorker.last.terminate).toHaveBeenCalledOnce();
  });

  it.each(['empty error', 'message error', 'close'])('handles %s', async (reason) => {
    vi.stubGlobal('Worker', FakeStorageWorker);
    vi.stubGlobal('MessageChannel', MessageChannel);
    const worker = createStorageWorker();
    const heard = vi.fn();
    worker.onFailure(heard);
    if (reason === 'empty error') FakeStorageWorker.last.onerror!({ message: '' } as ErrorEvent);
    else if (reason === 'message error') FakeStorageWorker.last.onmessageerror!();
    else worker.close();
    expect(heard).toHaveBeenCalledOnce();
    await expect(worker.repository.readSnapshot()).rejects.toThrow();
    worker.close();
  });

  it('terminates the Worker when connecting a port throws', () => {
    vi.stubGlobal('Worker', FakeStorageWorker);
    vi.stubGlobal(
      'MessageChannel',
      class {
        constructor() {
          throw new Error('ports unavailable');
        }
      },
    );
    expect(createStorageWorker).toThrow('ports unavailable');
    expect(FakeStorageWorker.last.terminate).toHaveBeenCalledOnce();
  });
});
