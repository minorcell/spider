import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { BONES, CONTACT, GAIT } from '../../../src/shared/config.js';
import { nestSurface } from '../../../src/shared/nestShape.js';
import { bindLegWorld } from '../../../src/shared/sim/bindWorld.js';
import { Spider } from '../../../src/shared/sim/Spider.js';
import { createWorld } from '../../../src/shared/world.js';
import { Terrain, TERRAIN } from '../../../src/shared/terrain.js';
import { floatHeight, WATER, waterAt } from '../../../src/shared/water.js';

const IDLE = { throttle: 0, turn: 0, lift: 0, boost: 0 };
const FLAT = (): number => 0;

function mountWorld(spider: Spider, index: number): Vector3 {
  spider.root.updateMatrixWorld(true);
  return spider.legs[index].mount.getWorldPosition(new Vector3());
}

function specDir(spider: Spider, index: number): Vector3 {
  const spec = spider.legs[index].spec;
  return new Vector3(spec.x, 0, spec.z).normalize();
}

function worstClawGap(spider: Spider, ground: (x: number, z: number) => number): number {
  const point = new Vector3();
  let worst = Number.NEGATIVE_INFINITY;
  for (const leg of spider.legs) {
    let lowest = Number.POSITIVE_INFINITY;
    leg.claw.updateWorldMatrix(true, true);
    leg.claw.traverse((node) => {
      const geometry = (
        node as { geometry?: { getAttribute(name: string): MatrixAttr | undefined } }
      ).geometry;
      const position = geometry?.getAttribute('position');
      if (!position) return;
      const world = (node as { matrixWorld: Matrix4 }).matrixWorld;
      for (let i = 0; i < position.count; i++) {
        point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(world);
        lowest = Math.min(lowest, point.y - ground(point.x, point.z));
      }
    });
    worst = Math.max(worst, lowest);
  }
  return worst;
}

function shellClearance(spider: Spider, ground: (x: number, z: number) => number): number {
  spider.root.updateMatrixWorld(true);
  const point = new Vector3();
  let worst = Infinity;
  spider.chassis.traverse((node) => {
    const geometry = (node as { geometry?: { getAttribute(name: string): MatrixAttr | undefined } })
      .geometry;
    const position = geometry?.getAttribute('position');
    if (!position) return;
    const world = (node as { matrixWorld: Matrix4 }).matrixWorld;
    for (let i = 0; i < position.count; i++) {
      point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(world);
      worst = Math.min(worst, point.y - ground(point.x, point.z));
    }
  });
  return worst;
}

interface MatrixAttr {
  count: number;
  getX(index: number): number;
  getY(index: number): number;
  getZ(index: number): number;
}

function worldRight(spider: Spider): Vector3 {
  const forward = new Vector3(0, 0, -1).applyQuaternion(spider.root.quaternion);
  return new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
}

