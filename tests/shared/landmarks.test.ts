import { describe, expect, it } from 'vitest';
import { homeLandmarks } from '@/src/shared/landmarks';
import { planRoute } from '@/src/shared/route';
import { blockedAt } from '@/src/shared/sight';
import { captureBody } from '@/src/shared/sim/snapshot';
import { SimSession } from '@/src/shared/sim/session';
import { WORLD_RADIUS } from '@/src/shared/terrain';

describe('home landmarks', () => {
  it('derives mountain and rear from each island and preserves user marks on restore', () => {
    for (const seed of Array.from({ length: 20 }, (_, index) => index + 1)) {
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
    }
  });
});
