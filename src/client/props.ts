import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Group,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  LineSegments,
  Mesh,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  Vector2,
} from 'three';
import type { Footprint } from '../shared/state.js';
import { surfaceAt } from '../shared/terrain.js';
import { inkMat, paperMat } from '../shared/sim/parts.js';

// The nest is a room. Front faces alone are culled from inside, so the far wall
// disappears and the outside shows through. This one faces both ways.
const nestMat = paperMat.clone();
nestMat.side = DoubleSide;

/** Line-art prop. The apple's origin is its bottom. Nest and grass sit on the ground. */
export function buildProp(kind: string, stage: number, footprint?: Footprint): Group | null {
  if (kind === 'apple') return buildApple(stage);
  if (kind === 'nest') return buildNest();
  if (kind === 'grass') return buildGrass(footprint?.kind === 'circle' ? footprint.r : 1.7);
  return null;
}

function buildApple(stage: number): Group {
  const apple = new Group();
  const bite = stage <= 0 ? 0 : stage === 1 ? 0.34 : 0.68;
  const body = new Mesh(bittenApple(bite), paperMat);
  // A smooth lathe has no sharp edge, so EdgesGeometry draws nothing and the
  // paper body vanishes into the page. The ink is a few ribs and rings.
  body.add(new LineSegments(appleWire(bite), inkMat));
  apple.add(body);

  const stem = new Mesh(new CylinderGeometry(0.018, 0.026, 0.16, 5), paperMat);
  stem.position.set(0.03, 0.64, 0);
  stem.rotation.z = 0.35;
  stem.rotation.x = -0.2;
  stem.add(new LineSegments(new EdgesGeometry(stem.geometry, 1), inkMat));
  apple.add(stem);

  const leaf = new Mesh(appleLeaf(), paperMat);
  leaf.position.set(0.14, 0.6, 0.02);
  leaf.rotation.z = -0.7;
  leaf.rotation.y = 0.4;
  leaf.add(new LineSegments(new EdgesGeometry(leaf.geometry, 1), inkMat));
  apple.add(leaf);
  return apple;
}

/** Profile of the apple, bottom shifted to y = 0. x is the radius. */
function appleProfile(): Vector2[] {
  const points: Vector2[] = [];
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = (t - 0.12) * 0.7;
    let radius = Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.72 * 0.34;
    radius *= 1 + 0.08 * Math.sin(Math.PI * t);
    if (t > 0.78) radius *= 1 - ((t - 0.78) / 0.22) * 0.62;
    if (t < 0.1) radius *= 0.45 + t * 5;
    points.push(new Vector2(Math.max(0.015, radius), y));
  }
  const bottom = Math.min(...points.map((point) => point.y));
  for (const point of points) point.y -= bottom;
  return points;
}

/** A lathed apple: fat middle, dimples at the crown and the blossom end. */
function appleShape(): BufferGeometry {
  return new LatheGeometry(appleProfile(), 14);
}

/**
 * Ribs and rings in the same frame as LatheGeometry: x = r·sin(phi), z = r·cos(phi).
 * A bite flattens +X, which is phi = π/2.
 */
