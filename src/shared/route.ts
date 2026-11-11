import { GAIT } from '@/src/shared/config';
import { blockAt, BODY_RADIUS, surfaceLimit, sweepCircle } from '@/src/shared/collision';
import type { Block } from '@/src/shared/state';

const CELL = 3;
const CORRIDOR = 12;
const CORRIDOR_STEP = 0.5;

class BlockGrid {
  readonly #cells = new Map<number, Block[]>();

  constructor(
    blocks: readonly Block[],
    readonly radius: number,
  ) {
    for (const block of blocks) {
      const minX = Math.floor((block.minX - radius) / CELL);
      const maxX = Math.floor((block.maxX + radius) / CELL);
      const minZ = Math.floor((block.minZ - radius) / CELL);
      const maxZ = Math.floor((block.maxZ + radius) / CELL);
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
    return cell ? blockAt(x, z, cell, this.radius) : null;
  }

  blockedAt(x: number, z: number): boolean {
    return this.blockAt(x, z) !== null;
  }

  between(a: PlanPoint, b: PlanPoint): Block[] {
    const found = new Set<Block>();
    const steps = Math.max(1, Math.ceil(span(a, b) / (CELL / 2)));
    for (let i = 0; i <= steps; i++) {
      const x = Math.floor((a.x + ((b.x - a.x) * i) / steps) / CELL);
      const z = Math.floor((a.z + ((b.z - a.z) * i) / steps) / CELL);
      // Include neighboring cells so even a diagonal corner crossing is covered.
      for (let ix = x - 1; ix <= x + 1; ix++) {
        for (let iz = z - 1; iz <= z + 1; iz++) {
          for (const block of this.#cells.get(cellKey(ix, iz)) ?? []) found.add(block);
        }
      }
    }
    return [...found];
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

interface RouteClearance {
  radius?: number;
  turnRadius?: number;
  inside?: (x: number, z: number) => boolean;
  maxSlope?: number;
}

export function planRoute(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocks: readonly Block[],
  height: (x: number, z: number) => number,
  limit: number,
  clearance: RouteClearance = {},
): Plan | null {
  const radius = clearance.radius ?? BODY_RADIUS;
  const grid = new BlockGrid(blocks, radius);
  const pad = (clearance.turnRadius ?? radius) + 0.35;
  const start = { x: x0, z: z0 };
  const goal = { x: x1, z: z1 };
  const standable = ({ x, z }: PlanPoint) =>
    Math.hypot(x, z) <= limit && (clearance.inside?.(x, z) ?? true) && !grid.blockedAt(x, z);
  const surface = {
    blocks: [],
    inside: clearance.inside,
    surface: height,
    maxSlope: clearance.maxSlope ?? GAIT.maxSlope,
  };
  const clear = (a: PlanPoint, b: PlanPoint) => {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    return (
      !sweepCircle(a.x, a.z, dx, dz, radius, grid.between(a, b)) &&
      !surfaceLimit(a.x, a.z, dx, dz, surface)
    );
  };
  if (!standable(goal) || !standable(start)) return null;
  const direct = clear(start, goal);
  if (direct) return { points: [start, goal], around: [], direct: true };

  const nodes = [start, goal];
  for (const block of corridor(blocks, start, goal)) {
    const xs = [block.minX - pad, block.maxX + pad];
    const zs = [block.minZ - pad, block.maxZ + pad];
    for (const x of xs) {
      for (const z of zs) {
        const point = { x, z };
        if (!standable(point)) continue;
        if (nodes.some((other) => Math.hypot(other.x - x, other.z - z) < 0.05)) continue;
        nodes.push(point);
      }
    }
  }

  const n = nodes.length;
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
      if (next === current || closed.has(next)) continue;
      const score = gScore[current] + span(nodes[current], nodes[next]);
      if (score >= gScore[next] || !clear(nodes[current], nodes[next])) continue;
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
    points: pull(points, clear),
    around: blocksBetween(start, goal, grid),
    direct: false,
  };
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

function blocksBetween(a: PlanPoint, b: PlanPoint, grid: BlockGrid): string[] {
  const ids = new Set<string>();
  for (const block of grid.between(a, b)) {
    if (sweepCircle(a.x, a.z, b.x - a.x, b.z - a.z, grid.radius, [block]))
      ids.add(block.owner ?? block.id);
  }
  return [...ids];
}

function pull(points: PlanPoint[], clear: (a: PlanPoint, b: PlanPoint) => boolean): PlanPoint[] {
  const kept: PlanPoint[] = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = points.length - 1;
    while (j > i + 1 && !clear(points[i], points[j])) j -= 1;
    if (kept.length === 0) kept.push(points[i]);
    kept.push(points[j]);
    i = j;
  }
  return kept;
}
