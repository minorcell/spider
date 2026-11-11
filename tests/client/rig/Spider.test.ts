import { BODY_RADIUS, moveCircle } from '@/src/shared/collision';
import { block } from '@/tests/helpers';
import { indexEntities, propBlocks } from '@/src/shared/world';
import { describe, expect, it } from 'vitest';
import { Matrix4, Mesh, Vector3 } from 'three';
import { BONES, CONTACT, GAIT } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { NEST_SCALE_XZ, NEST_SCALE_Y, nestSurface } from '@/src/shared/nestShape';
import { nestSolidSurface } from '@/src/shared/nestCollision';
import { NEST_DETAILS } from '@/src/shared/nestDetails';
import { bindLegWorld } from '@/src/client/rig/bindWorld';
import { AnimatedActor as Spider } from '@/tests/rigHelpers';
import { createWorld } from '@/src/shared/world';
import { Terrain, TERRAIN } from '@/src/shared/terrain';
import { floatHeight, WATER, waterAt } from '@/src/shared/water';

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
    spider.place(0, 0, 8);
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
    spider.bindMotion((x, z, dx, dz) =>
      moveCircle(x, z, dx, dz, BODY_RADIUS, {
        blocks: [block('wall', -10, 10, -10, -BODY_RADIUS)],
      }),
    );
    spider.update(0.1, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('solid');
    expect(spider.speed).toBe(0);
  });

  it('slides along x when only the forward step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindMotion((x, z, dx, dz) =>
      moveCircle(x, z, dx, dz, BODY_RADIUS, {
        blocks: [block('wall', -10, 10, -10, -BODY_RADIUS)],
      }),
    );
    spider.update(0.05, { ...IDLE, throttle: 1 });
    expect(spider.halt).toBe('clear');
    expect(spider.root.position.x).toBeLessThan(0);
    expect(spider.root.position.z).toBe(0);
  });

  it('slides along z when only the sideways step is blocked', () => {
    const spider = new Spider();
    spider.yaw = Math.PI / 4;
    spider.bindMotion((x, z, dx, dz) =>
      moveCircle(x, z, dx, dz, BODY_RADIUS, {
        blocks: [block('wall', -10, -BODY_RADIUS, -10, 10)],
      }),
    );
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
    spider.place(0.9, 0, 0);
    spider.yaw = Math.PI / 2;
    spider.update(0.2, { ...IDLE, throttle: -1 });
    expect(spider.root.position.x).toBeCloseTo(1, 6);
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
    spider.position.y = 20;
    for (let i = 0; i < 400; i++) spider.update(0.05);
    expect(spider.root.position.y).toBeCloseTo(0);
    expect(spider.fall).toBe(0);
  });

  it('eases down a small gap', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.position.y = 0.1;
    spider.update(0.1);
    expect(spider.root.position.y).toBeGreaterThan(0);
    expect(spider.root.position.y).toBeLessThan(0.1);
  });

  it('keeps the feet at body height while airborne', () => {
    const spider = new Spider();
    spider.bindGround(() => 0);
    spider.position.y = 5;
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
    const foot = spider.legs[0].foot.clone();
    spider.present();
    expect(spider.legs[0].foot).toEqual(foot);
  });

  it('plants on the nest mound without growing a bone', () => {
    const world = createWorld(1);
    const spider = new Spider();
    bindLegWorld(spider, world);
    spider.bindGround((x, z) => world.terrain.height(x, z));
    for (let i = 0; i < 8; i++) spider.update(1 / 30);
    const nest = [...world.entities.values()].find((entity) => entity.kind === 'nest');
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
    world.entities = indexEntities(
      [...world.entities.values()].filter((entity) => entity.kind !== 'nest'),
    );
    world.entities.set('odd', { id: 'odd', kind: 'nope', x: 3, y: 0, z: 3, stage: 0 });
    const spider = new Spider();
    bindLegWorld(spider, world);
    spider.bindGround(() => 0);
    spider.update(1 / 30);
    spider.update(1 / 30);
    expect(spider.legs[0].foot.y).toBeGreaterThan(CONTACT);
    expect(spider.legs[0].foot.y).toBeLessThan(0.08);
  });

  it.each(['pebble', 'root'] as const)(
    'plants a foot on a nest %s without stretching a bone',
    (kind) => {
      const world = createWorld(1);
      const nest = [...world.entities.values()].find((entity) => entity.kind === 'nest')!;
      world.entities = indexEntities([nest]);
      const at =
        kind === 'pebble' ? NEST_DETAILS.pebbles[0].position : NEST_DETAILS.roots[0].spine[4];
      const x = nest.x + at.x * NEST_SCALE_XZ;
      const z = nest.z + at.z * NEST_SCALE_XZ;
      const spider = new Spider();
      const spec = spider.legs[0].spec;
      spider.place(x - spec.side * spec.lateral, nest.y + at.y * NEST_SCALE_Y, z + spec.fore);
      bindLegWorld(spider, world);
      spider.bindGround(FLAT);
      for (let i = 0; i < 60; i++) spider.update(1 / 60);
      const leg = spider.legs[0];
      expect(leg.foot.x).toBeCloseTo(x);
      expect(leg.foot.z).toBeCloseTo(z);
      const solid = nestSolidSurface(nest, x, z);
      expect(solid).toBeGreaterThan(nestSurface(nest, x, z) + 0.01);
      expect(leg.foot.y).toBeGreaterThanOrEqual(solid + CONTACT - 1e-3);
      for (let bone = 0; bone < BONES.length; bone++) {
        expect(leg.bones[bone].scale.z).toBeLessThanOrEqual(BONES[bone].len + 1e-3);
      }
    },
  );

  it('clears the body over nest solids and invalidates support when the nest binding changes', () => {
    const spider = new Spider();
    spider.bindGround(FLAT);
    const pebble = NEST_DETAILS.pebbles[0].position;
    const origin = { x: 0, y: 0.02, z: 0 };
    spider.place(pebble.x * NEST_SCALE_XZ, 0, pebble.z * NEST_SCALE_XZ);
    for (let i = 0; i < 120; i++) spider.update(1 / 60);
    const unboundHeight = spider.root.position.y;
    const solidAt = (x: number, z: number) => nestSolidSurface(origin, x, z);
    expect(shellClearance(spider, solidAt)).toBeLessThan(-0.03);
    spider.bindLegs((into) => {
      into.length = 0;
    }, solidAt);
    for (let i = 0; i < 120; i++) spider.update(1 / 60);
    expect(shellClearance(spider, solidAt)).toBeGreaterThan(-0.03);
    const raised = spider.root.position.y;
    expect(raised).toBeGreaterThan(unboundHeight + 0.05);
    spider.bindLegs(
      (into) => {
        into.length = 0;
      },
      () => Number.NEGATIVE_INFINITY,
    );
    for (let i = 0; i < 120; i++) spider.update(1 / 60);
    expect(spider.root.position.y).toBeCloseTo(unboundHeight, 2);
  });

  it.each(['tree', 'stone'] as const)('keeps the front leg out of a registered %s', (kind) => {
    const spider = new Spider();
    spider.bindGround(FLAT);
    spider.update(1 / 60);
    const leg = spider.legs[0];
    const target = leg.claw.position.clone();
    const obstacle = {
      id: `${kind}-2`,
      kind,
      x: target.x,
      y: 0,
      z: target.z,
      stage: 0,
      footprint: { kind: 'circle', r: 0.26 } as const,
    };
    const world = createWorld(1);
    world.entities = indexEntities([obstacle]);
    world.terrain = { height: FLAT };
    world.blocks = propBlocks(world.entities.values());
    expect(
      world.blocks.some(
        (shape) =>
          target.x > shape.minX &&
          target.x < shape.maxX &&
          target.z > shape.minZ &&
          target.z < shape.maxZ &&
          target.y < shape.height,
      ),
    ).toBe(true);
    bindLegWorld(spider, world);
    for (let i = 0; i < 60; i++) spider.update(1 / 60);

    const foot = leg.claw.position;
    leg.claw.updateWorldMatrix(true, true);
    const clawVertices: Vector3[] = [];
    leg.claw.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const positions = node.geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        clawVertices.push(
          new Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld),
        );
      }
    });
    expect(clawVertices.length).toBeGreaterThan(0);
    const surface = KINDS[kind].support;
    const chain = [...leg.joints.map((joint) => joint.position), foot];
    for (let i = 0; i < BONES.length; i++) {
      expect(chain[i].distanceTo(chain[i + 1])).toBeLessThanOrEqual(BONES[i].len + 1e-3);
    }
    if (surface) {
      const gaps = clawVertices.map((point) => point.y - surface(obstacle, point.x, point.z));
      const gap = Math.min(...gaps);
      expect(gap).toBeGreaterThanOrEqual(-0.004);
      expect(gap).toBeLessThan(CONTACT + 0.01);
    } else
      for (const shape of world.blocks) {
        const isInside = (point: Vector3) =>
          point.x > shape.minX + 1e-3 &&
          point.x < shape.maxX - 1e-3 &&
          point.z > shape.minZ + 1e-3 &&
          point.z < shape.maxZ - 1e-3 &&
          point.y < shape.height - 1e-3;
        expect(isInside(foot), JSON.stringify({ shape, foot, target })).toBe(false);
        expect(clawVertices.some(isInside)).toBe(false);
        for (let i = 0; i < BONES.length; i++) {
          expect(isInside(chain[i].clone().lerp(chain[i + 1], 0.5))).toBe(false);
        }
      }
  });

  it('clears a solid leg obstacle using its block height by default', () => {
    const spider = new Spider();
    spider.bindGround(FLAT);
    spider.update(1 / 60);
    const claw = spider.legs[0].claw.position;
    const start = claw.clone();
    const wall = block('wall', start.x - 0.2, start.x + 0.2, start.z - 0.2, start.z + 0.2);
    spider.bindLegs(
      (into) => {
        into.length = 0;
      },
      () => Number.NEGATIVE_INFINITY,
      () => [wall],
    );
    spider.update(1 / 60);
    expect(
      claw.x <= wall.minX || claw.x >= wall.maxX || claw.z <= wall.minZ || claw.z >= wall.maxZ,
    ).toBe(true);
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
