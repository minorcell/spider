import {
  BufferGeometry,
  BoxGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineSegments,
  Matrix4,
  Mesh,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { inkMat, paperMat } from '../shared/sim/parts.js';
import { nestBlocks } from '../shared/world.js';

// The nest is a woven paper basket: a square room of collision walls, lashed
// with reeds and twigs. The base is drawn from nestBlocks() itself, so the
// paper wall and the wall the spider hits can never drift apart.
//
// Every reed, band and twig is baked into two buffers, one paper mesh and one
// ink line set. A whole nest is two draw calls.

const UP = new Vector3(0, 1, 0);
const boxGeo = new BoxGeometry(1, 1, 1).toNonIndexed();
const boxEdges = new EdgesGeometry(boxGeo);
const twigGeo = new CylinderGeometry(0.72, 1, 1, 6, 1).toNonIndexed();
const twigEdges = new EdgesGeometry(twigGeo, 12);

const leafShape = new Shape();
leafShape.moveTo(0, 0);
leafShape.bezierCurveTo(0.07, 0.09, 0.2, 0.11, 0.28, 0.02);
leafShape.bezierCurveTo(0.19, -0.06, 0.07, -0.05, 0, 0);
const leafGeo = new ShapeGeometry(leafShape).toNonIndexed();
const leafEdges = new EdgesGeometry(leafGeo, 1);

/** Door half-angle that clears the 2.5-wide gap in the square wall. */
const DOOR_ANGLE = 0.52;

/** Angle around the door axis: 0 at -Z, positive toward +X, ±π at the back. */
function doorAngle(x: number, z: number): number {
  return Math.atan2(x, -z);
}

const rnd = (n: number): number => {
  const v = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
};

interface Pt {
  x: number;
  z: number;
}

/** A rounded square path around the nest, sampled anticlockwise in x/z. */
function roundedSquare(half: number, radius: number, seg = 8): Pt[] {
  const c = Math.max(0, half - radius);
  const arcs = [
    { cx: c, cz: c, a0: 0 },
    { cx: -c, cz: c, a0: Math.PI / 2 },
    { cx: -c, cz: -c, a0: Math.PI },
    { cx: c, cz: -c, a0: Math.PI * 1.5 },
  ];
  const pts: Pt[] = [];
  for (const arc of arcs) {
    for (let i = 0; i <= seg; i++) {
      const angle = arc.a0 + (i / seg) * (Math.PI / 2);
      pts.push({ x: arc.cx + Math.cos(angle) * radius, z: arc.cz + Math.sin(angle) * radius });
    }
  }
  return pts;
}

/** Resample a closed polyline every `step` world units. */
function walk(pts: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const count = Math.max(1, Math.round(length / step));
    for (let k = 0; k < count; k++) {
      out.push({ x: a.x + ((b.x - a.x) * k) / count, z: a.z + ((b.z - a.z) * k) / count });
    }
  }
  return out;
}

class PaperBatch {
  readonly #faces: number[] = [];
  readonly #lines: number[] = [];
  readonly #matrix = new Matrix4();
  readonly #position = new Vector3();
  readonly #scale = new Vector3();
  readonly #quaternion = new Quaternion();
  readonly #turn = new Quaternion();
  readonly #lean = new Quaternion();
  readonly #dir = new Vector3();

