import { Spider } from '@/src/client/rig/Spider';
import { bindLegWorld } from '@/src/client/rig/bindWorld';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { BODY_RADIUS, blockedAt } from '@/src/shared/collision';
import { moveRegisteredBody } from '@/src/shared/registeredBodyMotion';
import { planRoute } from '@/src/shared/route';
import { SimSession } from '@/src/shared/sim/session';
import { fitsPlacement, stepPhysics } from '@/src/shared/sim/physics';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import { addEntity, propBlocks, removeEntity } from '@/src/shared/world';

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
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  session.world.physics = { ...PHYSICS, damping: 0, maxSpeed: 120 };
  return session;
}

afterEach(() => {
  delete KINDS.fence;
  delete KINDS.pellet;
  delete KINDS.ghost;
  delete KINDS.slab;
  delete KINDS['flat-walker'];
});

describe('registered bodies share continuous collision', () => {
  it('stops both a fast tiny item and the controlled body at a registered thin shape', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.8, z: 0 });
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: -2 });
    pellet.vx = 80;
    stepPhysics(session.world, away, 1 / 30);
    expect(pellet.x).toBeCloseTo(0.79, 6);
    expect(pellet.vx).toBe(0);
    expect(blockedAt(pellet.x, pellet.z, session.world.blocks, 0.01)).toBe(false);

    session.actor.state.yaw = -Math.PI / 2;
    session.actor.update(0.5, { throttle: 1, turn: 0, lift: 0, boost: 1 });
    const front = Math.max(
      ...session.actor.spec.clearance.map(({ c, r }) => -c[2] + Math.max(r[0], r[2])),
    );
    expect(session.actor.position.x).toBeCloseTo(0.8 - front, 6);
    expect(
      blockedAt(session.actor.position.x, session.actor.position.z, session.world.blocks),
    ).toBe(false);
  });

  it('stops a reversing actor at the abdomen, before the origin reaches a wall', () => {
    const session = scene();
    session.world.blocks = [
      { id: 'rear-wall', minX: -3, maxX: 3, minZ: 2.2, maxZ: 2.3, height: 2 },
    ];
    Object.assign(session.actor.position, { x: 0, y: 0, z: 0 });
    session.actor.state.yaw = 0;

    session.actor.update(1, { throttle: -1, turn: 0, lift: 0, boost: 0 });

    const rear = Math.max(
      ...session.actor.spec.clearance.map(({ c, r }) => c[2] + Math.max(r[0], r[2])),
    );
    expect(session.actor.position.z).toBeCloseTo(2.2 - rear, 6);
    expect(session.actor.position.z + BODY_RADIUS).toBeLessThan(2.2);
  });

  it('limits a turn whose swept abdomen would cross a nearby wall', () => {
    const session = scene();
    session.world.blocks = [
      { id: 'side-wall', minX: 1.4, maxX: 1.5, minZ: -2, maxZ: 2, height: 2 },
    ];
    Object.assign(session.actor.position, { x: 0, y: 0, z: 0 });
    session.actor.state.yaw = 0;

    session.actor.update(1, { throttle: 0, turn: -1, lift: 0, boost: 0 });

    const yaw = session.actor.yaw;
    const rearEdge = (angle: number) =>
      Math.max(
        ...session.actor.spec.clearance.map(
          ({ c, r }) => c[0] * Math.cos(angle) + c[2] * Math.sin(angle) + Math.max(r[0], r[2]),
        ),
      );
    expect(yaw).toBeGreaterThan(0);
    expect(yaw).toBeLessThan(Math.PI / 2);
    expect(rearEdge(yaw)).toBeLessThanOrEqual(1.4);
    expect(rearEdge(yaw + 0.03)).toBeGreaterThan(1.4);
    expect(session.actor.position).toMatchObject({ x: 0, z: 0 });
  });

  it('honors a shared center-boundary callback without a radius-specific callback', () => {
    const reached = moveRegisteredBody({ x: 0, y: 0, z: 0 }, 0, [], 4, 0, {
      blocks: [],
      inside: (x) => x < 2,
    });
    expect(reached.halt).toBe('solid');
    expect(reached.x).toBeCloseTo(2, 6);
  });

  it('sweeps an actor push instead of teleporting an item to the far side of a wall', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.2, z: 0 });
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: 0 });
    stepPhysics(session.world, { x: -0.1, z: 0, speed: 2 }, 1 / 60);
    expect(pellet.x).toBeCloseTo(0.19, 6);
    expect(pellet.vx).toBe(0);
  });

  it('keeps the along-wall velocity after a dynamic contact', () => {
    const session = scene();
    addEntity(session.world, 'fence', { x: 0.2, z: 0 });
    const pellet = addEntity(session.world, 'pellet', { x: 0, z: 0 });
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
    Object.assign(session.actor.position, { x: -5, y: 0, z: 0 });
    KINDS.ghost = { ...KINDS.pellet, physics: { ...KINDS.pellet.physics!, solid: false } };
    addEntity(session.world, 'fence', { x: 0.2, z: 0 });
    const ghost = addEntity(session.world, 'ghost', { x: 0, z: 0 });
    const pellet = addEntity(session.world, 'pellet', { x: 0.4, z: 0 });
    ghost.vx = 1;
    stepPhysics(session.world, { x: 0.4, z: 0.01, speed: 0 }, 0.4);
    expect(ghost.x).toBeCloseTo(0.4);
    expect(ghost.vx).toBe(1);
    expect(fitsPlacement(session.world, pellet, ghost.x, ghost.z)).toBe(true);
    expect(fitsPlacement(session.world, ghost, 0.2, 0)).toBe(true);
    KINDS.ghost.boxes = KINDS.fence.boxes;
    expect(propBlocks([ghost])).toEqual([]);
    // Rebinding the legs also reads the same solidity flag.
    bindLegWorld(new Spider(session.actor), session.world);
    session.actor.update(0);
  });

  it('uses the buoyant walking surface when the registered world contains water', () => {
    const session = scene();
    session.world.terrain = { height: () => -2, surface: () => -0.8 };
    session.actor.state.yaw = -Math.PI / 2;
    session.actor.update(0.2, { throttle: 1, turn: 0, lift: 0, boost: 0 });
    expect(session.actor.swimming).toBe(true);
    expect(session.actor.position.x).toBeGreaterThan(0);
    expect(session.actor.halt).toBe('clear');
  });

  it('keeps the complete registered body within the world boundary during a long intent', () => {
    const session = scene();
    const front = Math.max(
      ...session.actor.spec.clearance.map(({ c, r }) => -c[2] + Math.max(r[0], r[2])),
    );
    Object.assign(session.actor.position, { x: WORLD_RADIUS - front - 0.01, y: 0, z: 0 });
    session.actor.state.yaw = -Math.PI / 2;
    session.actor.update(0.2, { throttle: 1, turn: 0, lift: 0, boost: 1 });
    expect(session.actor.position.x + front).toBeCloseTo(WORLD_RADIUS, 6);
    expect(session.actor.position.x + front).toBeLessThanOrEqual(WORLD_RADIUS);
  });

  it('plans around the same shape and reports the owning entity instead of collider pieces', () => {
    const session = scene();
    const fence = addEntity(session.world, 'fence', { x: 0.8, z: 0 });
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

describe('registered walkable surfaces', () => {
  function registerSlab(): void {
    const half = 1;
    KINDS.slab = {
      rest: 0,
      walkable: true,
      boxes: (entity) => [
        {
          id: 'top',
          minX: -half,
          maxX: half,
          minZ: -half,
          maxZ: half,
          height: entity.stage === 0 ? 0.75 : 2,
        },
      ],
      support: (entity, x, z) =>
        Math.abs(x - entity.x) <= half && Math.abs(z - entity.z) <= half
          ? entity.y + (entity.stage === 0 ? 0.75 : 2)
          : Number.NEGATIVE_INFINITY,
    };
  }

  it.each(['stone', 'bog-stone'])('climbs a low %s using ordinary walking', (kind) => {
    const session = scene();
    const rock = addEntity(session.world, kind, { x: 0, z: -4 });
    rock.footprint = { kind: 'circle', r: kind === 'stone' ? 0.5 : 0.85 };
    session.world.blocks = propBlocks(session.world.entities.values());

    let highest = 0;
    for (let i = 0; i < 240 && session.actor.position.z > -4.75; i++) {
      session.actor.update(1 / 60, { throttle: 0.55, turn: 0, lift: 0, boost: 0 });
      highest = Math.max(highest, session.actor.position.y);
    }

    expect(session.actor.position.z).toBeLessThanOrEqual(-4.75);
    expect(highest).toBeGreaterThan(0.04);
  });

  it('walks onto a low support through the route API after restoring it, and drops after removal', async () => {
    const session = scene();
    registerSlab();
    const low = addEntity(session.world, 'slab', { x: 0, z: -4 });
    const body = JSON.parse(JSON.stringify(captureBody(session, null)));
    applyBody(session, body);
    session.world.terrain = { height: () => 0 };
    const restored = session.world.entities.get(low.id)!;
    expect(restored).not.toBe(low);
    expect(session.world.blocks).toContainEqual(
      expect.objectContaining({ owner: restored.id, height: restored.y + 0.75 }),
    );

    let finished = false;
    const route = session.moveTo(0, -4).finally(() => {
      finished = true;
    });
    for (let i = 0; i < 600 && !finished; i++) {
      session.frame(1 / 60);
      await Promise.resolve();
    }
    expect(finished).toBe(true);
    expect(await route).toMatchObject({ ok: true, reason: 'reached', detour: null });
    expect(Math.abs(session.actor.position.z + 4)).toBeLessThan(0.45);
    expect(session.actor.position.y).toBeGreaterThan(0.15);

    removeEntity(session.world, restored);
    expect(session.world.blocks.some((block) => block.owner === restored.id)).toBe(false);
    for (let i = 0; i < 120; i++) session.frame(1 / 60);
    expect(session.actor.position.y).toBeCloseTo(0, 4);
  });

  it('keeps low supports solid for a registered body without the step capability', async () => {
    const session = scene();
    registerSlab();
    KINDS['flat-walker'] = {
      ...KINDS.spider,
      control: { ...session.actor.spec, stepHeight: undefined },
    };
    const walker = addEntity(session.world, 'flat-walker', { x: 0, z: 0 });
    removeEntity(session.world, session.actor.entity);
    session.world.controlledId = walker.id;
    session.actor.bindEntity(walker);
    addEntity(session.world, 'slab', { x: 0, z: -4 });

    await expect(session.moveTo(0, -4)).resolves.toMatchObject({ ok: false, reason: 'no-path' });
    for (let i = 0; i < 120; i++) {
      session.actor.update(1 / 60, { throttle: 1, turn: 0, lift: 0, boost: 0 });
    }
    expect(walker.z).toBeGreaterThan(-3);
    expect(session.actor.halt).toBe('solid');
  });

  it('preserves the turn collision when the movement solver returns no displacement', () => {
    const session = scene();
    session.actor.bindTurn((from) => from);
    session.actor.bindMotion((x, z) => ({ x, z, dx: 0, dz: 0, halt: 'clear' }));

    session.actor.update(0.5, { throttle: 1, turn: 1, lift: 0, boost: 0 });

    expect(session.actor.position).toMatchObject({ x: 0, z: 0 });
    expect(session.actor.halt).toBe('solid');
    expect(session.actor.speed).toBe(0);
  });

  it('keeps taller instances of the same registered support solid to walking and routes', async () => {
    const session = scene();
    registerSlab();
    const tall = addEntity(session.world, 'slab', { x: 0, z: -4 });
    tall.stage = 1;
    session.world.blocks = propBlocks(session.world.entities.values());

    await expect(session.moveTo(0, -4)).resolves.toMatchObject({ ok: false, reason: 'no-path' });
    for (let i = 0; i < 120; i++) {
      session.actor.update(1 / 60, { throttle: 1, turn: 0, lift: 0, boost: 0 });
    }
    expect(session.actor.position.z).toBeGreaterThan(-3);
    expect(session.actor.halt).toBe('solid');
  });
});
