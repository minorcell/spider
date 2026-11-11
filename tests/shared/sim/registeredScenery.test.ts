import { islandPlacements, islandFamilies } from '@/src/shared/islandContent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KINDS, propertiesOf } from '@/src/shared/kinds';
import { homeLandmarks } from '@/src/shared/landmarks';
import { coverAt, homeAt, blockedAt, occluded } from '@/src/shared/sight';
import { aheadAt, senseBody } from '@/src/shared/sense';
import { viewDistance } from '@/src/shared/vision';
import { SimSession } from '@/src/shared/sim/session';
import { bindLegWorld } from '@/src/shared/sim/bindWorld';
import { applyBody, captureBody, classify } from '@/src/shared/sim/snapshot';
import { addEntity, removeEntity, propBlocks, createWorld } from '@/src/shared/world';
import { Terrain } from '@/src/shared/terrain';
import { attachCargo, drive } from '@/tests/simHelpers';
import { pump } from '@/tests/helpers';

function registerCamp(): void {
  KINDS.camp = {
    rest: 0,
    physics: { solid: true, radius: 0, loose: false, rolls: false },
    fixedElevation: true,
    model: 'grass',
    label: '芦苇营地',
    home: { half: 2, storage: { start: 1, step: 0.5 }, landmark: '营地' },
    placement: {
      probe: 2,
      footprint: () => ({ kind: 'circle', r: 2 }),
      fits: (terrain, entity) => terrain.height(entity.x, entity.z) >= 0,
    },
    cover: { range: 3, volumes: (_id, radius) => [{ x: 0, z: 0, radius, height: 3 }] },
    boxes: [
      { id: 'left', minX: -2.2, maxX: -2, minZ: -2, maxZ: 2, height: 2 },
      { id: 'right', minX: 2, maxX: 2.2, minZ: -2, maxZ: 2, height: 2 },
    ],
    support: (origin, x, z) =>
      Math.abs(x - origin.x) <= 2 && Math.abs(z - origin.z) <= 2 ? origin.y + 0.15 : -Infinity,
  };
}

function campSession(): SimSession {
  registerCamp();
  const session = new SimSession(7);
  session.world.entities.clear();
  session.world.blocks = [];
  session.world.terrain = { height: () => 0 };
  const camp = addEntity(session.world, 'camp', { x: 8, z: -6 }, 0);
  // The scene's authored home ID survives replacing its registered definition.
  session.world.entities.delete(camp.id);
  camp.id = 'home';
  session.world.entities.set(camp.id, camp);
  session.world.blocks = propBlocks(session.world.entities.values());
  session.spider.root.position.set(camp.x, 0, camp.z);
  return session;
}

afterEach(() => {
  delete KINDS.camp;
  delete KINDS.canopy;
});

