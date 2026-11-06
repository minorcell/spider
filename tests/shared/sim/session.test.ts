// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { KINDS } from '../../../src/shared/kinds.js';
import { MARK_LIMIT, MARK_NAME_MAX, MARK_NOTE_MAX } from '../../../src/shared/config.js';
import { STUCK_LIMIT, type Goal } from '../../../src/shared/sim/goals.js';
import { SimSession } from '../../../src/shared/sim/session.js';
import { insideHome } from '../../../src/shared/sight.js';
import { Terrain } from '../../../src/shared/terrain.js';
import type { EntityState } from '../../../src/shared/state.js';
import type { Controls } from '../../../src/shared/types.js';
import { block } from '../../helpers.js';
import { drive } from '../../simHelpers.js';

const routeControl = vi.hoisted(() => ({
  plan: null as null | ((...args: unknown[]) => unknown),
}));

vi.mock('../../../src/shared/route.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/shared/route.js')>();
  return {
    ...actual,
    planRoute: (...args: Parameters<typeof actual.planRoute>) =>
      routeControl.plan
        ? (routeControl.plan(...args) as ReturnType<typeof actual.planRoute>)
        : actual.planRoute(...args),
  };
});

const IDLE: Controls = { throttle: 0, turn: 0, lift: 0, boost: 0 };

function fakeEntity(over: Partial<EntityState> = {}): EntityState {
  return { id: 'apple-99', kind: 'apple', x: 0, y: 0, z: 0, stage: 0, ...over };
}

/** Pump frames and let async goal chains make progress between rounds. */
async function settle<T>(
  promise: Promise<T>,
  session: SimSession,
  rounds = 80,
  steps = 60,
): Promise<T> {
  let done = false;
  let value: T;
  promise.then(
    (result) => {
      done = true;
      value = result;
    },
    () => {
      done = true;
    },
  );
  for (let round = 0; round < rounds && !done; round++) {
    for (let step = 0; step < steps; step++) session.frame(1 / 60);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (!done) throw new Error('goal never settled');
  return value!;
}

afterEach(() => {
  routeControl.plan = null;
  delete KINDS.candy;
  delete KINDS['candy-no-meal'];
  delete KINDS.zero;
});

describe('SimSession basics', () => {
  it('builds a world and binds the body', () => {
    const session = new SimSession(3);
    expect(session.world.seed).toBe(3);
    const terrain = new Terrain(8);
    const prepared = new SimSession(1, terrain);
    expect(prepared.world.terrain).toBe(terrain);
    expect(prepared.world.seed).toBe(8);
    const snapshot = session.snapshot();
    expect(snapshot.world).toBe(session.world);
    expect(snapshot.state.feet).toHaveLength(8);
  });

  it('reports client-local world time', () => {
    const session = new SimSession(3);
    expect(session.worldInfo(new Date(2026, 10, 5, 12, 34, 56))).toMatchObject({
      clock: {
        localDate: '2026-11-05',
        localTime: '12:34:56',
        phase: 'day',
      },
    });
    expect(session.worldInfo(new Date(2026, 10, 5, 12, 34, 56)).clock.daylight).toBeCloseTo(
      0.988,
      3,
    );
  });

  it('ignores negative frame steps', () => {
    const session = new SimSession(3);
    session.frame(-5);
    expect(session.spider.time).toBe(0);
  });

  it('names an apple within reach', () => {
    const session = new SimSession(1);
    session.world.entities = session.world.entities.filter((entity) => entity.kind === 'nest');
    const apple = session.addEntity('apple', 0, -0.7);
    const near = session.near();
    expect(near.map((item) => item.id)).toEqual([apple.id]);
    expect(near[0].distance).toBeLessThanOrEqual(1.2);
    expect(near[0]).not.toHaveProperty('x');
  });

  it('senses the body without scanning the island', () => {
    const session = new SimSession(3);
    const sense = session.sense();
    expect(sense.home).toBe(true);
    expect(sense.ahead).toBeDefined();
    expect(sense).not.toHaveProperty('entities');
    expect(sense).not.toHaveProperty('ways');
    expect(session.sense(true).ways?.length).toBeGreaterThan(0);
  });

  it('observes at the asked distance, clamped', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 0, 1, 12) });
    const session = new SimSession(3);
    expect(session.observe().view).toBe(16);
    expect(session.observe(-1).view).toBe(0);
    expect(session.observe(1000).view).toBe(16);
  });

  it('shortens the view inside grass, until the body is raised over it', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 0, 1, 12) });
    const session = new SimSession(3);
    const grass = session.world.entities.find((entity) => entity.kind === 'grass')!;
    session.spider.root.position.set(grass.x, 0, grass.z);
    expect(session.observe(16).view).toBe(4.5);
    session.spider.heightSet = 1.6;
    expect(session.observe(16).view).toBe(16);
  });

  it('shortens visual range at night while leaving near sensing intact', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 0, 0));
    try {
      const session = new SimSession(3);
      session.world.entities = session.world.entities.filter((entity) => entity.kind === 'nest');
      const apple = session.addEntity('apple', 0, -0.7);
      expect(session.observe(16).view).toBeCloseTo(8.8, 5);
      expect(session.near().map((item) => item.id)).toEqual([apple.id]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops at the round shore instead of the square map edge', async () => {
    const session = new SimSession(4);
    session.world.terrain = {
      height: () => 0,
      inside: (x, z, margin = 0) => Math.hypot(x, z) < 3 - margin,
    };
    session.spider.root.position.set(2, 0, 0);
    session.spider.yaw = -Math.PI / 2;
    const outcome = await settle(drive(session, 2, { throttle: 1 }), session);
    expect(outcome).toMatchObject({ ok: false, reason: 'blocked', halt: 'solid' });
    expect(session.spider.root.position.x).toBeLessThan(3);
  });
});

