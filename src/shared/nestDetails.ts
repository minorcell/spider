import { Euler, SphereGeometry, Vector3 } from 'three';
import { mulberry32 } from './noise.js';
import { NEST_DOOR, NEST_RO, nestDoor, nestLocalHeight, nestRimRadius } from './nestShape.js';
import { tubeGeometry } from './tubeGeometry.js';

const TAU = Math.PI * 2;

function layout() {
  const rand = mulberry32(71);
  const pebbles = Array.from({ length: 15 }, (_, k) => {
    const angle = NEST_DOOR + 0.68 + (k / 14) * (TAU - 1.36);
    const radius = nestRimRadius(angle);
    const scale = new Vector3(0.4 + rand() * 0.18, 0.26 + rand() * 0.2, 0.32 + rand() * 0.18);
    return {
      scale,
      position: new Vector3(
        Math.cos(angle) * radius,
        nestLocalHeight(radius, angle) + 0.04,
        Math.sin(angle) * radius,
      ),
      rotation: new Euler(rand() * 0.25, angle + rand() * 0.5, rand() * 0.2),
    };
  });
  const roots: Vector3[][] = [];
  for (let k = 0; k < 9; k++) {
    const angle = (k / 9) * TAU + 0.3;
    if (nestDoor(angle) > 0.2) continue;
    roots.push(
      Array.from({ length: 13 }, (_, i) => {
        const t = i / 12;
        const r = 1.4 + t * 1.8;
        const a = angle + Math.sin(t * 4 + k) * 0.08;
        return new Vector3(
          Math.cos(a) * r,
          nestLocalHeight(Math.min(r, NEST_RO), a) + 0.04,
          Math.sin(a) * r,
        );
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

export function nestPebbleGeometry(): SphereGeometry {
  return new SphereGeometry(1, 10, 7);
}

export function nestRootGeometry(spine: readonly Vector3[]) {
  return tubeGeometry(spine, (t) => 0.065 * (1 - t * 0.85), 7);
}
