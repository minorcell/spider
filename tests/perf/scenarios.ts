import { buildProp, drapeGrass } from '../../src/client/props.js';
import { createWorldHandler } from '../../src/client/worker/worldHandler.js';
import { planRoute } from '../../src/shared/route.js';
import { SimSession } from '../../src/shared/sim/session.js';
import type { Block, WorldState } from '../../src/shared/state.js';
import { WORLD_RADIUS } from '../../src/shared/terrain.js';
import type { Controls } from '../../src/shared/types.js';
import { drive } from '../simHelpers.js';

export const FRAME_DT = 1 / 60;
export const FRAME_COUNT = 120;
export const SEED = 1234;

export const WALK: Controls = { throttle: 1, turn: 0, lift: 0, boost: 0 };

export function stepDriven(session: SimSession, frames = FRAME_COUNT): void {
  void drive(session, 4, WALK);
  try {
    for (let i = 0; i < frames; i++) session.frame(FRAME_DT);
  } finally {
    session.cancel();
  }
}

export function planAroundNest(blocks: readonly Block[], height: (x: number, z: number) => number) {
  return planRoute(0, 0, 8, 0, blocks, height, WORLD_RADIUS);
}

export function bakeWorkerIsland(seed = SEED) {
  return createWorldHandler()({ id: 0, method: 'prepare', seed });
}

export function dressIsland(world: WorldState): void {
  const height = (x: number, z: number): number => world.terrain.height(x, z);
  for (const entity of world.entities) {
    const built = buildProp(entity.kind, entity.stage, entity.footprint, entity.id);
    if (built && entity.kind === 'grass') drapeGrass(built, entity.x, entity.z, height);
  }
}
