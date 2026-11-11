import { bakeTerrainGrid } from '@/src/shared/terrain';
import type { PreparedBuffers, WorldRequest } from '@/src/client/worker/worldProtocol';

export type WorldHandler = (request: WorldRequest) => Promise<PreparedBuffers>;

export function createWorldHandler(): WorldHandler {
  return (request) => {
    const seed = request.seed >>> 0;
    return Promise.resolve({ seed, grid: bakeTerrainGrid(seed) });
  };
}
