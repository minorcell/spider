import type { Clock, EntityId, Vec3 } from './base';
import type { Entity } from './module_Entity';
import type { Motion, PhysicsView, Tether } from './module_Physics';

export type CommandId = string;
export type RemovalCause = 'expired' | 'eaten' | 'despawned';

export type Action =
  | Readonly<{ kind: 'moveTo'; position: Vec3; fast?: boolean }>
  | Readonly<{ kind: 'approach'; target: EntityId; standoff?: number; fast?: boolean }>
  | Readonly<{ kind: 'walk'; distance: number; fast?: boolean }>
  | Readonly<{ kind: 'turn'; degrees: number; relative: boolean }>
  | Readonly<{ kind: 'setHeight'; height: number }>
  | Readonly<{ kind: 'setLamp'; on: boolean }>
  // `release` 只解除约束。`drop` 和 `store` 沿用现有工具的放置行为。
  | Readonly<{ kind: 'eat' | 'tether' | 'release' | 'drop' | 'store'; target: EntityId }>
  | Readonly<{ kind: 'drink' | 'sleep' }>;

export interface Command {
  readonly actor: EntityId;
  /** 用户指令可以取代同一行动者正在执行的自主动作。 */
  readonly source: 'user' | 'autonomous';
  readonly action: Action;
}

export type Failure =
  | 'cancelled'
  | 'stale-target'
  | 'out-of-reach'
  | 'blocked'
  | 'steep'
  | 'no-path'
  | 'spoiled'
  | 'not-edible'
  | 'not-carryable'
  | 'not-carrying'
  | 'not-home'
  | 'no-room'
  | 'no-water'
  | 'full'
  | 'timeout'
  | 'invalid';

export type ActionDetail =
  | Readonly<{ kind: 'navigation'; position: Vec3; around: readonly EntityId[] }>
  | Readonly<{ kind: 'meal'; target: EntityId; completedBites: number; removed: boolean }>;

export type Outcome =
  | Readonly<{ ok: true; detail?: ActionDetail }>
  | Readonly<{ ok: false; reason: Failure; detail?: ActionDetail }>;

export type WorldEvent =
  | Readonly<{ kind: 'freshnessChanged'; entity: EntityId; to: 'rotten' }>
  | Readonly<{ kind: 'bite'; actor: EntityId; target: EntityId; completedBites: number }>
  | Readonly<{ kind: 'tetherChanged'; tether: Tether; attached: boolean }>
  | Readonly<{ kind: 'removed'; entity: EntityId; cause: RemovalCause }>
  // 每条已受理指令只产生一个终态事件，取消和到期也一样。
  | Readonly<{ kind: 'actionFinished'; command: CommandId; outcome: Outcome }>;

export interface ActionWorld {
  readonly clock: Clock;
  readonly physics: PhysicsView;
  /** 仅在世界事务内部提供这个能力。 */
  entity(id: EntityId): Entity | undefined;
  /** 沿用观察所用的竖直触及范围与遮挡规则。 */
  checkReach(actor: EntityId, target: EntityId): 'out-of-reach' | 'blocked' | undefined;
  /** 建立牵引前，校验容量、可达性、目标是否仍存在，以及它是否已被牵引。 */
  attach(carrier: EntityId, target: EntityId): Failure | undefined;
  release(carrier: EntityId, target: EntityId): void;
  /** 先校验目的地，通过后才修改物理体位姿并解除牵引。 */
  place(carrier: EntityId, target: EntityId, destination: 'ahead' | 'home'): Failure | undefined;
  /** 清除物理体、关联关系，以及引用该 ID 的未完成指令。 */
  remove(target: EntityId, cause: RemovalCause): void;
  /** 记录本次事务中已经发生的事件。 */
  emit(event: WorldEvent): void;
  /** 立即结束命令，并将唯一的终态事件入队。 */
  finish(command: CommandId, outcome: Outcome): void;
}

export interface ActionExecutor {
  /** 保存命令并分配回执 ID。世界决定何时推进动作。 */
  submit(command: Command): CommandId;
  /** 在当前世界事务中结算取消，模拟暂停时也可以执行。 */
  cancel(id: CommandId, world: ActionWorld): void;
  /** 对指令进行仲裁，并为本模拟步生成控制器输入。 */
  plan(world: ActionWorld): readonly Motion[];
  /** 根据运动求解结果，只完成效果已经提交的动作。 */
  settle(world: ActionWorld): void;
  /** 结束依赖已移除行动者或目标的未完成命令。 */
  invalidate(entity: EntityId, world: ActionWorld): void;
}
