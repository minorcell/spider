import { afterEach, describe, expect, it } from 'vitest';
import { PHYSICS } from '@/src/shared/config';
import { KINDS } from '@/src/shared/kinds';
import { initialControl } from '@/src/shared/control';
import { addEntity, removeEntity } from '@/src/shared/world';
import { SimSession } from '@/src/shared/sim/session';
import { captureBody, classify, type SimBody } from '@/src/shared/sim/snapshot';
import { stepPhysics } from '@/src/shared/sim/physics';
import {
  attachTether,
  attachmentFailure,
  carriedItems,
  heldBy,
  pullTethers,
  tetherAnchor,
  tetherEndpoints,
} from '@/src/shared/sim/tether';
import { pump } from '@/tests/helpers';

const zero = { x: 0, y: 0, z: 0 };
const far = { x: 100, z: 100, speed: 0 };

function scene() {
  KINDS.winch = {
    rest: 0,
    tether: { anchor: zero, limit: 2, minLength: 1, spacing: 0.3, stiffness: 2, damping: 0.1 },
  };
  KINDS.cart = {
    ...KINDS.winch,
    carryable: { anchor: zero },
    physics: { solid: true, loose: true, rolls: false, radius: 0.1, mass: 2 },
  };
  KINDS.parcel = {
    rest: 0,
    carryable: { anchor: zero },
    physics: { solid: true, loose: true, rolls: false, radius: 0.1, mass: 1 },
  };
  const session = new SimSession(7);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 1 };
  session.world.physics = { ...PHYSICS, gravity: 0, damping: 0, maxSpeed: 120 };
  return session;
}

afterEach(() => {
  delete KINDS.winch;
  delete KINDS.cart;
  delete KINDS.parcel;
});

function status(body: SimBody) {
  return classify({
    ...body,
    id: 'current',
    format: 4,
    savedAt: 1,
    day: '2026-11-11',
    owner: 'test',
    seq: 1,
    leaseUntil: 1,
  }).status;
}

