import { afterEach, describe, expect, it } from 'vitest';
import { KINDS } from '@/src/shared/kinds';
import { deadlineAt, freshnessOf, nourish } from '@/src/shared/life';
import { addEntity, createWorld } from '@/src/shared/world';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import { attachTether } from '@/src/shared/sim/tether';

const epoch = 1_800_000_000_000;

function scene(): SimSession {
  const session = new SimSession(7, undefined, epoch);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  session.world.populations.clear();
  return session;
}

function tick(session: SimSession, count: number): void {
  for (let i = 0; i < count; i++) session.frame(1 / 60, session.world.clock.wallNowMs);
}

afterEach(() => {
  delete KINDS.ration;
  delete KINDS.grazer;
});

describe('registered life capabilities', () => {
  it('stamps staggered instance deadlines and keeps them when definitions change', () => {
    const world = createWorld(7, undefined, epoch);
    const apples = [...world.entities.values()].filter((item) => item.kind === 'apple');
    expect(apples).toHaveLength(20);
    for (const [i, apple] of apples.entries()) {
      expect(apple.deadline).toEqual({
        clock: 'wall',
        expiresAtMs: epoch + (720 - i * 24) * 1000,
        rotsAtMs: epoch + (630 - i * 24) * 1000,
      });
    }
    KINDS.ration = { ...KINDS.berry };
    const food = addEntity(world, 'ration', { x: 5, z: 0 });
    const original = { ...food.deadline };
    KINDS.ration.lifetime = { clock: 'wall', lifetimeSeconds: 900, rottenSeconds: 100 };
    expect(food.deadline).toEqual(original);
    world.clock.wallNowMs += 86_400_000;
    expect(freshnessOf(food, world.clock)).toBe('fresh');
    world.clock.simSeconds = 150;
    expect(freshnessOf(food, world.clock)).toBe('rotten');
    world.clock.simSeconds = 180;
    expect(freshnessOf(food, world.clock)).toBe('expired');
    const later = addEntity(world, 'ration', { x: 6, z: 0 });
    expect(later.deadline).toEqual(deadlineAt(KINDS.ration.lifetime, world.clock));
  });

  it('reconciles wall expiry and relations without advancing hunger, physics or populations', async () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    const berry = session.addEntity('berry', 1, 0);
    const pebble = session.addEntity('pebble', 4, 0);
    pebble.vx = 1;
    expect(pebble.deadline).toBeUndefined();
    expect(attachTether(session.world, session.actor.entity.id, apple.id)).toMatchObject({
      ok: true,
    });
    const meal = session.eat(apple.id);
    const clock = { ...session.world.clock };
    const hunger = session.actor.entity.metabolism!.hunger;
    session.reconcileWallTime(epoch + 720_000);
    await expect(meal).resolves.toMatchObject({ ok: false, reason: 'expired', nutrition: 0 });
    expect(session.world.entities.has(apple.id)).toBe(false);
    expect(session.world.tethers.size).toBe(0);
    expect(session.world.entities.has(berry.id)).toBe(true);
    expect(session.world.clock.simSeconds).toBe(clock.simSeconds);
    expect(session.world.clock.tick).toBe(clock.tick);
    expect(session.actor.entity.metabolism!.hunger).toBe(hunger);
    expect(pebble.x).toBe(4);
    expect(pebble.vx).toBe(1);
    expect(session.world.populations.size).toBe(0);
    session.reconcileWallTime(NaN);
    session.reconcileWallTime(-1);
    expect(session.world.clock.wallNowMs).toBe(epoch + 720_000);
  });

  it('awards nutrition only for complete bites, including cancel, save and resume', async () => {
    const session = scene();
    session.actor.entity.metabolism!.hunger = 80;
    const apple = session.addEntity('apple', 0, -0.8);
    const originalDeadline = { ...apple.deadline };
    const first = session.eat(apple.id);
    tick(session, 29);
    expect(apple.stage).toBe(0);
    expect(session.actor.entity.metabolism!.hunger).toBeCloseTo(80 + 29 / 360);
    tick(session, 16);
    expect(apple.stage).toBe(1);
    session.cancel();
    await expect(first).resolves.toMatchObject({ reason: 'cancelled', stage: 1, nutrition: 10 });
    const saved = captureBody(session, null);
    applyBody(session, saved, undefined, epoch);
    const resumed = session.eat(apple.id);
    tick(session, 150);
    await expect(resumed).resolves.toMatchObject({
      ok: true,
      stage: 6,
      nutrition: 50,
      removed: true,
    });
    expect(session.actor.entity.metabolism!.hunger).toBeCloseTo(80 + 195 / 360 - 60);
    expect(saved.entities.find((item) => item.id === apple.id)!.deadline).toEqual(originalDeadline);
    expect(session.world.entities.has(apple.id)).toBe(false);
  });

  it('lets expiry win over the final bite and never grants its nutrition', async () => {
    KINDS.ration = {
      ...KINDS.apple,
      lifetime: { clock: 'wall', lifetimeSeconds: 3, rottenSeconds: 0 },
    };
    const session = scene();
    session.actor.entity.metabolism!.hunger = 100;
    const food = session.addEntity('ration', 0, -0.8);
    const meal = session.eat(food.id);
    for (let i = 1; i <= 180; i++) session.frame(1 / 60, epoch + i * (1000 / 60));
    await expect(meal).resolves.toMatchObject({
      ok: false,
      reason: 'expired',
      stage: 5,
      nutrition: 50,
    });
    expect(session.world.entities.has(food.id)).toBe(false);
    expect(session.actor.entity.metabolism!.hunger).toBeGreaterThan(50);
  });

  it('rejects rotten food at submission and at the next bite, and exposes freshness to readers', async () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    session.reconcileWallTime(epoch + 629_500);
    const meal = session.eat(apple.id);
    session.frame(0.05, epoch + 630_000);
    await expect(meal).resolves.toMatchObject({
      ok: false,
      reason: 'spoiled',
      stage: 0,
      nutrition: 0,
    });
    await expect(session.eat(apple.id)).resolves.toMatchObject({ reason: 'spoiled' });
    await expect(session.eat()).resolves.toMatchObject({ reason: 'nothing-to-eat' });
    expect(session.near().find((item) => item.id === apple.id)?.freshness).toBe('rotten');
    expect(session.observe().entities.find((item) => item.id === apple.id)?.freshness).toBe(
      'rotten',
    );
    attachTether(session.world, session.actor.entity.id, apple.id);
    expect(session.sense().carrying[0].freshness).toBe('rotten');
    expect(session.observe().self.carrying[0].freshness).toBe('rotten');
    expect(session.sense().hunger).toBeCloseTo(25, 1);
  });

  it('rounds bite duration to simulation steps and updates every registered metabolism', async () => {
    KINDS.grazer = {
      rest: 0,
      metabolism: { initialHunger: 4, hungerPerSecond: 2, maxHunger: 5, forageAt: 3 },
    };
    KINDS.ration = {
      rest: 0,
      eat: { bites: 1, secondsPerBite: 0.021, nutritionPerBite: 40, removes: false },
    };
    const session = scene();
    const grazer = session.addEntity('grazer', 5, 0);
    const food = session.addEntity('ration', 0, -0.8);
    const meal = session.eat(food.id);
    tick(session, 1);
    expect(food.stage).toBe(0);
    tick(session, 1);
    await expect(meal).resolves.toMatchObject({ ok: true, nutrition: 40, removed: false });
    expect(session.actor.entity.metabolism!.hunger).toBe(0);
    await expect(session.eat(food.id)).resolves.toMatchObject({ reason: 'depleted' });
    tick(session, 60);
    expect(grazer.metabolism!.hunger).toBe(5);
    expect(session.actor.entity.metabolism!.hunger).toBeCloseTo(1 / 6);
    const berry = session.addEntity('berry', 0, -0.8);
    delete session.actor.entity.metabolism;
    await expect(session.eat(berry.id)).resolves.toMatchObject({ reason: 'cannot-eat' });
    tick(session, 1);
  });

  it('restores wall-expired items before publication without aging simulation food or hunger', () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    const berry = session.addEntity('berry', 1, 0);
    attachTether(session.world, session.actor.entity.id, apple.id);
    const saved = captureBody(session, null);
    applyBody(session, saved, undefined, epoch + 721_000);
    expect(session.world.entities.has(apple.id)).toBe(false);
    expect(session.world.tethers.size).toBe(0);
    expect(session.world.entities.get(berry.id)?.deadline).toEqual(berry.deadline);
    expect(session.actor.entity.metabolism!.hunger).toBe(25);
    expect(session.world.clock).toEqual({ tick: 0, simSeconds: 0, wallNowMs: epoch + 721_000 });
    expect(saved.entities.some((item) => item.id === apple.id)).toBe(true);
  });

  it('revalidates the eater at a bite boundary without consuming food or granting nutrition', async () => {
    const session = scene();
    const berry = session.addEntity('berry', 0, -0.8);
    expect(nourish(berry, 4)).toBe(false);
    const meal = session.eat(berry.id);
    tick(session, 29);
    delete session.actor.entity.metabolism;
    tick(session, 1);
    await expect(meal).resolves.toMatchObject({
      ok: false,
      reason: 'cannot-eat',
      stage: 0,
      nutrition: 0,
    });
    session.actor.entity.metabolism = { hunger: 25 };
    session.actor.entity.kind = 'pebble';
    await expect(session.eat(berry.id)).resolves.toMatchObject({ reason: 'cannot-eat' });
    delete session.world.controlledId;
    expect(session.sense().hunger).toBeUndefined();
  });

  it('rejects invalid deadline and metabolism records before replacing the live world', () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    const berry = session.addEntity('berry', 1, 0);
    const pebble = session.addEntity('pebble', 3, 0);
    const saved = captureBody(session, null);
    const index = session.world.entities;
    const reject = (id: string, patch: Record<string, unknown>): void => {
      const candidate = structuredClone(saved);
      Object.assign(
        candidate.entities.find((item) => item.id === id)!,
        patch,
      );
      expect(() => applyBody(session, candidate, undefined, epoch)).toThrow(
        'Invalid world snapshot',
      );
      expect(session.world.entities).toBe(index);
    };
    for (const deadline of [
      undefined,
      null,
      3,
      {},
      { clock: 'unknown' },
      { clock: 'wall', rotsAtMs: -1, expiresAtMs: 10 },
      { clock: 'wall', rotsAtMs: 20, expiresAtMs: 10 },
      { clock: 'wall', rotsAtMs: 0, expiresAtMs: Infinity },
    ])
      reject(apple.id, { deadline });
    reject(berry.id, {
      deadline: { clock: 'simulation', rotsAtSeconds: 0, expiresAtSeconds: NaN },
    });
    reject(pebble.id, { deadline: apple.deadline });
    for (const metabolism of [
      undefined,
      null,
      {},
      { hunger: NaN },
      { hunger: -1 },
      { hunger: 101 },
    ])
      reject(session.actor.entity.id, { metabolism });
    reject(pebble.id, { metabolism: { hunger: 25 } });
    reject(apple.id, { stage: 0.5 });
    reject(apple.id, { stage: 7 });
    for (const wall of [NaN, -1])
      expect(() => applyBody(session, saved, undefined, wall)).toThrow('Invalid world time');
  });
});
