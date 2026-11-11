import { bindLegWorld } from '@/src/shared/sim/bindWorld';
import { propBlocks } from '@/src/shared/world';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { BODY_RADIUS, blockedAt } from '@/src/shared/collision';
import { planRoute } from '@/src/shared/route';
import { SimSession } from '@/src/shared/sim/session';
import { fitsPlacement, stepPhysics } from '@/src/shared/sim/physics';
import { addEntity } from '@/src/shared/world';

const away = { x: 100, z: 100, speed: 0 };

function scene(): SimSession {
  KINDS.fence = {
    rest: 0,
    boxes: [{ id: 'panel', minX: 0, maxX: 0.002, minZ: -3, maxZ: 3, height: 2 }],
  };
  KINDS.pellet = {
    rest: 0,
    physics: { solid: true, radius: 0.01, loose: true, rolls: true, mass: 0.01 },
  };
  const session = new SimSession(7);
  session.world.entities = new Map([
    [session.spider.controller.entity.id, session.spider.controller.entity],
  ]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  session.world.physics = { ...PHYSICS, damping: 0, maxSpeed: 120 };
  return session;
}

afterEach(() => {
  delete KINDS.fence;
  delete KINDS.pellet;
  delete KINDS.ghost;
});

describe('registered bodies share continuous collision', () => {
  it('stops both a fast tiny item and the controlled body at a registered thin shape', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.8, z: 0 }, 0);
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: -2 }, 0);
    pellet.vx = 80;
    stepPhysics(session.world, away, 1 / 30);
    expect(pellet.x).toBeCloseTo(0.79, 6);
    expect(pellet.vx).toBe(0);
    expect(blockedAt(pellet.x, pellet.z, session.world.blocks, 0.01)).toBe(false);

    session.spider.yaw = -Math.PI / 2;
    session.spider.update(0.5, { throttle: 1, turn: 0, lift: 0, boost: 1 });
    expect(session.spider.root.position.x).toBeCloseTo(0.8 - BODY_RADIUS, 6);
    expect(
      blockedAt(
        session.spider.root.position.x,
        session.spider.root.position.z,
        session.world.blocks,
      ),
    ).toBe(false);
  });

  it('sweeps an actor push instead of teleporting an item to the far side of a wall', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.2, z: 0 }, 0);
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: 0 }, 0);
    stepPhysics(session.world, { x: -0.1, z: 0, speed: 2 }, 1 / 60);
    expect(pellet.x).toBeCloseTo(0.19, 6);
    expect(pellet.vx).toBe(0);
  });

  it('keeps the along-wall velocity after a dynamic contact', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.2, z: 0 }, 0);
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: 0 }, 0);
    pellet.vx = 2;
    pellet.vz = 1;
    stepPhysics(session.world, away, 0.5);
    expect(pellet.x).toBeCloseTo(0.19, 6);
    expect(pellet.z).toBeCloseTo(0.5, 6);
    expect(pellet.vx).toBe(0);
    expect(pellet.vz).toBe(1);
  });

  it('uses registered solidity independently from motion and rendering', () => {
    const session = scene();
    session.spider.place(-5, 0, 0);
    KINDS.ghost = { ...KINDS.pellet, physics: { ...KINDS.pellet.physics!, solid: false } };
    addEntity(session.world, 'fence', { x: 0.2, z: 0 }, 0);
    const ghost = addEntity(session.world, 'ghost', { x: 0, z: 0 }, 0);
    const pellet = addEntity(session.world, 'pellet', { x: 0.4, z: 0 }, 0);
    ghost.vx = 1;
    stepPhysics(session.world, { x: 0.4, z: 0.01, speed: 0 }, 0.4);
    expect(ghost.x).toBeCloseTo(0.4);
    expect(ghost.vx).toBe(1);
    expect(fitsPlacement(session.world, pellet, ghost.x, ghost.z)).toBe(true);
    expect(fitsPlacement(session.world, ghost, 0.2, 0)).toBe(true);
    KINDS.ghost.boxes = KINDS.fence.boxes;
    expect(propBlocks([ghost])).toEqual([]);
    // Rebinding the legs also reads the same solidity flag.
    bindLegWorld(session.spider, session.world);
    session.spider.update(0);
  });

  it('uses the buoyant walking surface when the registered world contains water', () => {
    const session = scene();
    session.world.terrain = { height: () => -2, surface: () => -0.8 };
    session.spider.yaw = -Math.PI / 2;
    session.spider.update(0.2, { throttle: 1, turn: 0, lift: 0, boost: 0 });
    expect(session.spider.swimming).toBe(true);
    expect(session.spider.root.position.x).toBeGreaterThan(0);
    expect(session.spider.halt).toBe('clear');
  });

  it('binds the same world boundary after the controller emits a long intent', () => {
    const session = scene();
    session.spider.place(WORLD_RADIUS - 0.01, 0, 0);
    session.spider.yaw = -Math.PI / 2;
    session.spider.update(0.2, { throttle: 1, turn: 0, lift: 0, boost: 1 });
    expect(session.spider.root.position.x).toBeLessThanOrEqual(WORLD_RADIUS);
    expect(session.spider.root.position.x).toBeCloseTo(WORLD_RADIUS, 6);
  });

  it('plans around the same shape and reports the owning entity instead of collider pieces', () => {
    const session = scene();
    const fence = addEntity(session.world, 'fence', { x: 0.8, z: 0 }, 0);
    const plan = planRoute(0, 0, 2, 0, session.world.blocks, () => 0, 10)!;
    expect(plan.direct).toBe(false);
    expect(plan.around).toEqual([fence.id]);
    for (let i = 1; i < plan.points.length; i++) {
      const from = plan.points[i - 1];
      const to = plan.points[i];
      for (let step = 0; step <= 100; step++) {
        expect(
          blockedAt(
            from.x + ((to.x - from.x) * step) / 100,
            from.z + ((to.z - from.z) * step) / 100,
            session.world.blocks,
          ),
        ).toBe(false);
      }
    }
  });
});
