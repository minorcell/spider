import { expect, it, vi } from 'vitest';
import { WorkerLocalBackend, type LocalPort } from '@/src/client/local/workerClient';
import { attachInferenceWorker, type InferenceScope } from '@/src/client/local/workerAttach';
import type {
  LocalControl,
  LocalRequest,
  LocalReplyMessage,
} from '@/src/client/local/workerProtocol';
import type { LocalBackend, LocalReply } from '@/src/client/local/types';

function pair() {
  const client: LocalPort = {
    onmessage: null,
    postMessage(request) {
      server.onmessage?.({ data: request } as MessageEvent<LocalRequest>);
    },
  };
  const server = {
    onmessage: null as ((event: MessageEvent<LocalRequest>) => void) | null,
    postMessage(reply: LocalReplyMessage) {
      client.onmessage?.({ data: reply } as MessageEvent<LocalReplyMessage>);
    },
    start: vi.fn(),
    close: vi.fn(),
  };
  return { client, server };
}
function setup() {
  const main = pair();
  const diary = pair();
  const scope = main.server as unknown as InferenceScope;
  const runtime: Required<LocalBackend> = {
    localSession: vi.fn(async () => {}),
    localLoad: vi.fn(async () => {}),
    localStatus: vi.fn(async () => ({ ready: true, text: 'ready' })),
    localUnload: vi.fn(async () => {}),
    localCancel: vi.fn(async () => {}),
    localComplete: vi.fn(async (_id, _messages, _options, onDelta) => {
      onDelta?.('answer');
      return { text: 'answer', input: 1, output: 2 };
    }),
  };
  attachInferenceWorker(scope, runtime);
  const send = (data: LocalControl) => scope.onmessage?.({ data } as MessageEvent<LocalControl>);
  send({ event: 'connect', key: 1, port: diary.server as unknown as MessagePort });
  return {
    main: new WorkerLocalBackend(main.client),
    diary: new WorkerLocalBackend(diary.client),
    runtime,
    send,
    diaryPort: diary.server,
  };
}

it('dispatches both endpoints to one runtime without waiting for a pending summary', async () => {
  const { main, diary, runtime } = setup();
  await main.localLoad({ cachedOnly: true });
  expect(runtime.localLoad).toHaveBeenCalledWith({ cachedOnly: true });
  let finish!: (value: LocalReply) => void;
  vi.mocked(runtime.localComplete).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const summary = diary.localComplete('same', [], { kind: 'summary' });
  expect(await main.localStatus()).toMatchObject({ ready: true });
  const delta = vi.fn();
  await expect(main.localComplete('same', [], undefined, delta)).resolves.toMatchObject({
    text: 'answer',
  });
  expect(delta).toHaveBeenCalledExactlyOnceWith('answer');
  const ids = vi.mocked(runtime.localComplete).mock.calls.map((call) => call[0]);
  expect(ids[0]).not.toBe(ids[1]);
  await main.localCancel('same');
  expect(runtime.localCancel).toHaveBeenLastCalledWith(ids[1]);
  await diary.localCancel('same');
  expect(runtime.localCancel).toHaveBeenLastCalledWith(ids[0]);
  finish({ text: 'summary', input: 1, output: 1 });
  await summary;
  await main.localUnload();
  expect(runtime.localUnload).toHaveBeenCalledOnce();
});

it('releases sessions and cancels pending work when a diary disconnects', async () => {
  const { diary, runtime, send, diaryPort } = setup();
  await diary.localSession('turn', true);
  await diary.localSession('done', false);
  let finish!: (value: LocalReply) => void;
  vi.mocked(runtime.localComplete).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  void diary.localComplete('pending', [], undefined, vi.fn());
  send({ event: 'disconnect', key: 1 });
  expect(runtime.localCancel).toHaveBeenCalledWith(JSON.stringify([2, 'pending']));
  expect(runtime.localSession).toHaveBeenLastCalledWith(JSON.stringify([2, 'turn']), false);
  expect(diaryPort.close).toHaveBeenCalledOnce();
  finish({ text: 'late', input: 0, output: 0 });
  await Promise.resolve();
  send({ event: 'disconnect', key: 999 });
});

it('replaces connections, forwards named errors, and handles plain thrown values', async () => {
  const { main, runtime, send, diaryPort } = setup();
  send({ event: 'connect', key: 1, port: pair().server as unknown as MessagePort });
  expect(diaryPort.close).toHaveBeenCalledOnce();
  vi.mocked(runtime.localComplete).mockRejectedValueOnce(new DOMException('stopped', 'AbortError'));
  await expect(main.localComplete('abort', [])).rejects.toMatchObject({ name: 'AbortError' });
  vi.mocked(runtime.localLoad).mockRejectedValueOnce('plain error');
  await expect(main.localLoad()).rejects.toThrow('plain error');
});

it('accepts runtimes without sessions and ignores disconnect cleanup failures', async () => {
  const { diary, runtime, send } = setup();
  runtime.localSession = undefined as never;
  await diary.localSession('ignored', true);
  let reject!: (error: unknown) => void;
  vi.mocked(runtime.localComplete).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  void diary.localComplete('pending', [], undefined, vi.fn());
  vi.mocked(runtime.localCancel).mockRejectedValueOnce(new Error('already closed'));
  send({ event: 'disconnect', key: 1 });
  reject(new Error('late'));
  await Promise.resolve();
});

it('forwards ordinary Error names', async () => {
  const { main, runtime } = setup();
  vi.mocked(runtime.localLoad).mockRejectedValueOnce(new Error('download failed'));
  await expect(main.localLoad()).rejects.toThrow('download failed');
});

it('ignores a failed session release when the diary disconnects', async () => {
  const { diary, runtime, send } = setup();
  await diary.localSession('turn', true);
  vi.mocked(runtime.localSession).mockRejectedValueOnce(new Error('already closed'));
  send({ event: 'disconnect', key: 1 });
  await Promise.resolve();
});