  addGeometry(geo: BufferGeometry, edges: BufferGeometry, matrix: Matrix4): void {
    const position = geo.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      this.#position.fromBufferAttribute(position, i).applyMatrix4(matrix);
      this.#faces.push(this.#position.x, this.#position.y, this.#position.z);
    }
    const edge = edges.getAttribute('position');
    for (let i = 0; i < edge.count; i++) {
      this.#position.fromBufferAttribute(edge, i).applyMatrix4(matrix);
      this.#lines.push(this.#position.x, this.#position.y, this.#position.z);
    }
  }

  addBox(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    ry = 0,
  ): void {
    this.#turn.setFromAxisAngle(UP, ry);
    this.#matrix.compose(
      this.#position.set(x, y, z),
      this.#turn,
      this.#scale.set(width, height, depth),
    );
    this.addGeometry(boxGeo, boxEdges, this.#matrix);
  }

  addReed(
    width: number,
    height: number,
    depth: number,
    x: number,
    z: number,
    leanX: number,
    leanZ: number,
    yaw: number,
  ): void {
    this.#turn.setFromAxisAngle(UP, yaw);
    this.#lean.setFromUnitVectors(UP, this.#dir.set(leanX, 1, leanZ).normalize());
    this.#quaternion.copy(this.#lean).multiply(this.#turn);
    this.#matrix.compose(
      this.#position.set(x, height / 2, z),
      this.#quaternion,
      this.#scale.set(width, height, depth),
    );
    this.addGeometry(boxGeo, boxEdges, this.#matrix);
  }

  addTwig(a: Vector3, b: Vector3, radius: number): void {
    this.#dir.subVectors(b, a);
    const length = this.#dir.length();
    this.#quaternion.setFromUnitVectors(UP, this.#dir.normalize());
    this.#matrix.compose(
      this.#position.addVectors(a, b).multiplyScalar(0.5),
      this.#quaternion,
      this.#scale.set(radius, length, radius),
    );
    this.addGeometry(twigGeo, twigEdges, this.#matrix);
  }

  addLeaf(x: number, y: number, z: number, roll: number): void {
    this.#turn.setFromAxisAngle(new Vector3(0, 0, 1), roll);
    this.#matrix.compose(this.#position.set(x, y, z), this.#turn, this.#scale.set(1, 1, 1));
    this.addGeometry(leafGeo, leafEdges, this.#matrix);
  }

  addLine(a: Vector3, b: Vector3): void {
    this.#lines.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  build(): Group {
    const nest = new Group();
    const paper = new BufferGeometry();
    paper.setAttribute('position', new Float32BufferAttribute(this.#faces, 3));
    nest.add(new Mesh(paper, paperMat));
    const ink = new BufferGeometry();
    ink.setAttribute('position', new Float32BufferAttribute(this.#lines, 3));
    nest.add(new LineSegments(ink, inkMat));
    return nest;
  }
}

/** Rings and radial twigs on the room floor. */
function addFloor(batch: PaperBatch): void {
  const y = 0.03;
  for (const radius of [1.15, 1.9]) {
    const segments = 48;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      batch.addLine(
        new Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius),
        new Vector3(Math.cos(b) * radius, y, Math.sin(b) * radius),
      );
    }
  }
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + 0.08;
    batch.addLine(
      new Vector3(Math.cos(angle) * 1.15, y, Math.sin(angle) * 1.15),
      new Vector3(Math.cos(angle) * 1.9, y, Math.sin(angle) * 1.9),
    );
  }
}

/** Horizontal twigs around a rounded square, skipping the door wedge. */
function addBand(
  batch: PaperBatch,
  half: number,
  thickness: number,
  height: number,
  y: number,
): void {
  const pts = roundedSquare(half, 0.55);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    if (Math.abs(doorAngle(mx, mz)) < DOOR_ANGLE) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    batch.addBox(length * 1.15, height, thickness, mx, y, mz, Math.atan2(-dz, dx));
  }
}

/** The wavy bundle of twigs along the top of the reeds. */
function addRim(batch: PaperBatch, half: number, baseY: number): void {
  const pts = walk(roundedSquare(half, 0.55, 10), 0.26);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const angle = doorAngle(mx, mz);
    if (Math.abs(angle) < DOOR_ANGLE + 0.03) continue;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const length = Math.hypot(dx, dz);
    const grain = rnd(i * 7.1);
    const back = Math.max(0, -Math.cos(angle));
    batch.addBox(
      length * 1.16,
      0.055,
      0.045,
      mx,
      baseY + back * 0.42 + (grain - 0.5) * 0.09,
      mz,
      Math.atan2(-dz, dx),
    );
  }
}

