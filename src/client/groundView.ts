import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { groundAttributes, islandBuffers, type IslandBuffers } from '../shared/island.js';
import { groundMat } from '../shared/sim/parts.js';

const contourInk = new LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.2 });
const contourMajor = new LineBasicMaterial({
  color: PALETTE.ink,
  transparent: true,
  opacity: 0.34,
});

/** Paper island. Ink follows the slope in curves, plus the contour lines. */
export function buildIsland(height: (x: number, z: number) => number): Group {
  return islandGroup(islandBuffers(height));
}

/** Upload buffers the world worker already filled. */
export function islandGroup(buffers: IslandBuffers): Group {
  const group = new Group();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(buffers.groundPosition, 3));
  geo.setAttribute('color', new Float32BufferAttribute(buffers.groundColor, 3));
  geo.setIndex(new BufferAttribute(buffers.groundIndex, 1));
  geo.computeVertexNormals();
  group.add(new Mesh(geo, groundMat));

  const ink = new LineBasicMaterial({ color: PALETTE.grid });
  const grid = new BufferGeometry();
  grid.setAttribute('position', new Float32BufferAttribute(buffers.grid, 3));
  group.add(new LineSegments(grid, ink));

  const minor = new BufferGeometry();
  minor.setAttribute('position', new Float32BufferAttribute(buffers.contourMinor, 3));
  const major = new BufferGeometry();
  major.setAttribute('position', new Float32BufferAttribute(buffers.contourMajor, 3));
  const contours = new Group();
  contours.add(new LineSegments(minor, contourInk), new LineSegments(major, contourMajor));
  group.add(contours);
  return group;
}

/** Plane in the x/z ground, displaced by `height`. The normal faces up. */
export function groundGeometry(
  height: (x: number, z: number) => number,
  half: number,
  segments: number,
): BufferGeometry {
  const baked = groundAttributes(height, half, segments);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(baked.groundPosition, 3));
  geo.setAttribute('color', new Float32BufferAttribute(baked.groundColor, 3));
  geo.setIndex(new BufferAttribute(baked.groundIndex, 1));
  geo.computeVertexNormals();
  return geo;
}