describe('registered two-entity tethers', () => {
  it('uses registered endpoints for controlled, rotated and unrotated entities', () => {
    const session = scene();
    const source = session.actor.entity;
    Object.assign(source, { x: 3, y: 4, z: 5 });
    source.control = { ...initialControl(), yaw: Math.PI / 2 };
    const local = { x: 1, y: 2, z: 3 };
    expect(tetherAnchor(source, local)).toEqual({ x: 6, y: 6, z: 4 });
    const parcel = addEntity(session.world, 'parcel', { x: 2, z: 5 }, 0);
    parcel.y = 3;
    expect(tetherAnchor(parcel, local)).toEqual({ x: 3, y: 5, z: 8 });
    Object.assign(parcel, { qx: 0, qy: 0, qz: Math.SQRT1_2, qw: Math.SQRT1_2 });
    const rotated = tetherAnchor(parcel, local);
    expect(rotated.x).toBeCloseTo(0);
    expect(rotated.y).toBeCloseTo(4);
    expect(rotated.z).toBeCloseTo(8);
  });

  it('keeps a rolling item’s center attachment fixed while its surface turns', () => {
    const session = scene();
    const pebble = session.addEntity('pebble', 2, 3);
    Object.assign(pebble, { qx: 0.6, qy: 0, qz: 0, qw: 0.8 });
    const point = tetherAnchor(pebble, KINDS.pebble.carryable!.anchor);
    expect(point).toEqual({ x: pebble.x, y: pebble.y + 0.19, z: pebble.z });
    expect(tetherAnchor({ ...pebble, kind: 'unknown' }, zero)).toEqual({
      x: pebble.x,
      y: pebble.y,
      z: pebble.z,
    });
  });

  it('releases one relation without mixing in another owner’s inventory', () => {
    const session = scene();
    const winch = session.addEntity('winch', 3, 0);
    const a = session.addEntity('pebble', 0, 0);
    const b = session.addEntity('pebble', 1, 0);
    const c = session.addEntity('pebble', 2, 0);
    attachTether(session.world, session.actor.entity.id, a.id);
    attachTether(session.world, session.actor.entity.id, b.id);
    attachTether(session.world, winch.id, c.id);
    a.vx = 2;
    expect(session.release(a.id)).toEqual({
      ok: true,
      action: 'release',
      target: a.id,
      carrying: [b.id],
    });
    expect(a.vx).toBe(2);
    expect(carriedItems(session.world, winch.id)).toEqual([c]);
  });

  it('keeps independent inventories and capacities for two owners through save and removal', () => {
    const session = scene();
    const { world } = session;
    const winch = addEntity(world, 'winch', { x: 3, z: 0 }, 0);
    const a = addEntity(world, 'parcel', { x: 0.8, z: 0 }, 0);
    const b = addEntity(world, 'parcel', { x: 3.1, z: 0 }, 0);
    const c = addEntity(world, 'parcel', { x: 3.2, z: 0 }, 0);
    expect(attachTether(world, session.actor.entity.id, a.id).ok).toBe(true);
    expect(attachTether(world, winch.id, b.id)).toMatchObject({
      ok: true,
      relation: { length: 1 },
    });
    expect(attachTether(world, winch.id, c.id)).toMatchObject({
      ok: true,
      relation: { length: 1.3 },
    });
    expect(carriedItems(world)).toEqual([a]);
    expect(carriedItems(world, winch.id)).toEqual([b, c]);
    expect(heldBy(world, b.id)).toBe(false);
    expect(heldBy(world, b.id, winch.id)).toBe(true);
    expect(heldBy({ ...world, controlledId: undefined }, a.id)).toBe(false);
    expect(session.release(b.id)).toMatchObject({ ok: false, reason: 'not-carrying' });
    expect(session.observe().entities.some((entity) => entity.id === b.id)).toBe(true);
    const save = captureBody(session, null);
    expect(status(save)).toBe('ok');
    const restored = new SimSession(8);
    restored.adopt(save);
    expect(restored.world.tethers).toEqual(world.tethers);
    expect(restored.world.tethers.get(a.id)).not.toBe(world.tethers.get(a.id));
    removeEntity(world, winch);
    expect(world.tethers.size).toBe(1);
    expect(world.entities.get(b.id)).toBe(b);
    expect(world.entities.get(c.id)).toBe(c);
    removeEntity(world, a);
    expect(world.tethers.size).toBe(0);
  });

  it('validates registered capabilities, exclusive targets and each owner’s capacity', () => {
    const { world } = scene();
    const winch = addEntity(world, 'winch', { x: 0, z: 0 }, 0);
    const parcels = [0, 1, 2].map((x) => addEntity(world, 'parcel', { x, z: 1 }, 0));
    const berry = addEntity(world, 'berry', { x: 0, z: 0 }, 0);
    expect(attachmentFailure(world, 'absent', parcels[0].id)).toBe('not-found');
    expect(attachmentFailure(world, winch.id, 'absent')).toBe('not-found');
    expect(attachmentFailure(world, winch.id, winch.id)).toBe('same-entity');
    expect(attachmentFailure(world, parcels[0].id, parcels[1].id)).toBe('not-tether-capable');
    expect(attachmentFailure(world, winch.id, berry.id)).toBe('not-carryable');
    attachTether(world, winch.id, parcels[0].id);
    expect(attachmentFailure(world, world.controlledId!, parcels[0].id)).toBe('already-tethered');
    attachTether(world, winch.id, parcels[1].id);
    expect(attachTether(world, winch.id, parcels[2].id)).toEqual({ ok: false, reason: 'full' });
    expect(attachTether(world, world.controlledId!, parcels[2].id).ok).toBe(true);
    parcels[0].kind = 'absent';
    expect(attachmentFailure(world, winch.id, parcels[0].id)).toBe('not-carryable');
    winch.kind = 'absent';
    expect(attachmentFailure(world, winch.id, parcels[2].id)).toBe('not-tether-capable');
  });

  it('allows more than seven total relations when separate registered owners have capacity', () => {
    const session = scene();
    KINDS.winch.tether!.limit = 8;
    const winch = session.addEntity('winch', 10, 0);
    for (let i = 0; i < 8; i++) {
      const item = session.addEntity('parcel', 10, i);
      expect(attachTether(session.world, winch.id, item.id).ok).toBe(true);
    }
    const held = session.addEntity('pebble', 0, -0.8);
    expect(attachTether(session.world, session.actor.entity.id, held.id).ok).toBe(true);
    const body = captureBody(session, null);
    expect(status(body)).toBe('ok');
    KINDS.winch.tether!.limit = 7;
    expect(status(body)).toBe('malformed');
    for (const sourceId of [undefined, 2, 'absent', held.id]) {
      expect(status({ ...body, tethers: [{ ...body.tethers[0], sourceId }] } as SimBody)).toBe(
        'malformed',
      );
    }
    expect(
      status({ ...body, tethers: Array(body.entities.length + 1).fill(body.tethers[0]) }),
    ).toBe('malformed');
  });

  it('pulls both loose endpoints by registered mass and preserves total momentum', () => {
    const { world } = scene();
    const cart = addEntity(world, 'cart', { x: -2, z: 0 }, 0);
    const parcel = addEntity(world, 'parcel', { x: 2, z: 0 }, 0);
    attachTether(world, cart.id, parcel.id);
    world.tethers.get(parcel.id)!.length = 1;
    stepPhysics(world, far, 0.1);
    expect(cart.x).toBeGreaterThan(-2);
    expect(parcel.x).toBeLessThan(2);
    expect(cart.vx! * 2 + parcel.vx!).toBeCloseTo(0);
    expect(cart.vx).toBeCloseTo(0.3);
    expect(parcel.vx).toBeCloseTo(-0.6);
  });

  it('adds chain impulses from one velocity state regardless of relation iteration order', () => {
    const { world } = scene();
    const a = addEntity(world, 'cart', { x: -3, z: 0 }, 0);
    const b = addEntity(world, 'cart', { x: 0, z: 0 }, 0);
    const c = addEntity(world, 'parcel', { x: 4, z: 0 }, 0);
    attachTether(world, a.id, b.id);
    attachTether(world, b.id, c.id);
    for (const relation of world.tethers.values()) relation.length = 1;
    pullTethers(world, 0.1);
    const result = [a.vx, b.vx, c.vx];
    expect(result[0]).toBeCloseTo(0.2);
    expect(result[1]).toBeCloseTo(0.1);
    expect(result[2]).toBeCloseTo(-0.6);
    for (const entity of [a, b, c]) entity.vx = entity.vy = entity.vz = 0;
    world.tethers = new Map([...world.tethers].reverse());
    pullTethers(world, 0.1);
    expect([a.vx, b.vx, c.vx]).toEqual(result);
  });

  it('leaves slack and rapidly approaching bodies unforced, then wakes a resting tethered body', () => {
    const { world } = scene();
    const winch = addEntity(world, 'winch', { x: 0, z: 0 }, 0);
    const parcel = addEntity(world, 'parcel', { x: 2, z: 0 }, 0);
    attachTether(world, winch.id, parcel.id);
    expect(pullTethers(world, 0.1).size).toBe(0);
    world.tethers.get(parcel.id)!.length = 1;
    parcel.vx = -100;
    expect(pullTethers(world, 0.1).size).toBe(0);
    expect(parcel.vx).toBe(-100);
    parcel.vx = 0;
    world.tethers.get(parcel.id)!.length = 10;
    stepPhysics(world, far, 0.1);
    const restingX = parcel.x;
    world.tethers.get(parcel.id)!.length = 1;
    stepPhysics(world, far, 0.1);
    expect(parcel.x).toBeLessThan(restingX);
  });

  it('uses turning source velocity and registered default mass in the common force rule', () => {
    const { world } = scene();
    const source = world.entities.get(world.controlledId!)!;
    source.control!.yawRate = 2;
    KINDS.parcel.physics!.mass = undefined;
    const parcel = addEntity(world, 'parcel', { x: 5, z: 1.66 }, 0);
    parcel.y = source.y + 0.82;
    attachTether(world, source.id, parcel.id);
    world.tethers.get(parcel.id)!.length = 1.2;
    source.vx = 0.1;
    source.vy = 0.2;
    source.vz = 0.3;
    pullTethers(world, 0.01);
    expect(parcel.vx).toBeLessThan(0);
    expect(source.vx).toBe(0.1);
  });

  it('tolerates missing or no-longer-capable endpoints without creating phantom forces', () => {
    const { world } = scene();
    const winch = addEntity(world, 'winch', { x: 0, z: 0 }, 0);
    const parcel = addEntity(world, 'parcel', { x: 4, z: 0 }, 0);
    attachTether(world, winch.id, parcel.id);
    const relation = world.tethers.get(parcel.id)!;
    relation.length = 1;
    parcel.kind = 'berry';
    expect(tetherEndpoints(world, relation)).toBeNull();
    parcel.kind = 'absent';
    expect(pullTethers(world, 0.1).size).toBe(0);
    parcel.kind = 'parcel';
    winch.kind = 'parcel';
    expect(pullTethers(world, 0.1).size).toBe(0);
    winch.kind = 'absent';
    expect(pullTethers(world, 0.1).size).toBe(0);
    world.entities.delete(winch.id);
    expect(pullTethers(world, 0.1).size).toBe(0);
    world.entities.set(winch.id, winch);
    world.entities.delete(parcel.id);
    expect(pullTethers(world, 0.1).size).toBe(0);
  });

  it('rechecks availability at pickup commit without stealing another owner’s relation', async () => {
    const session = scene();
    const winch = session.addEntity('winch', 2, 0);
    const item = session.addEntity('pebble', 0, -0.8);
    const pending = session.pickUp(item.id);
    attachTether(session.world, winch.id, item.id);
    pump(session, 24);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'already-tethered' });
    expect(session.world.tethers.get(item.id)!.sourceId).toBe(winch.id);
    expect(session.sense().carrying).toEqual([]);
    expect(session.near().some((entity) => entity.id === item.id)).toBe(true);
  });
});
