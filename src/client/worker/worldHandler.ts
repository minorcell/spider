import { islandBuffers } from '../../shared/island.js';
import { bakeTerrainGrid, Terrain } from '../../shared/terrain.js';
import type { PreparedBuffers, WorldRequest } from './worldProtocol.js';

export type WorldHandler = (request: WorldRequest) => Promise<PreparedBuffers>;

/** Bake one island. The page uploads the buffers; it does not sample the noise. */
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
