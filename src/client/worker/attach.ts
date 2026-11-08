import { StorageClient } from '@/src/client/storage/client';
import { useLocalBackend } from '@/src/client/local/backend';
import { WorkerLocalBackend } from '@/src/client/local/workerClient';
import { createHandler, type Handler } from '@/src/client/worker/handler';
import type { JournalControl, JournalReply, JournalRequest } from '@/src/client/worker/protocol';

export interface WorkerScope {
  onmessage: ((event: MessageEvent<JournalRequest | JournalControl>) => void) | null;
  postMessage(message: JournalReply): void;
}

export function attachJournalWorker(scope: WorkerScope, handle?: Handler): void {
  let local: WorkerLocalBackend | null = null;
  let storage: StorageClient | null = null;
  let storageFailure: Error | null = null;
  scope.onmessage = (event) => {
    const request = event.data;
    if ('event' in request) {
      if (request.event === 'storagePort') {
        storage = new StorageClient(request.port);
        if (storageFailure) storage.fail(storageFailure);
        handle = createHandler(storage);
      } else if (request.event === 'storageFailure') {
        storageFailure = new Error(request.error);
        storage?.fail(storageFailure);
      } else if (request.event === 'inferencePort') {
        local = new WorkerLocalBackend(request.port);
        useLocalBackend(local);
      } else {
        // Install a failed backend even when startup failed before the port arrived.
        const error = new Error(request.error);
        local?.fail(error);
        useLocalBackend(local ?? error);
      }
      return;
    }
    const task = handle
      ? handle(request)
      : Promise.reject(storageFailure ?? new Error('日记存储线程尚未连接'));
    void task.then(
      (value) => scope.postMessage({ id: request.id, ok: true, value }),
      (error: unknown) =>
        scope.postMessage({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}