describe('marks', () => {
  it('marks the place under the body and lists it from the current pose', () => {
    const session = new SimSession(5);
    session.spider.root.position.set(3.12345, 0, -2.12345);
    expect(session.mark('  水边  ', '  喝水  ')).toMatchObject({
      ok: true,
      action: 'mark',
      name: '水边',
      x: 3.123,
      z: -2.123,
      note: '喝水',
    });
    expect(session.world.marks).toEqual([{ name: '水边', x: 3.123, z: -2.123, note: '喝水' }]);

    session.spider.root.position.set(0, 0, 0);
    session.spider.yaw = 0;
    const [near] = session.marks();
    expect(near.name).toBe('水边');
    expect(near.distance).toBeCloseTo(Math.hypot(3.123, 2.123), 3);
    expect(near.bearing).toBeCloseTo(55.8, 1);

    session.spider.root.position.set(3.123, 0, -2.123);
    expect(session.marks()[0]).toMatchObject({ distance: 0, bearing: 0 });
  });

  it('lists marks nearest first and keeps an empty note off the record', () => {
    const session = new SimSession(5);
    session.spider.root.position.set(10, 0, 0);
    session.mark('远');
    session.spider.root.position.set(1, 0, 0);
    session.mark('近', '   ');
    session.spider.root.position.set(0, 0, 0);
    expect(session.marks().map((mark) => mark.name)).toEqual(['近', '远']);
    expect(session.world.marks.find((mark) => mark.name === '近')).not.toHaveProperty('note');
  });

  it('rejects a missing, long, duplicate, or over-limit name', () => {
    const session = new SimSession(5);
    expect(session.mark('   ')).toMatchObject({ ok: false, reason: 'need-name' });
    expect(session.mark('x'.repeat(MARK_NAME_MAX + 1))).toMatchObject({
      ok: false,
      reason: 'name-too-long',
    });
    expect(session.mark('水边', 'x'.repeat(MARK_NOTE_MAX + 1))).toMatchObject({
      ok: false,
      reason: 'note-too-long',
    });
    expect(session.mark('水边')).toMatchObject({ ok: true });
    expect(session.mark(' 水边 ')).toMatchObject({
      ok: false,
      reason: 'name-taken',
      name: '水边',
    });
    for (let index = 1; index < MARK_LIMIT; index++) {
      expect(session.mark(`地点-${index}`)).toMatchObject({ ok: true });
    }
    expect(session.mark('最后一个')).toMatchObject({ ok: false, reason: 'full' });
    expect(session.world.marks).toHaveLength(MARK_LIMIT);
  });

  it('forgets a named place', () => {
    const session = new SimSession(5);
    session.mark('水边');
    expect(session.forgetMark(' 水边 ')).toMatchObject({
      ok: true,
      action: 'forget',
      name: '水边',
    });
    expect(session.world.marks).toEqual([]);
    expect(session.forgetMark('水边')).toMatchObject({
      ok: false,
      reason: 'not-found',
      name: '水边',
    });
    expect(session.forgetMark(' ')).toMatchObject({ ok: false, reason: 'need-name' });
  });

  it('walks back to a named place or reports that it is missing', async () => {
    const session = new SimSession(5);
    session.spider.root.position.set(0, 0, -3);
    session.mark('门外');
    session.spider.root.position.set(0, 0, 0);
    await expect(settle(session.goToMark(' 门外 '), session)).resolves.toMatchObject({
      ok: true,
      reason: 'reached',
      name: '门外',
    });
    await expect(session.goToMark('没有这个地方')).resolves.toEqual({
      ok: false,
      reason: 'not-found',
      name: '没有这个地方',
    });
    await expect(session.goToMark(' ')).resolves.toEqual({ ok: false, reason: 'need-name' });
  });
});

