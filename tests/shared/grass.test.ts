import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { grassClumps, grassOnDryGround, grassRadius, grassSeed } from '../../src/shared/grass.js';
import { grassHere } from '../../src/shared/sight.js';
import { buildProp } from '../../src/client/props.js';

describe('grass shape', () => {
  it('invalidates cached cover when a patch is resized or renamed', () => {
    const entity = {
      id: 'grass-1',
      kind: 'grass',
      x: 0,
      y: 0,
      z: 0,
      stage: 0,
      footprint: { kind: 'circle' as const, r: 1 },
    };
    const query = (x: number, z: number) => grassHere(x, z, [entity], 0);
    expect(query(0, 0)).toBe(true);
    expect(query(0, 0)).toBe(true);
    entity.footprint.r = 2;
    expect(query(0, 0)).toBe(true);
    entity.id = 'grass-2';
    expect(query(0, 0)).toBe(true);
  });

  it('rejects a wet edge or a small water pocket even with a dry center', () => {
    expect(grassOnDryGround(() => 0, 0, 0, 1)).toBe(true);
    expect(grassOnDryGround((x) => (x > 0.6 ? -1 : 0), 0, 0, 1)).toBe(false);
    expect(
      grassOnDryGround((x, z) => (Math.hypot(x - 0.5, z - 0.5) < 0.15 ? -1 : 0), 0, 0, 1),
    ).toBe(false);
  });

  it('uses stable seeds, with a fallback for nonnumeric names', () => {
    expect(grassSeed('grass-x')).toBe(grassSeed(''));
    expect(grassRadius('grass-1')).not.toBe(grassRadius('grass-2'));
  });

  it('fits drawn blades to the same clumps used by sight', () => {
    for (const id of ['grass-1', 'grass-2', 'grass-3']) {
      const radius = grassRadius(id);
      const clumps = grassClumps(radius, grassSeed(id));
      const patch = buildProp('grass', 0, { kind: 'circle', r: radius }, id)!;
      const positions = (patch.children[0] as Mesh).geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const z = positions.getZ(i);
        expect(
          clumps.some(
            (clump) =>
              Math.hypot(x - clump.x, z - clump.z) <= clump.radius + 1e-6 &&
              positions.getY(i) <= clump.height + 0.016,
          ),
        ).toBe(true);
      }
      const entity = {
        id,
        kind: 'grass',
        x: 0,
        y: 0,
        z: 0,
        stage: 0,
        footprint: { kind: 'circle' as const, r: radius },
      };
      for (const clump of clumps) {
        expect(grassHere(clump.x, clump.z, [entity], 0.5)).toBe(true);
        expect(grassHere(clump.x, clump.z, [entity], 2)).toBe(false);
      }
      expect(grassHere(radius, 0, [entity], 0)).toBe(false);
    }
  });
});
