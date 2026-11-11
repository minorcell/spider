import { meshSurface } from '@/src/shared/mesh';
import {
  NEST_DETAILS,
  NEST_PEBBLE_SKIN,
  NEST_ROOT_SKIN,
  nestPebbleMesh,
  nestRootMesh,
} from '@/src/shared/nestDetails';
import {
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestLocalHeight,
  nestRimRadius,
  nestSurface,
} from '@/src/shared/nestShape';
import type { Block } from '@/src/shared/state';

/** Local collision registration follows the earthen rear bank, leaving the foreground open. */
export function nestBankBoxes(): Block[] {
  const boxes: Block[] = [];
  for (let i = 0; i < 17; i++) {
    const angle = 0.14 + (i / 16) * (Math.PI - 0.28);
    const radius = nestRimRadius(angle);
    const x = Math.cos(angle) * radius * NEST_SCALE_XZ;
    const z = Math.sin(angle) * radius * NEST_SCALE_XZ;
    const half = 0.27 * NEST_SCALE_XZ;
    boxes.push({
      id: `bank-${i}`,
      minX: x - half,
      maxX: x + half,
      minZ: z - half,
      maxZ: z + half,
      height: nestLocalHeight(radius, angle) * NEST_SCALE_Y + 0.16,
    });
  }
  return boxes;
}

export const nestDetailHeight = meshSurface([
  ...NEST_DETAILS.pebbles.flatMap((pebble) => [
    { ...pebble, mesh: nestPebbleMesh(), skin: 0 },
    { ...pebble, mesh: nestPebbleMesh(), skin: NEST_PEBBLE_SKIN },
  ]),
  ...NEST_DETAILS.roots.flatMap((root) => [
    { mesh: nestRootMesh(root), skin: 0 },
    { mesh: nestRootMesh(root), skin: NEST_ROOT_SKIN },
  ]),
]);

export function nestSolidSurface(
  origin: { x: number; y: number; z: number },
  x: number,
  z: number,
): number {
  const detail = nestDetailHeight((x - origin.x) / NEST_SCALE_XZ, (z - origin.z) / NEST_SCALE_XZ);
  return Math.max(nestSurface(origin, x, z), origin.y + detail * NEST_SCALE_Y);
}
