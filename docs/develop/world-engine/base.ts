/** 已注册定义的命名空间 ID。 */
export type TypeId = `${string}:${string}`;
/** 世界内稳定的实例 ID。从存档恢复后也沿用原 ID，已分配的 ID 不再复用。 */
export type EntityId = string;
export type Tick = number;
export type UnixMs = number;
export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type Rotation = Readonly<{ x: number; y: number; z: number; w: number }>;
export type Pose = Readonly<{ position: Vec3; rotation: Rotation }>;
export type Bounds = Readonly<{ min: Vec3; max: Vec3 }>;
export type Mark = Readonly<{ name: string; x: number; z: number; note?: string }>;
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface Clock {
  /** 已提交的模拟步数。 */
  readonly tick: Tick;
  /** 累计的模拟秒数，包含旧版存档保留的小数部分。 */
  readonly simSeconds: number;
  /** 浏览器为这次更新采样的 UTC Unix 时间戳，单位为毫秒。 */
  readonly wallNowMs: UnixMs;
}

/** 世界创建后，共享定义保持只读。 */
export interface Registry<T> {
  get(id: TypeId): T | undefined;
}

export interface RegistryBuilder<T extends { readonly id: TypeId }> {
  /** 启动时拒绝重复的 ID 和无效配置。 */
  register(definition: T): void;
  /** 锁定注册表，并向世界开放查询。 */
  seal(): Registry<T>;
}
