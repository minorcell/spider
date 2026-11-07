import { createNoise } from './noise.js';

export const TERRAIN = {
  half: 52,
  island: 50,
  pad: 8,
  flat: 5.2,
  segments: 104,
  water: -0.8,
  river: 14,
  riverWidth: 3.2,
} as const;

const GRID_VERTS = (TERRAIN.segments + 1) ** 2;

export const WORLD_RADIUS = TERRAIN.island * 0.86;

export interface Land {
  inside?: (x: number, z: number, margin?: number) => boolean;
}

export function insideLand(land: Land, x: number, z: number, margin = 0): boolean {
  return land.inside ? land.inside(x, z, margin) : true;
}

export interface Ground {
  height(x: number, z: number): number;
  surface?(x: number, z: number): number;
}

export function surfaceOf(ground: Ground, x: number, z: number): number {
  return ground.surface ? ground.surface(x, z) : ground.height(x, z);
}

export function nearestWater(
  ground: Ground,
  x: number,
  z: number,
  reach: number,
): { x: number; z: number; distance: number } | null {
  const wet = (px: number, pz: number): boolean =>
    (ground.surface ? ground.surface(px, pz) : TERRAIN.water) > ground.height(px, pz);
  if (wet(x, z)) return { x, z, distance: 0 };
  const directions = 24;
  const step = 0.25;
  for (let distance = step; distance <= reach + 1e-9; distance += step) {
    for (let i = 0; i < directions; i++) {
      const angle = (i / directions) * Math.PI * 2;
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;
      if (wet(px, pz)) return { x: px, z: pz, distance };
    }
  }
  return null;
}

export function bakeTerrainGrid(seed: number): Float32Array {
  const noise = createNoise(seed);
  const warp = createNoise(seed ^ 0x9e3779b9);
  const angle = ((seed * 2654435761) % 6283) / 1000;
  const cols = TERRAIN.segments + 1;
  const grid = new Float32Array(cols * cols);
  const half = TERRAIN.half;
  const cell = (half * 2) / TERRAIN.segments;
  for (let j = 0; j < cols; j++) {
    const z = -half + j * cell;
    const row = j * cols;
    for (let i = 0; i < cols; i++) grid[row + i] = sample(noise, warp, angle, -half + i * cell, z);
  }
  return grid;
}

export class Terrain {
  readonly seed: number;
  readonly #grid: Float32Array;
  readonly #noise: (x: number, y: number) => number;

  constructor(seed: number, grid?: Float32Array) {
    this.seed = seed >>> 0;
    if (grid && grid.length !== GRID_VERTS) throw new Error('bad terrain grid');
    this.#grid = grid ?? bakeTerrainGrid(this.seed);
    this.#noise = createNoise(this.seed);
  }

  height(x: number, z: number): number {
    const half = TERRAIN.half;
    const segments = TERRAIN.segments;
    if (x <= -half || z <= -half || x >= half || z >= half) return 0;
    const cols = segments + 1;
    const cell = (half * 2) / segments;
    const ix = Math.min(segments - 1, Math.max(0, Math.floor((x + half) / cell)));
    const iz = Math.min(segments - 1, Math.max(0, Math.floor((z + half) / cell)));
    const x0 = -half + ix * cell;
    const z0 = -half + iz * cell;
    const fx = (x - x0) / cell;
    const fz = (z - z0) / cell;
    const h00 = this.#grid[iz * cols + ix];
    const h10 = this.#grid[iz * cols + ix + 1];
    const h01 = this.#grid[(iz + 1) * cols + ix];
    const h11 = this.#grid[(iz + 1) * cols + ix + 1];
    if (fx + fz <= 1) return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
    return h01 * (1 - fx) + h11 * (fx + fz - 1) + h10 * (1 - fz);
  }

  surface(x: number, z: number): number {
    return Math.max(this.height(x, z), TERRAIN.water);
  }

