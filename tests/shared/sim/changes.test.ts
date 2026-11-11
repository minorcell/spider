import { afterEach, describe, expect, it, vi } from 'vitest';
import { batchWorldChanges, onWorldCommit, type WorldCommit } from '@/src/shared/changes';
import { initialPopulations, populationRules } from '@/src/shared/islandContent';
import { KINDS } from '@/src/shared/kinds';
import { grow, removeEntity } from '@/src/shared/world';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import { attachTether, detachTether } from '@/src/shared/sim/tether';

const epoch = 1_800_000_000_000;
function scene(): SimSession {
  const session = new SimSession(7, undefined, epoch);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  session.world.populations.clear();
  return session;
}
function ticks(session: SimSession, count: number): void {
  for (let i = 0; i < count; i++) session.frame(1 / 60, epoch);
}
afterEach(() => {
  delete KINDS.ration;
  vi.restoreAllMocks();
});

describe('committed world changes', () => {
  it('publishes every registered bite and the final removal with cleaned relations, without rendering', async () => {
    KINDS.ration = {
      ...KINDS.apple,
      eat: { bites: 3, secondsPerBite: 2 / 60, nutritionPerBite: 7, removes: true },
    };
    const session = scene();
    const world = session.world;
    session.actor.entity.metabolism!.hunger = 70;
    const food = session.addEntity('ration', 0, -0.8);
    attachTether(world, session.actor.entity.id, food.id);
    const receipts: WorldCommit[] = [];
    const second: WorldCommit[] = [];
    const states: { stage: number | undefined; present: boolean; attached: boolean }[] = [];
    onWorldCommit(world, (commit) => {
      receipts.push(commit);
      states.push({
        stage: food.stage,
        present: world.entities.has(food.id),
        attached: world.tethers.has(food.id),
      });
    });
    onWorldCommit(world, (commit) => second.push(commit));
    const eating = session.eat(food.id);
    session.frame(0.05, epoch);
    session.frame(0.05, epoch);
    await expect(eating).resolves.toMatchObject({ ok: true, nutrition: 21, stage: 3 });
    expect(receipts).toHaveLength(3);
    expect(receipts.slice(0, 2).map((commit) => commit.events)).toEqual(
      [1, 2].map((completedBites) => [
        {
          kind: 'bite',
          actor: session.actor.entity.id,
          target: food.id,
          completedBites,
          nutrition: 7,
        },
      ]),
    );
    expect(receipts.map((commit) => commit.clock.tick)).toEqual([2, 4, 6]);
    expect(second).toEqual(receipts);
    expect(states).toEqual([
      { stage: 1, present: true, attached: true },
      { stage: 2, present: true, attached: true },
      { stage: 3, present: false, attached: false },
    ]);
    expect(second[2]).toBe(receipts[2]);
    expect(receipts[2].events).toEqual([
      {
        kind: 'bite',
        actor: session.actor.entity.id,
        target: food.id,
        completedBites: 3,
        nutrition: 7,
      },
      {
        kind: 'tetherChanged',
        tether: expect.objectContaining({ targetId: food.id }),
        attached: false,
        cause: 'removed',
      },
      { kind: 'removed', entity: food.id, actor: session.actor.entity.id, cause: 'eaten' },
    ]);
    expect(session.actor.entity.metabolism!.hunger).toBeCloseTo(49 + 1 / 60);
  });

  it('keeps a completed bite on cancellation and publishes expiry as a separate batch', async () => {
    const session = scene();
    const food = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, food.id);
    const commits: WorldCommit[] = [];
    onWorldCommit(session.world, (commit) => commits.push(commit));
    const eating = session.eat(food.id);
    ticks(session, 30);
    session.cancel();
    await expect(eating).resolves.toMatchObject({ ok: false, stage: 1, nutrition: 10 });
    expect(food.stage).toBe(1);
    expect(session.world.tethers.has(food.id)).toBe(true);
    expect(commits).toHaveLength(1);
    expect(commits[0].events).toEqual([
      {
        kind: 'bite',
        actor: session.actor.entity.id,
        target: food.id,
        completedBites: 1,
        nutrition: 10,
      },
    ]);

    session.reconcileWallTime(epoch + 720_000);
    expect(commits).toHaveLength(2);
    expect(commits[1].events).toEqual([
      {
        kind: 'tetherChanged',
        tether: expect.objectContaining({ targetId: food.id }),
        attached: false,
        cause: 'removed',
      },
      { kind: 'removed', entity: food.id, cause: 'expired' },
    ]);
  });

  it('publishes placement after the item has moved and detached', () => {
    const session = scene();
    const food = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, food.id);
    const states: unknown[] = [];
    onWorldCommit(session.world, (commit) =>
      states.push({
        events: commit.events,
        x: food.x,
        z: food.z,
        attached: session.world.tethers.has(food.id),
      }),
    );
    const result = session.drop(food.id);
    expect(result.ok).toBe(true);
    expect(states).toEqual([
      {
        events: [
          {
            kind: 'tetherChanged',
            tether: expect.objectContaining({ targetId: food.id }),
            attached: false,
            cause: 'placed',
          },
        ],
        x: result.x,
        z: result.z,
        attached: false,
      },
    ]);
  });

  it('publishes expiry rather than a bite, and ignores duplicate or stale removal requests', async () => {
    const session = scene();
    const food = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, food.id);
    const commits: WorldCommit[] = [];
    onWorldCommit(session.world, (commit) => commits.push(commit));
    const eating = session.eat(food.id);
    ticks(session, 29);
    session.frame(1 / 60, epoch + 720_000);
    await expect(eating).resolves.toMatchObject({ reason: 'expired', nutrition: 0, stage: 0 });
    expect(commits).toHaveLength(1);
    expect(commits[0].clock.tick).toBe(29);
    expect(commits[0].events.map((event) => event.kind)).toEqual(['tetherChanged', 'removed']);
    expect(commits[0].events[1]).toMatchObject({ cause: 'expired' });
    removeEntity(session.world, food);
    expect(detachTether(session.world, food.id, 'released')).toBe(false);
    const pebble = session.addEntity('pebble', 2, 0);
    removeEntity(session.world, { ...pebble });
    expect(session.world.entities.get(pebble.id)).toBe(pebble);
    removeEntity(session.world, pebble);
    expect(commits.at(-1)!.events).toEqual([
      { kind: 'removed', entity: pebble.id, cause: 'despawned', actor: undefined },
    ]);
    expect(commits).toHaveLength(3);
  });

  it('freezes receipts, preserves order across reentrant subscribers, and releases subscriptions', () => {
    const session = scene();
    const world = session.world;
    const food = session.addEntity('apple', 0, -0.8);
    const order: string[] = [];
    const receipts: WorldCommit[] = [];
    const lamps: { committed: boolean | undefined; live: boolean }[] = [];
    const stop = onWorldCommit(world, (commit) => {
      order.push(`first:${commit.revision}`);
      if (commit.events[0].kind === 'tetherChanged') session.setLamp(true);
    });
    onWorldCommit(world, (commit) => {
      order.push(`second:${commit.revision}`);
      receipts.push(commit);
      lamps.push({
        committed: commit.view.entities.find((entity) => entity.id === commit.controlledId)?.control
          ?.lamp,
        live: session.lamp,
      });
    });
    attachTether(world, session.actor.entity.id, food.id);
    const [attached, lamp] = receipts;
    expect(order).toEqual([
      `first:${attached.revision}`,
      `second:${attached.revision}`,
      `first:${lamp.revision}`,
      `second:${lamp.revision}`,
    ]);
    expect(lamps).toEqual([
      { committed: false, live: true },
      { committed: true, live: true },
    ]);
    expect(attachTether(world, session.actor.entity.id, food.id).ok).toBe(false);
    expect(receipts).toHaveLength(2);
    expect(Object.isFrozen(attached)).toBe(true);
    expect(Object.isFrozen(attached.events)).toBe(true);
    expect(Object.isFrozen(attached.clock)).toBe(true);
    expect(attached.clock).toBe(attached.view.clock);
    expect(Object.isFrozen(attached.view)).toBe(true);
    expect(Object.isFrozen(attached.view.entities)).toBe(true);
    const committedFood = attached.view.entities.find((entity) => entity.id === food.id)!;
    expect(Object.isFrozen(committedFood)).toBe(true);
    expect(Object.isFrozen(committedFood.deadline)).toBe(true);
    expect(Object.isFrozen(attached.view.tethers)).toBe(true);
    expect(Object.isFrozen(attached.view.tethers[0])).toBe(true);
    const event = attached.events[0];
    if (event.kind !== 'tetherChanged') throw new Error('missing attachment');
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.isFrozen(event.tether)).toBe(true);
    const length = event.tether.length;
    world.tethers.get(food.id)!.length += 10;
    expect(event.tether.length).toBe(length);
    expect(attached.view.tethers[0].length).toBe(length);
    food.stage += 1;
    expect(committedFood.stage).toBe(0);
    ticks(session, 1);
    expect(attached.clock.tick).toBe(0);
    stop();
    expect(session.release(food.id).ok).toBe(true);
    expect(receipts.at(-1)!.events).toEqual([
      {
        kind: 'tetherChanged',
        tether: expect.objectContaining({ targetId: food.id }),
        attached: false,
        cause: 'released',
      },
    ]);
    expect(order.at(-1)).toBe(`second:${receipts.at(-1)!.revision}`);
    expect(order).toHaveLength(5);
    expect(receipts.map((commit) => commit.revision)).toEqual([
      attached.revision,
      attached.revision + 1,
      attached.revision + 2,
    ]);
  });

  it('isolates broken effects and publishes each rotten transition once from either clock', () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    const berry = session.addEntity('berry', 2, 0);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = onWorldCommit(session.world, () => {
      throw new Error('broken effect');
    });
    const events: WorldCommit['events'][number][] = [];
    onWorldCommit(session.world, (commit) => events.push(...commit.events));
    session.reconcileWallTime(epoch + 630_000);
    session.reconcileWallTime(epoch + 630_001);
    expect(events).toEqual([{ kind: 'freshnessChanged', entity: apple.id, to: 'rotten' }]);
    expect(error).toHaveBeenCalledOnce();
    stop();
    session.world.clock.simSeconds = 150 - 1 / 60;
    session.frame(1 / 60, epoch + 630_001);
    expect(events.at(-1)).toEqual({ kind: 'freshnessChanged', entity: berry.id, to: 'rotten' });
    expect(error).toHaveBeenCalledOnce();
  });

  it('publishes wall-clock freshness transitions once per phase change and never revives expired items', () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    const commits: WorldCommit[] = [];
    onWorldCommit(session.world, (commit) => commits.push(commit));

    session.reconcileWallTime(epoch + 630_000);
    session.reconcileWallTime(epoch + 630_000);
    session.reconcileWallTime(epoch + 629_999);
    session.reconcileWallTime(epoch + 629_999);
    session.reconcileWallTime(epoch + 630_000);
    session.reconcileWallTime(epoch + 720_000);
    session.reconcileWallTime(epoch);

    expect(commits.map((commit) => commit.events)).toEqual([
      [{ kind: 'freshnessChanged', entity: apple.id, to: 'rotten' }],
      [{ kind: 'freshnessChanged', entity: apple.id, to: 'fresh' }],
      [{ kind: 'freshnessChanged', entity: apple.id, to: 'rotten' }],
      [{ kind: 'removed', entity: apple.id, cause: 'expired' }],
    ]);
    expect(session.world.entities.has(apple.id)).toBe(false);
  });

  it('publishes one restore notification and never replays effects to later readers', () => {
    const session = scene();
    const apple = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, apple.id);
    const saved = captureBody(session, null);
    const seen = vi.fn();
    onWorldCommit(session.world, seen);
    expect(seen).not.toHaveBeenCalled();
    const states: { present: boolean; tetherCount: number; actorBound: boolean }[] = [];
    onWorldCommit(session.world, () => {
      states.push({
        present: session.world.entities.has(apple.id),
        tetherCount: session.world.tethers.size,
        actorBound: session.world.entities.get(session.actor.entity.id) === session.actor.entity,
      });
    });
    applyBody(session, saved, undefined, epoch + 720_000);
    expect(seen).toHaveBeenCalledOnce();
    expect(seen.mock.calls[0][0].events).toEqual([{ kind: 'restored' }]);
    expect(session.world.entities.has(apple.id)).toBe(false);
    expect(session.world.tethers.size).toBe(0);
    expect(states).toEqual([{ present: false, tetherCount: 0, actorBound: true }]);
    const late = vi.fn();
    onWorldCommit(session.world, late);
    expect(late).not.toHaveBeenCalled();
    const invalid = structuredClone(saved);
    invalid.entities[0].kind = 'missing';
    expect(() => applyBody(session, invalid)).toThrow();
    expect(seen).toHaveBeenCalledOnce();
  });

  it('publishes a complete population update when growth runs directly', () => {
    const session = scene();
    const world = session.world;
    world.populations = initialPopulations();
    const commits: WorldCommit[] = [];
    const attempts: number[][] = [];
    onWorldCommit(world, (commit) => {
      commits.push(commit);
      attempts.push([...world.populations.values()].map((population) => population.attempts));
    });

    grow(world, Math.max(...populationRules.map((rule) => rule.interval)));

    expect(commits).toHaveLength(1);
    expect(attempts).toEqual([populationRules.map(() => 1)]);
    const spawned = commits[0].events.flatMap((event) => {
      if (event.kind !== 'spawned') return [];
      return [world.entities.get(event.entity)?.kind];
    });
    expect(spawned).toEqual(populationRules.map((rule) => rule.kind));
  });

  it('batches immediate changes and reports collisions at the world boundary', async () => {
    const session = scene();
    const commits: WorldCommit[] = [];
    onWorldCommit(session.world, (commit) => commits.push(commit));
    batchWorldChanges(session.world, () => {
      session.mark('here');
      session.setLamp(false); // Already off: no change.
      session.setLamp(true);
      batchWorldChanges(session.world, () => {
        session.forgetMark('here');
        expect(commits).toHaveLength(0);
      });
      expect(commits).toHaveLength(0);
    });
    expect(commits).toHaveLength(1);
    expect(commits[0].events.map((event) => event.kind)).toEqual([
      'marksChanged',
      'lampChanged',
      'marksChanged',
    ]);
    session.world.blocks = [{ id: 'wall', minX: -3, maxX: 3, minZ: -2, maxZ: -1, height: 3 }];
    const walking = session.walk(10);
    ticks(session, 120);
    session.cancel();
    await walking;
    const blocked = commits
      .flatMap((commit) => commit.events)
      .filter((event) => event.kind === 'blocked');
    expect(blocked).toEqual([{ kind: 'blocked', actor: session.actor.entity.id, by: 'solid' }]);
  });
});
