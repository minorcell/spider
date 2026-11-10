/** Namespaced ID of a registered definition. */
export type TypeId = `${string}:${string}`;
/** Stable world instance ID. Never reused in a world, including after restore. */
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
  /** Number of committed simulation steps. */
  readonly tick: Tick;
  /** Active simulation seconds, including the fractional time from legacy saves. */
  readonly simSeconds: number;
  /** UTC epoch milliseconds sampled once by the browser for this update. */
  readonly wallNowMs: UnixMs;
}

/** Shared definitions are immutable once the world is constructed. */
export interface Registry<T> {
  get(id: TypeId): T | undefined;
}

export interface RegistryBuilder<T extends { readonly id: TypeId }> {
  /** Reject duplicate IDs and invalid configuration at bootstrap. */
  register(definition: T): void;
  /** Freeze registration and expose lookup to the world. */
  seal(): Registry<T>;
}
