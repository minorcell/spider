import { kindOf } from '@/src/shared/kinds';
import type { EntityState, WorldState, WorldTime } from '@/src/shared/state';

export interface LifetimeSpec {
  clock: 'wall' | 'simulation';
  lifetimeSeconds: number;
  rottenSeconds: number;
}

/** Instance deadlines survive registration changes, carrying and partial meals. */
export type Deadline =
  | { clock: 'wall'; rotsAtMs: number; expiresAtMs: number }
  | { clock: 'simulation'; rotsAtSeconds: number; expiresAtSeconds: number };

export type Freshness = 'fresh' | 'rotten' | 'expired';

export interface MetabolismSpec {
  initialHunger: number;
  hungerPerSecond: number;
  maxHunger: number;
  forageAt: number;
}

export function deadlineAt(spec: LifetimeSpec, clock: WorldTime, ageSeconds = 0): Deadline {
  const remaining = spec.lifetimeSeconds - ageSeconds;
  if (spec.clock === 'wall') {
    const expiresAtMs = clock.wallNowMs + remaining * 1000;
    return { clock: 'wall', expiresAtMs, rotsAtMs: expiresAtMs - spec.rottenSeconds * 1000 };
  }
  const expiresAtSeconds = clock.simSeconds + remaining;
  return {
    clock: 'simulation',
    expiresAtSeconds,
    rotsAtSeconds: expiresAtSeconds - spec.rottenSeconds,
  };
}

export function freshnessOf(entity: EntityState, clock: WorldTime): Freshness {
  const deadline = entity.deadline;
  if (!deadline) return 'fresh';
  const [now, rotten, expired] =
    deadline.clock === 'wall'
      ? [clock.wallNowMs, deadline.rotsAtMs, deadline.expiresAtMs]
      : [clock.simSeconds, deadline.rotsAtSeconds, deadline.expiresAtSeconds];
  return now >= expired ? 'expired' : now >= rotten ? 'rotten' : 'fresh';
}

export function tickMetabolism(world: WorldState, dt: number): void {
  for (const entity of world.entities.values()) {
    const spec = kindOf(entity.kind)?.metabolism;
    if (!spec || !entity.metabolism) continue;
    entity.metabolism.hunger = Math.min(
      spec.maxHunger,
      entity.metabolism.hunger + spec.hungerPerSecond * dt,
    );
  }
}

export function nourish(entity: EntityState, nutrition: number): boolean {
  if (!kindOf(entity.kind)?.metabolism || !entity.metabolism) return false;
  entity.metabolism.hunger = Math.max(0, entity.metabolism.hunger - nutrition);
  return true;
}
