import { describe, expect, it } from 'vitest';
import { pushFromBlocks } from '@/src/shared/contact';

const block = { id: 'column', minX: 0, maxX: 2, minZ: 0, maxZ: 2, height: 2 };
const shallowSurface = () => 0.5;

describe('registered static probe contact', () => {
  it.each([
    { x: 1, y: 2.3, z: 1 },
    { x: -0.3, y: 1, z: 1 },
    { x: 2.3, y: 1, z: 1 },
    { x: 1, y: 1, z: -0.3 },
    { x: 1, y: 1, z: 2.3 },
  ])('leaves a separated probe at %j alone', (probe) => {
    const correction = { x: 9, y: 9, z: 9 };
    expect(pushFromBlocks(probe, 0.1, [block], correction)).toBe(false);
    expect(correction).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('takes the nearest side or top exit from a registered column', () => {
    const correction = { x: 0, y: 0, z: 0 };
    expect(pushFromBlocks({ x: 0.05, y: 1, z: 1 }, 0.1, [block], correction)).toBe(true);
    expect(correction.x).toBeCloseTo(-0.15);
    expect(correction.y).toBe(0);
    expect(correction.z).toBe(0);

    expect(pushFromBlocks({ x: 1, y: 1.95, z: 1 }, 0.1, [block], correction)).toBe(true);
    expect(correction.x).toBe(0);
    expect(correction.y).toBeCloseTo(0.15);
    expect(correction.z).toBe(0);
  });

  it('uses local surface height when a point is inside the broad column bounds', () => {
    const correction = { x: 0, y: 0, z: 0 };
    expect(pushFromBlocks({ x: 1, y: 0.8, z: 1 }, 0.1, [block], correction, shallowSurface)).toBe(
      false,
    );
    expect(correction).toEqual({ x: 0, y: 0, z: 0 });
    expect(pushFromBlocks({ x: 1, y: 0.55, z: 1 }, 0.1, [block], correction, shallowSurface)).toBe(
      true,
    );
    expect(correction.y).toBeCloseTo(0.05);
  });
});
