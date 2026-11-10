import type { RegistryBuilder } from './base';
import type { ItemType, PopulationRule } from './module_Content';

const appleRadius = 0.1944;

export const apple: ItemType = {
  id: 'spider:apple',
  modelId: 'spider:apple',
  tetherable: true,
  body: {
    motion: 'dynamic',
    colliders: [
      {
        shape: { kind: 'sphere', radius: appleRadius },
        offset: { x: 0, y: appleRadius, z: 0 },
        blocksMotion: true,
        blocksSight: false,
      },
    ],
    mass: 0.025,
    buoyancyVolume: 0.031,
    gravityScale: 1,
  },
  food: { bites: 6, secondsPerBite: 0.5, nutritionPerBite: 10 },
  lifetime: { clock: 'wall', lifetimeSeconds: 720, rottenSeconds: 90 },
};

export const applePopulation: PopulationRule = {
  id: 'spider:island-apple',
  itemTypeId: apple.id,
  targetCount: 20,
  intervalSeconds: 24,
  placementId: 'spider:dry-ground-fruit',
};

/** 用这个测试用例验证新食物可以走同一套引擎逻辑。 */
export function registerPearScenario(
  items: RegistryBuilder<ItemType>,
  populations: RegistryBuilder<PopulationRule>,
) {
  const pear: ItemType = {
    ...apple,
    id: 'example:pear',
    modelId: 'example:pear',
    body: {
      ...apple.body,
      mass: 0.03,
      colliders: [
        {
          shape: { kind: 'sphere', radius: 0.22 },
          offset: { x: 0, y: 0.22, z: 0 },
          blocksMotion: true,
          blocksSight: false,
        },
      ],
    },
    food: { bites: 4, secondsPerBite: 0.7, nutritionPerBite: 7 },
    lifetime: { clock: 'simulation', lifetimeSeconds: 360, rottenSeconds: 60 },
  };
  items.register(pear);
  populations.register({ ...applePopulation, id: 'example:pear-population', itemTypeId: pear.id });
}
