import { expect, it, vi } from 'vitest';
import { onLocalBusy, setLocalBusy } from '@/src/client/local/activity';
import { WorkerLocalBackend, type LocalPort } from '@/src/client/local/workerClient';
import type { LocalReplyMessage, LocalRequest } from '@/src/client/local/workerProtocol';

class Port implements LocalPort {
  onmessage: ((event: MessageEvent<LocalReplyMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  requests: LocalRequest[] = [];
  postMessage(request: LocalRequest): void {
    this.requests.push(request);
  }
  get last(): LocalRequest {
    return this.requests[this.requests.length - 1];
  }
  respond(reply: LocalReplyMessage): void {
    this.onmessage?.({ data: reply } as MessageEvent<LocalReplyMessage>);
  }
}
function call<T>(port: Port, start: () => Promise<T>, value: unknown): Promise<T> {
  const pending = start();
  port.respond({ id: port.last.id, ok: true, value });
  return pending;
}

it('routes local model lifecycle and inference through the dedicated inference worker', async () => {
  const port = new Port();
  const journal = new WorkerLocalBackend(port, setLocalBusy);
  await call(port, () => journal.localSession('turn', true), undefined);
  expect(port.last).toMatchObject({ method: 'localSession', args: ['turn', true] });
  await call(port, () => journal.localLoad(), undefined);
  expect(port.last).toMatchObject({ method: 'localLoad', args: [undefined] });
  await call(port, () => journal.localLoad({ cachedOnly: true }), undefined);
  expect(port.last).toMatchObject({ method: 'localLoad', args: [{ cachedOnly: true }] });
  expect(await call(port, () => journal.localStatus(), { ready: true, text: 'ready' })).toEqual({
    ready: true,
    text: 'ready',
  });
  const messages = [{ role: 'user' as const, content: '走' }];
  expect(
    await call(port, () => journal.localComplete('one', messages), {
      text: 'ok',
      input: 1,
      output: 1,
    }),
  ).toMatchObject({ text: 'ok' });
  expect(port.last).toMatchObject({ method: 'localComplete', args: ['one', messages] });
  await call(port, () => journal.localCancel('one'), undefined);
  expect(port.last).toMatchObject({ method: 'localCancel', args: ['one'] });
  await call(port, () => journal.localUnload(), undefined);
  expect(port.last.method).toBe('localUnload');
});

it('routes only matching stream deltas and resets rendering activity on worker failure', async () => {
  const port = new Port();
  const journal = new WorkerLocalBackend(port, setLocalBusy);
  const delta = vi.fn();
  const activity = vi.fn();
  const stop = onLocalBusy(activity);
  const pending = journal.localComplete('one', [], { kind: 'action' }, delta);
  expect(port.last).toMatchObject({ stream: true, args: ['one', [], { kind: 'action' }] });
  port.respond({ event: 'localActivity', busy: true });
  port.respond({ event: 'localDelta', id: port.last.id + 1, text: 'other request' });
  port.respond({ event: 'localDelta', id: port.last.id, text: '答：好了' });
  expect(delta).toHaveBeenCalledExactlyOnceWith('答：好了');
  const failed = expect(pending).rejects.toThrow('worker failed');
  port.onerror?.({ message: 'worker failed' } as ErrorEvent);
  await failed;
  expect(activity.mock.calls.map((call) => call[0])).toEqual([false, true, false]);
  stop();
});

it('preserves cancellation errors and ignores replies after fatal failure', async () => {
  const port = new Port();
  const failed = vi.fn();
  const client = new WorkerLocalBackend(port, undefined, failed);
  const pending = client.localComplete('x', []);
  port.respond({ id: port.last.id, ok: false, error: 'stopped', name: 'AbortError' });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  const next = client.localStatus();
  port.respond({ event: 'failure', error: 'GPU worker gone' });
  await expect(next).rejects.toThrow('GPU worker gone');
  await expect(client.localLoad()).rejects.toThrow('GPU worker gone');
  port.respond({ event: 'localDelta', id: port.last.id, text: 'late' });
  client.fail(new Error('second'));
  expect(failed).toHaveBeenCalledOnce();
});

it('rejects every pending request after a post or deserialize failure', async () => {
  const port = new Port();
  const client = new WorkerLocalBackend(port);
  const first = client.localStatus();
  port.postMessage = () => {
    throw 'cannot clone';
  };
  const second = client.localUnload();
  await expect(first).rejects.toThrow('cannot clone');
  await expect(second).rejects.toThrow('cannot clone');
  const other = new Port();
  const pending = new WorkerLocalBackend(other).localStatus();
  other.onmessageerror?.({} as MessageEvent);
  await expect(pending).rejects.toThrow('无法读取');
});

it('starts MessagePorts, ignores unknown replies and serializes posting errors', async () => {
  const port = new Port();
  const start = vi.fn();
  const client = new WorkerLocalBackend(Object.assign(port, { start }));
  expect(start).toHaveBeenCalledOnce();
  port.respond({ id: 99, ok: true, value: null });
  const pending = client.localStatus();
  port.respond({ id: port.last.id, ok: false, error: 'not ready' });
  await expect(pending).rejects.toMatchObject({ name: 'Error', message: 'not ready' });
  port.postMessage = () => {
    throw new Error('closed');
  };
  await expect(client.localUnload()).rejects.toThrow('closed');
});
