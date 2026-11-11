import { meshSurface } from '@/src/shared/mesh';
import {
  NEST_DETAILS,
  NEST_PEBBLE_SKIN,
  NEST_ROOT_SKIN,
  nestPebbleMesh,
  nestRootMesh,
} from '@/src/shared/nestDetails';
import { NEST_SCALE_XZ, NEST_SCALE_Y, nestSurface } from '@/src/shared/nestShape';

export const nestDetailHeight = meshSurface([
  ...NEST_DETAILS.pebbles.map((pebble) => ({
    ...pebble,
    mesh: nestPebbleMesh(),
    skin: NEST_PEBBLE_SKIN,
  })),
  ...NEST_DETAILS.roots.map((spine) => ({ mesh: nestRootMesh(spine), skin: NEST_ROOT_SKIN })),
]);

export function nestSolidSurface(
  origin: { x: number; y: number; z: number },
  x: number,
  z: number,
): number {
  const detail = nestDetailHeight((x - origin.x) / NEST_SCALE_XZ, (z - origin.z) / NEST_SCALE_XZ);
  return Math.max(nestSurface(origin, x, z), origin.y + detail * NEST_SCALE_Y);
}
