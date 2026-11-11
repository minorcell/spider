import type { Vec3 } from '@/src/shared/state';
import { sphereMesh, tubeMesh } from '@/src/shared/mesh';
import { mulberry32 } from '@/src/shared/noise';
import {
  NEST_DOOR,
  NEST_RO,
  nestDoor,
  nestLocalHeight,
  nestRimRadius,
} from '@/src/shared/nestShape';

const TAU = Math.PI * 2;

function layout() {
  const rand = mulberry32(71);
  const pebbles = Array.from({ length: 15 }, (_, k) => {
    const angle = NEST_DOOR + 0.68 + (k / 14) * (TAU - 1.36);
    const radius = nestRimRadius(angle);
    const scale = { x: 0.4 + rand() * 0.18, y: 0.26 + rand() * 0.2, z: 0.32 + rand() * 0.18 };
    return {
      scale,
      position: {
        x: Math.cos(angle) * radius,
        y: nestLocalHeight(radius, angle) + 0.04,
        z: Math.sin(angle) * radius,
      },
      rotation: { x: rand() * 0.25, y: angle + rand() * 0.5, z: rand() * 0.2 },
    };
  });
  const roots: Vec3[][] = [];
  for (let k = 0; k < 9; k++) {
    const angle = (k / 9) * TAU + 0.3;
    if (nestDoor(angle) > 0.2) continue;
    roots.push(
      Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        const r = 1.4 + t * 1.8;
        const a = angle + Math.sin(t * 4 + k) * 0.08;
        return {
          x: Math.cos(a) * r,
          y: nestLocalHeight(Math.min(r, NEST_RO), a) + 0.04,
          z: Math.sin(a) * r,
        };
      }),
    );
  }
  const tufts: { index: number; x: number; z: number }[] = [];
  for (let k = 0; k < 12; k++) {
    const angle = 0.1 + (k / 12) * TAU;
    if (nestDoor(angle) > 0.2) continue;
    const radius = 2.95 + rand() * 0.35;
    tufts.push({ index: k, x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
  }
  return { pebbles, roots, tufts };
}

export const NEST_DETAILS = layout();
export const NEST_PEBBLE_SKIN = 0.025;
export const NEST_ROOT_SKIN = 0.006;

export function nestPebbleMesh() {
  return sphereMesh(10, 7);
}

export function nestRootMesh(spine: readonly Vec3[]) {
  return tubeMesh(spine, (t) => 0.065 * (1 - t * 0.85), 7);
}