describe('Spider', () => {
  it('builds eight legs and a rig', () => {
    const spider = new Spider();
    expect(spider.legs).toHaveLength(8);
    expect(spider.rig.children.length).toBeGreaterThan(8);
    const state = spider.capture();
    expect(state.feet).toHaveLength(8);
    expect(state.feet.every((foot) => Number.isFinite(foot.y))).toBe(true);
  });

  it('reseeds the stance when the ground binds', () => {
    const spider = new Spider();
    spider.bindGround((x, z) => 0.1 * x + 0.2 * z, 10);
    const state = spider.capture();
    expect(state.feet.every((foot) => Number.isFinite(foot.y))).toBe(true);
  });

  it('poses without advancing at dt 0', () => {
    const spider = new Spider();
    spider.update(0, IDLE);
    expect(spider.time).toBe(0);
  });

  it('stands still after a saved pose is settled', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.update(0.2, { throttle: 1, turn: 0.2, lift: 0, boost: 0 });
    const saved = spider.capture();
    saved.position.x = 2;
    saved.position.z = -1;
    saved.speed = 3;
    spider.settle(saved);
    const parked = spider.root.position.clone();
    spider.update(0.016, IDLE);
    expect(spider.speed).toBe(0);
    expect(spider.root.position.distanceTo(parked)).toBeLessThan(1e-6);
    expect(spider.legs.every((leg) => leg.lifted === false)).toBe(true);
  });

  it('adopts an authoritative state', () => {
    const spider = new Spider();
    const feet = Array.from({ length: 8 }, (_, i) => ({ x: i, y: 0.2, z: -i }));
    spider.applyState({
      time: 2,
      position: { x: 1, y: 0.5, z: 2 },
      yaw: 0.5,
      speed: 1.25,
      height: 0.2,
      chassisPitch: 0.1,
      chassisRoll: 0.2,
      headYaw: 0.3,
      feet,
    });
    expect(spider.time).toBe(2);
    expect(spider.yaw).toBe(0.5);
    expect(spider.speed).toBe(1.25);
    expect(spider.heightSet).toBe(0.2);
    expect(spider.root.position.toArray()).toEqual([1, 0.5, 2]);
    expect(spider.legs[3].foot.toArray()).toEqual([3, 0.2, -3]);
  });

  it('steers, lifts, and pitches with the input', () => {
    const spider = new Spider();
    spider.update(0.1, { throttle: 1, turn: 1, lift: 1, boost: 1 });
    expect(spider.time).toBeCloseTo(0.1);
    expect(spider.speed).toBeGreaterThan(0);
    expect(spider.yawRate).toBeGreaterThan(0);
    expect(spider.headYaw).toBeLessThan(0);
    expect(spider.heightSet).toBeGreaterThan(0);
    expect(spider.chassis.rotation.x).toBeCloseTo(-GAIT.pitch);
  });

  it('clamps the deck height', () => {
    const spider = new Spider();
    for (let i = 0; i < 40; i++) spider.update(0.1, { ...IDLE, lift: 1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMax);
    for (let i = 0; i < 80; i++) spider.update(0.1, { ...IDLE, lift: -1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMin);
  });

  it('keeps the head above a real hill', () => {
    const terrain = new Terrain(7);
    const ground = (x: number, z: number) => terrain.height(x, z);
    const spider = new Spider();
    spider.yaw = 1.2;
    spider.root.position.set(0, 0, 8);
    spider.bindGround(ground);
    for (let i = 0; i < 200; i++) spider.update(1 / 30);
    expect(shellClearance(spider, ground)).toBeGreaterThan(-0.02);
    expect(spider.chassis.position.y).toBeGreaterThanOrEqual(0);
  });

  it('keeps the shell above a steep face', () => {
    const rise = 1.6;
    const grounds = [(x: number, z: number) => -z * rise, (x: number, _z: number) => x * rise];
    for (const ground of grounds) {
      const spider = new Spider();
      spider.yaw = 0.8;
      spider.bindGround(ground);
      for (let i = 0; i < 45; i++) spider.update(1 / 30, IDLE);
      expect(shellClearance(spider, ground)).toBeGreaterThan(-0.02);
    }
  });

  it('stops dead against a solid', () => {
    const spider = new Spider();
    spider.bindBlocked(() => true);
    spider.update(0.1, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('solid');
    expect(spider.speed).toBe(0);
  });

  it('slides along x when only the forward step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindBlocked((_x, z) => z < -1e-6);
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('clear');
    expect(spider.root.position.x).toBeLessThan(0);
    expect(spider.root.position.z).toBe(0);
  });

  it('slides along z when only the sideways step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindBlocked((x) => x < -1e-6);
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('clear');
    expect(spider.root.position.z).toBeLessThan(0);
    expect(spider.root.position.x).toBe(0);
  });

  it('refuses a step that climbs too fast', () => {
    const spider = new Spider();
    spider.bindGround((_x, z) => (z < -1e-4 ? 100 : 0));
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('steep');
    expect(spider.speed).toBe(0);
  });

  it('clamps the body inside the ground limit', () => {
    const spider = new Spider();
    spider.bindGround(() => 0, 1);
    spider.root.position.set(0.9, 0, 0);
    spider.yaw = Math.PI / 2;
    spider.update(0.2, { ...IDLE, throttle: -1 });
    expect(spider.root.position.x).toBe(1);
  });

  it('floats over deep water instead of standing on the bottom', () => {
    const terrain = { height: () => -2 };
    const spider = new Spider();
    spider.bindGround((x, z) => terrain.height(x, z));
    spider.bindWater((x, z) => waterAt(terrain, x, z));
    for (let i = 0; i < 200; i++) spider.update(1 / 30);
    const water = waterAt(terrain, 0, 0);
    expect(spider.swimming).toBe(true);
    expect(spider.waterDepth).toBeCloseTo(TERRAIN.water - terrain.height(0, 0));
    expect(spider.root.position.y).toBeCloseTo(floatHeight(water), 1);
    expect(spider.capture().feet.every((foot) => foot.y > -1)).toBe(true);
  });

  it('wades shallow water on the bottom', () => {
    const terrain = { height: () => TERRAIN.water - 0.2 };
    const spider = new Spider();
    spider.bindGround((x, z) => terrain.height(x, z));
    spider.bindWater((x, z) => waterAt(terrain, x, z));
    for (let i = 0; i < 120; i++) spider.update(1 / 30);
    expect(spider.swimming).toBe(false);
    expect(spider.root.position.y).toBeCloseTo(TERRAIN.water - 0.2, 1);
  });

  it('moves and turns slower in deep water', () => {
    const dry = new Spider();
    dry.bindGround(() => 0);
    const wet = new Spider();
    wet.bindGround(() => -2);
    wet.bindWater((x, z) => waterAt({ height: () => -2 }, x, z));
    for (let i = 0; i < 120; i++) {
      dry.update(1 / 30, { ...IDLE, throttle: 1, turn: 1 });
      wet.update(1 / 30, { ...IDLE, throttle: 1, turn: 1 });
    }
    expect(wet.speed).toBeLessThan(dry.speed * 0.6);
    expect(wet.speed).toBeCloseTo(GAIT.cruise * WATER.swimPace, 1);
    expect(Math.abs(wet.yaw)).toBeLessThan(Math.abs(dry.yaw));
  });

  it('falls instead of easing down a real drop', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 20;
    for (let i = 0; i < 400; i++) spider.update(0.05);
    expect(spider.root.position.y).toBeCloseTo(0);
    expect(spider.fall).toBe(0);
  });

  it('eases down a small gap', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 0.1;
    spider.update(0.1);
    expect(spider.root.position.y).toBeGreaterThan(0);
    expect(spider.root.position.y).toBeLessThan(0.1);
  });

  it('keeps the feet at body height while airborne', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.root.position.y = 5;
    for (let i = 0; i < 50; i++) spider.update(0.01, { ...IDLE, throttle: 1 });
    expect(spider.capture().feet.some((foot) => foot.y > 1)).toBe(true);
  });

  it('steps both tetrapods through a long walk', () => {
    const spider = new Spider();
    for (let i = 0; i < 400; i++) spider.update(0.05, { ...IDLE, throttle: 0.8 });
    const lifting = spider.legs.filter((leg) => leg.lifted).length;
    expect(lifting).toBeGreaterThan(0);
    const feet = spider.capture().feet;
    expect(new Set(feet.map((foot) => foot.x.toFixed(2))).size).toBeGreaterThan(1);
  });

  it('runs with boost', () => {
    const spider = new Spider();
    for (let i = 0; i < 40; i++) spider.update(0.05, { ...IDLE, throttle: 1, boost: 1 });
    expect(spider.speed).toBeGreaterThan(GAIT.cruise);
  });

  it('turns in place and settles', () => {
    const spider = new Spider();
    for (let i = 0; i < 90; i++) spider.update(0.05, { ...IDLE, turn: 0.8 });
    const yawAfterTurn = spider.yaw;
    for (let i = 0; i < 400; i++) spider.update(0.05, IDLE);
    expect(yawAfterTurn).not.toBe(0);
    expect(Math.abs(spider.yawRate)).toBeLessThan(1e-3);
    expect(spider.legs.every((leg) => !leg.lifted)).toBe(true);
  });

  it('breathes in place instead of swaying', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    const height: number[] = [];
    let maxRoll = 0;
    let maxPitch = 0;
    for (let i = 0; i < 400; i++) {
      spider.update(0.05);
      height.push(spider.chassis.position.y);
      maxRoll = Math.max(maxRoll, Math.abs(spider.chassis.rotation.z));
      maxPitch = Math.max(maxPitch, Math.abs(spider.chassis.rotation.x));
    }
    expect(maxRoll).toBeLessThan(0.01);
    expect(maxPitch).toBeLessThan(0.01);
    expect(Math.max(...height) - Math.min(...height)).toBeGreaterThan(0.03);
    expect(Math.max(...height)).toBeLessThan(0.05);
    expect(spider.legs.every((leg) => !leg.lifted)).toBe(true);
    for (const leg of spider.legs) {
      expect(leg.foot.y).toBeGreaterThan(CONTACT);
      expect(leg.foot.y).toBeLessThan(0.08);
    }
    expect(Math.abs(spider.headYaw)).toBeLessThan(0.02);

    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.chassis.position.y).toBe(0);
  });

  it('handles a foot with no horizontal reach from its shoulder', () => {
    const spider = new Spider();
    spider.update(0);
    spider.legs[0].foot.copy(mountWorld(spider, 0));
    spider.update(0);
    expect(Number.isFinite(spider.legs[0].foot.x)).toBe(true);
  });

  it('handles a zero-length two-bone reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 0.685);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('picks a knee plane when the pole is parallel to the reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 0.91);
    leg.foot.y = shoulder.y + 0.42;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('clamps both ends of the reach', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[0];
    const shoulder = mountWorld(spider, 0);
    const dir = specDir(spider, 0);
    leg.foot.copy(shoulder).addScaledVector(dir, 100);
    leg.foot.y = shoulder.y + 100;
    spider.update(0);
    leg.foot.copy(shoulder);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.foot.x)).toBe(true);
  });

  it('keeps the claws on the ground when the body stands up', () => {
    const spider = new Spider();
    spider.bindGround(FLAT);
    spider.update(0.5);
    const resting = worstClawGap(spider, FLAT);
    for (let i = 0; i < 40; i++) spider.update(0.1, { ...IDLE, lift: 1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMax);
    expect(worstClawGap(spider, FLAT)).toBeLessThan(resting + 0.02);
  });

  it('does not stretch a bone when the body stands up', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    for (let i = 0; i < 40; i++) spider.update(0.1, { ...IDLE, lift: 1 });
    expect(spider.heightSet).toBeCloseTo(GAIT.heightMax);
    for (const leg of spider.legs) {
      for (let bone = 0; bone < BONES.length; bone++) {
        expect(leg.bones[bone].scale.z).toBeLessThanOrEqual(BONES[bone].len + 1e-3);
      }
      expect(leg.claw.position.distanceTo(leg.joints[3].position)).toBeLessThan(
        BONES[3].len + 1e-3,
      );
    }
  });

  it('plants the claw tip on the ground', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.update(1 / 30);
    const point = new Vector3();
    let lowest = Infinity;
    let where = '';
    const parts = spider.legs.flatMap((leg, index) => [
      ...leg.bones.map((bone, boneIndex) => ({
        part: bone,
        label: `leg${index}-bone${boneIndex}`,
      })),
      ...leg.joints.map((joint, jointIndex) => ({
        part: joint,
        label: `leg${index}-joint${jointIndex}`,
      })),
      { part: leg.claw, label: `leg${index}-claw` },
    ]);
    for (const { part, label } of parts) {
      part.updateWorldMatrix(true, true);
      part.traverse((node) => {
        const geometry = (
          node as { geometry?: { getAttribute(name: string): MatrixAttr | undefined } }
        ).geometry;
        const position = geometry?.getAttribute('position');
        if (!position) return;
        const world = (node as { matrixWorld: Matrix4 }).matrixWorld;
        for (let i = 0; i < position.count; i++) {
          point.set(position.getX(i), position.getY(i), position.getZ(i)).applyMatrix4(world);
          if (point.y < lowest) {
            lowest = point.y;
            where = label;
          }
        }
      });
    }
    expect(lowest, where).toBeGreaterThan(CONTACT - 0.02);
    expect(lowest).toBeLessThan(CONTACT + 0.03);
    const saved = spider.capture();
    spider.applyState(saved);
    expect(spider.legs[0].foot.y).toBeCloseTo(saved.feet[0].y);
  });

  it('plants on the nest mound without growing a bone', () => {
    const world = createWorld(1);
    const spider = new Spider();
    bindLegWorld(spider, world);
    spider.bindGround((x, z) => world.terrain.height(x, z));
    for (let i = 0; i < 8; i++) spider.update(1 / 30);
    const nest = world.entities.find((entity) => entity.kind === 'nest');
    expect(nest).toBeTruthy();
    for (const leg of spider.legs) {
      const support = Math.max(
        world.terrain.height(leg.foot.x, leg.foot.z),
        nestSurface(nest!, leg.foot.x, leg.foot.z),
      );
      expect(leg.foot.y).toBeGreaterThanOrEqual(support + CONTACT - 1e-3);
      for (let bone = 0; bone < BONES.length; bone++) {
        expect(leg.bones[bone].scale.z).toBeLessThanOrEqual(BONES[bone].len + 1e-3);
      }
    }
  });

  it('ignores a missing nest and a body with no physics', () => {
    const world = createWorld(1);
    world.entities = world.entities.filter((entity) => entity.kind !== 'nest');
    world.entities.push({ id: 'odd', kind: 'nope', x: 3, y: 0, z: 3, stage: 0 });
    const spider = new Spider();
    bindLegWorld(spider, world);
    spider.bindGround(() => 0);
    spider.update(1 / 30);
    spider.update(1 / 30);
    expect(spider.legs[0].foot.y).toBeGreaterThan(CONTACT);
    expect(spider.legs[0].foot.y).toBeLessThan(0.08);
  });

  it('re-solves a planted leg when a loose body moves', () => {
    const spider = new Spider();
    spider.bindGround(FLAT);
    const sphere = { x: 40, y: 1, z: 40, radius: 0.2 };
    let count = 1;
    spider.bindLegs(
      (into) => {
        into.length = count;
        if (count > 0) into[0] = sphere;
      },
      () => Number.NEGATIVE_INFINITY,
    );
    for (let i = 0; i < 90; i++) spider.update(1 / 60, IDLE);
    const foot = spider.legs[0].foot.clone();
    sphere.x += 1;
    spider.update(0);
    sphere.y += 1;
    spider.update(0);
    sphere.z += 1;
    spider.update(0);
    sphere.radius += 0.1;
    spider.update(0);
    expect(spider.legs[0].foot.distanceTo(foot)).toBeLessThan(1e-6);

    const leg = spider.legs[0];
    const shin = leg.joints[2].position;
    const ankle = leg.joints[3].position;
    sphere.x = (shin.x + ankle.x) / 2;
    sphere.y = (shin.y + ankle.y) / 2;
    sphere.z = (shin.z + ankle.z) / 2;
    sphere.radius = 0.45;
    const knee = shin.clone();
    spider.update(0);
    expect(leg.joints[2].position.distanceTo(knee)).toBeGreaterThan(1e-3);
    const shoved = leg.joints[2].position.clone();
    count = 0;
    spider.update(0);
    expect(leg.joints[2].position.distanceTo(shoved)).toBeGreaterThan(1e-3);
  });

  it('twists a bone toward the body when it points along the body side', () => {
    const spider = new Spider();
    spider.update(0);
    const leg = spider.legs[1];
    const shoulder = mountWorld(spider, 1);
    leg.foot.copy(shoulder).addScaledVector(worldRight(spider), 0.7);
    leg.foot.y = shoulder.y - 0.08;
    spider.update(0);
    expect(Number.isFinite(leg.bones[0].scale.z)).toBe(true);
  });
});

it('settles into a release posture with a default target height', () => {
  const spider = new Spider();
  spider.setInteraction({ x: 1, z: 2 }, 'release');
  expect(spider.interaction?.target.y).toBe(0.2);
  spider.update(1 / 60, IDLE);
  expect(spider.chassis.position.y).toBeCloseTo(-0.045 * 0.45);
  spider.setInteraction(null);
  spider.update(1 / 60, IDLE);
  expect(spider.interaction).toBeNull();
});
