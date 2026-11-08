import { setLocalBusy } from '@/src/client/local/activity';
import type { LocalBackend } from '@/src/client/local/types';
import { WorkerLocalBackend, type LocalPort } from '@/src/client/local/workerClient';
import type { JournalControl } from '@/src/client/worker/protocol';

let backend: LocalBackend | Error | null = null;
let worker: Worker | null = null;
let client: WorkerLocalBackend | null = null;
let sequence = 0;
const failures = new Set<(error: Error) => void>();
const unavailable = () => new Error('本机模型需要后台线程；若不可用，请使用在线模型');

export function useLocalBackend(value: LocalBackend | Error): void {
  backend = value;
}

function inference(): { worker: Worker; client: WorkerLocalBackend } {
  if (client && worker) return { worker, client };
  // A diary must receive a direct port, never create another engine/Worker itself.
  if (typeof document === 'undefined' || typeof Worker === 'undefined') throw unavailable();
  const next = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module' });
  worker = next;
  client = new WorkerLocalBackend(next as unknown as LocalPort, setLocalBusy, (error) => {
    next.terminate();
    for (const fail of failures) fail(error);
  });
  return { worker: next, client };
}

export async function localBackend(): Promise<LocalBackend> {
  if (backend instanceof Error) throw backend;
  return backend ?? inference().client;
}

/** Wire the diary directly to the same inference Worker used by page actions. */
export function connectLocalJournal(journal: {
  postMessage(message: JournalControl, transfer?: Transferable[]): void;
}): () => void {
  let disconnect = () => {};
  let channel: MessageChannel | null = null;
  try {
    if (typeof MessageChannel === 'undefined') throw unavailable();
    const owner = inference();
    channel = new MessageChannel();
    const key = ++sequence;
    const fail = (error: Error) => {
      try {
        journal.postMessage({ event: 'inferenceFailure', error: error.message });
      } catch {}
    };
    failures.add(fail);
    disconnect = () => {
      failures.delete(fail);
      try {
        owner.worker.postMessage({ event: 'disconnect', key });
      } catch {}
    };
    owner.worker.postMessage({ event: 'connect', key, port: channel.port1 }, [channel.port1]);
    journal.postMessage({ event: 'inferencePort', port: channel.port2 }, [channel.port2]);
    // A failed singleton is deliberately retained so future requests fail promptly.
    void owner.client.localStatus().catch(fail);
  } catch (error) {
    disconnect();
    channel?.port1.close();
    channel?.port2.close();
    try {
      journal.postMessage({
        event: 'inferenceFailure',
        error: error instanceof Error ? error.message : String(error),
      });
    } catch {}
  }
  return disconnect;
}
