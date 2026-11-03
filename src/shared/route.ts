import { GAIT } from './config.js';
import { blockedAt, blockAt, BODY_RADIUS } from './sight.js';
import type { Block } from './state.js';

/** Extra gap past the body so a waypoint is not scraped along a corner. */
const PAD = BODY_RADIUS + 0.35;
const SAMPLE = 0.2;

export interface PlanPoint {
  x: number;
  z: number;
}

export interface Plan {
  /** Includes where you are and where you asked to stand. */
  points: PlanPoint[];
  /** Solids the straight segment would overlap. Empty when the straight walk is clear. */
  around: string[];
  /** True when the straight segment is walkable, so the body need not leave it. */
  direct: boolean;
}

/**
 * A short path around axis-aligned solids. The body stays on the same
 * blockedAt test the walker uses. Heading is not involved: x/z are world.
 */
export function planRoute(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocks: readonly Block[],
  height: (x: number, z: number) => number,
  limit: number,
): Plan | null {
  const start = { x: x0, z: z0 };
  const goal = { x: x1, z: z1 };
  if (!standable(goal, blocks, limit)) return null;
  if (!standable(start, blocks, limit)) return null;
  const direct = segmentClear(start, goal, blocks, height, limit);
  if (direct) return { points: [start, goal], around: [], direct: true };

  const nodes = [start, goal];
  for (const block of blocks) {
    const xs = [block.minX - PAD, block.maxX + PAD];
    const zs = [block.minZ - PAD, block.maxZ + PAD];
    for (const x of xs) {
      for (const z of zs) {
        const point = { x, z };
        if (!standable(point, blocks, limit)) continue;
        if (nodes.some((other) => Math.hypot(other.x - x, other.z - z) < 0.05)) continue;
        nodes.push(point);
      }
    }
  }

  const n = nodes.length;
  const visible: boolean[][] = Array.from({ length: n }, () =>
    Array.from({ length: n }, () => false),
  );
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const clear = segmentClear(nodes[i], nodes[j], blocks, height, limit);
      visible[i][j] = clear;
      visible[j][i] = clear;
    }
  }

  const goalIndex = 1;
  const gScore = Array.from({ length: n }, () => Infinity);
  const came = Array.from({ length: n }, () => -1);
  gScore[0] = 0;
  const open: number[] = [0];
  const closed = new Set<number>();
  while (open.length > 0) {
    open.sort(
      (a, b) =>
        gScore[a] +
        span(nodes[a], nodes[goalIndex]) -
        (gScore[b] + span(nodes[b], nodes[goalIndex])),
    );
    const current = open.shift();
    if (current === undefined || closed.has(current)) continue;
    if (current === goalIndex) break;
    closed.add(current);
    for (let next = 0; next < n; next++) {
      if (!visible[current][next] || closed.has(next)) continue;
      const score = gScore[current] + span(nodes[current], nodes[next]);
      if (score >= gScore[next]) continue;
      gScore[next] = score;
      came[next] = current;
      open.push(next);
    }
  }
  if (!Number.isFinite(gScore[goalIndex])) return null;

  const points: PlanPoint[] = [];
  for (let at = goalIndex; at >= 0; at = came[at]) points.push(nodes[at]);
  points.reverse();
  return {
    points: pull(points, blocks, height, limit),
    around: blocksBetween(start, goal, blocks),
    direct: false,
  };
}

function standable(point: PlanPoint, blocks: readonly Block[], limit: number): boolean {
  return Math.hypot(point.x, point.z) <= limit && !blockedAt(point.x, point.z, blocks);
}

function span(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

/** True when every sample can be stood on and no step climbs faster than the body allows. */
function segmentClear(
  a: PlanPoint,
  b: PlanPoint,
  blocks: readonly Block[],
  height: (x: number, z: number) => number,
  limit: number,
): boolean {
  const length = span(a, b);
  const steps = Math.max(1, Math.ceil(length / SAMPLE));
  let previous = height(a.x, a.z);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    // Both ends of every segment are standable, so the line cannot leave the round limit.
    /* v8 ignore next 2 */
    if (Math.hypot(x, z) > limit) return false;
    if (blockedAt(x, z, blocks)) return false;
    const ground = height(x, z);
    if (ground - previous > GAIT.maxSlope * (length / steps)) return false;
    previous = ground;
  }
  return true;
}

function blocksBetween(a: PlanPoint, b: PlanPoint, blocks: readonly Block[]): string[] {
  const length = span(a, b);
  const steps = Math.max(1, Math.ceil(length / SAMPLE));
  const ids: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const hit = blockAt(x, z, blocks);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

/** Drop waypoints the body can already see past. */
function pull(
  points: PlanPoint[],
  blocks: readonly Block[],
  height: (x: number, z: number) => number,
  limit: number,
): PlanPoint[] {
  const kept: PlanPoint[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !segmentClear(points[i], points[j], blocks, height, limit)) j -= 1;
    if (kept.length === 0) kept.push(points[i]);
    kept.push(points[j]);
    i = j;
  }
  /* v8 ignore next */
  return kept.length > 0 ? kept : points;
}
