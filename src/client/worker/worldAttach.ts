import { createWorldHandler, type WorldHandler } from '@/src/client/worker/worldHandler';
import type { WorldReply, WorldRequest } from '@/src/client/worker/worldProtocol';

export interface WorldScope {
  onmessage: ((event: MessageEvent<WorldRequest>) => void) | null;
  postMessage(message: WorldReply, transfer?: Transferable[]): void;
}

export function attachWorldWorker(
  scope: WorldScope,
  handle: WorldHandler = createWorldHandler(),
): void {
  scope.onmessage = (event) => {
    const request = event.data;
    void handle(request).then(
      (value) => scope.postMessage({ id: request.id, ok: true, value }, [value.grid.buffer]),
      (error: unknown) =>
        scope.postMessage({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}