  inside(x: number, z: number, margin = 0): boolean {
    const radius = Math.hypot(x, z);
    const coast =
      TERRAIN.island * (0.86 + 0.11 * (this.#noise(x * 0.016 + 11.3, z * 0.016 - 7.7) * 0.5 + 0.5));
    return radius < coast - margin;
  }
}

function sample(
  noise: (x: number, y: number) => number,
  warp: (x: number, y: number) => number,
  angle: number,
  x: number,
  z: number,
): number {
  const radius = Math.hypot(x, z);
  if (radius >= TERRAIN.island) return 0;
  const coast =
    TERRAIN.island * (0.86 + 0.11 * (noise(x * 0.016 + 11.3, z * 0.016 - 7.7) * 0.5 + 0.5));
  const rim = radius / coast;
  if (rim >= 1) return 0;
  const edge = rim <= 0.8 ? 1 : (1 - rim) / 0.2;
  const mask = edge * edge * (3 - 2 * edge);
  let pad = 1;
  if (radius <= TERRAIN.flat) pad = 0;
  else if (radius < TERRAIN.pad) {
    const u = (radius - TERRAIN.flat) / (TERRAIN.pad - TERRAIN.flat);
    pad = u * u * (3 - 2 * u);
  }

  const wx = x + 6 * warp(x * 0.027 + 4.1, z * 0.027 - 3.7);
  const wz = z + 6 * warp(x * 0.027 - 7.3, z * 0.027 + 5.9);
  const along = x * Math.cos(angle) + z * Math.sin(angle);
  const across = -x * Math.sin(angle) + z * Math.cos(angle);
  const region = (cx: number, cz: number, width: number): number => {
    const t = Math.max(0, 1 - Math.hypot(along - cx, across - cz) / width);
    return t * t * (3 - 2 * t);
  };
  const mountain = region(-12, -24, 20);
  const lowland = region(16, 15, 20);
  const plain = region(17, -16, 20);
  const base = noise(wx * 0.032, wz * 0.032);
  const detail = noise(wx * 0.095 + 13.1, wz * 0.095 - 5.7);
  const ridge = 1 - Math.abs(noise(wx * 0.06 - 4.3, wz * 0.06 + 8.1));
  const rolling = (base * 1.5 + detail * 0.12) * (1 - plain * 0.95);
  const h = rolling + mountain * (3.8 + ridge * 3.8) + lowland * (-1.8 + detail * 1.8);
  return carveRiver(x, z, angle, pad === 0 ? 0 : h * mask * pad);
}

function carveRiver(x: number, z: number, angle: number, height: number): number {
  const bearing = angle + 1.37;
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  const along = x * cos + z * sin;
  const across = -x * sin + z * cos;
  const phase = angle * 1.9;
  const center =
    TERRAIN.river +
    Math.sin(along * 0.105 + phase) * 2.7 +
    Math.sin(along * 0.23 - phase * 0.7) * 1.15;
  const width =
    TERRAIN.riverWidth +
    Math.sin(along * 0.16 + phase * 1.3) * 0.55 +
    Math.sin(along * 0.31 - phase) * 0.25;
  const edge = 1 - Math.abs(across - center) / width;
  if (edge <= 0) return height;
  const profile = edge * edge * (3 - 2 * edge);
  const bed =
    TERRAIN.water -
    (0.95 + Math.sin(along * 0.19 + phase * 0.6) * 0.25 + Math.sin(along * 0.047) * 0.3);
  return Math.min(height, height + (bed - height) * profile);
}

export function surfaceAt(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  half = TERRAIN.half,
  segments = TERRAIN.segments,
): number {
  const cell = (half * 2) / segments;
  const ix = Math.min(segments - 1, Math.max(0, Math.floor((x + half) / cell)));
  const iz = Math.min(segments - 1, Math.max(0, Math.floor((z + half) / cell)));
  const x0 = -half + ix * cell;
  const z0 = -half + iz * cell;
  const fx = Math.min(1, Math.max(0, (x - x0) / cell));
  const fz = Math.min(1, Math.max(0, (z - z0) / cell));
  const h00 = height(x0, z0);
  const h10 = height(x0 + cell, z0);
  const h01 = height(x0, z0 + cell);
  const h11 = height(x0 + cell, z0 + cell);
  if (fx + fz <= 1) return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
  return h01 * (1 - fx) + h11 * (fx + fz - 1) + h10 * (1 - fz);
}
