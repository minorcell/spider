import { buildProp, drapeGrass } from '@/src/client/props';
import { createWorldHandler } from '@/src/client/worker/worldHandler';
import { planRoute } from '@/src/shared/route';
import { SimSession } from '@/src/shared/sim/session';
import type { Block, WorldState } from '@/src/shared/state';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import type { Controls } from '@/src/shared/types';
import { drive } from '@/tests/simHelpers';

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
