// @vitest-environment node
import { expect, it, vi } from 'vitest';

// A renderer dependency anywhere in the import graph makes this integration test fail.
vi.mock('three', () => {
  throw new Error('The simulation must not load Three.js');
});

it('creates, moves, interacts, collides and restores using only world data in Node', async () => {
  const { SimSession } = await import('@/src/shared/sim/session');
  const { captureBody, applyBody } = await import('@/src/shared/sim/snapshot');
  const { removeEntity } = await import('@/src/shared/world');
  const session = new SimSession(7);
  session.world.terrain = { height: () => 1 };
  session.world.blocks = [];
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.actor.entity.y = 1.01;
  const item = session.addEntity('pebble', 0, -0.8);
  const pickup = session.pickUp(item.id);
  for (let i = 0; i < 24; i++) session.frame(1 / 60);
  await expect(pickup).resolves.toMatchObject({ ok: true });
  expect(session.activity).toBeNull();
  const start = session.actor.position.z;
  const walk = session.walk(1);
  for (let i = 0; i < 180; i++) session.frame(1 / 60);
  await expect(walk).resolves.toMatchObject({ ok: true });
  expect(session.actor.position.z).toBeLessThan(start - 0.5);
  const obstacle = session.addEntity('tree', 3.5, 0);
  const wall = session.world.blocks.find((block) => (block.owner ?? block.id) === obstacle.id)!;
  Object.assign(item, { x: wall.minX - 0.23, z: 0, vx: 100, vy: 0, vz: 0 });
  session.frame(0.05);
  expect(item.x).toBeCloseTo(wall.minX - 0.19, 6);
  expect(item.vx).toBe(0);
  const saved = captureBody(session, null);
  expect(saved).not.toHaveProperty('pose');
  expect(session.snapshot().state).not.toHaveProperty('feet');
  const restored = new SimSession(8);
  applyBody(restored, saved);
  expect(restored.world.entities).toEqual(session.world.entities);
  expect(restored.world.tethers).toEqual(session.world.tethers);
  removeEntity(restored.world, restored.actor.entity);
  expect(restored.world.tethers.size).toBe(0);
  expect(restored.world.entities.get(item.id)).toBeDefined();
});
