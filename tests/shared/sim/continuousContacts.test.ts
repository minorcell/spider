import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { attachTether } from '@/src/shared/sim/tether';
import { stepPhysics } from '@/src/shared/sim/physics';
import { SimSession } from '@/src/shared/sim/session';
import { addEntity } from '@/src/shared/world';
import { block, pump } from '@/tests/helpers';
import { drive } from '@/tests/simHelpers';

const far = { x: 100, z: 100, speed: 0 };

function scene(): SimSession {
  KINDS.light = {
    rest: 0,
    carryable: { anchor: { x: 0, y: 0, z: 0 } },
    physics: { solid: true, radius: 0.02, loose: true, rolls: true, mass: 1 },
  };
  KINDS.heavy = { ...KINDS.light, physics: { ...KINDS.light.physics!, mass: 2 } };
  const session = new SimSession(7);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  session.world.physics = { ...PHYSICS, gravity: 0, damping: 0, maxSpeed: 120 };
  return session;
}

afterEach(() => {
  delete KINDS.light;
  delete KINDS.heavy;
  delete KINDS.ghost;
});

describe('continuous body contacts', () => {
  it('prevents equal bodies from swapping sides in one step', () => {
    const session = scene();
    const a = addEntity(session.world, 'light', { x: -0.4, z: 0 }, 0);
    const b = addEntity(session.world, 'light', { x: 0.4, z: 0 }, 0);
    a.vx = 10;
    b.vx = -10;
    stepPhysics(session.world, far, 0.1);
    expect(a.x).toBeCloseTo(-0.02, 6);
    expect(b.x).toBeCloseTo(0.02, 6);
    expect(a.vx).toBeCloseTo(0);
    expect(b.vx).toBeCloseTo(0);
  });

  it('transfers momentum according to registered mass and continues after contact', () => {
    const session = scene();
    const a = addEntity(session.world, 'light', { x: -0.4, z: 0 }, 0);
    const b = addEntity(session.world, 'heavy', { x: 0.4, z: 0 }, 0);
    a.vx = 10;
    stepPhysics(session.world, far, 0.2);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x - a.x).toBeCloseTo(0.04, 6);
    expect(a.vx).toBeCloseTo(10 / 3, 6);
    expect(b.vx).toBeCloseTo(10 / 3, 6);
    expect(b.x).toBeGreaterThan(0.4);
  });

  it('finds contacts along vertical motion as well as horizontal motion', () => {
    const session = scene();
    const a = addEntity(session.world, 'light', { x: 0, z: 0 }, 0);
    const b = addEntity(session.world, 'light', { x: 0, z: 0 }, 0);
    a.y = 1;
    b.y = 2;
    a.vy = 10;
    b.vy = -10;
    stepPhysics(session.world, far, 0.1);
    expect(b.y - a.y).toBeCloseTo(0.04, 6);
    expect(a.vy).toBeCloseTo(0);
    expect(b.vy).toBeCloseTo(0);
  });

  it('detects a controller crossing a small item even when its endpoint is far away', () => {
    const session = scene();
    const item = addEntity(session.world, 'light', { x: 0, z: 0 }, 0);
    stepPhysics(session.world, { x: 1, z: 0, speed: 20, from: { x: -1, z: 0 } }, 0.1);
    expect(item.x).toBeGreaterThanOrEqual(1.5 - 1e-6);
    expect(item.vx).toBeGreaterThan(0);
  });

  it('propagates a collision through a chain and stops it at a wall', () => {
    const { world } = scene();
    world.blocks = [block('wall', 0.6, 0.61, -1, 1)];
    const bodies = [-0.4, 0, 0.4].map((x) => addEntity(world, 'light', { x, z: 0 }, 0));
    bodies[0].vx = 10;
    stepPhysics(world, far, 0.4);
    for (let i = 1; i < bodies.length; i++) {
      expect(bodies[i].x - bodies[i - 1].x).toBeGreaterThanOrEqual(0.04 - 1e-6);
    }
    expect(bodies[2].x).toBeCloseTo(0.58, 6);
    expect(bodies.map((body) => body.vx)).toEqual([0, 0, 0]);
  });

  it('wakes a sleeping body without losing its elevated ground support', () => {
    const { world } = scene();
    world.terrain = { height: () => 5 };
    const target = addEntity(world, 'light', { x: 0.4, z: 0 }, 0);
    stepPhysics(world, far, 0.1);
    stepPhysics(world, far, 0.1);
    const source = addEntity(world, 'light', { x: -0.4, z: 0 }, 0);
    source.vx = 10;
    stepPhysics(world, far, 0.2);
    expect(target.x).toBeGreaterThan(0.4);
    expect(target.y).toBeGreaterThanOrEqual(5);
    expect(source.y).toBeCloseTo(target.y);
    expect(target.vx).toBeCloseTo(5);
  });

  it('uses the controller radius and stops a pinned push without freezing unrelated bodies', () => {
    const { world } = scene();
    world.blocks = [block('wall', 0.6, 0.61, -1, 1)];
    const pushed = addEntity(world, 'light', { x: 0, z: 0 }, 0);
    const free = addEntity(world, 'light', { x: 0, z: 3 }, 0);
    free.vx = 2;
    const committed = stepPhysics(
      world,
      { x: 1, z: 0, speed: 20, radius: 0.1, from: { x: -1, z: 0 } },
      0.1,
    )!;
    expect(pushed.x).toBeCloseTo(0.58, 6);
    expect(committed.x).toBeCloseTo(0.46, 6);
    expect(pushed.vx).toBeCloseTo(0);
    expect(free.x).toBeCloseTo(0.2, 6);
  });

  it('commits a blocked controller position before the session completes its action', async () => {
    const session = scene();
    session.world.blocks = [block('wall', 0.65, 0.66, -1, 1)];
    const item = addEntity(session.world, 'light', { x: 0.6, z: 0 }, 0);
    Object.assign(session.actor.position, { x: 0, y: 0, z: 0 });
    session.actor.state.yaw = -Math.PI / 2;
    const action = drive(session, 3, { throttle: 1 });
    pump(session, 240);
    await expect(action).resolves.toMatchObject({ ok: false, reason: 'blocked', halt: 'solid' });
    expect(session.actor.position.x).toBeCloseTo(0.13, 5);
    expect(item.x).toBeCloseTo(0.63, 5);
    expect(item.x - session.actor.position.x).toBeCloseTo(0.5, 5);
  });

  it('lets a non-solid registered body pass through other bodies and walls', () => {
    const { world } = scene();
    KINDS.ghost = { ...KINDS.light, physics: { ...KINDS.light.physics!, solid: false } };
    world.blocks = [block('wall', 0.6, 0.61, -1, 1)];
    const source = addEntity(world, 'ghost', { x: -0.4, z: 0 }, 0);
    const target = addEntity(world, 'light', { x: 0.4, z: 0 }, 0);
    source.vx = 10;
    stepPhysics(world, far, 0.2);
    expect(source.x).toBeCloseTo(1.6, 6);
    expect(target.x).toBe(0.4);
  });

  it('separates an initially overlapping stack when the higher body is indexed first', () => {
    const { world } = scene();
    const high = addEntity(world, 'light', { x: 0, z: 0 }, 0);
    const low = addEntity(world, 'light', { x: 0, z: 0 }, 0);
    high.y = low.y + 0.02;
    stepPhysics(world, far, 0.1);
    expect(high.y - low.y).toBeCloseTo(0.04, 6);
    expect(low.y).toBeGreaterThanOrEqual(0);
  });

  it.each([0.3, 0.8])('chooses the first obstacle when the shore is at %s', (shore) => {
    const { world } = scene();
    world.terrain = { height: () => 0, inside: (x, _z, radius = 0) => x <= shore - radius };
    world.blocks = [block('wall', 0.6, 0.61, -1, 1)];
    const item = addEntity(world, 'light', { x: 0, z: 0 }, 0);
    item.vx = 10;
    stepPhysics(world, far, 0.1);
    expect(item.x).toBeCloseTo(Math.min(shore, 0.6) - 0.02, 6);
    expect(item.vx).toBe(0);
  });

  it('resolves a tether impulse through the same continuous body contacts', () => {
    const { world } = scene();
    const pulled = addEntity(world, 'light', { x: -0.4, z: 0 }, 0);
    const target = addEntity(world, 'heavy', { x: 0.4, z: 0 }, 0);
    const source = world.entities.get(world.controlledId!)!;
    Object.assign(source, { x: 100, y: pulled.y - 0.82, z: -1.66 });
    attachTether(world, source.id, pulled.id);
    world.tethers.get(pulled.id)!.length = 1;
    stepPhysics(world, far, 0.2);
    expect(target.x).toBeGreaterThan(0.4);
    expect(target.x - pulled.x).toBeCloseTo(0.04, 6);
    expect(pulled.vx).toBeCloseTo(target.vx!, 6);
    expect(world.tethers.has(pulled.id)).toBe(true);
  });
});