function appleWire(amount: number): BufferGeometry {
  const points = appleProfile();
  const peak = Math.max(...points.map((point) => point.x));
  const cut = amount > 0 ? peak * (1 - amount) : null;
  const place = (radius: number, y: number, phi: number): [number, number, number] => {
    const sin = Math.sin(phi);
    const cos = Math.cos(phi);
    let r = radius;
    if (cut != null && sin > 0 && r * sin > cut) r = cut / sin;
    return [r * sin, y, r * cos];
  };
  const positions: number[] = [];
  const segment = (a: [number, number, number], b: [number, number, number]) => {
    /* v8 ignore next */
    if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 1e-8) return;
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  };

  const ribs = 6;
  for (let rib = 0; rib < ribs; rib++) {
    const phi = Math.PI / 2 + (rib / ribs) * Math.PI * 2;
    for (let i = 0; i < points.length - 1; i++) {
      segment(place(points[i].x, points[i].y, phi), place(points[i + 1].x, points[i + 1].y, phi));
    }
  }
  for (const at of [0.28, 0.55, 0.8]) {
    const index = Math.round(at * (points.length - 1));
    const point = points[index];
    const turns = 16;
    for (let i = 0; i < turns; i++) {
      const phi = (i / turns) * Math.PI * 2;
      const next = ((i + 1) / turns) * Math.PI * 2;
      segment(place(point.x, point.y, phi), place(point.x, point.y, next));
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geo;
}

function bittenApple(amount: number): BufferGeometry {
  const geo = appleShape();
  if (amount <= 0) return geo;
  const position = geo.getAttribute('position');
  let peak = 0;
  for (let i = 0; i < position.count; i++) peak = Math.max(peak, position.getX(i));
  const cut = peak * (1 - amount);
  for (let i = 0; i < position.count; i++) {
    if (position.getX(i) > cut) position.setX(i, cut);
  }
  geo.computeVertexNormals();
  return geo;
}

function appleLeaf(): BufferGeometry {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.05, 0.04, 0.16, 0.05, 0.22, 0);
  shape.bezierCurveTo(0.16, -0.045, 0.05, -0.03, 0, 0);
  return new ShapeGeometry(shape);
}

function buildNest(): Group {
  const nest = new Group();
  const radius = 3.55;
  const gap = 1.05;
  // phi 0 faces -X. The missing wedge is centered on -Z, the door you are born facing.
  // One shell. A second, smaller dome reads as another nest with a gap between them.
  const phiStart = -Math.PI / 2 + gap / 2;
  const shell = new SphereGeometry(radius, 36, 16, phiStart, Math.PI * 2 - gap, 0, Math.PI / 2);
  const mound = new Mesh(shell, nestMat);
  mound.add(new LineSegments(new EdgesGeometry(shell, 16), inkMat));
  nest.add(mound);
  return nest;
}

function buildGrass(radius: number): Group {
  const grass = new Group();
  const count = 64;
  for (let i = 0; i < count; i++) {
    const angle = i * 2.399963;
    const dist = radius * Math.sqrt((i + 0.5) / count) * 0.96;
    const height = 0.28 + (i % 9) * 0.09;
    const width = i % 6 === 0 ? 0.055 : 0.02;
    const blade = new BoxGeometry(width, height, 0.012);
    const mesh = new Mesh(blade, paperMat);
    mesh.userData.half = height / 2;
    mesh.position.set(Math.cos(angle) * dist, height / 2, Math.sin(angle) * dist);
    mesh.rotation.y = angle * 0.37;
    mesh.rotation.z = ((i % 7) - 3) * 0.09;
    mesh.rotation.x = ((i % 5) - 2) * 0.07;
    mesh.add(new LineSegments(new EdgesGeometry(blade, 1), inkMat));
    grass.add(mesh);
  }
  return grass;
}

/** Stand each blade on the ground triangle under its own foot, instead of the patch center. */
export function drapeGrass(
  group: Group,
  x: number,
  z: number,
  height: (x: number, z: number) => number,
): void {
  group.position.set(x, 0, z);
  for (const blade of group.children) {
    const half = blade.userData.half;
    if (typeof half !== 'number') continue;
    const wx = x + blade.position.x;
    const wz = z + blade.position.z;
    // The box rotates about its center, so a corner hangs below `half`.
    let dip = half;
    const rx = blade.rotation.x;
    const rz = blade.rotation.z;
    const cy = Math.cos(rx);
    const sy = Math.sin(rx);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    for (const cx of [-0.03, 0.03]) {
      for (const y of [-half, half]) {
        for (const cz0 of [-0.008, 0.008]) {
          const y1 = y * cy - cz0 * sy;
          const y2 = cx * sz + y1 * cz;
          dip = Math.max(dip, -y2);
        }
      }
    }
    blade.position.y = surfaceAt(height, wx, wz) + dip + 0.02;
  }
}
