import {
  BackSide,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import { PALETTE } from '@/src/shared/config';

export const paperMat = new MeshLambertMaterial({
  color: PALETTE.paper,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

export const inkMat = new LineBasicMaterial({ color: PALETTE.ink });

export const silkMat = new LineBasicMaterial({
  color: PALETTE.ink,
  transparent: true,
  opacity: 0.42,
});

export const inkSolidMat = new MeshBasicMaterial({ color: PALETTE.ink, side: BackSide });

export const grassMat = new MeshLambertMaterial({
  color: PALETTE.grass,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

export const groundMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const appleMat = new MeshLambertMaterial({
  color: PALETTE.apple,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const leafMat = new MeshLambertMaterial({
  color: PALETTE.leaf,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const stemMat = new MeshLambertMaterial({ color: PALETTE.stem });
export const stoneMat = new MeshLambertMaterial({
  color: PALETTE.stone,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const spiderMat = new MeshLambertMaterial({
  color: PALETTE.spider,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const eyeMat = new MeshBasicMaterial({ color: PALETTE.eye });

export const soilMat = new MeshLambertMaterial({
  color: PALETTE.soil,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

export const jointMat = new MeshLambertMaterial({ color: 0x9b876f });
export const tubeGeo = new CylinderGeometry(0.44, 1, 1, 12, 6);
tubeGeo.rotateX(-Math.PI / 2);
tubeGeo.translate(0, 0, -0.5);
export const tubeShell = growShell(tubeGeo, 0.1, true);
export const tubeCrest = crestLine(tubeGeo);

export const ballGeo = new SphereGeometry(1, 16, 12);
export const ballShell = growShell(ballGeo, 0.08);

// Short, continuously tapered hooks curl down from the narrow tarsal tip.
export const clawGeo = new BufferGeometry();
const clawPositions: number[] = [];
const clawIndices: number[] = [];
for (let ring = 0; ring <= 10; ring++) {
  const t = ring / 10;
  const radius = 0.005 * Math.pow(1 - t, 1.4) + 0.0004;
  for (let side = 0; side <= 8; side++) {
    const angle = (side / 8) * Math.PI * 2;
    clawPositions.push(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius - 0.014 * t * t,
      -0.037 * t,
    );
  }
}
for (let ring = 0; ring < 10; ring++) {
  for (let side = 0; side < 8; side++) {
    const a = ring * 9 + side;
    const b = a + 9;
    clawIndices.push(a, b, a + 1, a + 1, b, b + 1);
  }
}
clawGeo.setAttribute('position', new Float32BufferAttribute(clawPositions, 3));
clawGeo.setIndex(clawIndices);
clawGeo.computeVertexNormals();
export const clawShell = growShell(clawGeo, 0.0007);

export function growShell(
  geometry: BufferGeometry,
  amount: number,
  radial = false,
): BufferGeometry {
  const shell = geometry.clone();
  const position = shell.getAttribute('position');
  const normal = shell.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    const x = normal.getX(i);
    const y = normal.getY(i);
    const z = radial ? 0 : normal.getZ(i);
    const len = Math.hypot(x, y, z);
    if (len < 1e-6) continue;
    position.setXYZ(
      i,
      position.getX(i) + (x / len) * amount,
      position.getY(i) + (y / len) * amount,
      position.getZ(i) + (z / len) * amount,
    );
  }
  return shell;
}

export function crestLine(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  const best = new Map<number, { x: number; y: number; z: number }>();
  for (let i = 0; i < position.count; i++) {
    const key = Math.round(position.getZ(i) * 1e3) / 1e3;
    const y = position.getY(i);
    const prev = best.get(key);
    if (prev && prev.y >= y) continue;
    best.set(key, { x: position.getX(i), y, z: position.getZ(i) });
  }
  const rings = [...best.values()].toSorted((a, b) => b.z - a.z);
  const flat: number[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i];
    const b = rings[i + 1];
    flat.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const line = new BufferGeometry();
  line.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return line;
}
