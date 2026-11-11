import { describe, expect, it, vi } from 'vitest';
import { SimSession } from '@/src/shared/sim/session';
import { captureBody, applyBody } from '@/src/shared/sim/snapshot';
import { stepPhysics } from '@/src/shared/sim/physics';
import { removeEntity } from '@/src/shared/world';
import { PHYSICS } from '@/src/shared/config';
import { viewDistance } from '@/src/shared/vision';

const noon = new Date(2026, 0, 1, 12).getTime();
const midnight = new Date(2026, 0, 2, 0).getTime();

function scene(): SimSession {
  const session = new SimSession(7, undefined, noon);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  return session;
}

describe('world-owned time', () => {
  it('uses one committed wall sample for perception while only executed steps age items', () => {
    const session = scene();
    const berry = session.addEntity('berry', 0, -0.8);
    session.actor.state.time = 5000;
    session.frame(1 / 60, noon);
    expect(session.world.entities.get(berry.id)).toBe(berry);
    expect(session.world.clock).toEqual({ tick: 1, simSeconds: 1 / 60, wallNowMs: noon });
    expect(session.observe().time).toBe(0.017);
    expect(viewDistance(session.world, 0, 0, 0, false)).toBe(24);

    // Reading after the host clock changes cannot produce a different world view.
    vi.spyOn(Date, 'now').mockReturnValue(midnight);
    expect(session.worldInfo().clock.phase).toBe('day');
    expect(viewDistance(session.world, 0, 0, 0, false)).toBe(24);
    session.frame(0, midnight);
    expect(session.world.clock).toEqual({ tick: 1, simSeconds: 1 / 60, wallNowMs: midnight });
    expect(session.worldInfo().clock.phase).toBe('night');
    expect(viewDistance(session.world, 0, 0, 0, false)).toBeCloseTo(2.4);
    expect(session.world.entities.get(berry.id)).toBe(berry);
  });

  it('keeps expiry, population and collisions running after the controlled actor is removed', async () => {
    const session = scene();
    const berry = session.addEntity('berry', 2, 0);
    const rock = session.addEntity('pebble', -1, 0);
    rock.vx = 4;
    session.world.physics = { ...PHYSICS, damping: 0 };
    session.world.clock.simSeconds = berry.expiresAt! - 0.1;
    const action = session.walk(5);
    removeEntity(session.world, session.actor.entity);
    session.world.populations.get('berries')!.remaining = 0;
    session.frame(0.05, midnight);
    await expect(action).resolves.toMatchObject({ ok: false, reason: 'stale-actor' });
    expect(session.world.populations.get('berries')!.attempts).toBe(1);
    const replacement = [...session.world.entities.values()].find(
      (item) => item.kind === 'berry' && item !== berry,
    )!;
    expect(replacement.expiresAt).toBeCloseTo(session.world.clock.simSeconds + 180);
    for (let i = 0; i < 9; i++) session.frame(0.05, midnight);
    expect(session.world.entities.has(berry.id)).toBe(false);
    expect(session.world.entities.has(replacement.id)).toBe(true);
    expect(rock.x).toBeCloseTo(1); // No invisible controller remains at the origin.
    expect(session.world.clock.tick).toBe(10);
    expect(session.actor.time).toBe(0);
    rock.vx = 0;
    for (let i = 0; i < 4; i++) expect(stepPhysics(session.world, undefined, 0.05)).toBeUndefined();
    expect(rock.x).toBeCloseTo(1);
  });

  it('restores independent clocks and uses world time for interrupted and resumed actions', async () => {
    const session = scene();
    session.world.clock = { tick: 600, simSeconds: 10, wallNowMs: noon };
    session.actor.state.time = 500;
    const berry = session.addEntity('berry', 0, -0.8);
    const saved = captureBody(session, null);
    expect(berry.expiresAt).toBe(190);
    session.frame(0.05, midnight);
    expect(saved.clock).toEqual({ tick: 600, simSeconds: 10, wallNowMs: noon });
    applyBody(session, saved);
    expect(session.world.clock).toEqual(saved.clock);
    expect(session.actor.time).toBe(500);
    const eating = session.eat(berry.id);
    session.actor.state.time = 0;
    for (let i = 0; i < 10; i++) session.frame(0.05, noon);
    session.cancel();
    await expect(eating).resolves.toMatchObject({ reason: 'cancelled', stage: 1 });
    expect(session.world.clock.simSeconds).toBeCloseTo(10.5);
    expect(session.world.clock.tick).toBe(610);
  });

  it('rejects invalid host samples without corrupting the committed world clock', () => {
    const session = scene();
    for (const [dt, wall] of [
      [NaN, noon],
      [Infinity, noon],
      [0.01, NaN],
      [0.01, -1],
    ]) {
      session.frame(dt, wall);
    }
    expect(session.world.clock).toEqual({ tick: 0, simSeconds: 0, wallNowMs: noon });
    session.frame(-1, noon);
    expect(session.world.clock.tick).toBe(0);
    session.frame(100, noon);
    expect(session.world.clock).toEqual({ tick: 1, simSeconds: 0.05, wallNowMs: noon });
  });
});
