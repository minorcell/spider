import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  LocalControl,
  LocalReplyMessage,
  LocalRequest,
} from '@/src/client/local/workerProtocol';
import type { JournalControl } from '@/src/client/worker/protocol';

class FakeWorker {
  static all: FakeWorker[] = [];
  static failure: unknown = null;
  onmessage: ((event: MessageEvent<LocalReplyMessage>) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  requests: (LocalRequest | LocalControl)[] = [];
  terminate = vi.fn();
  answer = true;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    if (FakeWorker.failure) throw FakeWorker.failure;
    FakeWorker.all.push(this);
  }
  postMessage(request: LocalRequest | LocalControl) {
    this.requests.push(request);
    if (!('method' in request) || !this.answer) return;
    queueMicrotask(() =>
      this.onmessage?.({
        data: { id: request.id, ok: true, value: { ready: false, text: 'not loaded' } },
      } as MessageEvent<LocalReplyMessage>),
    );
  }
}
class Channel {
  static all: Channel[] = [];
  port1 = { close: vi.fn() };
  port2 = { close: vi.fn() };
  constructor() {
    Channel.all.push(this);
  }
}
beforeEach(() => {
  vi.resetModules();
  FakeWorker.all = [];
  FakeWorker.failure = null;
  Channel.all = [];
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('MessageChannel', Channel);
});
afterEach(() => vi.unstubAllGlobals());

it('starts one inference Worker lazily and transfers a dedicated port to each diary', async () => {
  const bridge = await import('@/src/client/local/backend');
  expect(FakeWorker.all).toHaveLength(0);
  const client = await bridge.localBackend();
  expect(await bridge.localBackend()).toBe(client);
  const first = { postMessage: vi.fn() };
  const second = { postMessage: vi.fn() };
  const stop = bridge.connectLocalJournal(first);
  bridge.connectLocalJournal(second);
  expect(FakeWorker.all).toHaveLength(1);
  const worker = FakeWorker.all[0];
  expect(worker.url.pathname).toMatch(/\/inference.worker.ts$/);
  expect(worker.options).toEqual({ type: 'module' });
  expect(first.postMessage).toHaveBeenCalledWith(
    { event: 'inferencePort', port: Channel.all[0].port2 },
    [Channel.all[0].port2],
  );
  expect(
    worker.requests.filter((request) => 'event' in request && request.event === 'connect'),
  ).toHaveLength(2);
  await client.localStatus();
  stop();
  expect(worker.requests).toContainEqual({ event: 'disconnect', key: 1 });
  worker.onerror?.({ message: 'GPU worker crashed' } as ErrorEvent);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(second.postMessage).toHaveBeenLastCalledWith({
    event: 'inferenceFailure',
    error: 'GPU worker crashed',
  });
  expect(first.postMessage).toHaveBeenCalledOnce();
  await expect(client.localLoad()).rejects.toThrow('GPU worker crashed');
  const late = { postMessage: vi.fn() };
  bridge.connectLocalJournal(late);
  await vi.waitFor(() =>
    expect(late.postMessage).toHaveBeenLastCalledWith({
      event: 'inferenceFailure',
      error: 'GPU worker crashed',
    }),
  );
});

it('relays fatal errors even if one diary is gone, and tolerates failed cleanup', async () => {
  const bridge = await import('@/src/client/local/backend');
  let failSend = false;
  const diary = {
    postMessage: vi.fn(() => {
      if (failSend) throw new Error('diary gone');
    }),
  };
  const stop = bridge.connectLocalJournal(diary);
  await Promise.resolve();
  failSend = true;
  const worker = FakeWorker.all[0];
  worker.onmessageerror?.({} as MessageEvent);
  worker.postMessage = () => {
    throw new Error('worker gone');
  };
  expect(stop).not.toThrow();
});

it.each(['worker', 'document', 'channel'])(
  'reports unavailable %s support without inference on the page',
  async (missing) => {
    const bridge = await import('@/src/client/local/backend');
    if (missing === 'worker') vi.stubGlobal('Worker', undefined);
    if (missing === 'document') vi.stubGlobal('document', undefined);
    if (missing === 'channel') vi.stubGlobal('MessageChannel', undefined);
    const diary = { postMessage: vi.fn() };
    const disconnect = bridge.connectLocalJournal(diary);
    expect(diary.postMessage).toHaveBeenCalledWith({
      event: 'inferenceFailure',
      error: expect.stringContaining('需要后台线程'),
    });
    expect(FakeWorker.all).toHaveLength(0);
    disconnect();
    if (missing !== 'channel') await expect(bridge.localBackend()).rejects.toThrow('需要后台线程');
  },
);

it.each([new Error('blocked'), 'blocked'])(
  'reports startup failure %s even if reporting is blocked',
  async (failure) => {
    const bridge = await import('@/src/client/local/backend');
    FakeWorker.failure = failure;
    const diary = {
      postMessage: vi.fn(() => {
        throw new Error('diary gone');
      }),
    };
    expect(() => bridge.connectLocalJournal(diary)).not.toThrow();
    expect(diary.postMessage).toHaveBeenCalledWith({ event: 'inferenceFailure', error: 'blocked' });
  },
);

it('closes both ports and disconnects inference if the diary port cannot be transferred', async () => {
  const bridge = await import('@/src/client/local/backend');
  const diary = {
    postMessage(message: JournalControl) {
      if (message.event === 'inferencePort') throw new Error('cannot transfer');
    },
  };
  bridge.connectLocalJournal(diary);
  expect(Channel.all[0].port1.close).toHaveBeenCalledOnce();
  expect(Channel.all[0].port2.close).toHaveBeenCalledOnce();
  expect(FakeWorker.all[0].requests).toContainEqual({ event: 'disconnect', key: 1 });
});

it('retains an explicit unavailable backend error', async () => {
  const bridge = await import('@/src/client/local/backend');
  bridge.useLocalBackend(new Error('inference unavailable'));
  await expect(bridge.localBackend()).rejects.toThrow('inference unavailable');
});
