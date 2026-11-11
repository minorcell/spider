import { afterEach, describe, expect, it } from 'vitest';
import { KINDS } from '@/src/shared/kinds';
import { islandActor } from '@/src/shared/islandContent';
import { Controller } from '@/src/shared/sim/controller';
import { bindController } from '@/src/shared/sim/bindController';
import { SimSession } from '@/src/shared/sim/session';
import { addEntity, removeEntity } from '@/src/shared/world';
import { BODY_RADIUS } from '@/src/shared/collision';
import { block, pump } from '@/tests/helpers';
import { IDLE_CONTROLS } from '@/src/shared/types';

const originalActor = islandActor.kind;
afterEach(() => {
  islandActor.kind = originalActor;
  delete KINDS.scout;
});

describe('registered controlled entities', () => {
  it('keeps the controlled body in the one entity index and excludes itself from perception', () => {
    const session = new SimSession(7);
    const actor = session.actor.entity;
    expect(session.world.entities.get(session.world.controlledId!)).toBe(actor);
    expect(session.observe().entities.map((item) => item.id)).not.toContain(actor.id);
    expect(session.near().map((item) => item.id)).not.toContain(actor.id);
    expect(structuredClone(actor)).toEqual(actor);
    expect(Object.getPrototypeOf(actor)).toBe(Object.prototype);
  });

  it('uses another registered movement capability without a dedicated controller or collision implementation', () => {
    KINDS.scout = {
      rest: 0,
      physics: { solid: true, loose: false, rolls: false, radius: 0.1 },
      control: { ...KINDS.spider.control!, cruise: 6, heightMax: 0.2, clearance: [] },
    };
    islandActor.kind = 'scout';
    const session = new SimSession(7);
    session.world.terrain = { height: () => 0 };
    session.world.blocks = [block('wall', 0.5, 0.6, -10, 10)];
    const controller = session.actor;
    controller.entity.control!.yaw = -Math.PI / 2;
    controller.entity.y = 0;
    bindController(controller, session.world);
    controller.update(1, { ...IDLE_CONTROLS, throttle: 1, lift: 1 });
    expect(session.world.controlledId).toBe('scout-1');
    expect(controller.position.x).toBeCloseTo(0.4, 6);
    expect(controller.heightSet).toBe(0.2);
    expect(controller.entity.vx).toBeCloseTo(0.4, 6);
    expect(controller.entity.control!.time).toBe(1);
  });

  it('runs the movement kernel without constructing a model and rejects unregistered control', () => {
    KINDS.scout = { rest: 0, control: { ...KINDS.spider.control!, clearance: [] } };
    const entity = { id: 'actor', kind: 'scout', x: 0, y: 0, z: 0, stage: 0 };
    const controller = new Controller(entity);
    expect(controller.radius).toBe(BODY_RADIUS);
    controller.update(0.2, { ...IDLE_CONTROLS, throttle: 1 });
    expect(controller.position.z).toBeLessThan(0);
    expect(controller.entity.vz).toBeLessThan(0);
    expect(() => new Controller({ ...entity, kind: 'apple' })).toThrow('movement capability');
  });

  it('ends an action when its indexed actor has been removed', async () => {
    const session = new SimSession(7);
    const action = session.walk(2);
    const before = session.actor.time;
    removeEntity(session.world, session.actor.entity);
    pump(session, 2);
    await expect(action).resolves.toMatchObject({ ok: false, reason: 'stale-actor' });
    expect(session.actor.time).toBe(before);
    expect(session.world.controlledId).toBeUndefined();
  });

  it('does not continue an action through a replaced entity with the same ID', async () => {
    const session = new SimSession(7);
    const action = session.walk(2);
    session.world.entities.set(session.actor.entity.id, structuredClone(session.actor.entity));
    session.frame(1 / 60);
    await expect(action).resolves.toMatchObject({ ok: false, reason: 'stale-actor' });
    const item = addEntity(session.world, 'pebble', { x: 3, z: 3 }, 0);
    removeEntity(session.world, item);
    expect(session.world.controlledId).toBe(session.actor.entity.id);
  });
});
