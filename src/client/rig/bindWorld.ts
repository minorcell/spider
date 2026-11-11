import { waterAt } from '@/src/shared/water';
import { kindOf, type KindSpec } from '@/src/shared/kinds';
import type { Block, EntityState, WorldState } from '@/src/shared/state';
import type { LegSphere } from '@/src/client/rig/legPose';
import type { Spider } from '@/src/client/rig/Spider';

export function bindLegWorld(spider: Spider, world: WorldState): void {
  const pool: LegSphere[] = [];
  const nearBlocks: Block[] = [];
  const supports: { entity: EntityState; surface: NonNullable<KindSpec['support']> }[] = [];
  spider.bindLegs(
    (into) => {
      let count = 0;
      supports.length = 0;
      nearBlocks.length = 0;
      const origin = spider.source.position;
      for (const block of world.blocks) {
        if (
          origin.x + 3.5 >= block.minX &&
          origin.x - 3.5 <= block.maxX &&
          origin.z + 3.5 >= block.minZ &&
          origin.z - 3.5 <= block.maxZ
        )
          nearBlocks.push(block);
      }
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
    () => nearBlocks,
    (block, x, z) => {
      const entity = world.entities.get(block.owner ?? block.id);
      const surface = entity && kindOf(entity.kind)?.support;
      return entity && surface ? surface(entity, x, z) : block.height;
    },
  );
}

export function bindWorld(spider: Spider, world: WorldState): void {
  bindLegWorld(spider, world);
  spider.bindGround((x, z) => world.terrain.height(x, z));
  spider.bindWater((x, z) => waterAt(world.terrain, x, z));
}
