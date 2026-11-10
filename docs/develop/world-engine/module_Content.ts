import type { Pose, Registry, Tick, TypeId, UnixMs } from './base';
import type { BodySpec, PhysicsView, Terrain } from './module_Physics';

export interface FoodSpec {
  /** 从完整到吃完需要结算的口数。 */
  readonly bites: number;
  /** 吃完一口所需的模拟时间。 */
  readonly secondsPerBite: number;
  /** 每完成一口，由进食者应用这份营养。 */
  readonly nutritionPerBite: number;
}

export interface LifetimeSpec {
  /** 物品可选择设备的现实时间或实际推进的模拟时间。 */
  readonly clock: 'wall' | 'simulation';
  readonly lifetimeSeconds: number;
  /** 生命周期末尾的腐烂时长。这段时间内物品无法食用。 */
  readonly rottenSeconds: number;
}

export type Deadline =
  // 保存两个时间阈值。调整定义时，新的时长应用于之后创建的实例。
  | Readonly<{ clock: 'wall'; rotsAtMs: UnixMs; expiresAtMs: UnixMs }>
  | Readonly<{ clock: 'simulation'; rotsAtTick: Tick; expiresAtTick: Tick }>;

export interface ItemType {
  readonly id: TypeId;
  readonly body: BodySpec;
  /** 浏览器用这个 ID 从模型注册表查找外观。 */
  readonly modelId: TypeId;
  readonly tetherable: boolean;
  readonly food?: FoodSpec;
  readonly lifetime?: LifetimeSpec;
}

export interface PopulationRule {
  /** 生成规则独立于物品类型，世界可决定是否生成、在哪里生成。 */
  readonly id: TypeId;
  readonly itemTypeId: TypeId;
  /** 统计地面实例。被牵引的同类物品可以使总数超过此上限。 */
  readonly targetCount: number;
  /** 低于上限时，距离再次尝试生成所需的前台模拟秒数。 */
  readonly intervalSeconds: number;
  /** 已注册的放置规则，包含物体间距和可用地形的限制。 */
  readonly placementId: TypeId;
}

export interface PlacementPolicy {
  readonly id: TypeId;
  /** 使用与移动相同的地形和空间查询，提出一个可落地的位姿。 */
  pick(terrain: Terrain, physics: PhysicsView, random: () => number): Pose | undefined;
}

export interface ItemCatalog {
  readonly items: Registry<ItemType>;
  readonly populations: Registry<PopulationRule>;
  readonly placements: Registry<PlacementPolicy>;
}
