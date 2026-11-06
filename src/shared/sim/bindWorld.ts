import { kindOf } from '../kinds.js';
import { nestSurface } from '../nestShape.js';
import type { WorldState } from '../state.js';
import type { LegSphere } from './legPose.js';
import type { Spider } from './Spider.js';

/** 腿要躲开的东西：会滚的圆身体，以及巢穴土丘。 */
export function bindLegWorld(spider: Spider, world: WorldState): void {
  const pool: LegSphere[] = [];
  let nest: { x: number; y: number; z: number } | null = null;
  spider.bindLegs(
    (into) => {
      let count = 0;
      nest = null;
      for (const entity of world.entities) {
        if (entity.kind === 'nest') nest = entity;
        const physics = kindOf(entity.kind)?.physics;
        if (!physics?.loose || physics.radius <= 0) continue;
        const slot = pool[count] ?? { x: 0, y: 0, z: 0, radius: 0 };
        pool[count] = slot;
        slot.x = entity.x;
        slot.y = entity.y + physics.radius;
        slot.z = entity.z;
        slot.radius = physics.radius;
        count += 1;
      }
      into.length = count;
      for (let i = 0; i < count; i++) into[i] = pool[i];
    },
    (x, z) => (nest ? nestSurface(nest, x, z) : Number.NEGATIVE_INFINITY),
  );
}
