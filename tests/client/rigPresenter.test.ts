import { afterEach, expect, it } from 'vitest';
import { ActorPresenter, ACTOR_RIGS } from '@/src/client/rig/presenter';
import { Spider } from '@/src/client/rig/Spider';
import { SimSession } from '@/src/shared/sim/session';
import { captureBody } from '@/src/shared/sim/snapshot';
import { removeEntity } from '@/src/shared/world';
import { KINDS } from '@/src/shared/kinds';
import { drive } from '@/tests/simHelpers';
import { pump } from '@/tests/helpers';

afterEach(() => {
  delete ACTOR_RIGS.test;
  delete KINDS.scout;
});

it('projects committed movement into a browser-owned rig without changing world data', async () => {
  const session = new SimSession(7);
  const saved = captureBody(session, null);
  const presenter = new ActorPresenter(session);
  expect(captureBody(session, null)).toEqual(saved);
  presenter.model.root.position.set(90, 90, 90);
  presenter.sync(0);
  expect(captureBody(session, null)).toEqual(saved);
  expect(presenter.model.root.position.x).toBe(session.actor.position.x);
  const start = session.actor.position.z;
  const walking = drive(session, 0.5, { throttle: 1 });
  for (let i = 0; i < 40; i++) presenter.step(1 / 60);
  await expect(walking).resolves.toMatchObject({ ok: true });
  expect(presenter.model.root.position.z).toBeLessThan(start);
  expect(presenter.model.capture().feet).toHaveLength(8);
  expect(presenter.model.root.position.z).toBe(session.actor.position.z);
});

it('rebinds restored geometry and entity identity without resetting physical motion', () => {
  const session = new SimSession(7);
  const presenter = new ActorPresenter(session);
  const saved = captureBody(session, null);
  const actor = saved.entities.find((entity) => entity.id === saved.controlledId)!;
  Object.assign(actor, { x: 4, y: 3, z: 5, vx: 1, vy: -2, vz: 3 });
  actor.control!.yaw = 0.7;
  actor.control!.speed = 1;
  session.adopt(saved);
  const restored = captureBody(session, null);
  presenter.sync(0);
  expect(captureBody(session, null)).toEqual(restored);
  expect(presenter.model.root.position.toArray()).toEqual([4, 3, 5]);
  expect(presenter.model.root.rotation.y).toBe(0.7);
  expect(presenter.model.legs.every((leg) => Number.isFinite(leg.foot.y))).toBe(true);
  removeEntity(session.world, session.actor.entity);
  presenter.sync(0);
  expect(presenter.model.root.visible).toBe(false);
  expect(presenter.model.rig.visible).toBe(false);
});

it('shows the current action target and clears it on cancellation or removal', async () => {
  const session = new SimSession(7);
  const presenter = new ActorPresenter(session);
  const item = session.addEntity('pebble', 0, -0.8);
  const pending = session.pickUp(item.id);
  presenter.step(1 / 60);
  expect(presenter.model.interaction?.target.z).toBe(item.z);
  expect(presenter.model.chassis.position.y).toBeLessThan(0);
  expect(presenter.model.halt).toBe(session.actor.halt);
  session.cancel();
  presenter.sync(0);
  expect(presenter.model.interaction).toBeNull();
  await expect(pending).resolves.toMatchObject({ reason: 'cancelled' });
  const stale = session.pickUp(item.id);
  removeEntity(session.world, item);
  presenter.sync(0);
  expect(presenter.model.interaction).toBeNull();
  pump(session, 24);
  await expect(stale).resolves.toMatchObject({ ok: false });
});

it('selects actor presentation by registration and leaves headless kinds usable without it', () => {
  const session = new SimSession(7);
  KINDS.scout = { ...KINDS.spider, rig: 'test' };
  const scout = session.addEntity('scout', 0, 0);
  session.actor.bindEntity(scout);
  session.world.controlledId = scout.id;
  ACTOR_RIGS.test = (source) => {
    const rig = new Spider(source);
    rig.root.name = 'registered-scout';
    return rig;
  };
  expect(new ActorPresenter(session).model.root.name).toBe('registered-scout');
  for (const rig of ['missing', 'toString', undefined]) {
    KINDS.scout.rig = rig;
    expect(() => new ActorPresenter(session)).toThrow('No registered actor rig');
  }
  scout.kind = 'unknown';
  expect(() => new ActorPresenter(session)).toThrow('No registered actor rig');
});
