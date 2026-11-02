import {
  BackSide,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  type BufferGeometry,
  type Object3D,
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

/** 巢穴的土面。 */
export const soilMat = new MeshBasicMaterial({
  color: PALETTE.soil,
  side: DoubleSide,
  polygonOffset: true,
  polygonOffsetFactor: 1,
  polygonOffsetUnits: 1,
});

export const tubeGeo = new CylinderGeometry(0.85, 1, 1, 6);
tubeGeo.rotateX(-Math.PI / 2);
tubeGeo.translate(0, 0, -0.5);
export const tubeEdges = new EdgesGeometry(tubeGeo, 12);

export const ballGeo = new SphereGeometry(1, 8, 6);
export const ballEdges = new EdgesGeometry(ballGeo, 14);

export const clawGeo = new BoxGeometry(0.045, 0.03, 0.22);
clawGeo.translate(0.04, 0, -0.1);
export const clawEdges = new EdgesGeometry(clawGeo, 1);

/** A paper-filled solid with its own ink edges. */
export function addSolid(
  parent: Object3D,
  geo: BufferGeometry,
  x: number,
  y: number,
  z: number,
  rx = 0,
  ry = 0,
): Mesh {
  const mesh = new Mesh(geo, paperMat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rx, ry, 0);
  mesh.add(new LineSegments(new EdgesGeometry(geo, 18), inkMat));
  parent.add(mesh);
  return mesh;
}
