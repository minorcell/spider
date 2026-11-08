import type { PersistenceRepository } from '@/src/client/storage/repository';
import type { StorageReply, StorageRequest } from '@/src/client/storage/protocol';

export type StorageHandler = (request: StorageRequest) => Promise<unknown>;

/** Share one handler across all ports so storage commits retain arrival order. */
export function createStorageHandler(repository: PersistenceRepository): StorageHandler {
  let queue = Promise.resolve();
  const dispatch = (request: StorageRequest): Promise<unknown> => {
    switch (request.method) {
      case 'loadSession':
        return repository.loadSession(...request.args);
      case 'saveSession':
        return repository.saveSession(...request.args);
      case 'listMemories':
        return repository.listMemories(...request.args);
      case 'getMemory':
        return repository.getMemory(...request.args);
      case 'patchMemory':
        return repository.patchMemory(...request.args);
      case 'recordUsage':
        return repository.recordUsage(...request.args);
      case 'recordUsageCall':
        return repository.recordUsageCall(...request.args);
      case 'recordUsageCalls':
        return repository.recordUsageCalls(...request.args);
      case 'readUsage':
        return repository.readUsage(...request.args);
      case 'readSnapshot':
        return repository.readSnapshot(...request.args);
      case 'putSnapshot':
        return repository.putSnapshot(...request.args);
      case 'removeSnapshot':
        return repository.removeSnapshot(...request.args);
      case 'sweepSnapshots':
        return repository.sweepSnapshots(...request.args);
      default:
        return Promise.reject(new Error('Unknown storage method'));
    }
  };
  return (request) => {
    const task = queue.then(() => dispatch(request));
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  };
}

export interface StorageServerPort {
  onmessage: ((event: MessageEvent<StorageRequest>) => void) | null;
  postMessage(reply: StorageReply): void;
  start?(): void;
}

export function attachStoragePort(port: StorageServerPort, handle: StorageHandler): void {
  port.onmessage = ({ data: request }) => {
    void handle(request).then(
      (value) => port.postMessage({ id: request.id, ok: true, value }),
      (error: unknown) =>
        port.postMessage({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
  port.start?.();
}
