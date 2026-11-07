import { GAIT } from './config.js';
import { blockAt, BODY_RADIUS } from './sight.js';
import type { Block } from './state.js';

const PAD = BODY_RADIUS + 0.35;
const SAMPLE = 0.2;
const CELL = 3;
const CORRIDOR = 12;
const CORRIDOR_STEP = 0.5;

class BlockGrid {
  readonly #cells = new Map<number, Block[]>();

  constructor(readonly blocks: readonly Block[]) {
    for (const block of blocks) {
      const minX = Math.floor((block.minX - BODY_RADIUS) / CELL);
      const maxX = Math.floor((block.maxX + BODY_RADIUS) / CELL);
      const minZ = Math.floor((block.minZ - BODY_RADIUS) / CELL);
      const maxZ = Math.floor((block.maxZ + BODY_RADIUS) / CELL);
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = cellKey(x, z);
          const cell = this.#cells.get(key);
          if (cell) cell.push(block);
          else this.#cells.set(key, [block]);
        }
      }
    }
  }

  blockAt(x: number, z: number): Block | null {
    const cell = this.#cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
    return cell ? blockAt(x, z, cell) : null;
  }

  blockedAt(x: number, z: number): boolean {
    return this.blockAt(x, z) !== null;
  }
}

function cellKey(x: number, z: number): number {
  return (x + 1024) * 2048 + (z + 1024);
}

export interface PlanPoint {
  x: number;
  z: number;
}

export interface Plan {
  points: PlanPoint[];
  around: string[];
  direct: boolean;
}

export function planRoute(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocks: readonly Block[],
  height: (x: number, z: number) => number,
  limit: number,
): Plan | null {
  const grid = new BlockGrid(blocks);
  const start = { x: x0, z: z0 };
  const goal = { x: x1, z: z1 };
  if (!standable(goal, grid, limit)) return null;
  if (!standable(start, grid, limit)) return null;
  const direct = segmentClear(start, goal, grid, height);
  if (direct) return { points: [start, goal], around: [], direct: true };

  const nodes = [start, goal];
  for (const block of corridor(blocks, start, goal)) {
    const xs = [block.minX - PAD, block.maxX + PAD];
    const zs = [block.minZ - PAD, block.maxZ + PAD];
    for (const x of xs) {
      for (const z of zs) {
        const point = { x, z };
        if (!standable(point, grid, limit)) continue;
        if (nodes.some((other) => Math.hypot(other.x - x, other.z - z) < 0.05)) continue;
        nodes.push(point);
      }
    }
  }

  const n = nodes.length;
  const sees = (i: number, j: number): boolean => {
    return segmentClear(nodes[i], nodes[j], grid, height);
  };

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
      if (next === current || closed.has(next) || !sees(current, next)) continue;
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
    points: pull(points, grid, height),
    around: blocksBetween(start, goal, grid),
    direct: false,
  };
}

function standable(point: PlanPoint, grid: BlockGrid, limit: number): boolean {
  return Math.hypot(point.x, point.z) <= limit && !grid.blockedAt(point.x, point.z);
}

function corridor(blocks: readonly Block[], a: PlanPoint, b: PlanPoint): Block[] {
  const length = span(a, b);
  const steps = Math.max(1, Math.ceil(length / CORRIDOR_STEP));
  return blocks.filter((block) => {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      const cx = Math.min(block.maxX, Math.max(block.minX, x));
      const cz = Math.min(block.maxZ, Math.max(block.minZ, z));
      if (Math.hypot(x - cx, z - cz) <= CORRIDOR) return true;
    }
    return false;
  });
}

function span(a: PlanPoint, b: PlanPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function segmentClear(
  a: PlanPoint,
  b: PlanPoint,
  grid: BlockGrid,
  height: (x: number, z: number) => number,
): boolean {
  const length = span(a, b);
  const steps = Math.max(1, Math.ceil(length / SAMPLE));
  let previous = height(a.x, a.z);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (grid.blockedAt(x, z)) return false;
    const ground = height(x, z);
    if (ground - previous > GAIT.maxSlope * (length / steps)) return false;
    previous = ground;
  }
  return true;
}

function blocksBetween(a: PlanPoint, b: PlanPoint, grid: BlockGrid): string[] {
  const length = span(a, b);
  const steps = Math.max(1, Math.ceil(length / SAMPLE));
  const ids: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    const hit = grid.blockAt(x, z);
    if (hit && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

function pull(
  points: PlanPoint[],
  grid: BlockGrid,
  height: (x: number, z: number) => number,
): PlanPoint[] {
  const kept: PlanPoint[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !segmentClear(points[i], points[j], grid, height)) j -= 1;
    if (kept.length === 0) kept.push(points[i]);
    kept.push(points[j]);
    i = j;
  }
  return kept;
}