describe('goals', () => {
  it('cancels a running goal', async () => {
    const session = new SimSession(4);
    session.cancel();
    const promise = session.walk(5);
    session.cancel();
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('preempts the previous goal', async () => {
    const session = new SimSession(4);
    const first = session.walk(5);
    const second = drive(session, 0.1, {});
    await expect(first).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
    await expect(settle(second, session)).resolves.toMatchObject({ ok: true });
  });

  it('times out through the wall-clock guard', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const session = new SimSession(4);
    const promise = session.walk(5);
    vi.advanceTimersByTime(30_000);
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('walks, turns, and lifts', async () => {
    const session = new SimSession(4);
    await expect(settle(session.walk(1), session)).resolves.toMatchObject({
      ok: true,
      reason: 'reached',
    });
    await expect(settle(session.turn(90), session)).resolves.toMatchObject({ ok: true });
    await expect(settle(session.turnTo(45), session)).resolves.toMatchObject({ ok: true });
    await expect(settle(session.setHeight(0.3), session)).resolves.toMatchObject({ ok: true });
    expect(session.spider.heightSet).toBeCloseTo(0.3, 1);
  });

  it('reports a wall that stops a walk', async () => {
    const session = new SimSession(4);
    session.spider.root.position.set(0, 0, 1.8);
    session.spider.yaw = Math.PI;
    const outcome = await settle(session.walk(2), session);
    expect(outcome).toMatchObject({ ok: false, reason: 'blocked', halt: 'solid' });
  });

  it('reports a slope that stops a walk', async () => {
    const session = new SimSession(4);
    session.world.terrain.height = (x: number, z: number): number => (z > 5.5 ? 100 : 0);
    session.spider.root.position.set(0, 0, 5);
    session.spider.yaw = Math.PI;
    const outcome = await settle(session.walk(2), session);
    expect(outcome).toMatchObject({ ok: false, reason: 'steep', halt: 'steep' });
  });

  it('drives for a fixed time and stops against a solid', async () => {
    const session = new SimSession(4);
    await expect(settle(drive(session, 0.3, { throttle: 1 }), session)).resolves.toMatchObject({
      ok: true,
    });
    session.spider.root.position.set(0, 0, 1.8);
    session.spider.yaw = Math.PI;
    const blocked = await settle(drive(session, 2, { throttle: 1 }), session);
    expect(blocked).toMatchObject({ ok: false, reason: 'blocked', halt: 'solid' });
    await expect(settle(drive(session, 0.1, { turn: 1 }), session)).resolves.toMatchObject({
      ok: true,
    });
    await expect(settle(drive(session, 0.1, {}), session)).resolves.toMatchObject({ ok: true });
  });

  it('runs an arbitrary goal to its timeout', async () => {
    const session = new SimSession(4);
    const goal: Goal = {
      timeout: 0.01,
      controls: () => IDLE,
      done: () => false,
      result: () => ({ mark: 1 }),
    };
    const outcome = await settle(session.run(goal), session);
    expect(outcome).toMatchObject({ ok: false, reason: 'timeout', mark: 1 });
  });

  it('runs an arbitrary goal to completion', async () => {
    const session = new SimSession(4);
    let steps = 0;
    const goal: Goal = {
      timeout: 10,
      controls: () => IDLE,
      done: () => {
        steps += 1;
        return steps > 1;
      },
      result: () => ({}),
    };
    await expect(settle(session.run(goal), session)).resolves.toMatchObject({
      ok: true,
      reason: 'reached',
    });
  });
});

describe('moveTo', () => {
  it('accepts a point already under the body', async () => {
    const session = new SimSession(5);
    await expect(session.moveTo(0.1, 0)).resolves.toMatchObject({
      ok: true,
      reason: 'reached',
      detour: null,
    });
  });

  it('reports no path for a point off the island', async () => {
    const session = new SimSession(5);
    await expect(session.moveTo(0, 60)).resolves.toMatchObject({
      ok: false,
      reason: 'no-path',
      detour: null,
    });
  });

  it('walks straight to a nearby point', async () => {
    const session = new SimSession(5);
    const outcome = await settle(session.moveTo(0, -5), session);
    expect(outcome).toMatchObject({ ok: true, reason: 'reached', detour: null });
  });

  it('walks around the nest and says so', async () => {
    const session = new SimSession(5);
    const outcome = await settle(session.moveTo(0, 5), session, 120, 60);
    expect(outcome.ok).toBe(true);
    expect(String(outcome.detour)).toContain('绕开了');
  });

  it('stops quietly when cancelled', async () => {
    const session = new SimSession(5);
    const promise = session.moveTo(0, -5);
    session.cancel();
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'cancelled', detour: null });
  });

  it('retries a blocked route and reports the solids', async () => {
    const session = new SimSession(5);
    session.spider.bindBlocked(() => true);
    const blocked = await settle(session.moveTo(0, -5), session);
    expect(blocked).toMatchObject({ ok: false, reason: 'blocked', detour: null });
    const around = await settle(session.moveTo(0, 5), session);
    expect(around.ok).toBe(false);
    expect(String(around.detour)).toContain('还是过不去');
  });

  it('returns a timeout when the route never settles', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const session = new SimSession(5);
    const promise = session.moveTo(0, -5);
    vi.advanceTimersByTime(120_000);
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'timeout', detour: null });
  });

  it('describes a detour that had no solids', async () => {
    const session = new SimSession(5);
    routeControl.plan = (x0, z0, x1, z1) => ({
      points: [
        { x: x0 as number, z: z0 as number },
        { x: x1 as number, z: z1 as number },
      ],
      around: [],
      direct: false,
    });
    const outcome = await settle(session.moveTo(0, -1), session);
    expect(outcome).toMatchObject({ ok: true, reason: 'reached', detour: '绕开了陡坡，到了。' });
  });

  it('describes a failed detour that had no solids', async () => {
    const session = new SimSession(5);
    routeControl.plan = (x0, z0, x1, z1) => ({
      points: [
        { x: x0 as number, z: z0 as number },
        { x: x1 as number, z: z1 as number },
      ],
      around: [],
      direct: false,
    });
    session.spider.bindBlocked(() => true);
    const outcome = await settle(session.moveTo(0, -1), session);
    expect(outcome).toMatchObject({
      ok: false,
      reason: 'blocked',
      detour: '试了旁边的路，还是过不去。',
    });
  });
});

