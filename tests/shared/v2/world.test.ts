import { expect, test } from 'vitest';
import { island, islandItems } from '@/src/shared/v2/island';
import { STEP, solve, type Body } from '@/src/shared/v2/physics';
import { World, type ItemType, type Scene } from '@/src/shared/v2/world';

const still = { x: 0, y: 0 };
const left = { x: -1, y: 0 };
const size = { x: 120, y: 100 };

const apple: ItemType = {
  modelId: 'red',
  radius: 5,
  mass: 1,
  tetherable: true,
  food: { bites: 3, nutrition: 10 },
};
const pebble: ItemType = { modelId: 'gray', radius: 6, mass: 2, tetherable: true };
const berry: ItemType = {
  modelId: 'purple',
  radius: 4,
  mass: 1,
  tetherable: false,
  food: { bites: 2, nutrition: 5 },
};

function scene(typeId = 'test:food', x = 54): Scene {
  return {
    size,
    actor: { x: 24, y: 35 },
    obstacles: [],
    items: [{ id: 'sample', typeId, x, y: 35 }],
  };
}

test('registers independent combinations of food, body and tether capabilities', () => {
  const types = new Map<string, ItemType>([
    ['test:stone', pebble],
    ['test:food', berry],
  ]);
  const world = new World(
    {
      ...scene(),
      items: [...scene().items, { id: 'rock', typeId: 'test:stone', x: 44, y: 53 }],
    },
    types,
    0,
  );
  expect(world.act('eat', 'rock')).toBe('not-edible');
  expect(world.act('tether', 'rock')).toBe('attached');
  expect(world.act('tether', 'sample')).toBe('not-carryable');
  expect(world.act('eat', 'sample')).toBe('bite');
  expect(world.view().items.find(({ id }) => id === 'sample')?.bites).toBe(1);
  expect(world.act('eat', 'sample')).toBe('finished');
  expect(world.view().hunger).toBe(15);
  expect(world.view().tether).toBe('rock');
  expect(world.act('tether', 'sample')).toBe('missing');
});

test('tether moves the same body and release preserves its pose and speed', () => {
  const world = new World(scene(), new Map([['test:food', apple]]), 0);
  const initial = world.view();
  expect(world.act('tether', 'sample')).toBe('attached');
  world.step(still, 0);
  for (let step = 0; step < 30; step++) world.step(left, 0);
  const dragged = world.view().items[0];
  expect(dragged.id).toBe(initial.items[0].id);
  expect(dragged.body.x).toBeLessThan(initial.items[0].body.x);
  expect(dragged.body.vx).toBeLessThan(0);
  expect(world.act('eat', 'sample')).toBe('bite');
  expect(world.act('tether', 'sample')).toBe('released');
  expect(world.view().items[0].body).toEqual(dragged.body);
  expect(world.view().items[0].bites).toBe(1);
  world.step(still, 0);
  expect(world.view().items[0].body.x).toBeLessThan(dragged.body.x);
  expect(world.view().tether).toBeUndefined();
});

test('uses the registered clock and removes a tether with an expired body', () => {
  const types = new Map<string, ItemType>([
    ['test:real', { ...apple, lifetime: { clock: 'wall', seconds: 3 } }],
    ['test:food', { ...berry, lifetime: { clock: 'simulation', seconds: 3 * STEP } }],
  ]);
  const world = new World(
    {
      ...scene(),
      items: [...scene().items, { id: 'real', typeId: 'test:real', x: 30, y: 45 }],
    },
    types,
    1000,
  );
  expect(world.act('tether', 'real')).toBe('attached');
  world.step(still, 3900);
  expect(world.view().items).toHaveLength(2);
  world.step(still, 4000);
  expect(world.view().items.map(({ id }) => id)).toEqual(['sample']);
  expect(world.view().tether).toBeUndefined();
  world.step(still, 4000);
  expect(world.view().items).toHaveLength(0);
});

test('collision pushes a dynamic item and stops it at a static wall', () => {
  const world = new World(
    {
      ...scene('test:stone', 54),
      obstacles: [{ x: 82, y: 35, radius: 10, modelId: 'wall' }],
    },
    new Map([['test:stone', pebble]]),
    0,
  );
  for (let step = 0; step < 100; step++) world.step({ x: 1, y: 0 }, 0);
  const view = world.view();
  expect(view.items[0].body.x).toBeGreaterThan(62);
  expect(view.items[0].body.x).toBeLessThan(70);
  expect(view.actor.body.x).toBeLessThan(view.items[0].body.x);
  expect(view.obstacles[0].body.x).toBe(82);
});

test('rejects unreachable targets and invalid scene registrations', () => {
  const types = new Map([['test:food', apple]]);
  const far = scene('test:food', 100);
  const world = new World(far, types, 0);
  expect(world.act('eat', 'sample')).toBe('out-of-reach');
  expect(() => new World(far, new Map(), 0)).toThrow('Unregistered item type');
  expect(() => new World({ ...far, items: [...far.items, ...far.items] }, types, 0)).toThrow(
    'Duplicate item',
  );
});

test('separates coincident bodies and keeps fast bodies within both scene axes', () => {
  const a: Body = { x: 30, y: 30, radius: 5, vx: 0, vy: 0, drag: 0, inverseMass: 1 };
  const b = { ...a };
  const corner = { ...a, x: 110, y: 90, vx: 600, vy: 600 };
  solve([a, b, corner], size);
  expect(b.x - a.x).toBe(10);
  expect(corner).toMatchObject({ x: 115, y: 95, vx: 0, vy: 0 });
});

test('builds the island with its three registered types', () => {
  const world = new World(island, islandItems, 0);
  expect(world.view().items.map(({ modelId }) => modelId)).toEqual(['apple', 'pebble', 'berry']);
});
