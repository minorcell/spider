import { Color, MathUtils } from 'three';
import { PALETTE } from './config.js';
import { TERRAIN } from './terrain.js';

/** 等高线间距。地形越高，线越密，噪声的形状就露出来了。 */
const CONTOUR_STEP = 0.6;
const CONTOUR_TOP = 6.4;
const CONTOUR_BOTTOM = -3;

const water = new Color(PALETTE.water);
const lowland = new Color(PALETTE.ground);
const earth = new Color(PALETTE.earth);
const stone = new Color(PALETTE.stone);
const scratch = new Color();

/** 地势越低越像水，越高越像石头；陡坡再压一点石头色。 */
function terrainColor(h: number, slope: number, out: Color): void {
  if (h < -1) out.copy(water);
  else if (h < -0.2) out.copy(water).lerp(lowland, MathUtils.smoothstep(h, -1, -0.2));
  else if (h < 1.8) out.copy(lowland).lerp(earth, MathUtils.smoothstep(h, 0.2, 1.8) * 0.35);
  else if (h < 3.2) out.copy(earth).lerp(stone, MathUtils.smoothstep(h, 1.8, 3.2) * 0.6);
  else out.copy(stone);
  const steep = MathUtils.smoothstep(slope, 0.65, 1.25) * 0.35;
  if (steep > 0) out.lerp(stone, steep);
}

export interface IslandBuffers {
  groundPosition: Float32Array;
  groundColor: Float32Array;
  groundIndex: Uint32Array;
  grid: Float32Array;
  contourMinor: Float32Array;
  contourMajor: Float32Array;
}

/** Ground, slope curves, and contours. Plain arrays so a worker can transfer them. */
export function islandBuffers(
  height: (x: number, z: number) => number,
  half = TERRAIN.half,
  segments = TERRAIN.segments,
): IslandBuffers {
  return {
    ...groundAttributes(height, half, segments),
    grid: flowLines(height, half),
    ...contourLines(height, half, segments),
  };
}

/** The displaced plane. Vertex order matches PlaneGeometry after rotateX(-90°). */
export function groundAttributes(
  height: (x: number, z: number) => number,
  half: number,
  segments: number,
): Pick<IslandBuffers, 'groundPosition' | 'groundColor' | 'groundIndex'> {
  const cols = segments + 1;
  const cell = (half * 2) / segments;
  const position = new Float32Array(cols * cols * 3);
  const color = new Float32Array(cols * cols * 3);
  const index = new Uint32Array(segments * segments * 6);
  let vertex = 0;
  for (let iy = 0; iy < cols; iy++) {
    const z = iy * cell - half;
    for (let ix = 0; ix < cols; ix++) {
      const x = ix * cell - half;
      const y = height(x, z);
      position[vertex] = x;
      position[vertex + 1] = y;
      position[vertex + 2] = z;
      const slope =
        Math.hypot(
          height(x + cell, z) - height(x - cell, z),
          height(x, z + cell) - height(x, z - cell),
        ) /
        (2 * cell);
      terrainColor(y, slope, scratch);
      scratch.toArray(color, vertex);
      vertex += 3;
    }
  }
  let triangle = 0;
  for (let iy = 0; iy < segments; iy++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = ix + cols * iy;
      const b = ix + cols * (iy + 1);
      const d = ix + 1 + cols * iy;
      const c = ix + 1 + cols * (iy + 1);
      index[triangle] = a;
      index[triangle + 1] = b;
      index[triangle + 2] = d;
      index[triangle + 3] = b;
      index[triangle + 4] = c;
      index[triangle + 5] = d;
      triangle += 6;
    }
  }
  return { groundPosition: position, groundColor: color, groundIndex: index };
}

/** Curves that follow the slope, with a small bow so a plane does not turn back into a ruler grid. */
function flowLines(height: (x: number, z: number) => number, half: number): Float32Array {
  const points: number[] = [];
  const spacing = 4.5;
  const step = 0.7;
  const steps = 10;
  const lift = 0.02;
  const e = 0.55;
  let n = 0;
  const trace = (x0: number, z0: number, sign: number): void => {
    let x = x0;
    let z = z0;
    for (let i = 0; i < steps; i++) {
      const gx = height(x + e, z) - height(x - e, z);
      const gz = height(x, z + e) - height(x, z - e);
      const glen = Math.hypot(gx, gz);
      const flat = glen < 1e-4;
      const wx = flat ? Math.cos(n * 0.17) : gx / glen;
      const wz = flat ? Math.sin(n * 0.17) : gz / glen;
      const bow = 0.16 * Math.sin(i * 0.85 + n);
      const nx = x + sign * wx * step - wz * bow;
      const nz = z + sign * wz * step + wx * bow;
      if (nx < -half || nx > half || nz < -half || nz > half) break;
      points.push(x, height(x, z) + lift, z, nx, height(nx, nz) + lift, nz);
      x = nx;
      z = nz;
    }
  };
  for (let x = -half; x <= half; x += spacing) {
    for (let z = -half; z <= half; z += spacing) {
      n += 1;
      trace(x, z, 1);
      trace(x, z, -1);
    }
  }
  return Float32Array.from(points);
}

function contourLines(
  height: (x: number, z: number) => number,
  half: number,
  segments: number,
): Pick<IslandBuffers, 'contourMinor' | 'contourMajor'> {
  const cell = (half * 2) / segments;
  const cols = segments + 1;
  const heights = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++)
      heights[j * cols + i] = height(-half + i * cell, -half + j * cell);
  }
  const levels: number[] = [];
  for (let level = CONTOUR_BOTTOM; level <= CONTOUR_TOP; level += CONTOUR_STEP) levels.push(level);
  const minor: number[] = [];
  const major: number[] = [];
  const crossings: [number, number][] = [];
  for (let j = 0; j < segments; j++) {
    const z0 = -half + j * cell;
    for (let i = 0; i < segments; i++) {
      const x0 = -half + i * cell;
      const h00 = heights[j * cols + i];
      const h10 = heights[j * cols + i + 1];
      const h01 = heights[(j + 1) * cols + i];
      const h11 = heights[(j + 1) * cols + i + 1];
      for (let k = 0; k < levels.length; k++) {
        const level = levels[k];
        crossings.length = 0;
        addCrossing(crossings, level, h00, h10, x0, z0, x0 + cell, z0);
        addCrossing(crossings, level, h10, h11, x0 + cell, z0, x0 + cell, z0 + cell);
        addCrossing(crossings, level, h11, h01, x0 + cell, z0 + cell, x0, z0 + cell);
        addCrossing(crossings, level, h01, h00, x0, z0 + cell, x0, z0);
        const out = k % 5 === 4 ? major : minor;
        for (let p = 0; p + 1 < crossings.length; p += 2) {
          const a = crossings[p];
          const b = crossings[p + 1];
          out.push(a[0], level + 0.03, a[1], b[0], level + 0.03, b[1]);
        }
      }
    }
  }
  return { contourMinor: Float32Array.from(minor), contourMajor: Float32Array.from(major) };
}

function addCrossing(
  out: [number, number][],
  level: number,
  a: number,
  b: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): void {
  if ((a < level && b >= level) || (b < level && a >= level)) {
    const t = (level - a) / (b - a);
    out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
  }
}