describe('approach', () => {
  it('reports an unknown id', async () => {
    const session = new SimSession(6);
    await expect(session.approach('apple-404')).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('reports no path when no standing spot is reachable', async () => {
    const session = new SimSession(6);
    const far = session.addEntity('apple', 100, 0);
    await expect(session.approach(far.id)).resolves.toMatchObject({
      ok: false,
      reason: 'no-path',
    });
  });

  it('faces something already in reach', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -0.5);
    await expect(settle(session.approach(apple.id), session)).resolves.toMatchObject({
      ok: true,
      reason: 'already-close',
      id: apple.id,
    });
  });

  it('walks to a standoff and faces it', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -1.2);
    await expect(settle(session.approach(apple.id), session)).resolves.toMatchObject({
      ok: true,
      reason: 'reached',
      id: apple.id,
    });
  });

  it('returns a failed move', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -1.2);
    session.spider.bindBlocked(() => true);
    await expect(settle(session.approach(apple.id), session)).resolves.toMatchObject({
      ok: false,
      reason: 'blocked',
      id: apple.id,
    });
  });

  it('skips standing spots that are blocked', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -1.2);
    session.world.blocks.push(block('screen', -0.3, 0.3, -0.4, -0.2));
    const outcome = await settle(session.approach(apple.id), session);
    expect(outcome.id).toBe(apple.id);
  });

  it('returns a failed face after moving', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -1.2);
    vi.spyOn(session, 'turn').mockResolvedValue({ ok: false, reason: 'timeout' });
    await expect(settle(session.approach(apple.id), session)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
      id: apple.id,
      detour: null,
    });
  });

  it('returns a failed face when already close', async () => {
    const session = new SimSession(6);
    const apple = session.addEntity('apple', 0, -0.5);
    vi.spyOn(session, 'turn').mockResolvedValue({ ok: false, reason: 'timeout' });
    await expect(settle(session.approach(apple.id), session)).resolves.toMatchObject({
      ok: false,
      reason: 'timeout',
      id: apple.id,
      detour: null,
    });
  });
});

