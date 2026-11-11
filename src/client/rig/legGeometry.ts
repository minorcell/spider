import {
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import { mineralGrain } from '@/src/client/models/surface';

import { BONES } from '@/src/shared/config';

export const segmentMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
  bumpMap: mineralGrain,
  bumpScale: 0.007,
});
export const setaeMat = new LineBasicMaterial({
  color: 0x71614e,
  transparent: true,
  opacity: 0.65,
});

export function legGeometry(section: number): { shell: BufferGeometry; setae: BufferGeometry } {
  const positions: number[] = [];
  const colors: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const hairs: number[] = [];
  const profile = BONES[section].profile;
  const rows = 16,
    sides = 12;
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    const at = Math.min(3, Math.floor(t * 4));
    const f = t * 4 - at;
    const radius = profile[at] * (1 - f) + profile[at + 1] * f;
    const curve = Math.sin(t * Math.PI) * BONES[section].curve;
    for (let side = 0; side <= sides; side++) {
      const angle = (side / sides) * Math.PI * 2;
      const x = Math.cos(angle) * radius + curve;
      const y = Math.sin(angle) * radius * (section === 0 ? 0.92 : 0.78);
      positions.push(x, y, -t);
      uv.push(side / sides, t);
      const band = 1 - 0.24 * Math.exp(-Math.pow((t - 0.82) * 14, 2));
      const dorsal = 0.85 + Math.max(0, Math.sin(angle)) * 0.15;
      colors.push(0.62 * band * dorsal, 0.5 * band * dorsal, 0.36 * band * dorsal);
      if (row > 1 && row < rows - 1 && row % 2 === 0 && side % 3 === 0) {
        hairs.push(x, y, -t, x + Math.cos(angle) * 0.33, y + Math.sin(angle) * 0.33, -t - 0.018);
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let side = 0; side < sides; side++) {
      const a = row * (sides + 1) + side,
        b = a + sides + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const shell = new BufferGeometry();
  shell.setAttribute('position', new Float32BufferAttribute(positions, 3));
  shell.setAttribute('color', new Float32BufferAttribute(colors, 3));
  shell.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  shell.setIndex(indices);
  shell.computeVertexNormals();
  const setae = new BufferGeometry();
  setae.setAttribute('position', new Float32BufferAttribute(hairs, 3));
  return { shell, setae };
}

export const LEG_GEOMETRIES = BONES.map((_, section) => legGeometry(section));
