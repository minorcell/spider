import { blockedAt } from '@/src/shared/sight';
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
  const usable = (x: number, z: number): boolean =>
    Math.hypot(x, z) <= WORLD_RADIUS - 1 &&
    (!terrain.inside || terrain.inside(x, z, 1)) &&
    terrain.height(x, z) > TERRAIN.water &&
    !blockedAt(x, z, blocks);
  const home: Landmark = {
    name: '巢穴',
    x: 0,
    z: 0,
    ground: terrain.height(0, 0),
    note: '岛的中心，家',
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
  const length = Math.hypot(peak.x, peak.z);
  if (length < 1) return [home, top];
  const targetX = peak.x + (peak.x / length) * 6;
  const targetZ = peak.z + (peak.z / length) * 6;
  let rear: { x: number; z: number; score: number } | undefined;
  for (let x = Math.floor(targetX - 6); x <= targetX + 6; x++) {
    for (let z = Math.floor(targetZ - 6); z <= targetZ + 6; z++) {
      if ((x - peak.x) * peak.x + (z - peak.z) * peak.z <= 0 || !usable(x, z)) continue;
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