describe('eat', () => {
  it('finds nothing to eat', async () => {
    const session = new SimSession(7);
    session.world.entities = session.world.entities.filter((entity) => entity.kind !== 'apple');
    await expect(session.eat()).resolves.toMatchObject({ ok: false, reason: 'nothing-to-eat' });
  });

  it('reports an unknown id', async () => {
    const session = new SimSession(7);
    await expect(session.eat('apple-404')).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('refuses something that is not edible', async () => {
    const session = new SimSession(7);
    const grass = session.addEntity('grass', 0, -0.5);
    await expect(session.eat(grass.id)).resolves.toMatchObject({
      ok: false,
      reason: 'not-edible',
    });
  });

  it('refuses an edible thing that is too far', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 5, 0);
    await expect(session.eat(apple.id)).resolves.toMatchObject({
      ok: false,
      reason: 'out-of-reach',
    });
  });

  it('refuses an edible thing that is too high', async () => {
    const session = new SimSession(7);
    const apple = fakeEntity({ id: 'apple-high', x: 0, y: 100, z: -0.5 });
    session.world.entities.push(apple);
    await expect(session.eat(apple.id)).resolves.toMatchObject({
      ok: false,
      reason: 'out-of-reach',
    });
  });

  it('refuses something hidden behind a solid', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -1);
    session.world.blocks.push(block('screen', -1, 1, -0.6, -0.4));
    await expect(session.eat(apple.id)).resolves.toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });

  it('refuses something hidden behind a ridge', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -1);
    session.world.terrain = {
      height: (_x, z) => (z < -0.4 && z > -0.6 ? 2 : 0),
    };
    await expect(session.eat(apple.id)).resolves.toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });

  it('eats something through its stages and removes it', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -0.8);
    const outcome = await settle(session.eat(apple.id), session, 20, 60);
    expect(outcome).toMatchObject({ ok: true, action: 'eat', target: apple.id, removed: true });
    expect(session.world.entities).not.toContain(apple);
  });

  it('resumes a partly eaten thing', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -0.8);
    apple.stage = 1;
    const outcome = await settle(session.eat(apple.id), session, 20, 60);
    expect(outcome).toMatchObject({ ok: true, removed: true, stage: 2 });
  });

  it('eats from the back without reaching', async () => {
    const session = new SimSession(7);
    const apple = fakeEntity({ id: 'apple-back' });
    session.world.carrying.push(apple);
    const outcome = await settle(session.eat(apple.id), session, 20, 60);
    expect(outcome).toMatchObject({ ok: true, removed: true });
    expect(session.world.carrying).not.toContain(apple);
  });

  it('eats the nearest carried thing when no id is given', async () => {
    const session = new SimSession(7);
    session.world.entities = session.world.entities.filter((entity) => entity.kind !== 'apple');
    const apple = fakeEntity({ id: 'apple-back' });
    session.world.carrying.push(apple);
    const outcome = await settle(session.eat(), session, 20, 60);
    expect(outcome).toMatchObject({ ok: true, target: apple.id, removed: true });
  });

  it('reports a cancelled meal without removing anything', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -0.8);
    const promise = session.eat(apple.id);
    session.cancel();
    const outcome = await promise;
    expect(outcome).toMatchObject({ ok: false, reason: 'cancelled', removed: false });
    expect(session.world.entities).toContain(apple);
  });

  it('handles a thing that vanished mid-meal', async () => {
    const session = new SimSession(7);
    const apple = session.addEntity('apple', 0, -0.8);
    const promise = session.eat(apple.id);
    session.world.entities.splice(session.world.entities.indexOf(apple), 1);
    const outcome = await settle(promise, session, 20, 60);
    expect(outcome).toMatchObject({ ok: true, removed: true });
  });

  it('keeps a thing that does not disappear', async () => {
    KINDS.candy = {
      properties: ['edible'],
      rest: 0,
      eat: { duration: 0.2, stages: 2, removes: false },
    };
    const session = new SimSession(7);
    const candy = session.addEntity('candy', 0, -0.5);
    const outcome = await settle(session.eat(candy.id), session, 5, 20);
    expect(outcome).toMatchObject({ ok: true, removed: false });
    expect(session.world.entities).toContain(candy);
  });

  it('treats an edible property without a meal as not edible', async () => {
    KINDS['candy-no-meal'] = { properties: ['edible'], rest: 0 };
    const session = new SimSession(7);
    const candy = session.addEntity('candy-no-meal', 0, -0.5);
    await expect(session.eat(candy.id)).resolves.toMatchObject({
      ok: false,
      reason: 'not-edible',
    });
  });

  it('handles a meal with no slices', async () => {
    KINDS.zero = {
      properties: ['edible'],
      rest: 0,
      eat: { duration: 0.1, stages: 0, removes: false },
    };
    const session = new SimSession(7);
    const zero = session.addEntity('zero', 0, -0.5);
    const outcome = await settle(session.eat(zero.id), session, 5, 20);
    expect(outcome).toMatchObject({ ok: true, removed: false });
  });
});

