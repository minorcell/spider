import type { EntityId } from './base';
import type { ActionWorld, CommandId } from './module_Action';

interface Interaction {
  readonly command: CommandId;
  readonly actor: EntityId;
  readonly target: EntityId;
}

/** Called when the executor reaches a bite boundary, after physics. */
export function commitBite(world: ActionWorld, interaction: Interaction): void {
  const { command, actor: actorId, target: targetId } = interaction;
  const actor = world.entity(actorId);
  const target = world.entity(targetId);
  if (!actor || !target) {
    world.finish(command, { ok: false, reason: 'stale-target' });
    return;
  }

  const freshness = target.freshnessAt?.(world.clock) ?? 'fresh';
  if (freshness !== 'fresh') {
    world.finish(command, {
      ok: false,
      reason: freshness === 'rotten' ? 'spoiled' : 'stale-target',
    });
    return;
  }
  if (!actor.metabolism || !target.food) {
    world.finish(command, { ok: false, reason: 'not-edible' });
    return;
  }
  if (world.physics.tether(targetId)?.carrier !== actorId) {
    const reason = world.checkReach(actorId, targetId);
    if (reason) {
      world.finish(command, { ok: false, reason });
      return;
    }
  }

  const bite = target.food.bite();
  actor.metabolism.feed(bite.nutrition);
  world.emit({
    kind: 'bite',
    actor: actorId,
    target: targetId,
    completedBites: bite.completedBites,
  });
  if (!bite.depleted) return;

  // Retire the successful command before removal invalidates other references to the target.
  world.finish(command, {
    ok: true,
    detail: { kind: 'meal', target: targetId, completedBites: bite.completedBites, removed: true },
  });
  world.remove(targetId, 'eaten');
}

/** Release removes exactly one constraint. The next physics solve sees the original body. */
export function release(world: ActionWorld, interaction: Interaction): void {
  const { command, actor, target } = interaction;
  if (!world.entity(target)) {
    world.finish(command, { ok: false, reason: 'stale-target' });
    return;
  }
  if (world.physics.tether(target)?.carrier !== actor) {
    world.finish(command, { ok: false, reason: 'not-carrying' });
    return;
  }
  world.release(actor, target);
  world.finish(command, { ok: true });
}
