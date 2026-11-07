import { createHandler, type Handler } from './handler.js';
import type { JournalReply, JournalRequest } from './protocol.js';

export interface WorkerScope {
  onmessage: ((event: MessageEvent<JournalRequest>) => void) | null;
  postMessage(message: JournalReply): void;
}

export function attachJournalWorker(scope: WorkerScope, handle: Handler = createHandler()): void {
  scope.onmessage = (event) => {
    const request = event.data;
    void handle(request).then(
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
