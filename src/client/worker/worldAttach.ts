import { createWorldHandler, type WorldHandler } from './worldHandler.js';
import type { PreparedBuffers, WorldReply, WorldRequest } from './worldProtocol.js';

export interface WorldScope {
  onmessage: ((event: MessageEvent<WorldRequest>) => void) | null;
  postMessage(message: WorldReply, transfer?: Transferable[]): void;
}

function transfers(value: PreparedBuffers): Transferable[] {
  const island = value.island;
  return [
    value.grid.buffer,
    island.groundPosition.buffer,
    island.groundColor.buffer,
    island.groundIndex.buffer,
    island.coverPosition.buffer,
    island.coverColor.buffer,
  ];
}

export function attachWorldWorker(
  scope: WorldScope,
  handle: WorldHandler = createWorldHandler(),
): void {
  scope.onmessage = (event) => {
    const request = event.data;
    void handle(request).then(
      (value) => scope.postMessage({ id: request.id, ok: true, value }, transfers(value)),
      (error: unknown) =>
        scope.postMessage({
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  };
}
