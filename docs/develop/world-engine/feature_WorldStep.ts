import type { Clock, UnixMs, Vec3 } from './base';
import type { ActionExecutor, ActionWorld } from './module_Action';
import type { Entity } from './module_Entity';
import type { PhysicsSpace } from './module_Physics';
import type { WorldFrame } from './module_World';

/** The implementation of World opens this transaction internally. */
export interface StepTransaction extends ActionWorld {
  readonly physics: PhysicsSpace;
  readonly actions: ActionExecutor;
  readonly gravity: Vec3;
  /** Visits a stable list of the entities present after lifecycle and spawning. */
  entities(): readonly Entity[];
  /** Remove expired bodies and constraints, invalidate actions, and record transitions. */
  reconcileExpiry(): void;
  /** Advance eligible population timers by one fixed step and add any successful spawns. */
  advancePopulations(): void;
  /** Offer work for idle actors using the same action queue as user commands. */
  offerAutonomy(): void;
  /** Return the projected state and all events, after every effect is applied. */
  publish(): WorldFrame;
}

export type BeginStep = (clock: Clock) => StepTransaction;

/** Reference flow. The runtime supplies the transaction and the individual systems. */
export function advance(previous: Clock, wallNowMs: UnixMs, dtSeconds: number, begin: BeginStep) {
  const world = begin({
    tick: previous.tick + 1,
    simSeconds: previous.simSeconds + dtSeconds,
    wallNowMs,
  });

  // An item expiring at this clock cannot finish a bite or start a tether in this step.
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
