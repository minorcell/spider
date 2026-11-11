import { bindController } from '@/src/shared/sim/bindController';
import { waterAt } from '@/src/shared/water';
import { kindOf, type KindSpec } from '@/src/shared/kinds';
import type { EntityState, WorldState } from '@/src/shared/state';
import type { LegSphere } from '@/src/shared/sim/legPose';
import type { Spider } from '@/src/shared/sim/Spider';

export function bindLegWorld(spider: Spider, world: WorldState): void {
  const pool: LegSphere[] = [];
  const supports: { entity: EntityState; surface: NonNullable<KindSpec['support']> }[] = [];
  spider.bindLegs(
    (into) => {
      let count = 0;
      supports.length = 0;
      for (const entity of world.entities.values()) {
        const spec = kindOf(entity.kind);
        if (spec?.support) supports.push({ entity, surface: spec.support });
        const physics = spec?.physics;
        if (!physics?.loose || !physics.solid || physics.radius <= 0) continue;
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
    (x, z) => {
      let height = Number.NEGATIVE_INFINITY;
      for (const { entity, surface } of supports) height = Math.max(height, surface(entity, x, z));
      return height;
    },
  );
}

export function bindWorld(spider: Spider, world: WorldState): void {
  bindLegWorld(spider, world);
  spider.bindGround((x, z) => world.terrain.height(x, z));
  spider.bindWater((x, z) => waterAt(world.terrain, x, z));
  bindController(spider.controller, world);
}
