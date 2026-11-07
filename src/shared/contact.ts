import { CONTACT } from './config.js';

const SLOPE = 0.6;

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