describe('registered scenery composition', () => {
  it('generates a moved home and an additional cover kind from scene registrations alone', () => {
    registerCamp();
    KINDS.canopy = { ...KINDS.grass };
    const placement = islandPlacements[0];
    const saved = { ...placement };
    const families = islandFamilies as Array<(typeof islandFamilies)[number]>;
    families.push({ kind: 'canopy', count: 3, home: 8, gap: 4, repair: true });
    Object.assign(placement, { kind: 'camp', x: 8, z: -6 });
    try {
      const terrain = new Terrain(7);
      vi.spyOn(terrain, 'height').mockReturnValue(0);
      const world = createWorld(7, terrain);
      expect(world.entities.get('home')).toMatchObject({
        kind: 'camp',
        x: 8,
        z: -6,
        footprint: { kind: 'circle', r: 2 },
      });
      expect(world.blocks.filter((wall) => wall.owner === 'home')).toHaveLength(2);
      const patches = [...world.entities.values()].filter((entity) => entity.kind === 'canopy');
      expect(patches).toHaveLength(3);
      for (const patch of patches) {
        expect(Math.hypot(patch.x - 8, patch.z + 6)).toBeGreaterThanOrEqual(8);
        expect(patch.footprint?.kind).toBe('circle');
        expect(coverAt(patch.x, patch.z, [patch], 0)?.kind).toBe('canopy');
      }
    } finally {
      Object.assign(placement, saved);
      families.pop();
    }
  });

  it('combines home, cover, collision and placement without a new runtime branch', () => {
    const session = campSession();
    const { world } = session;
    expect(propertiesOf('camp')).toEqual(['cover', 'home']);
    expect(homeAt(8, -6, world.entities.values())?.kind).toBe('camp');
    expect(homeAt(0, 0, world.entities.values())).toBeNull();
    expect(session.sense()).toMatchObject({ home: true, cover: 'camp' });
    expect(homeLandmarks(world)[0]).toMatchObject({ name: '营地', x: 8, z: -6 });
    expect(viewDistance(world, 8, -6, 0, false, 24, new Date('2026-11-11T12:00:00'))).toBe(3);
    expect(blockedAt(10.1, -6, world.blocks)).toBe(true);
    expect(blockedAt(8, -8, world.blocks)).toBe(false);
    expect(aheadAt(8, -6, 90, () => 0, world.blocks)).toMatchObject({
      by: 'wall',
      id: 'home',
      kind: 'camp',
    });
    expect(
      senseBody(8, -6, 0, 90, () => 0, world.blocks).nearby.every((wall) => wall.kind === 'camp'),
    ).toBe(true);
    expect(occluded(5, -6, 11, -6, world.blocks, 'target', 1)).toBe(true);
    expect(occluded(5, -6, 8, -6, world.blocks, 'home', 1)).toBe(false);
  });

  it('uses the same compound walls for controlled motion and loose items', async () => {
    const session = campSession();
    session.spider.yaw = -Math.PI / 2;
    const walk = drive(session, 3, { throttle: 1 });
    pump(session, 240);
    await walk;
    expect(session.spider.root.position.x).toBeLessThan(10);
    expect(session.spider.root.position.x).toBeGreaterThan(8);
    const stone = addEntity(session.world, 'pebble', { x: 8, z: -7.5 }, 0);
    stone.vx = 4;
    pump(session, 90);
    expect(stone.x).toBeLessThanOrEqual(10 - KINDS.pebble.physics!.radius);
    expect(stone.x).toBeGreaterThan(8);
  });

  it('stores and sleeps relative to the registered home, then restores its shapes', async () => {
    const session = campSession();
    const item = addEntity(session.world, 'pebble', { x: 8, z: -6.8 }, 0);
    attachCargo(session.world, item);
    expect(session.store(item.id)).toMatchObject({ ok: true, x: 9, z: -5 });
    const sleep = session.sleep();
    pump(session, 300);
    await expect(sleep).resolves.toMatchObject({ ok: true, action: 'sleep' });
    const body = captureBody(session, null);
    const parsed = classify({
      ...body,
      id: 'current',
      format: 3,
      savedAt: 1,
      day: '2026-11-11',
      owner: 'tab',
      seq: 1,
      leaseUntil: 1,
    });
    expect(parsed.status).toBe('ok');
    const restored = new SimSession(8);
    const terrain = new Terrain(7);
    vi.spyOn(terrain, 'height').mockReturnValue(0);
    applyBody(restored, body, terrain);
    expect(restored.world.blocks).toEqual(session.world.blocks);
    expect(restored.sense()).toMatchObject({ home: true, cover: 'camp' });
    removeEntity(restored.world, restored.world.entities.get('home')!);
    expect(restored.world.blocks).toEqual([]);
    expect(homeLandmarks(restored.world)).toEqual([]);
    await expect(restored.sleep()).resolves.toMatchObject({ ok: false, reason: 'not-home' });
  });

  it('supports feet on every registered surface, including a second instance', () => {
    const session = campSession();
    const second = addEntity(session.world, 'camp', { x: -8, z: 6 }, 0);
    second.y = 1;
    const binding = vi.spyOn(session.spider, 'bindLegs');
    bindLegWorld(session.spider, session.world);
    const [collect, surface] = binding.mock.calls[0];
    collect!([]);
    expect(surface!(8, -6)).toBe(0.15);
    expect(surface!(-8, 6)).toBe(1.15);
    expect(surface!(0, 0)).toBe(-Infinity);
    removeEntity(session.world, second);
    collect!([]);
    expect(surface!(-8, 6)).toBe(-Infinity);
  });

  it('chooses the strongest overlapping cover and invalidates a changed definition', () => {
    const session = campSession();
    KINDS.canopy = { ...KINDS.camp, cover: { range: 2, volumes: KINDS.camp.cover!.volumes } };
    const canopy = addEntity(session.world, 'canopy', { x: 8, z: -6 }, 0);
    expect(coverAt(8, -6, session.world.entities.values(), 1)).toEqual({
      kind: 'canopy',
      range: 2,
    });
    expect(coverAt(8, -6, [...session.world.entities.values()].reverse(), 1)).toEqual({
      kind: 'canopy',
      range: 2,
    });
    KINDS.canopy.cover = { range: 1, volumes: () => [] };
    expect(coverAt(8, -6, [canopy], 1)).toBeNull();
    expect(coverAt(8, -6, session.world.entities.values(), 4)).toBeNull();
  });
});
