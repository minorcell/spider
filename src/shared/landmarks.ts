import { kindOf } from '@/src/shared/kinds';
import { blockedAt, BODY_RADIUS } from '@/src/shared/collision';
import { registeredFootprint } from '@/src/shared/registeredBodyMotion';
import { TERRAIN, WORLD_RADIUS } from '@/src/shared/terrain';
import type { WorldState } from '@/src/shared/state';

export interface Landmark {
  name: string;
  x: number;
  z: number;
  ground: number;
  note: string;
}

/** Built-in knowledge is derived from the current world, never stored as user marks. */
export function homeLandmarks(world: WorldState): Landmark[] {
  const { terrain, blocks } = world;
  const origin = [...world.entities.values()].find((entity) => kindOf(entity.kind)?.home);
  if (!origin) return [];
  const actor =
    world.controlledId === undefined ? undefined : world.entities.get(world.controlledId);
  const kind = actor && kindOf(actor.kind);
  const { radius } = registeredFootprint(
    kind?.control?.clearance ?? [],
    kind?.physics?.radius ?? BODY_RADIUS,
  );
  const usable = (x: number, z: number): boolean =>
    Math.hypot(x, z) <= WORLD_RADIUS - 1 &&
    (!terrain.inside || terrain.inside(x, z, 1)) &&
    terrain.height(x, z) > TERRAIN.water &&
    !blockedAt(x, z, blocks, radius);
  const home: Landmark = {
    name: kindOf(origin.kind)!.home!.landmark,
    x: origin.x,
    z: origin.z,
    ground: terrain.height(origin.x, origin.z),
    note: '家所在的位置',
  };
  let peak: { x: number; z: number; y: number } | undefined;
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      if (!usable(x, z)) continue;
      const y = terrain.height(x, z);
      if (!peak || y > peak.y) peak = { x, z, y };
    }
  }
  if (!peak) return [home];
  const top: Landmark = {
    name: '山顶',
    x: peak.x,
    z: peak.z,
    ground: peak.y,
    note: '岛上可站立的高处附近，不保证路线畅通',
  };
  const dx = peak.x - origin.x;
  const dz = peak.z - origin.z;
  const length = Math.hypot(dx, dz);
  if (length < 1) return [home, top];
  const targetX = peak.x + (dx / length) * 6;
  const targetZ = peak.z + (dz / length) * 6;
  let rear: { x: number; z: number; score: number } | undefined;
  for (let x = Math.floor(targetX - 6); x <= targetX + 6; x++) {
    for (let z = Math.floor(targetZ - 6); z <= targetZ + 6; z++) {
      if ((x - peak.x) * dx + (z - peak.z) * dz <= 0 || !usable(x, z)) continue;
      const score = Math.hypot(x - targetX, z - targetZ);
      if (!rear || score < rear.score) rear = { x, z, score };
    }
  }
  if (!rear) return [home, top];
  return [
    home,
    top,
    {
      name: '后山',
      x: rear.x,
      z: rear.z,
      ground: terrain.height(rear.x, rear.z),
      note: '山顶背离巢穴一侧的参考位置，不保证路线畅通',
    },
  ];
}
