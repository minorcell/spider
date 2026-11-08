import { describe, expect, it, vi } from 'vitest';
import { attachJournalWorker, type WorkerScope } from '@/src/client/worker/attach';
import type { JournalRequest } from '@/src/client/worker/protocol';

function scope(): WorkerScope & { postMessage: ReturnType<typeof vi.fn> } {
  return { onmessage: null, postMessage: vi.fn() };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await Promise.resolve();
}

describe('attachJournalWorker', () => {
  it('answers a request with its value', async () => {
    const port = scope();
    attachJournalWorker(port, async () => ['a']);
    port.onmessage?.({
      data: { id: 4, method: 'pages' } satisfies JournalRequest,
    } as MessageEvent<JournalRequest>);
    await settle();
    expect(port.postMessage).toHaveBeenCalledWith({ id: 4, ok: true, value: ['a'] });
  });

  it('turns a thrown error into a failed reply', async () => {
    const port = scope();
    let call = 0;
    attachJournalWorker(port, async () => {
      call += 1;
      throw call === 1 ? new Error('boom') : 'plain';
    });
    const send = (id: number) =>
      port.onmessage?.({
        data: { id, method: 'open' } satisfies JournalRequest,
      } as MessageEvent<JournalRequest>);
    send(1);
    await settle();
    send(2);
    await settle();
    expect(port.postMessage).toHaveBeenNthCalledWith(1, {
      id: 1,
      ok: false,
      error: 'boom',
    });
    expect(port.postMessage).toHaveBeenNthCalledWith(2, {
      id: 2,
      ok: false,
      error: 'plain',
    });
  });
});

it('requires a storage bootstrap and propagates failures before connection', async () => {
  const port = scope();
  attachJournalWorker(port);
  const send = (data: unknown) => port.onmessage?.({ data } as MessageEvent<any>);
  send({ id: 1, method: 'open' });
  await settle();
  expect(port.postMessage).toHaveBeenLastCalledWith({
    id: 1,
    ok: false,
    error: expect.stringContaining('尚未连接'),
  });
  send({ event: 'storageFailure', error: 'storage failed' });
  send({ id: 2, method: 'open' });
  await settle();
  expect(port.postMessage).toHaveBeenLastCalledWith({ id: 2, ok: false, error: 'storage failed' });
  const storagePort = {
    onmessage: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    start: vi.fn(),
  };
  send({ event: 'storagePort', port: storagePort });
  send({ id: 3, method: 'open' });
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenLastCalledWith({
      id: 3,
      ok: false,
      error: 'storage failed',
    }),
  );
  expect(storagePort.postMessage).not.toHaveBeenCalled();
});

it('opens a diary through its direct storage port and rejects pending storage after worker failure', async () => {
  const port = scope();
  attachJournalWorker(port);
  const send = (data: unknown) => port.onmessage?.({ data } as MessageEvent<any>);
  let storage: {
    onmessage: ((event: MessageEvent) => void) | null;
    postMessage: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  };
  storage = {
    onmessage: null,
    start: vi.fn(),
    postMessage: vi.fn((request) => {
      if (request.method === 'loadSession')
        queueMicrotask(() =>
          storage.onmessage?.({
            data: { id: request.id, ok: true, value: undefined },
          } as MessageEvent),
        );
    }),
  };
  send({ event: 'storagePort', port: storage });
  send({ id: 1, method: 'open' });
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenCalledWith({
      id: 1,
      ok: true,
      value: expect.objectContaining({ behind: false }),
    }),
  );
  send({ id: 2, method: 'pages' });
  await vi.waitFor(() =>
    expect(storage.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'listMemories' }),
    ),
  );
  send({ event: 'storageFailure', error: 'storage died' });
  await vi.waitFor(() =>
    expect(port.postMessage).toHaveBeenLastCalledWith({ id: 2, ok: false, error: 'storage died' }),
  );
});

it('injects direct inference, including pending cancellation and bootstrap failure', async () => {
  const { localBackend } = await import('@/src/client/local/backend');
  const port = scope();
  attachJournalWorker(port);
  const send = (data: unknown) => port.onmessage?.({ data } as MessageEvent<any>);
  send({ event: 'inferenceFailure', error: 'unavailable before port' });
  await expect(localBackend()).rejects.toThrow('unavailable before port');
  const inference = { onmessage: null, onmessageerror: null, postMessage: vi.fn(), start: vi.fn() };
  send({ event: 'inferencePort', port: inference });
  const backend = await localBackend();
  const pending = backend.localComplete('diary', [], { kind: 'summary' });
  expect(inference.postMessage).toHaveBeenCalledWith(
    expect.objectContaining({ method: 'localComplete', args: ['diary', [], { kind: 'summary' }] }),
  );
  send({ event: 'inferenceFailure', error: 'inference died' });
  await expect(pending).rejects.toThrow('inference died');
  await expect((await localBackend()).localStatus()).rejects.toThrow('inference died');
});