describe('water', () => {
  it('drinks from a pond within reach', () => {
    const session = new SimSession(8);
    session.world.terrain = {
      height: (x) => (x > 0.5 ? -2 : 0),
      surface: (x) => Math.max(x > 0.5 ? -2 : 0, -0.8),
    };
    const outcome = session.drink();
    expect(outcome).toMatchObject({ ok: true, action: 'drink' });
    expect(outcome.distance).toBeGreaterThan(0);
    expect(outcome.distance).toBeLessThanOrEqual(1.2);
  });

  it('refuses to drink on dry ground', () => {
    const session = new SimSession(8);
    session.world.terrain = { height: () => 0 };
    expect(session.drink()).toMatchObject({ ok: false, reason: 'no-water' });
  });
});

describe('carrying', () => {
  it('refuses to pick up more than the limit', async () => {
    const session = new SimSession(8);
    session.world.carrying.push(
      fakeEntity({ id: 'a' }),
      fakeEntity({ id: 'b' }),
      fakeEntity({ id: 'c' }),
      fakeEntity({ id: 'd' }),
      fakeEntity({ id: 'e' }),
      fakeEntity({ id: 'f' }),
      fakeEntity({ id: 'g' }),
    );
    await expect(session.pickUp()).resolves.toMatchObject({ ok: false, reason: 'full' });
  });

  it('finds nothing to carry', async () => {
    const session = new SimSession(8);
    session.world.entities = session.world.entities.filter((entity) => entity.kind !== 'apple');
    await expect(session.pickUp()).resolves.toMatchObject({
      ok: false,
      reason: 'nothing-to-carry',
    });
    await expect(session.pickUp('apple-404')).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('refuses something that cannot be carried', async () => {
    const session = new SimSession(8);
    const grass = session.addEntity('grass', 0, -0.5);
    await expect(session.pickUp(grass.id)).resolves.toMatchObject({
      ok: false,
      reason: 'not-carryable',
    });
  });

  it('refuses a carryable thing out of reach or behind a solid', async () => {
    const session = new SimSession(8);
    const far = session.addEntity('apple', 5, 0);
    await expect(session.pickUp(far.id)).resolves.toMatchObject({
      ok: false,
      reason: 'out-of-reach',
    });
    const hidden = session.addEntity('apple', 0, -1);
    session.world.blocks.push(block('screen', -1, 1, -0.6, -0.4));
    await expect(session.pickUp(hidden.id)).resolves.toMatchObject({
      ok: false,
      reason: 'blocked',
    });
  });

  it('picks something up and puts it on the back', async () => {
    const session = new SimSession(8);
    const apple = session.addEntity('apple', 0, -0.8);
    const outcome = await settle(session.pickUp(apple.id), session, 5, 20);
    expect(outcome).toMatchObject({ ok: true, action: 'pick-up', target: apple.id });
    expect(session.world.carrying).toContain(apple);
    expect(session.world.entities).not.toContain(apple);
  });

  it('handles a thing that vanished before the grab', async () => {
    const session = new SimSession(8);
    const apple = session.addEntity('apple', 0, -0.8);
    const promise = session.pickUp(apple.id);
    session.world.entities.splice(session.world.entities.indexOf(apple), 1);
    await expect(settle(promise, session, 5, 20)).resolves.toMatchObject({
      ok: false,
      reason: 'not-found',
    });
  });

  it('handles a cancelled grab', async () => {
    const session = new SimSession(8);
    const apple = session.addEntity('apple', 0, -0.8);
    const promise = session.pickUp(apple.id);
    session.cancel();
    await expect(promise).resolves.toMatchObject({ ok: false, reason: 'cancelled' });
  });

  it('refuses to drop what it does not carry', () => {
    const session = new SimSession(8);
    expect(session.drop()).toMatchObject({ ok: false, reason: 'not-carrying' });
    expect(session.drop('nope')).toMatchObject({ ok: false, reason: 'not-carrying', id: 'nope' });
  });

  it('refuses to drop with no room', () => {
    const session = new SimSession(8);
    session.world.carrying.push(fakeEntity({ id: 'apple-back' }));
    session.world.blocks.push(block('fill', -10, 10, -10, 10));
    expect(session.drop()).toMatchObject({ ok: false, reason: 'no-room' });
  });

  it('refuses to drop past the island edge', () => {
    const session = new SimSession(8);
    session.world.carrying.push(fakeEntity({ id: 'apple-back' }));
    session.world.terrain = { height: () => 0, inside: () => false };
    expect(session.drop()).toMatchObject({ ok: false, reason: 'no-room' });
  });

  it('drops the last carried thing in front', () => {
    const session = new SimSession(8);
    const item = fakeEntity({ id: 'apple-back' });
    session.world.carrying.push(item);
    const outcome = session.drop();
    expect(outcome).toMatchObject({ ok: true, action: 'drop', target: item.id });
    expect(session.world.carrying).toEqual([]);
    expect(session.world.entities).toContain(item);
    expect(Number.isFinite(item.x)).toBe(true);
  });

  it('drops one named thing and keeps the rest on the back', () => {
    const session = new SimSession(8);
    session.world.carrying.push(fakeEntity({ id: 'apple-1' }), fakeEntity({ id: 'apple-2' }));
    const outcome = session.drop('apple-1');
    expect(outcome).toMatchObject({ ok: true, target: 'apple-1', carrying: ['apple-2'] });
  });

  it('picks the nearest of several carryables', async () => {
    const session = new SimSession(8);
    const far = session.addEntity('apple', 0, -0.9);
    const near = session.addEntity('apple', 0, -0.5);
    const farther = session.addEntity('apple', 0, -1.1);
    session.world.entities = session.world.entities.filter(
      (entity) => entity === far || entity === near || entity === farther,
    );
    const outcome = await settle(session.pickUp(), session, 5, 20);
    expect(outcome).toMatchObject({ ok: true, target: near.id });
  });

  it('refuses to store what it does not carry', () => {
    const session = new SimSession(9);
    expect(session.store()).toMatchObject({ ok: false, reason: 'not-carrying' });
  });

  it('refuses to store away from home', () => {
    const session = new SimSession(9);
    session.world.carrying.push(fakeEntity({ id: 'apple-back' }));
    session.spider.root.position.set(10, 0, 10);
    expect(session.store()).toMatchObject({ ok: false, reason: 'not-home' });
  });

  it('refuses to store with no room', () => {
    const session = new SimSession(9);
    session.world.carrying.push(fakeEntity({ id: 'apple-back' }));
    session.world.blocks.push(block('fill', 0.5, 1.8, -2.5, 1.5));
    expect(session.store()).toMatchObject({ ok: false, reason: 'no-room' });
  });

  it('stores a carried thing in the nest', () => {
    const session = new SimSession(9);
    const item = fakeEntity({ id: 'apple-back' });
    session.world.carrying.push(item);
    expect(insideHome(session.spider.root.position.x, session.spider.root.position.z)).toBe(true);
    const outcome = session.store();
    expect(outcome).toMatchObject({ ok: true, action: 'store', target: item.id });
    expect(session.world.carrying).toEqual([]);
    expect(session.world.entities).toContain(item);
  });

  it('stores one named thing and keeps the rest on the back', () => {
    const session = new SimSession(9);
    session.world.carrying.push(fakeEntity({ id: 'apple-1' }), fakeEntity({ id: 'apple-2' }));
    const outcome = session.store('apple-1');
    expect(outcome).toMatchObject({ ok: true, target: 'apple-1', carrying: ['apple-2'] });
  });
});

describe('sleep and props', () => {
  it('refuses to sleep away from home', async () => {
    const session = new SimSession(10);
    session.spider.root.position.set(10, 0, 10);
    await expect(session.sleep()).resolves.toMatchObject({ ok: false, reason: 'not-home' });
  });

  it('sleeps and wakes in place', async () => {
    const session = new SimSession(10);
    const outcome = await settle(session.sleep(), session, 40, 60);
    expect(outcome).toMatchObject({ ok: true, action: 'sleep', home: true });
    expect(Math.abs(session.spider.heightSet)).toBeLessThan(0.05);
  });

  it('grows a replacement apple as the simulation runs', () => {
    const session = new SimSession(4);
    session.world.entities = session.world.entities.filter((entity) => entity.kind !== 'apple');
    session.world.appleIn = 0.02;
    session.frame(1 / 60);
    expect(session.world.entities.some((entity) => entity.kind === 'apple')).toBe(false);
    session.frame(1 / 60);
    expect(session.world.entities.filter((entity) => entity.kind === 'apple')).toHaveLength(1);

    session.world.entities = session.world.entities.filter((entity) => entity.kind !== 'apple');
    session.world.appleIn = 0;
    session.frame(1);
    expect(session.world.entities.some((entity) => entity.kind === 'apple')).toBe(true);
  });

  it('numbers a new prop after the highest existing one', () => {
    const session = new SimSession(10);
    const existing = session.world.entities.filter((entity) => entity.kind === 'apple').length;
    const added = session.addEntity('apple', 1, 1);
    expect(added.id).toBe(`apple-${existing + 1}`);
    expect(Number.isFinite(added.y)).toBe(true);
    expect(session.world.entities).toContain(added);
  });

  it('ignores non-numeric suffixes and counts carried props', () => {
    const session = new SimSession(10);
    session.world.entities = [{ ...fakeEntity({ id: 'apple-x' }) }];
    session.world.carrying = [fakeEntity({ id: 'apple-7' })];
    expect(session.addEntity('apple', 0, 0).id).toBe('apple-8');
    session.world.carrying = [];
    session.world.entities = [{ ...fakeEntity({ id: 'apple-x' }) }];
    expect(session.addEntity('apple', 0, 0).id).toBe('apple-1');
  });

  it('keeps its own copy of the goal contract', () => {
    expect(STUCK_LIMIT).toBeGreaterThan(0);
  });
});
