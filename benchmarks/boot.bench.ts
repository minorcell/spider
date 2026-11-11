import { describe, test } from 'vitest';
import { islandGroup } from '@/src/client/groundView';
import { buildProp, drapeGrass } from '@/src/client/props';
import { islandBuffers } from '@/src/client/islandMesh';
import { bakeTerrainGrid } from '@/src/shared/terrain';
import { createWorld } from '@/src/shared/world';
import { bakeWorkerIsland, SEED } from '@/tests/perf/scenarios';

const world = createWorld(SEED);
const height = (x: number, z: number): number => world.terrain.height(x, z);
const nests = [...world.entities.values()].filter((entity) => entity.kind === 'nest');
const apples = [...world.entities.values()].filter((entity) => entity.kind === 'apple');
const grasses = [...world.entities.values()].filter((entity) => entity.kind === 'grass');

function dress(entities: typeof nests): void {
  for (const entity of entities) {
    const built = buildProp(entity.kind, entity.stage, entity.footprint, entity.id);
    if (built && entity.kind === 'grass') drapeGrass(built, entity.x, entity.z, height);
  }
}

describe('boot', () => {
  test('bake worker island', async ({ bench }) => {
    await bench('bake worker island', () => {
      return bakeWorkerIsland();
    }).run();
  });

  test('bake the terrain grid', async ({ bench }) => {
    await bench('bake the terrain grid', () => {
      bakeTerrainGrid(SEED);
    }).run();
  });

  test('build island buffers', async ({ bench }) => {
    await bench('build island buffers', () => {
      islandBuffers(height);
    }).run();
  });

  test('group the island', async ({ bench }) => {
    const prepared = await bakeWorkerIsland();
    await bench('group the island', () => {
      islandGroup(prepared.island);
    }).run();
  });

  test('dress the nest', async ({ bench }) => {
    await bench('dress the nest', () => {
      dress(nests);
    }).run();
  });

  test('dress the apples', async ({ bench }) => {
    await bench('dress the apples', () => {
      dress(apples);
    }).run();
  });

  test('dress the grass', async ({ bench }) => {
    await bench('dress the grass', () => {
      dress(grasses);
    }).run();
  });
});
