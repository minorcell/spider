import type { Block } from '@/src/shared/state';

export const BODY_RADIUS = 0.48;
const EPSILON = 1e-9;
const SKIN = 1e-7;
const SURFACE_STEP = 0.2;

export interface SweepHit {
  time: number;
  nx: number;
  nz: number;
  block: Block;
}

export interface MotionSpace {
  blocks: readonly Block[];
  inside?: (x: number, z: number) => boolean;
  /** Walking surface and permitted ascent per horizontal metre. */
  surface?: (x: number, z: number) => number;
  maxSlope?: number;
}

export interface MotionResult {
  x: number;
  z: number;
  /** Requested displacement projected onto the remaining free directions. */
  dx: number;
  dz: number;
  halt: 'clear' | 'solid' | 'steep';
}

export type MotionSolver = (x: number, z: number, dx: number, dz: number) => MotionResult;

export function blockAt(
  x: number,
  z: number,
  blocks: readonly Block[],
  radius = BODY_RADIUS,
): Block | null {
  let nearest: Block | null = null;
  let nearestD = Infinity;
  for (const block of blocks) {
    if (
      x < block.minX - radius ||
      x > block.maxX + radius ||
      z < block.minZ - radius ||
      z > block.maxZ + radius
    )
      continue;
    const cx = Math.min(block.maxX, Math.max(block.minX, x));
    const cz = Math.min(block.maxZ, Math.max(block.minZ, z));
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    const within =
      radius > 0
        ? d < radius * radius
        : x > block.minX && x < block.maxX && z > block.minZ && z < block.maxZ;
    if (within && d < nearestD) {
      nearest = block;
      nearestD = d;
    }
  }
  return nearest;
}

export function blockedAt(
  x: number,
  z: number,
  blocks: readonly Block[],
  radius = BODY_RADIUS,
): boolean {
  return blockAt(x, z, blocks, radius) !== null;
}

/** Exact swept disk against the rounded expansion of every registered box. */
export function sweepCircle(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  blocks: readonly Block[],
): SweepHit | null {
  const length2 = dx * dx + dz * dz;
  if (length2 < EPSILON * EPSILON) return null;
  let hit: SweepHit | null = null;
  for (const block of blocks) {
    if (
      Math.max(x, x + dx) < block.minX - radius ||
      Math.min(x, x + dx) > block.maxX + radius ||
      Math.max(z, z + dz) < block.minZ - radius ||
      Math.min(z, z + dz) > block.maxZ + radius
    )
      continue;
    const consider = (time: number, nx: number, nz: number): void => {
      if (time < -EPSILON || time > 1 || (hit && time >= hit.time) || dx * nx + dz * nz >= -EPSILON)
        return;
      hit = { time: Math.max(0, time), nx, nz, block };
    };
    const cx = Math.min(block.maxX, Math.max(block.minX, x));
    const cz = Math.min(block.maxZ, Math.max(block.minZ, z));
    const ox = x - cx;
    const oz = z - cz;
    const distance = Math.hypot(ox, oz);
    if (distance > EPSILON && distance < radius) {
      consider(0, ox / distance, oz / distance);
    } else if (x >= block.minX && x <= block.maxX && z >= block.minZ && z <= block.maxZ) {
      // An invalid initial overlap may escape through the nearest face.
      const faces = [
        { distance: x - block.minX, nx: -1, nz: 0 },
        { distance: block.maxX - x, nx: 1, nz: 0 },
        { distance: z - block.minZ, nx: 0, nz: -1 },
        { distance: block.maxZ - z, nx: 0, nz: 1 },
      ];
      const nearest = faces.reduce((a, b) => (a.distance <= b.distance ? a : b));
      consider(0, nearest.nx, nearest.nz);
    }
    if (Math.abs(dx) > EPSILON) {
      const nx = dx > 0 ? -1 : 1;
      const time = ((dx > 0 ? block.minX - radius : block.maxX + radius) - x) / dx;
      const atZ = z + dz * time;
      if (atZ >= block.minZ && atZ <= block.maxZ) consider(time, nx, 0);
    }
    if (Math.abs(dz) > EPSILON) {
      const nz = dz > 0 ? -1 : 1;
      const time = ((dz > 0 ? block.minZ - radius : block.maxZ + radius) - z) / dz;
      const atX = x + dx * time;
      if (atX >= block.minX && atX <= block.maxX) consider(time, 0, nz);
    }
    if (radius <= 0) continue;
    for (const cornerX of [block.minX, block.maxX]) {
      for (const cornerZ of [block.minZ, block.maxZ]) {
        const px = x - cornerX;
        const pz = z - cornerZ;
        const toward = px * dx + pz * dz;
        const discriminant = toward * toward - length2 * (px * px + pz * pz - radius * radius);
        if (discriminant <= 0) continue;
        const time = (-toward - Math.sqrt(discriminant)) / length2;
        const nx = (px + dx * time) / radius;
        const nz = (pz + dz * time) / radius;
        if (
          (cornerX === block.minX ? nx <= 0 : nx >= 0) &&
          (cornerZ === block.minZ ? nz <= 0 : nz >= 0)
        )
          consider(time, nx, nz);
      }
    }
  }
  return hit;
}

