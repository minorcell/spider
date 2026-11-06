import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
} from 'three';
import { clamp, mix, positionWorld, sin, uniform } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { PALETTE } from '../shared/config.js';
import { groundAttributes, islandBuffers, type IslandBuffers } from '../shared/island.js';
import { groundMat } from '../shared/sim/parts.js';
import { TERRAIN } from '../shared/terrain.js';

const contourInk = new LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.2 });
const contourMajor = new LineBasicMaterial({
  color: PALETTE.ink,
  transparent: true,
  opacity: 0.34,
});

const waterTime = uniform(0);
const waterShallow = uniform(new Color(PALETTE.water));
const waterDeep = uniform(new Color(PALETTE.water).multiplyScalar(0.78));
const waterOpacity = uniform(0.74);

// Two crossing waves plus a diagonal drift, so the sheet reads as water.
const surface = positionWorld.xz;
const crossing = sin(surface.x.mul(1.35).add(waterTime.mul(1.15))).mul(
  sin(surface.y.mul(1.7).sub(waterTime.mul(0.85))),
);
const drift = sin(surface.x.add(surface.y).mul(1.9).add(waterTime.mul(1.7)));
const ripple = crossing.mul(0.55).add(drift.mul(0.45));

const waterMaterial = new MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: false,
  fog: false,
  side: DoubleSide,
  colorNode: mix(waterDeep, waterShallow, clamp(ripple.mul(0.28).add(0.58), 0, 1)),
  opacityNode: clamp(waterOpacity.add(ripple.mul(0.06)), 0, 1),
});
waterMaterial.userData.uTime = waterTime;

const contourBase = new Color(PALETTE.ink);
const waterBase = new Color(PALETTE.water);

/** Apply the current ecology tint without rebuilding the baked island. */
export function setGroundLight(red: number, green: number, blue: number): void {
  contourInk.color.copy(contourBase);
  contourMajor.color.copy(contourBase);
  waterShallow.value
    .copy(waterBase)
    .setRGB(waterBase.r * red, waterBase.g * green, waterBase.b * blue);
  waterDeep.value
    .copy(waterBase)
    .setRGB(waterBase.r * red * 0.78, waterBase.g * green * 0.78, waterBase.b * blue * 0.78);
}

/** Advance the moving highlights on every water sheet. */
export function tickWater(seconds: number): void {
  waterTime.value = seconds;
}

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

  // One flat sheet at the water line. Every hollow below it shows the sheet;
  // the ground above it hides the sheet, so the shoreline is the real contour.
  // A soft moving highlight keeps the sheet reading as liquid rather than glass.
  const water = new Mesh(new PlaneGeometry(TERRAIN.half * 2, TERRAIN.half * 2), waterMaterial);
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = TERRAIN.water + 0.01;
  group.add(water);
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
