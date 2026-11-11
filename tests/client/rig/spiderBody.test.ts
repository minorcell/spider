import { Box3, LineSegments, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { AnimatedActor as Spider } from '@/tests/rigHelpers';
import { LEG_GEOMETRIES } from '@/src/client/rig/legGeometry';

function find(root: Object3D, name: string): Object3D[] {
  const found: Object3D[] = [];
  root.traverse((node) => {
    if (node.name === name) found.push(node);
  });
  return found;
}

function box(object: Object3D): Box3 {
  return new Box3().setFromObject(object);
}

describe('spider body', () => {
  it('keeps a fine cephalothorax in front of the abdomen', () => {
    const spider = new Spider();
    spider.root.updateMatrixWorld(true);
    const ceph = box(find(spider.chassis, 'cephalothorax')[0]);
    const abdomen = box(find(spider.chassis, 'abdomen')[0]);
    expect(ceph.max.x - ceph.min.x).toBeGreaterThan((ceph.max.y - ceph.min.y) * 2);
    expect((ceph.min.z + ceph.max.z) / 2).toBeLessThan((abdomen.min.z + abdomen.max.z) / 2 - 0.6);
    expect(ceph.min.z).toBeLessThan(-0.5);
    expect(abdomen.max.z).toBeGreaterThan(1.5);
    expect(ceph.min.y).toBeGreaterThan(0.57);
    expect(abdomen.min.y).toBeGreaterThan(0.5);
    expect(find(spider.chassis, 'pedicel')).toHaveLength(1);
  });

  it('batches visible body markings and short setae on each shell', () => {
    const spider = new Spider();
    for (const name of ['cephalothorax', 'abdomen']) {
      const shell = find(spider.chassis, name)[0] as Mesh;
      const color = shell.geometry.getAttribute('color');
      expect(color.count).toBe(shell.geometry.getAttribute('position').count);
      expect(new Set(color.array).size).toBeGreaterThan(100);

      const coat = shell.getObjectByName(`${name}-setae`) as LineSegments;
      expect(coat).toBeInstanceOf(LineSegments);
      const position = coat.geometry.getAttribute('position');
      expect(position.count).toBeGreaterThan(0);
      const base = new Vector3();
      const tip = new Vector3();
      for (let i = 0; i < position.count; i += 2) {
        base.fromBufferAttribute(position, i);
        tip.fromBufferAttribute(position, i + 1);
        const length = base.distanceTo(tip);
        expect(length).toBeGreaterThan(0);
        expect(length).toBeLessThan(0.05);
      }
    }
  });

  it('puts eight eyes and the palps on the face, and the spinnerets on the rear', () => {
    const spider = new Spider();
    spider.root.updateMatrixWorld(true);
    const at = new Vector3();
    const ceph = box(find(spider.chassis, 'cephalothorax')[0]);
    const abdomen = box(find(spider.chassis, 'abdomen')[0]);
    const eyes = find(spider.chassis, 'eye');
    expect(eyes).toHaveLength(8);
    const glints = find(spider.chassis, 'eye-glint');
    expect(glints).toHaveLength(eyes.length);
    for (const [index, eye] of eyes.entries()) {
      const material = (eye as Mesh).material as MeshStandardMaterial;
      expect(material.roughness).toBeLessThan(0.5);
      const glint = glints[index];
      expect(glint.scale.x).toBeLessThan(eye.scale.x);
      expect(glint.position.z).toBeLessThan(eye.position.z);
    }
    const eyeZ = eyes.reduce((sum, eye) => sum + eye.getWorldPosition(at).z, 0) / eyes.length;
    expect(eyeZ).toBeLessThan((ceph.min.z + ceph.max.z) / 2);

    const left = find(spider.chassis, 'pedipalp-left')[0];
    const right = find(spider.chassis, 'pedipalp-right')[0];
    expect(left.getWorldPosition(at).x).toBeLessThan(-0.05);
    expect(right.getWorldPosition(at).x).toBeGreaterThan(0.05);
    const leftBaseZ = left.getWorldPosition(at).z;
    const leftTipZ = find(spider.chassis, 'pedipalp-left-tip')[0].getWorldPosition(at).z;
    expect(leftTipZ).toBeLessThan(leftBaseZ);

    const fangs = find(spider.chassis, 'fang');
    expect(fangs).toHaveLength(2);
    for (const fang of fangs) {
      const center = fang.getWorldPosition(at).clone();
      const bounds = box(fang);
      expect(bounds.min.y).toBeLessThan(center.y);
      expect(bounds.min.z).toBeLessThan(center.z);
    }

    const spinnerets = find(spider.chassis, 'spinneret');
    expect(spinnerets).toHaveLength(3);
    const rear =
      spinnerets.reduce((sum, part) => sum + part.getWorldPosition(at).z, 0) / spinnerets.length;
    expect(rear).toBeGreaterThan((abdomen.min.z + abdomen.max.z) / 2);
    expect(find(spider.chassis, 'coxa')).toHaveLength(8);
  });

  it('renders distinct leg segments with taper and outward-facing surface normals', () => {
    const spider = new Spider();
    spider.update(1 / 60);
    const leg = spider.legs[0];
    const radial = new Vector3();
    const normal = new Vector3();
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const taperedWidths: number[] = [];
    for (const [section, bone] of leg.bones.entries()) {
      const mesh = bone.children[0] as Mesh;
      const { shell } = LEG_GEOMETRIES[section];
      expect(mesh.geometry).toBe(shell);
      expect(mesh.material).not.toBe(leg.joints[section].material);
      expect(mesh.children.some((child) => child instanceof Mesh)).toBe(true);
      expect(mesh.children.some((child) => child instanceof LineSegments)).toBe(true);
      const position = shell.getAttribute('position');
      const normals = shell.getAttribute('normal');
      const rings = new Map<number, Box3>();
      for (let i = 0; i < position.count; i++) {
        a.fromBufferAttribute(position, i);
        const ring = rings.get(a.z) ?? new Box3();
        ring.expandByPoint(a);
        rings.set(a.z, ring);
      }
      for (let i = 0; i < position.count; i++) {
        a.fromBufferAttribute(position, i);
        rings.get(a.z)!.getCenter(radial);
        radial.subVectors(a, radial);
        normal.fromBufferAttribute(normals, i);
        expect(normal.dot(radial)).toBeGreaterThan(0);
      }
      const triangles = shell.index!;
      for (let i = 0; i < triangles.count; i += 3) {
        a.fromBufferAttribute(position, triangles.getX(i));
        b.fromBufferAttribute(position, triangles.getX(i + 1));
        c.fromBufferAttribute(position, triangles.getX(i + 2));
        rings.get(a.z)!.getCenter(radial);
        radial.subVectors(a, radial);
        normal.subVectors(b, a).cross(c.sub(a));
        expect(normal.dot(radial)).toBeGreaterThan(0);
      }
      const base = rings.get(0)!.getSize(a).x;
      const tip = rings.get(-1)!.getSize(a).x;
      expect(tip).toBeLessThan(base);
      expect(bone.scale.x).toBeGreaterThan(0);
      taperedWidths.push(tip * bone.scale.x);
    }
    expect(taperedWidths.at(-1)).toBeLessThan(taperedWidths.at(-2)! * 0.6);
  });

  it('ends in a compact pair of claws that hook down', () => {
    const spider = new Spider();
    const foot = spider.legs[0].claw;
    const pretarsus = foot.getObjectByName('pretarsus') as Mesh;
    expect(pretarsus).toBeInstanceOf(Mesh);
    pretarsus.geometry.computeBoundingBox();
    const tipSize = pretarsus.geometry
      .boundingBox!.getSize(new Vector3())
      .multiply(pretarsus.scale);
    expect(tipSize.x).toBeLessThan(0.02);
    expect(tipSize.y).toBeLessThan(0.02);
    const hooks = foot.children.filter((child) => child instanceof Mesh && child !== pretarsus);
    expect(hooks).toHaveLength(2);
    expect(hooks[0].position.x).toBeLessThan(0);
    expect(hooks[1].position.x).toBeGreaterThan(0);
    const vertex = new Vector3();
    for (const hook of hooks) {
      const positions = hook.geometry.getAttribute('position');
      const bounds = new Box3();
      let nearest = Infinity;
      for (let i = 0; i < positions.count; i++) {
        vertex.fromBufferAttribute(positions, i);
        bounds.expandByPoint(vertex);
        nearest = Math.min(nearest, vertex.length());
      }
      expect(bounds.min.y).toBeLessThan(0);
      expect(bounds.min.z).toBeLessThan(0);
      expect(nearest).toBeLessThan(0.012);
      const size = bounds.getSize(vertex);
      expect(size.x).toBeLessThan(size.length() * 0.5);
      expect(size.length()).toBeLessThan(0.06);
    }
  });
});
