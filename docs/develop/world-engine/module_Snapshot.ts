import type { EntityId, Json, Mark, Tick, TypeId, UnixMs, Vec3 } from './base';
import type { BodyState, Tether } from './module_Physics';

export interface EntityRecord {
  readonly id: EntityId;
  readonly typeId: TypeId;
  /** 物理体的位姿和速度与实体行为数据分别保存。 */
  readonly body: BodyState;
  /** 已注册的类型在构造实体时校验这份数据。 */
  readonly data: Json;
}

export interface PopulationRecord {
  readonly ruleId: TypeId;
  /** 距离下次尝试生成还有多少前台模拟秒。 */
  readonly secondsUntilAttempt: number;
  /** 放置失败也递增尝试次数，避免恢复时重新抽取同一次尝试。 */
  readonly attempts: number;
}

export interface WorldSnapshot {
  /** 本地存档和云端存档封装内部的世界数据版本。 */
  readonly schema: 1;
  readonly seed: number;
  readonly tick: Tick;
  readonly simSeconds: number;
  readonly gravity: Vec3;
  /** 分配下一个实体 ID 的计数器。移除实体时也保留计数。 */
  readonly nextEntity: number;
  readonly controlledActor: EntityId;
  /** 地面物品和被牵引的物品共享这份列表。每个 ID 只出现一次。 */
  readonly entities: readonly EntityRecord[];
  readonly tethers: readonly Tether[];
  readonly populations: readonly PopulationRecord[];
  readonly marks: readonly Mark[];
}

/** 浏览器使用的元数据，与引擎快照分开保存。 */
export interface CheckpointPayload {
  readonly world: WorldSnapshot;
  /** 保留的文本用于现有的指令中断提示。 */
  readonly pending: Readonly<{ text: string; tool: string | null }> | null;
}

export type CheckpointError = 'empty' | 'malformed' | 'unsupported-format' | 'unknown-type';
export type DecodedCheckpoint =
  | Readonly<{ ok: true; checkpoint: CheckpointPayload }>
  | Readonly<{ ok: false; reason: CheckpointError }>;

export interface SnapshotCodec {
  /** 解码本地格式 3、4 和云端格式 1、2 中的世界数据。 */
  decode(raw: unknown, wallNowMs: UnixMs): DecodedCheckpoint;
  /** 将带版本的世界数据编码为 JSON 安全值。存储层负责外层封装。 */
  encode(checkpoint: CheckpointPayload): Json;
}
