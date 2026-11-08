import { Matrix4, Quaternion, Vector3, type BufferGeometry } from 'three';
import {
  NEST_DETAILS,
  NEST_PEBBLE_SKIN,
  NEST_ROOT_SKIN,
  nestPebbleGeometry,
  nestRootGeometry,
} from '@/src/shared/nestDetails';
import { NEST_SCALE_XZ, NEST_SCALE_Y, nestSurface } from '@/src/shared/nestShape';
import { growShell } from '@/src/shared/sim/parts';

const HALF = 4;
const CELL = 0.25;
const COLS = (HALF * 2) / CELL;
interface Face {
  x: number;
  y: number;
  z: number;
  ux: number;
  uz: number;
  vx: number;
  vz: number;
  uy: number;
  vy: number;
}

function bake(): Face[][] {
  const cells: Face[][] = Array.from({ length: COLS * COLS }, () => []);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const identity = new Matrix4();
  const add = (geometry: BufferGeometry, skin: number, matrix: Matrix4): void => {
    const shell = growShell(geometry, skin);
    const position = shell.getAttribute('position');
    const index = shell.getIndex()!;
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i)).applyMatrix4(matrix);
      b.fromBufferAttribute(position, index.getX(i + 1))
        .applyMatrix4(matrix)
        .sub(a);
      c.fromBufferAttribute(position, index.getX(i + 2))
        .applyMatrix4(matrix)
        .sub(a);
      const det = b.x * c.z - b.z * c.x;
      if (det >= -1e-10) continue;
      const face: Face = {
        x: a.x,
        y: a.y,
        z: a.z,
        ux: c.z / det,
        uz: -c.x / det,
        vx: -b.z / det,
        vz: b.x / det,
        uy: b.y,
        vy: c.y,
      };
      const x0 = Math.floor((Math.min(a.x, a.x + b.x, a.x + c.x) + HALF) / CELL);
      const x1 = Math.floor((Math.max(a.x, a.x + b.x, a.x + c.x) + HALF) / CELL);
      const z0 = Math.floor((Math.min(a.z, a.z + b.z, a.z + c.z) + HALF) / CELL);
      const z1 = Math.floor((Math.max(a.z, a.z + b.z, a.z + c.z) + HALF) / CELL);
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) cells[z * COLS + x].push(face);
      }
    }
    shell.dispose();
    geometry.dispose();
  };
  for (const pebble of NEST_DETAILS.pebbles) {
    const matrix = new Matrix4().compose(
      pebble.position,
      new Quaternion().setFromEuler(pebble.rotation),
      pebble.scale,
    );
    add(nestPebbleGeometry(), NEST_PEBBLE_SKIN, matrix);
  }
  for (const spine of NEST_DETAILS.roots) {
    add(nestRootGeometry(spine), NEST_ROOT_SKIN, identity);
  }
  return cells;
}

const cells = bake();

export function nestDetailHeight(x: number, z: number): number {
  const ix = Math.floor((x + HALF) / CELL);
  const iz = Math.floor((z + HALF) / CELL);
  if (ix < 0 || ix >= COLS || iz < 0 || iz >= COLS) return Number.NEGATIVE_INFINITY;
  let y = Number.NEGATIVE_INFINITY;
  for (const face of cells[iz * COLS + ix]) {
    const dx = x - face.x;
    const dz = z - face.z;
    const u = face.ux * dx + face.uz * dz;
    const v = face.vx * dx + face.vz * dz;
    if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
    y = Math.max(y, face.y + u * face.uy + v * face.vy);
  }
  return y;
}

export function nestSolidSurface(
  origin: { x: number; y: number; z: number },
  x: number,
  z: number,
): number {
  const detail = nestDetailHeight((x - origin.x) / NEST_SCALE_XZ, (z - origin.z) / NEST_SCALE_XZ);
  return Math.max(nestSurface(origin, x, z), origin.y + detail * NEST_SCALE_Y);
}