/** Heightfields and irregular coasts use bounded samples, independent of body radius. */
export function surfaceLimit(
  x: number,
  z: number,
  dx: number,
  dz: number,
  space: MotionSpace,
): { time: number; halt: 'solid' | 'steep' } | null {
  if (!space.inside && !space.surface) return null;
  const length = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(length / SURFACE_STEP));
  let previous = space.surface?.(x, z) ?? 0;
  for (let i = 1; i <= steps; i++) {
    const time = i / steps;
    const px = x + dx * time;
    const pz = z + dz * time;
    if (space.inside && !space.inside(px, pz)) {
      let low = (i - 1) / steps;
      let high = time;
      for (let n = 0; n < 24; n++) {
        const middle = (low + high) / 2;
        if (space.inside(x + dx * middle, z + dz * middle)) low = middle;
        else high = middle;
      }
      return { time: low, halt: 'solid' };
    }
    const ground = space.surface?.(px, pz) ?? 0;
    if (ground - previous > (space.maxSlope ?? Infinity) * (length / steps))
      return { time: (i - 1) / steps, halt: 'steep' };
    previous = ground;
  }
  return null;
}

/** One collision response for controlled movement, free bodies and contact corrections. */
export function moveCircle(
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
  space: MotionSpace,
): MotionResult {
  const result: MotionResult = { x, z, dx, dz, halt: 'clear' };
  let remainingX = dx;
  let remainingZ = dz;
  // Two independent planes stop planar movement; extra passes handle rounded corners.
  for (let pass = 0; pass < 4 && Math.hypot(remainingX, remainingZ) > EPSILON; pass++) {
    const hit = sweepCircle(result.x, result.z, remainingX, remainingZ, radius, space.blocks);
    const limit = surfaceLimit(result.x, result.z, remainingX, remainingZ, space);
    if (limit && (!hit || limit.time <= hit.time)) {
      result.x += remainingX * limit.time;
      result.z += remainingZ * limit.time;
      result.dx = result.dz = 0;
      result.halt = limit.halt;
      break;
    }
    if (!hit) {
      result.x += remainingX;
      result.z += remainingZ;
      break;
    }
    const travel = Math.max(0, hit.time - SKIN / Math.hypot(remainingX, remainingZ));
    result.x += remainingX * travel;
    result.z += remainingZ * travel;
    const normal = result.dx * hit.nx + result.dz * hit.nz;
    result.dx -= normal * hit.nx;
    result.dz -= normal * hit.nz;
    const left = remainingX * hit.nx + remainingZ * hit.nz;
    remainingX = (remainingX - left * hit.nx) * (1 - hit.time);
    remainingZ = (remainingZ - left * hit.nz) * (1 - hit.time);
    result.halt = 'solid';
  }
  return result;
}

export interface SphereMotion {
  x: number;
  y: number;
  z: number;
  dx: number;
  dy: number;
  dz: number;
  radius: number;
}

export interface SphereHit {
  time: number;
  /** Unit normal from the first body toward the second. */
  nx: number;
  ny: number;
  nz: number;
}

/** Time of first approaching contact along two simultaneous linear trajectories. */
export function sweepSpheres(a: SphereMotion, b: SphereMotion): SphereHit | null {
  const px = b.x - a.x;
  const py = b.y - a.y;
  const pz = b.z - a.z;
  const dx = b.dx - a.dx;
  const dy = b.dy - a.dy;
  const dz = b.dz - a.dz;
  const radius = a.radius + b.radius;
  const speed2 = dx * dx + dy * dy + dz * dz;
  const approach = px * dx + py * dy + pz * dz;
  if (radius <= 0 || speed2 <= EPSILON * EPSILON || approach >= 0) return null;
  const gap = px * px + py * py + pz * pz - radius * radius;
  const discriminant = approach * approach - speed2 * gap;
  if (discriminant <= 0) return null;
  const time = gap <= 0 ? 0 : gap / (-approach + Math.sqrt(discriminant));
  if (time > 1) return null;
  const nx = px + dx * time;
  const ny = py + dy * time;
  const nz = pz + dz * time;
  const length = Math.hypot(nx, ny, nz);
  // Coincident centers are handled by the overlap solver; there is no entry normal.
  if (length <= EPSILON || (dx * nx + dy * ny + dz * nz) / length >= -EPSILON) return null;
  return { time, nx: nx / length, ny: ny / length, nz: nz / length };
}
