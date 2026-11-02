import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
  Vector3,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { paperMat } from '../shared/sim/parts.js';
import { TERRAIN } from '../shared/terrain.js';

const LINE_STEP = 2;
/** 等高线间距。地形越高，线越密，噪声的形状就露出来了。 */
const CONTOUR_STEP = 0.6;
const CONTOUR_TOP = 6.4;
const CONTOUR_BOTTOM = -3;

const contourInk = new LineBasicMaterial({ color: PALETTE.ink, transparent: true, opacity: 0.2 });
const contourMajor = new LineBasicMaterial({
  color: PALETTE.ink,
  transparent: true,
  opacity: 0.34,
});

/** Paper island with ink grid lines draped over the same height function. */
export function buildIsland(height: (x: number, z: number) => number): Group {
  const group = new Group();
  const geo = groundGeometry(height, TERRAIN.half, TERRAIN.segments);
  group.add(new Mesh(geo, paperMat));

  const ink = new LineBasicMaterial({ color: PALETTE.grid });
  const points: Vector3[] = [];
  const half = TERRAIN.half;
  for (let x = -half; x <= half; x += LINE_STEP) {
    for (let z = -half; z < half; z += LINE_STEP) {
      points.push(new Vector3(x, height(x, z) + 0.02, z));
      points.push(new Vector3(x, height(x, z + LINE_STEP) + 0.02, z + LINE_STEP));
    }
  }
  for (let z = -half; z <= half; z += LINE_STEP) {
    for (let x = -half; x < half; x += LINE_STEP) {
      points.push(new Vector3(x, height(x, z) + 0.02, z));
      points.push(new Vector3(x + LINE_STEP, height(x + LINE_STEP, z) + 0.02, z));
    }
  }
  group.add(new LineSegments(new BufferGeometry().setFromPoints(points), ink));
  group.add(contours(height));
  return group;
}

/**
 * 等高线：按地形网格的顶点高度走 marching squares。
 * 每个格子只取相邻的两个交点连成一段，鞍点也能画出四条支线。
 */
function contours(height: (x: number, z: number) => number): Group {
  const half = TERRAIN.half;
  const cells = TERRAIN.segments;
  const cell = (half * 2) / cells;
  const cols = cells + 1;
  const heights = new Float32Array(cols * cols);
  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < cols; i++) {
      heights[j * cols + i] = height(-half + i * cell, -half + j * cell);
    }
  }

  const levels: number[] = [];
  for (let level = CONTOUR_BOTTOM; level <= CONTOUR_TOP; level += CONTOUR_STEP) {
    levels.push(level);
  }

  const minor: number[] = [];
  const major: number[] = [];
  const crossings: [number, number][] = [];

  for (let j = 0; j < cells; j++) {
    const z0 = -half + j * cell;
    for (let i = 0; i < cells; i++) {
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

  const minorGeometry = new BufferGeometry();
  minorGeometry.setAttribute('position', new Float32BufferAttribute(minor, 3));
  const majorGeometry = new BufferGeometry();
  majorGeometry.setAttribute('position', new Float32BufferAttribute(major, 3));
  const group = new Group();
  group.add(new LineSegments(minorGeometry, contourInk));
  group.add(new LineSegments(majorGeometry, contourMajor));
  return group;
}

/** 一条边与等高线的交点。 */
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

/** Plane in the x/z ground, displaced by `height`. The normal faces up. */
export function groundGeometry(
  height: (x: number, z: number) => number,
  half: number,
  segments: number,
): BufferGeometry {
  const geo = new PlaneGeometry(half * 2, half * 2, segments, segments);
  // PlaneGeometry faces +z in the xy plane. -90° about x lays it on xz facing +y.
  geo.rotateX(-Math.PI / 2);
  const position = geo.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    position.setY(i, height(position.getX(i), position.getZ(i)));
  }
  geo.computeVertexNormals();
  return geo;
}
