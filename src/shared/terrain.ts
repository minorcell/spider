import { createNoise, fbm } from './noise.js';

/** The island sits inside this square. Past the rim the ground is flat at 0. */
export const TERRAIN = {
  half: 36,
  /** Radius at which the hills have faded out. */
  island: 30,
  /** Hills are back to full height past this radius. */
  pad: 6,
  /**
   * Level disk around the birth nest. The woven nest reaches about 3 from the
   * middle, so this has to clear that rim or the reeds sit inside the hill.
   */
  flat: 4.4,
  /** Ground mesh divisions. `surfaceAt` has to use this same grid. */
  segments: 72,
} as const;

const HEIGHT = 3.6;

export class Terrain {
  readonly seed: number;
  readonly #noise: (x: number, y: number) => number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.#noise = createNoise(this.seed);
  }

  /** World height at a horizontal point. The origin is flattened. */
  height(x: number, z: number): number {
    const radius = Math.hypot(x, z);
    const rim = radius / TERRAIN.island;
    if (rim >= 1) return 0;
    const edge = rim <= 0.72 ? 1 : (1 - rim) / 0.28;
    const mask = edge * edge * (3 - 2 * edge);
    let pad = 1;
    if (radius <= TERRAIN.flat) pad = 0;
    else if (radius < TERRAIN.pad) {
      const u = (radius - TERRAIN.flat) / (TERRAIN.pad - TERRAIN.flat);
      pad = u * u;
    }
    const n = fbm(this.#noise, x * 0.055, z * 0.055);
    return n * HEIGHT * mask * pad;
  }
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
