import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { BONES } from '../../../src/shared/config.js';
import { Spider } from '../../../src/shared/sim/Spider.js';
import { clawGeo, tubeCrest, tubeGeo } from '../../../src/shared/sim/parts.js';

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

  it('puts eight eyes and the palps on the face, and the spinnerets on the rear', () => {
    const spider = new Spider();
    spider.root.updateMatrixWorld(true);
    const at = new Vector3();
    const ceph = box(find(spider.chassis, 'cephalothorax')[0]);
    const abdomen = box(find(spider.chassis, 'abdomen')[0]);
    const eyes = find(spider.chassis, 'eye');
    expect(eyes).toHaveLength(8);
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

  it('draws a round tapered leg and a claw that hooks down', () => {
    const spider = new Spider();
    const bone = spider.legs[0].bones[0].children[0] as Mesh;
    expect(bone.children.some((child) => child instanceof Mesh)).toBe(true);
    expect(bone.children.some((child) => child.type === 'LineSegments')).toBe(true);
    expect(tubeGeo.parameters.radialSegments).toBe(12);
    expect(tubeGeo.parameters.radiusTop).toBeLessThan(tubeGeo.parameters.radiusBottom);
    expect(tubeCrest.getAttribute('position').count).toBeGreaterThanOrEqual(2);
    expect(BONES[0].radius).toBeLessThan(0.06);
    expect(BONES[3].radius).toBeGreaterThan(0.02);
    expect(BONES[3].radius).toBeLessThan(BONES[2].radius);
    const claw = clawGeo.getAttribute('position');
    let clawMinY = Number.POSITIVE_INFINITY;
    let clawMinZ = Number.POSITIVE_INFINITY;
    let clawNear = Number.POSITIVE_INFINITY;
    for (let i = 0; i < claw.count; i++) {
      const x = claw.getX(i);
      const y = claw.getY(i);
      const z = claw.getZ(i);
      clawMinY = Math.min(clawMinY, y);
      clawMinZ = Math.min(clawMinZ, z);
      clawNear = Math.min(clawNear, Math.hypot(x, y, z));
    }
    expect(clawMinY).toBeLessThan(0);
    expect(clawMinZ).toBeLessThan(0);
    expect(clawNear).toBeLessThan(0.012);
    expect(spider.legs[0].claw.children).toHaveLength(3);
  });
});
