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
} as const;

export class Terrain {
  readonly seed: number;
  readonly #noise: (x: number, y: number) => number;
  readonly #warp: (x: number, y: number) => number;
  readonly #angle: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.#noise = createNoise(this.seed);
    this.#warp = createNoise(this.seed ^ 0x9e3779b9);
    // 直接从种子里取一个方向；不要再开一条随机流，地形构造要保持纯函数。
    this.#angle = ((this.seed * 2654435761) % 6283) / 1000;
  }

  /**
   * World height at a horizontal point. The origin is flattened.
   *
   * 三层地形：扭曲过的 fbm 做缓坡，脊线噪声做山脊，再加一条随种子转向的
   * 长坡，岛的边缘用低频噪声咬出不规则的海岸。近处压平给巢穴，远处收到 0。
   */
  height(x: number, z: number): number {
    const radius = Math.hypot(x, z);
    if (radius >= TERRAIN.island) return 0;
    // 海岸只往里收，保证 island 之外永远是平的。
    const coast =
      TERRAIN.island * (0.86 + 0.11 * (this.#noise(x * 0.016 + 11.3, z * 0.016 - 7.7) * 0.5 + 0.5));
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

    const wx = x + 6 * this.#warp(x * 0.027 + 4.1, z * 0.027 - 3.7);
    const wz = z + 6 * this.#warp(x * 0.027 - 7.3, z * 0.027 + 5.9);
    const base = fbm(this.#noise, wx * 0.045, wz * 0.045);
    const ridge = 1 - Math.abs(fbm(this.#noise, wx * 0.075 + 13.1, wz * 0.075 - 5.7));
    const axis = (x * Math.cos(this.#angle) + z * Math.sin(this.#angle)) / TERRAIN.island;
    const h = base * 7 + (ridge - 0.5) * 3.4 + axis * 2.4;
    // 不把低处压成 0：留出真正的谷地，巢穴外面才不是一圈等高的环。
    return h * mask * pad;
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
