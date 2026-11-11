import { describe, test } from 'vitest';
import { islandGroup } from '@/src/client/groundView';
import { buildProp, drapeGrass } from '@/src/client/props';
import { islandBuffers } from '@/src/shared/island';
import { bakeTerrainGrid } from '@/src/shared/terrain';
import { createWorld } from '@/src/shared/world';
import { bakeWorkerTerrain, SEED } from '@/tests/perf/scenarios';

const world = createWorld(SEED);
const height = (x: number, z: number): number => world.terrain.height(x, z);
const nests = world.entities.filter((entity) => entity.kind === 'nest');
const apples = world.entities.filter((entity) => entity.kind === 'apple');
const grasses = world.entities.filter((entity) => entity.kind === 'grass');

function dress(entities: typeof nests): void {
  for (const entity of entities) {
    const built = buildProp(entity.kind, entity.stage, entity.footprint, entity.id);
    if (built && entity.kind === 'grass') drapeGrass(built, entity.x, entity.z, height);
  }
}

describe('boot', () => {
  test('bake worker terrain', async ({ bench }) => {
    await bench('bake worker terrain', () => {
      return bakeWorkerTerrain();
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
    const buffers = islandBuffers(height);
    await bench('group the island', () => {
      islandGroup(buffers);
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
