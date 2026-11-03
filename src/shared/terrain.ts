import { createNoise, fbm } from './noise.js';

/** The island sits inside this square. Past the rim the ground is flat at 0. */
export const TERRAIN = {
  half: 52,
  /** Radius at which the hills have faded out. */
  island: 50,
  /** Hills are back to full height past this radius. */
  pad: 8,
  /**
   * Level disk around the birth nest. The mound now reaches about 4.2 from the
   * middle, so this has to clear that rim or the nest sits inside the hill.
   */
  flat: 5.2,
  /** Ground mesh divisions. `surfaceAt` has to use this same grid. */
  segments: 104,
  /** Still water fills every hollow below this height. */
  water: -0.8,
  /** The main river meanders around this distance from the nest. */
  river: 14,
  /** Half-width of the river channel before the banks rise. */
  riverWidth: 3.2,
} as const;

const GRID_VERTS = (TERRAIN.segments + 1) ** 2;

/** The smallest coast any seed can make. A round bound inside it is always land. */
export const WORLD_RADIUS = TERRAIN.island * 0.86;

/** A world that can say whether a point is still on the island. */
export interface Land {
  inside?: (x: number, z: number, margin?: number) => boolean;
}

/** True when the point is on land. A hand-built world without a shore is open. */
export function insideLand(land: Land, x: number, z: number, margin = 0): boolean {
  return land.inside ? land.inside(x, z, margin) : true;
}

/** A world that can say where its ground and water line are. */
export interface Ground {
  height(x: number, z: number): number;
  surface?(x: number, z: number): number;
}

/**
 * The surface a route follows: the solid ground, or the still water line over
 * a hollow. This is not a floor; the body solver decides whether a support is
 * ground or buoyancy.
 */
export function surfaceOf(ground: Ground, x: number, z: number): number {
  return ground.surface ? ground.surface(x, z) : ground.height(x, z);
}

/**
 * The nearest water within `reach`, sampled in rings around the body. Null when
 * the body is on dry ground with no pond close enough to touch.
 */
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

/** Noise at every ground vertex. The page asks the world worker for this. */
export function bakeTerrainGrid(seed: number): Float32Array {
  const noise = createNoise(seed);
  const warp = createNoise(seed ^ 0x9e3779b9);
  // 直接从种子里取一个方向；不要再开一条随机流，地形构造要保持纯函数。
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
  /** Analytic height at each ground vertex. Lookups interpolate this grid. */
  readonly #grid: Float32Array;
  /** The same low-frequency noise that carves the coast. */
  readonly #noise: (x: number, y: number) => number;

  constructor(seed: number, grid?: Float32Array) {
    this.seed = seed >>> 0;
    if (grid && grid.length !== GRID_VERTS) throw new Error('bad terrain grid');
    this.#grid = grid ?? bakeTerrainGrid(this.seed);
    this.#noise = createNoise(this.seed);
  }

  /**
   * World height at a horizontal point. This is the rendered triangle, not the
   * raw noise: the mesh, the body, and loose props all read this grid.
   * The noise is evaluated once, at the vertices, when the island is built.
   */
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
    // Same split as PlaneGeometry: a-b-d when fx + fz <= 1, otherwise b-c-d.
    if (fx + fz <= 1) return h00 * (1 - fx - fz) + h01 * fz + h10 * fx;
    return h01 * (1 - fx) + h11 * (fx + fz - 1) + h10 * (1 - fz);
  }

  /**
   * The travel surface used by route and sight probes: the ground, or the flat
   * water line over a hollow. A body crossing this point still floats or wades
   * according to the water depth under it.
   */
  surface(x: number, z: number): number {
    return Math.max(this.height(x, z), TERRAIN.water);
  }

  /**
   * True when the point is inside the actual coast. `margin` keeps a body's
   * radius clear of the water. This is the round world bound every mover uses.
   */
  inside(x: number, z: number, margin = 0): boolean {
    const radius = Math.hypot(x, z);
    const coast =
      TERRAIN.island * (0.86 + 0.11 * (this.#noise(x * 0.016 + 11.3, z * 0.016 - 7.7) * 0.5 + 0.5));
    return radius < coast - margin;
  }
}

/**
 * Analytic height. The origin is flattened.
 *
 * 三层地形：扭曲过的 fbm 做缓坡，脊线噪声做山脊，再加一条随种子转向的
 * 长坡，岛的边缘用低频噪声咬出不规则的海岸。近处压平给巢穴，远处收到 0。
 */
function sample(
  noise: (x: number, y: number) => number,
  warp: (x: number, y: number) => number,
  angle: number,
  x: number,
  z: number,
): number {
  const radius = Math.hypot(x, z);
  if (radius >= TERRAIN.island) return 0;
  // 海岸只往里收，保证 island 之外永远是平的。
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
  const base = fbm(noise, wx * 0.045, wz * 0.045);
  const ridge = 1 - Math.abs(fbm(noise, wx * 0.075 + 13.1, wz * 0.075 - 5.7));
  const axis = (x * Math.cos(angle) + z * Math.sin(angle)) / TERRAIN.island;
  const h = base * 7 + (ridge - 0.5) * 3.4 + axis * 2.4;
  // 不把低处压成 0：留出真正的谷地，巢穴外面才不是一圈等高的环。
  return carveRiver(x, z, angle, h * mask * pad);
}

/**
 * Cut one continuous, meandering channel through the lowlands. The channel
 * keeps a bed below the water line, so hollows fill and connect instead of
 * reading as a scattered set of round pits.
 *
 * The curve lives in coordinates rotated with the seed. It stays off the nest
 * disk, and its width/depth breathe slowly along the flow so the banks do not
 * look like a canal.
 */
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
  // Smooth the bank into the old terrain instead of leaving a sharp trench.
  const profile = edge * edge * (3 - 2 * edge);
  const bed =
    TERRAIN.water -
    (0.95 + Math.sin(along * 0.19 + phase * 0.6) * 0.25 + Math.sin(along * 0.047) * 0.3);
  return height > bed ? height + (bed - height) * profile : height;
}

/**
 * Height of the rendered ground triangle at a point.
 * PlaneGeometry lays a grid on xz; each cell is split a-b-d and b-c-d
 * (a at the -x/-z corner, b at -x/+z, d at +x/-z, c at +x/+z).
 * The raw noise sits under that triangle on a concave patch, which is how a
 * prop seated on the noise ends up inside the mesh.
 */
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
