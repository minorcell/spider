import type { Block, EntityState } from './state.js';

/** Interior of the nest. You start here. */
export const HOME = { half: 2.15 } as const;

/** How wide you are when a wall decides you do not fit. */
export const BODY_RADIUS = 0.48;

export function insideHome(x: number, z: number): boolean {
  return Math.abs(x) <= HOME.half && Math.abs(z) <= HOME.half;
}

/** The solid whose footprint the body overlaps, if any. */
export function blockAt(
  x: number,
  z: number,
  blocks: readonly Block[],
  radius = BODY_RADIUS,
): Block | null {
  let nearest: Block | null = null;
  let nearestD = Infinity;
  for (const block of blocks) {
    const cx = Math.min(block.maxX, Math.max(block.minX, x));
    const cz = Math.min(block.maxZ, Math.max(block.minZ, z));
    const d = (x - cx) ** 2 + (z - cz) ** 2;
    if (d < radius ** 2 && d < nearestD) {
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

/** A solid lies across the line of sight, not merely at the thing being looked at. */
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

/** How high the eyes sit above the ground under the body. */
export const EYE_HEIGHT = 0.85;

/**
 * How far above an anchor its visible top sits. A look aims at the top of a
 * thing, not at the point where it touches the ground.
 */
export const SIGHT_TOP = 0.35;

/**
 * How far above the line a ridge has to stand before it hides a target. The
 * spider is about a body high, so a low bump is not a wall.
 */
export const GROUND_CLEARANCE = 0.8;

/**
 * A rise in the ground hides the far point. Samples the horizontal span and
 * compares each ground height with the eye-to-target ray. A small bump is not
 * enough: the ridge has to stand about a body high above the line, or a gentle
 * slope would hide half the island.
 */
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

/**
 * The ground a look can reach, one point per bearing. Each ray marches out and
 * stops at the first ridge or wall that hides what is behind it. A clear look
 * is still a circle; a valley with a bank across it is a bite out of the shape.
 */
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
    for (let s = 1; s <= steps; s++) {
      const r = Math.min(outer, s * step);
      const px = x + dx * r;
      const pz = z + dz * r;
      const ground = height(px, pz);
      const slope = (ground + SIGHT_TOP - eye) / r;
      if (slope < horizon) break;
      if (blocks.length > 0 && occluded(x, z, px, pz, blocks, '', eye)) break;
      horizon = Math.max(horizon, (ground - eye - GROUND_CLEARANCE) / r);
      reach = r;
      if (r >= outer) break;
    }
    points.push({ x: x + dx * reach, z: z + dz * reach });
  }
  return points;
}

export function grassHere(x: number, z: number, entities: readonly EntityState[]): boolean {
  return entities.some(
    (entity) =>
      entity.kind === 'grass' &&
      entity.footprint?.kind === 'circle' &&
      Math.hypot(entity.x - x, entity.z - z) <= entity.footprint.r,
  );
}

function segmentHits(x0: number, z0: number, x1: number, z1: number, block: Block): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - block.minX, block.maxX - x0, z0 - block.minZ, block.maxZ - z0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  // A hit only at the far end is the thing itself, not something in front of it.
  return t0 < 0.98;
}
