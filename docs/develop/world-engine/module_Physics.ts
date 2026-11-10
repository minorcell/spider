import type { Bounds, EntityId, Pose, Vec3 } from './base';

export type LocalShape =
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'box'; halfExtents: Vec3 }>;

export interface Terrain {
  readonly seed: number;
  /** The existing continuous land surface, sampled in world units. */
  heightAt(x: number, z: number): number;
  /** Dry ground returns null. Water is sampled independently of solid ground. */
  waterAt(x: number, z: number): Readonly<{ surfaceY: number; depth: number }> | null;
  /** Land and boundary shapes overlapping the requested volume. */
  colliders(bounds: Bounds): Iterable<Collider>;
}

export interface LocalCollider {
  readonly shape: LocalShape;
  /** Offset from the body origin, including the apple sphere center above its base. */
  readonly offset: Vec3;
  readonly blocksMotion: boolean;
  readonly blocksSight: boolean;
}

export interface Collider extends Pick<LocalCollider, 'blocksMotion' | 'blocksSight'> {
  /** A terrain patch or the stable ID of an entity. */
  readonly owner: Readonly<{ kind: 'terrain' } | { kind: 'entity'; id: EntityId }>;
  readonly shape: LocalShape | Readonly<{ kind: 'heightfield'; terrain: Terrain }>;
  /** Shape pose in world space. */
  readonly pose: Pose;
}

export interface BodySpec {
  /** Static supports, dynamic bodies, and driven bodies share collision queries. */
  readonly motion: 'static' | 'dynamic' | 'driven';
  /** A body may have several shapes. Compound scenery still has one entity ID. */
  readonly colliders: readonly LocalCollider[];
  readonly gravityScale: number;
  /** Positive and required for dynamic bodies. */
  readonly mass?: number;
  readonly buoyancyVolume?: number;
}

export interface BodyState {
  /** Pose of the body origin, not the center of an individual collider. */
  readonly pose: Pose;
  /** Linear and angular velocities per simulation second. */
  readonly velocity: Vec3;
  readonly angularVelocity: Vec3;
}

export interface Tether {
  readonly carrier: EntityId;
  readonly target: EntityId;
  /** Local-space mount on the carrier body. */
  readonly anchor: Vec3;
  /** A taut tether adds tension. A slack tether adds none. */
  readonly restLength: number;
  readonly stiffness: number;
  readonly damping: number;
}

export type Motion =
  // Dynamic-body impulse integrates with gravity, contacts, and constraints.
  | Readonly<{ kind: 'impulse'; entity: EntityId; impulse: Vec3 }>
  // A controller's proposed pose goes through the same collision space.
  | Readonly<{ kind: 'drive'; entity: EntityId; proposed: Pose }>;

export interface MotionResult {
  readonly displacement: Vec3;
  readonly grounded: boolean;
  readonly blockers: readonly Collider['owner'][];
}

export interface PhysicsView {
  body(id: EntityId): BodyState | undefined;
  /** Contact information for the last solved simulation step. */
  motion(id: EntityId): MotionResult | undefined;
  /** Includes terrain and entity shapes. Callers apply purpose-specific filtering. */
  colliders(bounds: Bounds): Iterable<Collider>;
  tether(target: EntityId): Tether | undefined;
  tethers(): Iterable<Tether>;
}

/** The world owns this writer. The browser and entity behaviors receive read views. */
export interface PhysicsSpace extends PhysicsView {
  add(id: EntityId, spec: BodySpec, initial: BodyState): void;
  /** Removes the body. The world supplies detachments and corresponding events. */
  remove(id: EntityId): void;
  /** Add the sole tether for a target after the world validates both ends. */
  attach(tether: Tether): void;
  /** Detach while preserving the target's pose and velocity. */
  detach(target: EntityId): Tether | undefined;
  /** Solve placement against the same space. A rejected placement changes nothing. */
  place(target: EntityId, pose: Pose): boolean;
  /** Integrate gravity, controller input, tethers, buoyancy and contact together. */
  solve(dtSeconds: number, gravity: Vec3, motions: readonly Motion[]): void;
}
