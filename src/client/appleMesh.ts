import {
  BufferGeometry,
  CylinderGeometry,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  LineSegments,
  Mesh,
  Shape,
  ShapeGeometry,
  Vector2,
  Vector3,
} from 'three';
import { inkMat, inkSolidMat, paperMat } from '../shared/sim/parts.js';

// 苹果不再是一圈圈车出来的灯笼：轮廓靠一层薄薄的墨壳勾出来，
// 果面只留两三道短纹；咬口有果肉、两粒种子和一点切面线。

/** 苹果的剖面：从果底的萼洼，绕到果顶的梗洼。x 是半径，y 是高度。 */
function appleProfile(): Vector2[] {
  const raw: readonly (readonly [number, number])[] = [
    [0.012, 0.035],
    [0.07, 0.012],
    [0.15, 0.018],
    [0.23, 0.055],
    [0.3, 0.12],
    [0.335, 0.2],
    [0.35, 0.3],
    [0.35, 0.4],
    [0.335, 0.49],
    [0.3, 0.56],
    [0.252, 0.618],
    [0.196, 0.66],
    [0.15, 0.682],
    [0.1, 0.682],
    [0.055, 0.652],
    [0.018, 0.638],
  ];
  return raw.map(([x, y]) => new Vector2(x, y));
}

function appleGeometry(): LatheGeometry {
  const geometry = new LatheGeometry(appleProfile(), 44);
  // 轻微的五瓣起伏，别让它是一个完美的旋转体。
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const a = Math.atan2(z, x);
    const lobe = 1 + 0.018 * Math.cos(5 * a + 0.7) + 0.012 * Math.cos(2 * a - 1.1);
    position.setX(i, x * lobe);
    position.setZ(i, z * lobe * 0.96);
  }
  geometry.computeVertexNormals();
  return geometry;
}

/** 沿法线把壳吹大一点，用背面黑壳当外轮廓。 */
function outlineShell(geometry: LatheGeometry, thickness: number): Mesh {
  const shell = geometry.clone();
  const position = shell.getAttribute('position');
  const normal = shell.getAttribute('normal');
  for (let i = 0; i < position.count; i++) {
    position.setX(i, position.getX(i) + normal.getX(i) * thickness);
    position.setY(i, position.getY(i) + normal.getY(i) * thickness);
    position.setZ(i, position.getZ(i) + normal.getZ(i) * thickness);
  }
  return new Mesh(shell, inkSolidMat);
}

/** 浮点坐标转一组墨线。 */
function lineFrom(flat: readonly number[]): LineSegments {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(flat, 3));
  return new LineSegments(geometry, inkMat);
}

function appleLeaf(scale: number): Mesh {
  const shape = new Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(0.05, 0.06, 0.16, 0.07, 0.24, 0.01);
  shape.bezierCurveTo(0.16, -0.05, 0.05, -0.045, 0, 0);
  const geometry = new ShapeGeometry(shape);
  geometry.scale(scale, scale, scale);
  const mesh = new Mesh(geometry, paperMat);
  const ink: number[] = [0.005 * scale, 0.003 * scale, 0.001, 0.225 * scale, 0.004 * scale, 0.001];
  for (let i = 1; i <= 3; i++) {
    const t = i / 4;
    ink.push(
      (0.24 * t + 0.005) * scale,
      0.002,
      0.001,
      (0.24 * t + 0.04) * scale,
      0.035 * scale,
      0.001,
    );
    ink.push(
      (0.24 * t + 0.005) * scale,
      0.002,
      0.001,
      (0.24 * t + 0.04) * scale,
      -0.035 * scale,
      0.001,
    );
  }
  mesh.add(lineFrom(ink));
  return mesh;
}

/** 按高度取剖面半径，给果面的短纹定位。 */
function radiusAtY(y: number): number {
  let best = 0.1;
  for (const point of appleProfile()) {
    if (Math.abs(point.y - y) < 0.035) best = Math.max(best, point.x);
  }
  return best * 0.995;
}

