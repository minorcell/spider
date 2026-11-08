import { visualRange, worldClock } from '@/src/shared/ecology';
import { EYE_HEIGHT, grassHere } from '@/src/shared/sight';
import { surfaceOf } from '@/src/shared/terrain';
import { GRASS_VIEW, VIEW_DISTANCE } from '@/src/shared/world';
import type { WorldState } from '@/src/shared/state';

/** The same light, grass and distance limits for the agent and the observation view. */
export function viewDistance(
  world: WorldState,
  x: number,
  z: number,
  height: number,
  lamp: boolean,
  requested = VIEW_DISTANCE,
  now = new Date(),
): number {
  const eye = surfaceOf(world.terrain, x, z) + EYE_HEIGHT + height;
  const light = VIEW_DISTANCE * visualRange(worldClock(now), lamp);
  const grass = grassHere(x, z, world.entities, eye) ? GRASS_VIEW : VIEW_DISTANCE;
  return Math.min(VIEW_DISTANCE, Math.max(0, requested), light, grass);
}
