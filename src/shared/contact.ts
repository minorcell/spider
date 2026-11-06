import { CONTACT } from './config.js';

/** Horizontal step for the ground slope. The loose-body solver uses the same step. */
const SLOPE = 0.6;

/**
 * Height of the bottom of a sphere sitting on a heightfield.
 * A point (`radius` 0) uses the center sample and no skin.
 * A sphere treats the ground under it as a plane, so the bottom rises by
 * `radius * (sqrt(1 + slope²) - 1)`, then adds `CONTACT`.
 * Sampling a ring under every apple every frame missed the frame budget.
 */
export function groundSupport(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
): number {
  const ground = height(x, z);
  if (radius <= 0) return ground;
  const gx = (height(x + SLOPE, z) - height(x - SLOPE, z)) / (2 * SLOPE);
  const gz = (height(x, z + SLOPE) - height(x, z - SLOPE)) / (2 * SLOPE);
  const lift = radius * (Math.sqrt(1 + gx * gx + gz * gz) - 1);
  return ground + lift + CONTACT;
}
