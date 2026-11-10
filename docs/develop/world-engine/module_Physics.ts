import type { Bounds, EntityId, Pose, Vec3 } from './base';

export type LocalShape =
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'box'; halfExtents: Vec3 }>;

export interface Terrain {
  readonly seed: number;
  /** 现有连续地形表面，以世界单位采样。 */
  heightAt(x: number, z: number): number;
  /** 干燥地面返回 `null`。水面与固体地形分别采样。 */
  waterAt(x: number, z: number): Readonly<{ surfaceY: number; depth: number }> | null;
  /** 查询范围内的地面及边界形状。 */
  colliders(bounds: Bounds): Iterable<Collider>;
}

export interface LocalCollider {
  readonly shape: LocalShape;
  /** 相对物理体原点的偏移。例如苹果球形碰撞体的中心高于果底。 */
  readonly offset: Vec3;
  readonly blocksMotion: boolean;
  readonly blocksSight: boolean;
}

export interface Collider extends Pick<LocalCollider, 'blocksMotion' | 'blocksSight'> {
  /** 形状的来源可以是地形的一部分，也可以通过稳定 ID 对应一个实体。 */
  readonly owner: Readonly<{ kind: 'terrain' } | { kind: 'entity'; id: EntityId }>;
  readonly shape: LocalShape | Readonly<{ kind: 'heightfield'; terrain: Terrain }>;
  /** 形状在世界坐标下的位姿。 */
  readonly pose: Pose;
}

export interface BodySpec {
  /** 静态支撑物、动态物体和受控物体共用碰撞查询。 */
  readonly motion: 'static' | 'dynamic' | 'driven';
  /** 一个物理体可以包含多个形状。组合景物仍只占一个实体 ID。 */
  readonly colliders: readonly LocalCollider[];
  readonly gravityScale: number;
  /** 动态体必须指定正数质量。 */
  readonly mass?: number;
  readonly buoyancyVolume?: number;
}

export interface BodyState {
  /** 物理体原点的位姿，各碰撞形状的中心由局部偏移计算。 */
  readonly pose: Pose;
  /** 线速度和角速度均以每模拟秒计。 */
  readonly velocity: Vec3;
  readonly angularVelocity: Vec3;
}

export interface Tether {
  readonly carrier: EntityId;
  readonly target: EntityId;
  /** 挂点在牵引者物理体的局部坐标中。 */
  readonly anchor: Vec3;
  /** 绷紧时产生拉力，松弛时拉力为零。 */
  readonly restLength: number;
  readonly stiffness: number;
  readonly damping: number;
}

export type Motion =
  // 动态体的冲量与重力、接触和约束一并参与求解。
  | Readonly<{ kind: 'impulse'; entity: EntityId; impulse: Vec3 }>
  // 控制器提出的位姿也通过同一物理空间检查碰撞。
  | Readonly<{ kind: 'drive'; entity: EntityId; proposed: Pose }>;

export interface MotionResult {
  readonly displacement: Vec3;
  readonly grounded: boolean;
  readonly blockers: readonly Collider['owner'][];
}

export interface PhysicsView {
  body(id: EntityId): BodyState | undefined;
  /** 最近一个模拟步的接触结果。 */
  motion(id: EntityId): MotionResult | undefined;
  /** 查询结果包含地形和实体形状，调用方可按用途过滤。 */
  colliders(bounds: Bounds): Iterable<Collider>;
  tether(target: EntityId): Tether | undefined;
  tethers(): Iterable<Tether>;
}

/** 世界持有写接口，浏览器和实体行为使用只读视图。 */
export interface PhysicsSpace extends PhysicsView {
  add(id: EntityId, spec: BodySpec, initial: BodyState): void;
  /** 移除物理体。世界负责解除相关约束并发布事件。 */
  remove(id: EntityId): void;
  /** 世界校验两端后，为目标建立唯一一条牵引约束。 */
  attach(tether: Tether): void;
  /** 解除约束时保留目标的位姿和速度。 */
  detach(target: EntityId): Tether | undefined;
  /** 通过同一物理空间校验放置。拒绝放置时保持原状。 */
  place(target: EntityId, pose: Pose): boolean;
  /** 统一求解重力、控制输入、牵引、浮力和接触。 */
  solve(dtSeconds: number, gravity: Vec3, motions: readonly Motion[]): void;
}
