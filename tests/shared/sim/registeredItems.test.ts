import { describe, expect, it } from 'vitest';
import { populationRules } from '@/src/shared/islandContent';
import { KINDS } from '@/src/shared/kinds';
import { SimSession } from '@/src/shared/sim/session';
import { captureBody, classify, type SimBody } from '@/src/shared/sim/snapshot';
import { grow } from '@/src/shared/world';
import { block, pump } from '@/tests/helpers';

const date = '2026-11-11';

function decode(body: SimBody): SimBody {
  const parsed = classify(
    {
      ...body,
      id: 'current',
      format: 4,
      savedAt: 1,
      day: date,
      owner: 'tab',
      seq: 1,
      leaseUntil: 1,
    },
    date,
  );
  if (parsed.status !== 'ok') throw new Error('Invalid test save');
  return parsed.record;
}

describe('registered items in the island', () => {
  it('generates both kinds and resumes their independent population rules from a save', () => {
    const session = new SimSession(7);
    const seeded = [...session.world.entities.values()];
    expect(seeded.some((item) => item.kind === 'pebble')).toBe(true);
    expect(seeded.some((item) => item.kind === 'berry')).toBe(true);

    const old = captureBody(session, null);
    old.populations = {};
    old.entities = old.entities.filter((item) => item.kind !== 'pebble' && item.kind !== 'berry');
    session.adopt(decode(old));
    for (const rule of populationRules)
      session.world.populations.set(rule.id, { remaining: rule.interval, attempts: 0 });
    grow(session.world, 12);
    expect(
      [...session.world.entities.values()].filter((item) => item.kind === 'berry'),
    ).toHaveLength(1);
    expect([...session.world.entities.values()].some((item) => item.kind === 'pebble')).toBe(false);

    const restored = new SimSession(8);
    restored.adopt(decode(captureBody(session, null)));
    expect(restored.world.populations.get('berries')).toEqual({ remaining: 12, attempts: 1 });
    expect(restored.world.populations.get('pebbles')).toEqual({ remaining: 6, attempts: 0 });
    grow(restored.world, 6);
    expect(
      [...restored.world.entities.values()].filter((item) => item.kind === 'pebble'),
    ).toHaveLength(1);
  });

  it('rolls a pebble into a wall using its registered body', () => {
    const session = new SimSession(7);
    session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
    session.world.terrain = { height: () => 1 };
    const wall = block('wall', 0.8, 1, -4, -1);
    session.world.blocks = [wall];
    const stone = session.addEntity('pebble', 0.2, -2);
    stone.vx = 4;
    pump(session, 60);
    expect(stone.x).toBeGreaterThan(0.5);
    expect(stone.x).toBeLessThanOrEqual(wall.minX - KINDS.pebble.physics!.radius);
    expect(Math.abs(stone.qz!)).toBeGreaterThan(0);
  });

  it('tethers and restores a pebble that cannot be eaten', async () => {
    const session = new SimSession(7);
    const stone = session.addEntity('pebble', 0, -0.8);
    expect(session.near()).toContainEqual(
      expect.objectContaining({ id: stone.id, properties: ['carryable'] }),
    );
    await expect(session.eat(stone.id)).resolves.toMatchObject({ ok: false, reason: 'not-edible' });
    const pickup = session.pickUp(stone.id);
    pump(session, 24);
    await expect(pickup).resolves.toMatchObject({ ok: true, target: stone.id });
    expect(session.world.entities.get(stone.id)).toBe(stone);
    stone.vx = 0.5;

    const restored = new SimSession(8);
    restored.adopt(decode(captureBody(session, null)));
    expect(restored.world.tethers.get(stone.id)).toEqual(session.world.tethers.get(stone.id));
    expect(restored.world.entities.get(stone.id)).toEqual(stone);
    expect(restored.release(stone.id).ok).toBe(true);
    expect(restored.world.entities.get(stone.id)?.vx).toBe(0.5);
  });

  it('saves a berry after one bite, then finishes it through the same eat action', async () => {
    const session = new SimSession(7);
    const berry = session.addEntity('berry', 0, -0.8);
    expect(session.near()).toContainEqual(
      expect.objectContaining({ id: berry.id, properties: ['edible'] }),
    );
    await expect(session.pickUp(berry.id)).resolves.toMatchObject({
      ok: false,
      reason: 'not-carryable',
    });
    const eating = session.eat(berry.id);
    pump(session, 31);
    session.cancel();
    await expect(eating).resolves.toMatchObject({ ok: false, reason: 'cancelled', stage: 1 });
    const restored = new SimSession(8);
    restored.adopt(decode(captureBody(session, null)));
    expect(restored.world.entities.get(berry.id)).toMatchObject({
      stage: 1,
      deadline: berry.deadline,
    });
    const finishing = restored.eat(berry.id);
    pump(restored, 31);
    await expect(finishing).resolves.toMatchObject({ ok: true, removed: true, target: berry.id });
    expect(restored.world.entities.has(berry.id)).toBe(false);
  });

  it('expires berries by wall time and preserves the ID sequence across reloads', () => {
    const epoch = 1_800_000_000_000;
    const session = new SimSession(7, undefined, epoch);
    const berry = session.addEntity('berry', 0, -0.8);
    const expiresAtMs = epoch + 6 * 3_600_000;
    expect(berry.deadline).toMatchObject({ clock: 'wall', expiresAtMs });
    session.frame(1 / 60, expiresAtMs - 1);
    expect(session.world.entities.get(berry.id)).toBe(berry);
    session.frame(0, expiresAtMs);
    expect(session.world.entities.has(berry.id)).toBe(false);

    const restored = new SimSession(8, undefined, expiresAtMs);
    restored.adopt(decode(captureBody(session, null)));
    const replacement = restored.addEntity('berry', 0, -0.8);
    expect(Number(replacement.id.split('-')[1])).toBe(Number(berry.id.split('-')[1]) + 1);
  });
});
