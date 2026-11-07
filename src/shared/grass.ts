import { mulberry32 } from './noise.js';
import { TERRAIN } from './terrain.js';

/** Check the whole patch, including the ground under its outermost leaves. */
export function grassOnDryGround(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
): boolean {
  const steps = Math.ceil((radius * 2) / 0.25);
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      if (
        height(x - radius + (i / steps) * radius * 2, z - radius + (j / steps) * radius * 2) <=
        TERRAIN.water + 0.08
      )
        return false;
    }
  }
  return true;
}

export interface GrassClump {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** Stable across saves, and shared by the drawn blades and sight tests. */
export function grassSeed(id: string): number {
  const suffix = id.includes('-') ? Number(id.slice(id.lastIndexOf('-') + 1)) : 0;
  return ((Number.isFinite(suffix) ? suffix : 0) * 977 + 13) >>> 0;
}

/** Small tufts, broad patches, and tall grass heaps alternate naturally. */
export function grassRadius(id: string): number {
  return 0.65 + ((Math.imul(grassSeed(id), 2654435761) >>> 0) / 4294967296) * 1.25;
}

export function grassClumps(radius: number, seed: number): GrassClump[] {
  const rand = mulberry32(seed);
  const count = Math.max(1, Math.round(radius * 2));
  const offset = rand() * Math.PI * 2;
  return Array.from({ length: count }, (_, index) => {
    const angle = offset + index * 2.399963;
    const size = Math.min(radius, 0.62 + rand() * 0.4);
    const distance = (radius - size) * Math.sqrt(index / count);
    return {
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      radius: size,
      height: 0.65 + rand() * 0.9,
    };
  });
}
