import { CONTACT } from './config.js';

/**
 * Height of the bottom of a sphere sitting on a heightfield.
 * A point (`radius` 0) uses the center sample and no skin.
 * A sphere stays above every sample inside its radius, then adds `CONTACT`.
 */
export function groundSupport(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
): number {
  const ground = height(x, z);
  if (radius <= 0) return ground;
  let bottom = ground;
  for (const scale of [0.25, 0.5, 0.75, 1]) {
    const dist = radius * scale;
    const rise = Math.sqrt(Math.max(0, radius * radius - dist * dist));
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const sample = height(x + Math.cos(angle) * dist, z + Math.sin(angle) * dist);
      bottom = Math.max(bottom, sample + rise - radius);
    }
  }
  return bottom + CONTACT;
}
