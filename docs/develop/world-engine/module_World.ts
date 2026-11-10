import type { Bounds, Clock, EntityId, Mark, TypeId, UnixMs, Vec3 } from './base';
import type { Command, CommandId, WorldEvent } from './module_Action';
import type { ContentCatalog, EntityView } from './module_Entity';
import type { PhysicsView, Terrain } from './module_Physics';
import type { WorldSnapshot } from './module_Snapshot';

export interface WorldView {
  readonly clock: Clock;
  readonly controlledActor: EntityId;
  /** 世界事务完成后，统一发布这份只读视图。 */
  readonly physics: PhysicsView;
  entity(id: EntityId): EntityView | undefined;
  entities(bounds?: Bounds): Iterable<EntityView>;
  marks(): readonly Mark[];
}

export interface WorldFrame {
  /** 本次事务全部变更提交后的只读状态。 */
  readonly view: WorldView;
  /** 按提交顺序排列的新事件。消费方对每帧只处理一次。 */
  readonly events: readonly WorldEvent[];
}

export interface WorldConfig {
  readonly terrain: Terrain;
  readonly gravity: Vec3;
  readonly populationIds: readonly TypeId[];
  readonly wallNowMs: UnixMs;
}

export type WorldRestoreResult =
  | Readonly<{ ok: true; world: World }>
  | Readonly<{ ok: false; reason: 'malformed' | 'unknown-type' }>;

export declare class World {
  /** 世界持有连续岛屿地形。地形形状也可从只读物理视图查询。 */
  readonly terrain: Terrain;
  readonly gravity: Vec3;
  /** 本方案采用固定步长，每步 1/60 秒。 */
  readonly stepSeconds: number;

  static create(config: WorldConfig, catalog: ContentCatalog): World;
  /** 构建独立的候选世界，并拒绝未知定义或无效关系。 */
  static restore(
    snapshot: WorldSnapshot,
    terrain: Terrain,
    catalog: ContentCatalog,
  ): WorldRestoreResult;

  /** 暂停时仍可读取上次提交的视图。 */
  view(): WorldView;
  submit(command: Command): CommandId;
  /** 用户指令处理期间保留行动者的控制权，必要时结束正在进行的自主命令。 */
  setAutonomyAllowed(actor: EntityId, allowed: boolean): WorldFrame;
  /** 取消动作时保持两套游戏时钟及物理状态的原有进度。 */
  cancel(command: CommandId): WorldFrame;
  /** 名称无效、重名或标记列表已满时返回 `false`。 */
  addMark(mark: Mark): boolean;
  removeMark(name: string): boolean;
  /** 用宿主传入的设备时间执行一个完整的固定步。 */
  step(wallNowMs: UnixMs): WorldFrame;
  /** 按现实时间处理到期物品，身体需求、种群和物理保持原有进度。 */
  reconcileWallTime(wallNowMs: UnixMs): WorldFrame;
  /** 捕获独立的快照数据。动作等待状态和订阅由宿主管理。 */
  snapshot(): WorldSnapshot;
}
