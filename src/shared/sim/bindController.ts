import { moveCircle } from '@/src/shared/collision';
import { insideLand, WORLD_RADIUS } from '@/src/shared/terrain';
import { floatHeight, waterAt } from '@/src/shared/water';
import { kindOf } from '@/src/shared/kinds';
import type { WorldState } from '@/src/shared/state';
import type { Controller } from '@/src/shared/sim/controller';

export function bindController(controller: Controller, world: WorldState): void {
  controller.bindSupport((x, z) => {
    let height = Number.NEGATIVE_INFINITY;
    for (const entity of world.entities.values()) {
      const support = kindOf(entity.kind)?.support;
      if (support) height = Math.max(height, support(entity, x, z));
    }
    return height;
  });
  controller.bindGround((x, z) => world.terrain.height(x, z));
  controller.bindWater((x, z) => waterAt(world.terrain, x, z));
  controller.bindMotion((x, z, dx, dz) =>
    moveCircle(x, z, dx, dz, controller.radius, {
      blocks: world.blocks,
      inside: (px, pz) =>
        Math.hypot(px, pz) <= WORLD_RADIUS && insideLand(world.terrain, px, pz, controller.radius),
      surface: (px, pz) => {
        const water = waterAt(world.terrain, px, pz);
        const ground = world.terrain.height(px, pz);
        return water.depth > 0 ? Math.max(ground, floatHeight(water)) : ground;
      },
      maxSlope: controller.spec.maxSlope,
    }),
  );
}
