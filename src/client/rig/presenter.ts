import { kindOf } from '@/src/shared/kinds';
import type { EntityState, WorldState } from '@/src/shared/state';
import type { SimSession } from '@/src/shared/sim/session';
import type { Controller } from '@/src/shared/sim/controller';
import { Spider } from './Spider';
import { bindWorld } from './bindWorld';

export const ACTOR_RIGS: Record<string, (source: Controller) => Spider> = {
  spider: (source) => new Spider(source),
};

/** Browser-owned animation. The session can run and restore without ever constructing this. */
export class ActorPresenter {
  readonly model: Spider;
  #entity: EntityState | null = null;
  #terrain: WorldState['terrain'] | null = null;

  constructor(readonly session: SimSession) {
    const rig = kindOf(session.actor.entity.kind)?.rig;
    const build = rig && Object.hasOwn(ACTOR_RIGS, rig) ? ACTOR_RIGS[rig] : undefined;
    if (!build) throw new Error(`No registered actor rig for ${session.actor.entity.kind}`);
    this.model = build(session.actor);
    this.sync(0);
  }

  sync(dt: number): void {
    const { actor, world, activity, input } = this.session;
    const alive =
      world.controlledId === actor.entity.id &&
      world.entities.get(actor.entity.id) === actor.entity;
    this.model.root.visible = this.model.rig.visible = alive;
    if (!alive) {
      this.model.setInteraction(null);
      return;
    }
    if (this.#entity !== actor.entity || this.#terrain !== world.terrain) {
      this.#entity = actor.entity;
      this.#terrain = world.terrain;
      bindWorld(this.model, world);
    }
    this.model.setInteraction(activity ? (world.entities.get(activity.targetId) ?? null) : null);
    this.model.present(dt, input);
  }

  step(dt: number, wallNowMs?: number): void {
    this.session.frame(dt, wallNowMs);
    this.sync(dt);
  }
}
