import { moveRegisteredBody, turnRegisteredBody } from '@/src/shared/registeredBodyMotion';
import { insideLand, WORLD_RADIUS } from '@/src/shared/terrain';
import { waterAt } from '@/src/shared/water';
import { kindOf } from '@/src/shared/kinds';
import type { Block, WorldState } from '@/src/shared/state';
import type { MotionSpace } from '@/src/shared/collision';
import type { Controller } from '@/src/shared/sim/controller';

export type ActorSpace = Required<Pick<MotionSpace, 'blocks' | 'surface' | 'maxSlope'>> & {
  insideRadius: (x: number, z: number, radius: number) => boolean;
};

export function bindController(controller: Controller, world: WorldState): void {
  let source: readonly Block[] | undefined;
  let count = 0;
  let terrain: WorldState['terrain'] | undefined;
  let spec: Controller['spec'] | undefined;
  const steps = new Set<string>();
  const motion: ActorSpace = {
    blocks: [],
    insideRadius: (x, z, radius) =>
      Math.hypot(x, z) <= WORLD_RADIUS - radius && insideLand(world.terrain, x, z, radius),
    surface: (x, z) => controller.travel(x, z),
    maxSlope: controller.spec.maxSlope,
  };
  const space = (): ActorSpace => {
    if (
      source !== world.blocks ||
      count !== world.blocks.length ||
      terrain !== world.terrain ||
      spec !== controller.spec
    ) {
      source = world.blocks;
      count = source.length;
      terrain = world.terrain;
      spec = controller.spec;
      steps.clear();
      const tooHigh = new Set<string>();
      if (spec.stepHeight) {
        for (const block of source) {
          const owner = block.owner ?? block.id;
          const entity = world.entities.get(owner);
          const kind = entity && kindOf(entity.kind);
          if (!entity || !kind?.walkable || !kind.support || tooHigh.has(owner)) continue;
          if (block.height - controller.travel(entity.x, entity.z) <= spec.stepHeight)
            steps.add(owner);
          else {
            steps.delete(owner);
            tooHigh.add(owner);
          }
        }
      }
      motion.blocks = steps.size
        ? source.filter((block) => !steps.has(block.owner ?? block.id))
        : source;
      motion.maxSlope = spec.maxSlope;
    }
    return motion;
  };
  controller.bindSupport((x, z) => {
    let height = Number.NEGATIVE_INFINITY;
    for (const entity of world.entities.values()) {
      const support = kindOf(entity.kind)?.support;
      if (support) height = Math.max(height, support(entity, x, z));
    }
    return height;
  });
  controller.bindStepSupport((x, z) => {
    space();
    let height = Number.NEGATIVE_INFINITY;
    for (const id of steps) {
      const entity = world.entities.get(id)!;
      height = Math.max(height, kindOf(entity.kind)!.support!(entity, x, z));
    }
    return height;
  });
  controller.bindGround((x, z) => world.terrain.height(x, z));
  controller.bindWater((x, z) => waterAt(world.terrain, x, z));
  controller.bindTurn((from, to) =>
    turnRegisteredBody(
      controller.position,
      from,
      to,
      controller.spec.clearance,
      space().blocks,
      controller.radius,
    ),
  );
  controller.bindMotion((x, z, dx, dz) =>
    moveRegisteredBody(
      { x, y: controller.position.y, z },
      controller.yaw,
      controller.spec.clearance,
      dx,
      dz,
      space(),
      controller.radius,
    ),
  );
  controller.motionSpace = space;
}
