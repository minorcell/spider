import type { Clock, EntityId, Json, Registry, TypeId } from './base';
import type { Deadline, FoodSpec, ItemCatalog } from './module_Content';
import type { BodySpec, BodyState, Motion, PhysicsView } from './module_Physics';

export type Freshness = 'fresh' | 'rotten' | 'expired';

export interface DroppedItemData {
  /** 引用共享的物品类型定义。 */
  readonly itemTypeId: TypeId;
  /** 只记录已经结算的口数。中断一口的过程会保留这个值。 */
  readonly completedBites: number;
  /** 实例的时间阈值，在搬运和存档恢复时继续沿用。 */
  readonly deadline?: Deadline;
}

export interface FoodSource {
  readonly spec: FoodSpec;
  /** 动作执行器重新校验目标后，结算一口。 */
  bite(): Readonly<{ completedBites: number; nutrition: number; depleted: boolean }>;
}

export interface Metabolism {
  readonly hunger: number;
  /** 应用已经结算的一口营养。行动者负责将自身需求值限制在有效范围内。 */
  feed(nutrition: number): void;
}

export interface EntityView {
  readonly id: EntityId;
  readonly typeId: TypeId;
  readonly modelId: TypeId;
  /** 根据上次提交的物理状态生成。 */
  readonly body: BodyState;
  /** 渲染、感知与诊断共用这份状态。 */
  readonly item?: Readonly<{ itemTypeId: TypeId; completedBites: number; freshness: Freshness }>;
  readonly hunger?: number;
  readonly tetherable: boolean;
}

export interface Entity {
  readonly id: EntityId;
  readonly typeId: TypeId;
  /** 固定的物理定义。由世界负责更改位姿和速度。 */
  readonly bodySpec: BodySpec;
  readonly tetherable: boolean;
  readonly food?: FoodSource;
  readonly metabolism?: Metabolism;
  /** 过期处理、食用校验和只读视图使用同一个查询。 */
  freshnessAt?(clock: Clock): Freshness;
  /** 更新代谢等对象自有状态，并返回运动意图。 */
  tick(clock: Clock, dtSeconds: number, physics: PhysicsView): readonly Motion[];
  /** 生成独立的只读数据，对外只暴露数据投影。 */
  project(body: BodyState, clock: Clock): EntityView;
  /** 序列化实例自身的数据，物理状态和牵引关系分别保存。 */
  saveData(): Json;
}

export interface EntityType {
  readonly id: TypeId;
  /** 校验实例数据并构造运行时对象。 */
  create(id: EntityId, data: Json, catalog: ItemCatalog): Entity;
}

export interface ContentCatalog extends ItemCatalog {
  readonly entities: Registry<EntityType>;
}
