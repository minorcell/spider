import { visualRange, worldClock } from '@/src/shared/ecology';
import { EYE_HEIGHT, coverAt } from '@/src/shared/sight';
import { surfaceOf } from '@/src/shared/terrain';
import { VIEW_DISTANCE } from '@/src/shared/world';
import type { WorldState } from '@/src/shared/state';

/** The same light, cover and distance limits for the agent and the observation view. */
export function viewDistance(
  world: WorldState,
  x: number,
  z: number,
  height: number,
  lamp: boolean,
  requested = VIEW_DISTANCE,
  now = new Date(world.clock.wallNowMs),
): number {
  const eye = surfaceOf(world.terrain, x, z) + EYE_HEIGHT + height;
  const light = VIEW_DISTANCE * visualRange(worldClock(now), lamp);
  const cover = coverAt(x, z, world.entities.values(), eye)?.range ?? VIEW_DISTANCE;
  return Math.min(VIEW_DISTANCE, Math.max(0, requested), light, cover);
}
