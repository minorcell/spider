import { describe, expect, test } from 'vitest';
import { Mesh, type Object3D } from 'three';
import { buildProp, drapeGrass } from '../src/client/props.js';
import { islandGroup } from '../src/client/groundView.js';
import { grassClumps, grassSeed } from '../src/shared/grass.js';
import { groundAttributes, islandBuffers } from '../src/shared/island.js';
import { planRoute } from '../src/shared/route.js';
import { grassHere } from '../src/shared/sight.js';
import { SimSession } from '../src/shared/sim/session.js';
import { applyBody, captureBody } from '../src/shared/sim/snapshot.js';
import { surfaceOf, Terrain, TERRAIN, WORLD_RADIUS } from '../src/shared/terrain.js';
import { SEED } from '../tests/perf/scenarios.js';

const source = new SimSession(SEED);
const world = source.world;
const height = (x: number, z: number) => world.terrain.height(x, z);
const surface = (x: number, z: number) => surfaceOf(world.terrain, x, z);
if (!(world.terrain instanceof Terrain)) throw new Error('Expected baked terrain');
const terrain = world.terrain;
const current = captureBody(source, null);
const legacy = structuredClone(current);
delete legacy.scenery;
legacy.entities = legacy.entities.filter((entity) =>
  ['nest', 'apple', 'grass'].includes(entity.kind),
);
const dense = structuredClone(current);
dense.scenery = 2;
dense.entities = dense.entities.filter((entity) => entity.kind !== 'grass');
const grass = world.entities.find((entity) => entity.kind === 'grass')!;
for (let index = 0; index < 60; index++) {
  dense.entities.push({
    ...grass,
    id: `legacy-grass-${index}`,
    footprint: { kind: 'circle', r: 3.2 },
  });
}
const radius = grass.footprint!.kind === 'circle' ? grass.footprint!.r : 1;
const clump = grassClumps(radius, grassSeed(grass.id))[0];
const grassX = grass.x + clump.x;
const grassZ = grass.z + clump.z;
const targets = world.entities.filter((entity) => entity.kind === 'apple');
const target = targets.find((entity) => {
  const plan = planRoute(0, 0, entity.x, entity.z, world.blocks, surface, WORLD_RADIUS);
  return plan && !plan.direct && plan.points.length > 2;
});
if (!target) throw new Error('Scenery benchmark requires a reachable detour');

function release(root: Object3D): void {
  root.traverse((node) => {
    const geometry = (node as Mesh).geometry;
    geometry?.dispose();
  });
}

describe('scenery boot', () => {
  for (const kind of ['tree', 'stone', 'bog-stone', 'nest', 'grass']) {
    test(`build all ${kind} models`, async ({ bench }) => {
      const entities = world.entities.filter((entity) => entity.kind === kind);
      expect(entities.length).toBeGreaterThan(0);
      await bench(`build ${entities.length} ${kind} models`, () => {
        for (const entity of entities) {
          const model = buildProp(entity.kind, entity.stage, entity.footprint, entity.id)!;
          if (kind === 'grass') drapeGrass(model, entity.x, entity.z, height);
          release(model);
        }
      }).run();
    });
  }

  test('bake ground mesh without cover', async ({ bench }) => {
    await bench('ground mesh only', () => {
      groundAttributes(height, TERRAIN.half, TERRAIN.segments);
    }).run();
  });

  test('bake ground mesh and low cover', async ({ bench }) => {
    await bench('ground mesh + low cover', () => {
      islandBuffers(height);
    }).run();
  });

  test('assemble baked ground and cover', async ({ bench }) => {
    const buffers = islandBuffers(height);
    expect(buffers.coverPosition.length).toBeGreaterThan(0);
    await bench('assemble ground + cover', () => {
      release(islandGroup(buffers));
    }).run();
  });
});

describe('scenery runtime', () => {
  test('query grass cover across all patches', async ({ bench }) => {
    expect(grassHere(grassX, grassZ, world.entities, grass.y + 0.5)).toBe(true);
    await bench('120 grass queries', () => {
      for (let i = 0; i < 120; i++) grassHere(grassX, grassZ, world.entities, grass.y + 0.5);
    }).run();
  });

  test('route through actual scenery', async ({ bench }) => {
    await bench(`detour with ${world.blocks.length} walls`, () => {
      planRoute(0, 0, target.x, target.z, world.blocks, surface, WORLD_RADIUS);
    }).run();
  });
});

describe('scenery persistence', () => {
  for (const [name, body] of [
    ['current', current],
    ['legacy without scenery', legacy],
    ['dense grass release', dense],
  ] as const) {
    test(`restore ${name}`, async ({ bench }) => {
      const session = new SimSession(SEED);
      await bench(`restore ${name} with baked terrain`, () => {
        applyBody(session, body, terrain);
      }).run();
    });
  }
});
