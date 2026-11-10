import type { Clock, UnixMs, Vec3 } from './base';
import type { ActionExecutor, ActionWorld } from './module_Action';
import type { Entity } from './module_Entity';
import type { PhysicsSpace } from './module_Physics';
import type { WorldFrame } from './module_World';

/** 世界的实现负责在内部开启这个事务。 */
export interface StepTransaction extends ActionWorld {
  readonly physics: PhysicsSpace;
  readonly actions: ActionExecutor;
  readonly gravity: Vec3;
  /** 以稳定的顺序遍历生命周期处理和生成结束后仍在世界中的实体。 */
  entities(): readonly Entity[];
  /** 移除到期的物理体与约束，结束失效动作，并记录状态变化。 */
  reconcileExpiry(): void;
  /** 将符合条件的种群计时器推进一个固定步，并加入成功生成的实体。 */
  advancePopulations(): void;
  /** 为空闲行动者提出自主动作，与用户指令共用动作队列。 */
  offerAutonomy(): void;
  /** 所有效果应用完毕后，返回状态视图及本次更新的全部事件。 */
  publish(): WorldFrame;
}

export type BeginStep = (clock: Clock) => StepTransaction;

/** 世界步进示例。运行时负责提供事务及各系统的实现。 */
export function advance(previous: Clock, wallNowMs: UnixMs, dtSeconds: number, begin: BeginStep) {
  const world = begin({
    tick: previous.tick + 1,
    simSeconds: previous.simSeconds + dtSeconds,
    wallNowMs,
  });

  // 本步到期的物品会先被移除，本步内无法继续吃这一口或建立牵引。
  world.reconcileExpiry();
  world.advancePopulations();
  world.offerAutonomy();

  const motions = [...world.actions.plan(world)];
  for (const entity of world.entities()) {
    motions.push(...entity.tick(world.clock, dtSeconds, world.physics));
  }
  world.physics.solve(dtSeconds, world.gravity, motions);
  world.actions.settle(world);
  return world.publish();
}

export function reconcileWall(previous: Clock, wallNowMs: UnixMs, begin: BeginStep) {
  const world = begin({ ...previous, wallNowMs });
  world.reconcileExpiry();
  return world.publish();
}