/** Short reeds over the outside of the soil wall, down to the ground. */
function addWallReeds(batch: PaperBatch): void {
  const pts = walk(roundedSquare(2.86, 0.55), 0.22);
  let seed = 300;
  for (let i = 0; i < pts.length; i++) {
    const point = pts[i];
    if (Math.abs(doorAngle(point.x, point.z)) < DOOR_ANGLE) continue;
    const grain = rnd(seed);
    seed += 1;
    const height = 0.4 + grain * 0.28;
    const radius = Math.hypot(point.x, point.z);
    batch.addReed(
      0.05 + grain * 0.025,
      height,
      0.022,
      point.x,
      point.z,
      (point.x / radius) * 0.04,
      (point.z / radius) * 0.04,
      Math.atan2(point.x / radius, point.z / radius) + (grain - 0.5) * 0.3,
    );
  }
}

/** Three rows of reeds, longer at the back so the nest has a shoulder. */
function addReeds(batch: PaperBatch): void {
  const rows = [
    { half: 2.76, step: 0.34, low: 0.5, high: 0.8, radial: 0.24, side: 0.2, width: 0.06 },
    { half: 2.64, step: 0.235, low: 0.9, high: 1.2, radial: 0.22, side: 0.14, width: 0.085 },
    { half: 2.42, step: 0.27, low: 0.68, high: 0.92, radial: 0.1, side: 0.1, width: 0.055 },
  ];
  let seed = 0;
  for (const row of rows) {
    const pts = walk(roundedSquare(row.half, 0.55), row.step);
    for (let i = 0; i < pts.length; i++) {
      const point = pts[i];
      const angle = doorAngle(point.x, point.z);
      if (Math.abs(angle) < DOOR_ANGLE) continue;
      const grain = rnd(seed);
      seed += 1;
      const back = Math.max(0, -Math.cos(angle));
      const height = row.low + (row.high - row.low) * grain + back * 0.44;
      const radius = Math.hypot(point.x, point.z);
      const nx = point.x / radius;
      const nz = point.z / radius;
      const side = (i % 2 === 0 ? 1 : -1) * row.side * (0.5 + grain);
      batch.addReed(
        row.width + grain * 0.025,
        height,
        0.024,
        point.x,
        point.z,
        nx * row.radial - nz * side,
        nz * row.radial + nx * side,
        Math.atan2(nx, nz) + (grain - 0.5) * 0.5,
      );
    }
  }
}

/** A bent-twig door frame in the -Z gap, just below the camera's sight line. */
function addDoor(batch: PaperBatch): void {
  const z = -2.62;
  const top = 1.58;
  for (const side of [-1, 1]) {
    const points = [
      new Vector3(side * 1.36, 0, z),
      new Vector3(side * 1.34, 0.72, z),
      new Vector3(side * 1.2, 1.18, z + 0.01),
      new Vector3(side * 0.86, 1.45, z + 0.03),
      new Vector3(side * 0.42, top, z + 0.05),
      new Vector3(0, top + 0.02, z + 0.06),
    ];
    for (let i = 0; i < points.length - 1; i++) {
      const radius = 0.085 - i * 0.012;
      batch.addTwig(points[i], points[i + 1], Math.max(0.035, radius));
    }
    // A small fork where the branches meet.
    batch.addTwig(
      new Vector3(side * 0.3, top - 0.02, z + 0.05),
      new Vector3(side * 0.48, top + 0.3, z + 0.11),
      0.018,
    );
  }
  batch.addLeaf(0.08, top - 0.2, z + 0.07, -0.5);
  // A flat paper sill across the threshold.
  batch.addBox(2.5, 0.045, 0.34, 0, 0.022, -2.88);
}

function buildWovenNest(): Group {
  const batch = new PaperBatch();

  for (const block of nestBlocks()) {
    batch.addBox(
      block.maxX - block.minX,
      block.height,
      block.maxZ - block.minZ,
      (block.minX + block.maxX) / 2,
      block.height / 2,
      (block.minZ + block.maxZ) / 2,
    );
  }

  // Lashings on the outside of the soil wall, then the reeds above it.
  for (const y of [0.18, 0.42, 0.64]) {
    addBand(batch, 2.88, 0.055, 0.055, y);
  }
  addWallReeds(batch);
  addReeds(batch);
  addBand(batch, 2.7, 0.06, 0.06, 0.84);
  addRim(batch, 2.68, 1.04);

  addFloor(batch);
  addDoor(batch);
  return batch.build();
}

export { buildWovenNest as buildNest };
