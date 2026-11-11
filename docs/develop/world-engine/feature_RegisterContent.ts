import type { RegistryBuilder, TypeId } from './base';
import type { ItemType, PopulationRule } from './module_Content';
import type { BodySpec } from './module_Physics';

const dryGround = 'spider:dry-ground';

function roundBody(radius: number, mass: number, buoyancyVolume?: number): BodySpec {
  return {
    motion: 'dynamic',
    colliders: [
      {
        shape: { kind: 'sphere', radius },
        offset: { x: 0, y: radius, z: 0 },
        blocksMotion: true,
        blocksSight: false,
      },
    ],
    mass,
    buoyancyVolume,
    gravityScale: 1,
  };
}

export const apple: ItemType = {
  id: 'spider:apple',
  modelId: 'spider:apple',
  tetherable: true,
  body: roundBody(0.1944, 0.025, 0.031),
  food: { bites: 6, secondsPerBite: 0.5, nutritionPerBite: 10 },
  lifetime: { clock: 'wall', lifetimeSeconds: 720, rottenSeconds: 90 },
};

export const applePopulation: PopulationRule = {
  id: 'spider:island-apple',
  itemTypeId: apple.id,
  targetCount: 20,
  intervalSeconds: 24,
  placementId: dryGround,
};

const pebble: ItemType = {
  id: 'example:pebble',
  modelId: 'example:pebble',
  body: roundBody(0.12, 0.08),
  tetherable: true,
};

const berry: ItemType = {
  id: 'example:berry',
  modelId: 'example:berry',
  body: roundBody(0.08, 0.005, 0.006),
  tetherable: false,
  food: { bites: 2, secondsPerBite: 0.5, nutritionPerBite: 4 },
  lifetime: { clock: 'simulation', lifetimeSeconds: 360, rottenSeconds: 60 },
};

const pebblePopulation: PopulationRule = {
  id: 'example:island-pebble',
  itemTypeId: pebble.id,
  targetCount: 5,
  intervalSeconds: 30,
  placementId: dryGround,
};

const berryPopulation: PopulationRule = {
  id: 'example:island-berry',
  itemTypeId: berry.id,
  targetCount: 8,
  intervalSeconds: 18,
  placementId: dryGround,
};

/** 返回测试场景要加入 WorldConfig.populationIds 的生成规则 ID。 */
export function registerItemCombinations(
  items: RegistryBuilder<ItemType>,
  populations: RegistryBuilder<PopulationRule>,
): readonly TypeId[] {
  items.register(pebble);
  items.register(berry);
  populations.register(pebblePopulation);
  populations.register(berryPopulation);
  return [pebblePopulation.id, berryPopulation.id];
}
