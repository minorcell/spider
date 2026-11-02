import {
  BackSide,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LineBasicMaterial,
  MeshBasicMaterial,
  SphereGeometry,
} from 'three';
import { PALETTE } from '../config.js';

// Every part of the model shares these materials and primitives.

export const paperMat = new MeshBasicMaterial({
  color: PALETTE.paper,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

export const inkMat = new LineBasicMaterial({ color: PALETTE.ink });

/** 丝线：比墨淡，压在土和纸上不会抢主线条。 */
export const silkMat = new LineBasicMaterial({
  color: PALETTE.ink,
  transparent: true,
  opacity: 0.42,
});

/** 实心墨壳，用来给圆润的果子勾外轮廓。 */
export const inkSolidMat = new MeshBasicMaterial({ color: PALETTE.ink, side: BackSide });

/** 草叶要双面，纸面填色。 */
export const grassMat = new MeshBasicMaterial({
  color: PALETTE.grass,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** 岛面、苹果、叶子和梗各用一点淡色；线稿还是同一套墨线。 */
export const groundMat = new MeshBasicMaterial({
  color: 0xffffff,
  vertexColors: true,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const appleMat = new MeshBasicMaterial({
  color: PALETTE.apple,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const leafMat = new MeshBasicMaterial({
  color: PALETTE.leaf,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const stemMat = new MeshBasicMaterial({ color: PALETTE.stem });
export const stoneMat = new MeshBasicMaterial({
  color: PALETTE.stone,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const spiderMat = new MeshBasicMaterial({
  color: PALETTE.spider,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});
export const eyeMat = new MeshBasicMaterial({ color: PALETTE.eye });

/** 巢穴的土面。 */
export const soilMat = new MeshBasicMaterial({
  color: PALETTE.soil,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

/** Unit bone. Local −z runs from the joint toward the next one, and the far end is the narrow one. */
export const tubeGeo = new CylinderGeometry(0.62, 1, 1, 12);
tubeGeo.rotateX(-Math.PI / 2);
tubeGeo.translate(0, 0, -0.5);
export const tubeShell = growShell(tubeGeo, 0.1, true);
export const tubeCrest = crestLine(tubeGeo);

export const ballGeo = new SphereGeometry(1, 16, 12);
export const ballShell = growShell(ballGeo, 0.08);

/** Hooked claw. The wide base is the local origin, which is the end of the tarsus. */
export const clawGeo = new CylinderGeometry(0.0022, 0.009, 0.08, 8);
clawGeo.translate(0, 0.04, 0);
clawGeo.rotateX(-2);
export const clawShell = growShell(clawGeo, 0.0025);

/** Push a copy out along its normals. Radial shells stay put along local z, so a scaled bone does not grow a long cap. */
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

/** The highest vertex of each ring: one ink stripe along the top of a bone. */
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
