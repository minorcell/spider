import type { EntityId } from './base';
import type { ActionWorld, CommandId } from './module_Action';

interface Interaction {
  readonly command: CommandId;
  readonly actor: EntityId;
  readonly target: EntityId;
}

/** 物理求解完成后，动作执行器在一口到达结算时点时调用。 */
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

  // 先将当前命令标记为成功，再移除目标。移除时会让其他引用该目标的命令失效。
  world.finish(command, {
    ok: true,
    detail: { kind: 'meal', target: targetId, completedBites: bite.completedBites, removed: true },
  });
  world.remove(targetId, 'eaten');
}

/** 松手只解除这一条约束。下一次物理求解继续使用原物理体。 */
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
