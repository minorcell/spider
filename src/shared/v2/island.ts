import type { ItemType, Scene } from './world';

export const islandItems: ReadonlyMap<string, ItemType> = new Map([
  [
    'spider:apple',
    {
      modelId: 'apple',
      radius: 9,
      mass: 0.8,
      tetherable: true,
      food: { bites: 6, nutrition: 10 },
      lifetime: { clock: 'wall', seconds: 720 },
    },
  ],
  ['spider:pebble', { modelId: 'pebble', radius: 7, mass: 2.5, tetherable: true }],
  [
    'spider:berry',
    {
      modelId: 'berry',
      radius: 6,
      mass: 0.5,
      tetherable: false,
      food: { bites: 2, nutrition: 4 },
      lifetime: { clock: 'simulation', seconds: 360 },
    },
  ],
]);

export const island: Scene = {
  size: { x: 400, y: 224 },
  actor: { x: 119, y: 116 },
  obstacles: [
    { x: 301, y: 89, radius: 10, modelId: 'wall' },
    { x: 301, y: 108, radius: 10, modelId: 'wall' },
    { x: 301, y: 127, radius: 10, modelId: 'wall' },
    { x: 301, y: 146, radius: 10, modelId: 'wall' },
    { x: 333, y: 49, radius: 17, modelId: 'nest' },
  ],
  items: [
    { id: 'apple-1', typeId: 'spider:apple', x: 150, y: 116 },
    { id: 'pebble-1', typeId: 'spider:pebble', x: 207, y: 91 },
    { id: 'berry-1', typeId: 'spider:berry', x: 218, y: 151 },
  ],
};
