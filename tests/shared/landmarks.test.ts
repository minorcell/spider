import { describe, expect, it } from 'vitest';
import { homeLandmarks } from '@/src/shared/landmarks';
import { planRoute } from '@/src/shared/route';
import { blockedAt } from '@/src/shared/sight';
import { captureBody } from '@/src/shared/sim/snapshot';
import { SimSession } from '@/src/shared/sim/session';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import { block } from '@/tests/helpers';

describe('home landmarks', () => {
  it('uses the default body radius when the world has no controlled actor', () => {
    const world = new SimSession(1).world;
    world.terrain = {
      height: (x, z) => (z === 0 && x === 5 ? 2 : z === 0 && x === 3 ? 1 : -2),
    };
    world.blocks = [block('wall', 5.51, 6, -0.5, 0.5)];
    expect(homeLandmarks(world)[1]).toMatchObject({ name: '山顶', x: 3, z: 0 });

    delete world.controlledId;
    expect(homeLandmarks(world)[1]).toMatchObject({ name: '山顶', x: 5, z: 0 });
  });

  it('keeps home when no dry landmark can be placed', () => {
    const world = new SimSession(1).world;
    world.terrain = { height: () => -2 };
    world.blocks = [];
    expect(homeLandmarks(world).map((place) => place.name)).toEqual(['巢穴']);
  });

  it('omits the rear when the only high point is the center or has no dry land beyond it', () => {
    const world = new SimSession(1).world;
    world.blocks = [];
    world.terrain = { height: (x, z) => (x === 0 && z === 0 ? 1 : -2) };
    expect(homeLandmarks(world).map((place) => place.name)).toEqual(['巢穴', '山顶']);
    world.terrain = { height: (x, z) => (x === 5 && z === 0 ? 1 : -2) };
    expect(homeLandmarks(world).map((place) => place.name)).toEqual(['巢穴', '山顶']);
  });

  it.each(Array.from({ length: 20 }, (_, index) => index + 1))(
    'derives mountain and rear and preserves user marks on restore for island seed %i',
    (seed) => {
      const session = new SimSession(seed);
      const [home, peak, rear] = session.landmarks();
      expect(home).toMatchObject({ name: '巢穴', x: 0, z: 0 });
      expect(peak.name).toBe('山顶');
      expect(rear.name).toBe('后山');
      expect((rear.x - peak.x) * peak.x + (rear.z - peak.z) * peak.z).toBeGreaterThan(0);
      for (const point of [peak, rear]) {
        expect(session.world.terrain.inside!(point.x, point.z, 1)).toBe(true);
        expect(blockedAt(point.x, point.z, session.world.blocks)).toBe(false);
        expect(
          planRoute(
            0,
            0,
            point.x,
            point.z,
            session.world.blocks,
            session.world.terrain.height.bind(session.world.terrain),
            WORLD_RADIUS,
          ),
        ).not.toBeNull();
      }
      session.mark('我的地点');
      const body = captureBody(session, null);
      const restored = new SimSession(seed + 100);
      restored.landmarks();
      restored.adopt(body);
      expect(restored.world.marks).toEqual(session.world.marks);
      expect(restored.landmarks()).toEqual(homeLandmarks(restored.world));
      expect(restored.landmarks()).toEqual(session.landmarks());
    },
  );
});
