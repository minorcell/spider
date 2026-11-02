import { describe, expect, it, vi } from 'vitest';
import { attachJournalWorker, type WorkerScope } from '../../../src/client/worker/attach.js';
import type { JournalRequest } from '../../../src/client/worker/protocol.js';

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
