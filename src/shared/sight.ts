import { grassClumps, grassSeed, type GrassClump } from './grass.js';
import type { Block, EntityState } from './state.js';

export const HOME = { half: 2.15 } as const;

export const BODY_RADIUS = 0.48;

export function insideHome(x: number, z: number): boolean {
  return Math.abs(x) <= HOME.half && Math.abs(z) <= HOME.half;
}

export function blockAt(
  x: number,
  z: number,
  blocks: readonly Block[],
  radius = BODY_RADIUS,
): Block | null {
  let nearest: Block | null = null;
  let nearestD = Infinity;
  const radiusSquared = radius * radius;
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
    if (d < radiusSquared && d < nearestD) {
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

export function occluded(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocks: readonly Block[],
  ignoreId: string,
  eye: number,
): boolean {
  for (const block of blocks) {
    if (block.id === ignoreId || block.height < eye) continue;
    if (segmentHits(x0, z0, x1, z1, block)) return true;
  }
  return false;
}

export const EYE_HEIGHT = 0.85;

export const SIGHT_TOP = 0.35;

export const GROUND_CLEARANCE = 0.2;

export function groundOccluded(
  x0: number,
  z0: number,
  y0: number,
  x1: number,
  y1: number,
  z1: number,
  height: (x: number, z: number) => number,
  clearance = GROUND_CLEARANCE,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return false;
  const steps = Math.max(2, Math.ceil(length / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ground = height(x0 + dx * t, z0 + dz * t);
    if (ground > y0 + (y1 - y0) * t + clearance) return true;
  }
  return false;
}

export function sightOutline(
  x: number,
  z: number,
  eye: number,
  view: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  segments = 72,
  step = 0.25,
): { x: number; z: number }[] {
  const points: { x: number; z: number }[] = [];
  const outer = Math.max(0, view);
  const steps = Math.max(1, Math.ceil(outer / step));
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const dx = Math.sin(angle);
    const dz = -Math.cos(angle);
    let horizon = Number.NEGATIVE_INFINITY;
    let reach = 0;
    if (outer <= 0) {
      points.push({ x, z });
      continue;
    }
    const wall = nearestWall(x, z, dx, dz, blocks, eye, outer);
    for (let s = 1; s <= steps; s++) {
      const r = Math.min(outer, s * step);
      if (r >= wall) break;
      const px = x + dx * r;
      const pz = z + dz * r;
      const ground = height(px, pz);
      const slope = (ground - eye) / r;
      if (slope < horizon) break;
      horizon = Math.max(horizon, (ground - eye - GROUND_CLEARANCE) / r);
      reach = r;
      if (r >= outer) break;
    }
    points.push({ x: x + dx * reach, z: z + dz * reach });
  }
  return points;
}

export const GRASS_HEIGHT = 1.35;

const coverShapes = new WeakMap<
  EntityState,
  { id: string; radius: number; clumps: GrassClump[] }
>();

function coverShape(entity: EntityState, radius: number): GrassClump[] {
  const cached = coverShapes.get(entity);
  if (cached && cached.id === entity.id && cached.radius === radius) return cached.clumps;
  const clumps = grassClumps(radius, grassSeed(entity.id));
  coverShapes.set(entity, { id: entity.id, radius, clumps });
  return clumps;
}

export function grassHere(
  x: number,
  z: number,
  entities: readonly EntityState[],
  eye = Number.NEGATIVE_INFINITY,
): boolean {
  return entities.some(
    (entity) =>
      entity.kind === 'grass' &&
      entity.footprint?.kind === 'circle' &&
      Math.abs(entity.x - x) <= entity.footprint.r &&
      Math.abs(entity.z - z) <= entity.footprint.r &&
      coverShape(entity, entity.footprint.r).some(
        (clump) =>
          Math.hypot(entity.x + clump.x - x, entity.z + clump.z - z) <= clump.radius &&
          eye < entity.y + clump.height,
      ),
  );
}

function nearestWall(
  x: number,
  z: number,
  dx: number,
  dz: number,
  blocks: readonly Block[],
  eye: number,
  reach: number,
): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    if (block.height < eye) continue;
    const entry = segmentEntry(x, z, x + dx * reach, z + dz * reach, block);
    if (entry != null) nearest = Math.min(nearest, entry * reach);
  }
  return nearest;
}

function segmentHits(x0: number, z0: number, x1: number, z1: number, block: Block): boolean {
  return segmentEntry(x0, z0, x1, z1, block) !== null;
}

function segmentEntry(x0: number, z0: number, x1: number, z1: number, block: Block): number | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - block.minX, block.maxX - x0, z0 - block.minZ, block.maxZ - z0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t0 < 0.98 ? t0 : null;
}