/** 一只苹果，`stage` 越大咬口越深。 */
export function buildApple(stage: number): Group {
  const group = new Group();
  const geometry = appleGeometry();
  const amount = stage <= 0 ? 0 : stage === 1 ? 0.42 : 0.8;
  const cutLines: number[] = [];

  if (amount > 0) {
    const position = geometry.getAttribute('position');
    let peak = 0;
    for (let i = 0; i < position.count; i++) peak = Math.max(peak, position.getX(i));
    const cut = peak * (1 - amount);
    for (let i = 0; i < position.count; i++) {
      if (position.getX(i) > cut) position.setX(i, cut);
    }
    geometry.computeVertexNormals();

    const cutPoints: Vector3[] = [];
    for (const point of appleProfile()) {
      if (point.x <= cut) continue;
      cutPoints.push(new Vector3(cut, point.y, Math.sqrt(point.x * point.x - cut * cut)));
    }
    for (let i = 0; i < cutPoints.length - 1; i++) {
      const a = cutPoints[i];
      const b = cutPoints[i + 1];
      cutLines.push(a.x, a.y, a.z, b.x, b.y, b.z);
      cutLines.push(a.x, a.y, -a.z, b.x, b.y, -b.z);
    }
    const first = cutPoints[0];
    const last = cutPoints[cutPoints.length - 1];
    cutLines.push(first.x, first.y, first.z, first.x, first.y, -first.z);
    cutLines.push(last.x, last.y, last.z, last.x, last.y, -last.z);

    // 果肉上的两粒种子。
    for (const [dy, dz] of [
      [0.03, 0.05],
      [-0.02, -0.05],
    ]) {
      const seed = new Shape();
      seed.moveTo(0, -0.026);
      seed.bezierCurveTo(0.018, -0.01, 0.016, 0.018, 0, 0.026);
      seed.bezierCurveTo(-0.016, 0.018, -0.018, -0.01, 0, -0.026);
      const shape = new ShapeGeometry(seed);
      shape.rotateY(Math.PI / 2);
      const mesh = new Mesh(shape, paperMat);
      mesh.position.set(cut + 0.002, 0.33 + dy, dz);
      mesh.add(new LineSegments(new EdgesGeometry(shape, 1), inkMat));
      group.add(mesh);
    }
    for (let k = 0; k < 5; k++) {
      const y = 0.2 + k * 0.045;
      const z = 0.04 + 0.04 * Math.sin(k * 2.1);
      cutLines.push(cut + 0.003, y, z - 0.04, cut + 0.003, y + 0.012, z + 0.04);
    }
    group.add(lineFrom(cutLines));
  }

  const apple = new Mesh(geometry, paperMat);
  apple.add(outlineShell(geometry, 0.008));
  group.add(apple);

  // 果面只留短纹，不画经线。
  const face: number[] = [];
  const curveLine = (phi: number, y0: number, y1: number, bulge: number): void => {
    const points: Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const y = y0 + (y1 - y0) * t;
      const r = radiusAtY(y) * (1 + bulge * Math.sin(Math.PI * t));
      points.push(new Vector3(Math.cos(phi) * r - 0.004, y, Math.sin(phi) * r + 0.002));
    }
    for (let i = 0; i < points.length - 1; i++) {
      face.push(
        points[i].x,
        points[i].y,
        points[i].z,
        points[i + 1].x,
        points[i + 1].y,
        points[i + 1].z,
      );
    }
  };
  if (stage <= 0) {
    curveLine(0.5, 0.2, 0.48, 0.004);
    curveLine(-0.5, 0.17, 0.4, 0.004);
    curveLine(2.4, 0.3, 0.5, 0.002);
  } else {
    curveLine(Math.PI - 0.6, 0.2, 0.45, 0.003);
    curveLine(Math.PI + 0.4, 0.26, 0.48, 0.003);
  }
  group.add(lineFrom(face));

  const stem = new Mesh(new CylinderGeometry(0.014, 0.024, 0.15, 5), paperMat);
  stem.position.set(0.012, 0.715, 0);
  stem.rotation.z = -0.22;
  stem.rotation.x = 0.1;
  stem.add(new LineSegments(new EdgesGeometry(stem.geometry, 1), inkMat));
  group.add(stem);

  const leaf = appleLeaf(0.85);
  leaf.position.set(0.055, 0.755, 0.005);
  leaf.rotation.z = -0.55;
  leaf.rotation.y = -0.5;
  leaf.rotation.x = -0.2;
  group.add(leaf);

  return group;
}
