import { islandBuffers } from '@/src/shared/island';
import { bakeTerrainGrid, Terrain } from '@/src/shared/terrain';
import type { PreparedBuffers, WorldRequest } from '@/src/client/worker/worldProtocol';

export type WorldHandler = (request: WorldRequest) => Promise<PreparedBuffers>;

export function createWorldHandler(): WorldHandler {
  return (request) => {
    const seed = request.seed >>> 0;
    const grid = bakeTerrainGrid(seed);
    const terrain = new Terrain(seed, grid);
    return Promise.resolve({
      seed,
      grid,
      island: islandBuffers((x, z) => terrain.height(x, z)),
    });
  };
}
