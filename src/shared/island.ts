import { Color, MathUtils } from 'three';
import { PALETTE } from './config.js';
import { mulberry32 } from './noise.js';
import { TERRAIN } from './terrain.js';

const water = new Color(PALETTE.water);
const lowland = new Color(PALETTE.ground);
const earth = new Color(PALETTE.earth);
const stone = new Color(PALETTE.stone);
const scratch = new Color();

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
  coverPosition: Float32Array;
  coverColor: Float32Array;
}

export function islandBuffers(
  height: (x: number, z: number) => number,
  half: number = TERRAIN.half,
  segments: number = TERRAIN.segments,
): IslandBuffers {
  return {
    ...groundAttributes(height, half, segments),
    ...groundCover(height, half),
  };
}

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

function groundCover(
  height: (x: number, z: number) => number,
  half: number,
): Pick<IslandBuffers, 'coverPosition' | 'coverColor'> {
  const rand = mulberry32(0x6d6f7373);
  const positions: number[] = [];
  const colors: number[] = [];
  const moss = new Color(PALETTE.moss);
  const grass = new Color(PALETTE.grass);
  const soil = new Color(PALETTE.earth);
  const tint = new Color();
  const triangle = (points: readonly number[], color: Color): void => {
    positions.push(...points);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
  };
  for (let gx = -half; gx < half; gx += 0.85) {
    for (let gz = -half; gz < half; gz += 0.85) {
      const x = gx + rand() * 0.85;
      const z = gz + rand() * 0.85;
      const y = height(x, z);
      if (
        Math.hypot(x, z) > TERRAIN.island * 0.86 ||
        Math.hypot(x, z) < 4.6 ||
        y <= TERRAIN.water + 0.03
      )
        continue;
      const slope =
        Math.hypot(
          height(x + 0.4, z) - height(x - 0.4, z),
          height(x, z + 0.4) - height(x, z - 0.4),
        ) / 0.8;
      const patch = Math.sin(x * 0.31 + Math.sin(z * 0.17) * 2) + Math.cos(z * 0.27 - x * 0.12);
      const wet = y < TERRAIN.water + 0.7;
      const leafy = slope < 0.6 && y < 3 && patch > -0.35;
      if (rand() > (leafy || wet ? 0.86 : 0.24)) continue;
      tint.copy(wet ? moss : leafy ? grass : soil).multiplyScalar(0.88 + rand() * 0.2);
      const blades = leafy && !wet ? 3 : 5;
      for (let k = 0; k < blades; k++) {
        const angle = rand() * Math.PI * 2;
        const dx = Math.cos(angle);
        const dz = Math.sin(angle);
        const reach = 0.06 + rand() * (wet ? 0.22 : 0.14);
        const width = wet ? 0.045 : 0.018;
        const tipX = x + dx * reach;
        const tipZ = z + dz * reach;
        const lift = leafy && !wet ? 0.05 + rand() * 0.1 : 0.018;
        triangle(
          [
            x - dz * width,
            height(x - dz * width, z + dx * width) + 0.012,
            z + dx * width,
            x + dz * width,
            height(x + dz * width, z - dx * width) + 0.012,
            z - dx * width,
            tipX,
            height(tipX, tipZ) + lift,
            tipZ,
          ],
          tint,
        );
      }
    }
  }
  return { coverPosition: Float32Array.from(positions), coverColor: Float32Array.from(colors) };
}
