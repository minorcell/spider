import type { TetherRelation, WorldState, WorldTime } from '@/src/shared/state';
import { captureWorldView, type WorldView } from '@/src/shared/worldView';

export type RemovalCause = 'expired' | 'eaten' | 'despawned';
export type ReleaseCause = 'released' | 'placed' | 'removed';

export type WorldChange =
  | Readonly<{ kind: 'spawned'; entity: string }>
  | Readonly<{ kind: 'removed'; entity: string; cause: RemovalCause; actor?: string }>
  | Readonly<{ kind: 'freshnessChanged'; entity: string; to: 'fresh' | 'rotten' }>
  | Readonly<{
      kind: 'bite';
      actor: string;
      target: string;
      completedBites: number;
      nutrition: number;
    }>
  | Readonly<{
      kind: 'tetherChanged';
      tether: Readonly<TetherRelation>;
      attached: boolean;
      cause?: ReleaseCause;
    }>
  | Readonly<{ kind: 'blocked'; actor: string; by: 'solid' | 'steep' }>
  | Readonly<{ kind: 'lampChanged'; actor: string; on: boolean }>
  | Readonly<{ kind: 'marksChanged' }>
  | Readonly<{ kind: 'restored' }>;

/** An immutable receipt for one completed mutation batch, independent of rendering. */
export interface WorldCommit {
  readonly revision: number;
  readonly clock: Readonly<WorldTime>;
  readonly controlledId?: string;
  readonly events: readonly WorldChange[];
  readonly view: WorldView;
}

type Listener = (commit: WorldCommit) => void;
interface Journal {
  depth: number;
  revision: number;
  pending: WorldChange[];
  listeners: Set<Listener>;
  deliveries: WorldCommit[];
  delivering: boolean;
}

// Delivery cursors are session-local, never saved or replayed after a restore.
const journals = new WeakMap<WorldState, Journal>();

function journalFor(world: WorldState): Journal {
  let journal = journals.get(world);
  if (!journal) {
    journal = {
      depth: 0,
      revision: 0,
      pending: [],
      listeners: new Set(),
      deliveries: [],
      delivering: false,
    };
    journals.set(world, journal);
  }
  return journal;
}

export function onWorldCommit(world: WorldState, listen: Listener): () => void {
  const journal = journalFor(world);
  journal.listeners.add(listen);
  return () => journal.listeners.delete(listen);
}

/** Nested rules publish together only after their enclosing world update finishes. */
export function batchWorldChanges<T>(world: WorldState, update: () => T): T {
  const journal = journalFor(world);
  journal.depth++;
  try {
    return update();
  } finally {
    journal.depth--;
    publish(world, journal);
  }
}

export function recordWorldChange(world: WorldState, event: WorldChange): void {
  const journal = journalFor(world);
  journal.pending.push(
    Object.freeze(
      event.kind === 'tetherChanged'
        ? { ...event, tether: Object.freeze({ ...event.tether }) }
        : { ...event },
    ),
  );
  publish(world, journal);
}

function publish(world: WorldState, journal: Journal): void {
  if (journal.depth > 0 || journal.pending.length === 0) return;
  const events = Object.freeze(journal.pending);
  journal.pending = [];
  const revision = ++journal.revision;
  if (journal.listeners.size === 0) return;
  const view = captureWorldView(world);
  const commit: WorldCommit = Object.freeze({
    revision,
    clock: view.clock,
    controlledId: view.controlledId,
    events,
    view,
  });
  journal.deliveries.push(commit);
  if (journal.delivering) return;
  journal.delivering = true;
  try {
    // A subscriber may request another mutation. All readers receive this receipt first.
    while (journal.deliveries.length > 0) {
      const next = journal.deliveries.shift()!;
      for (const listen of Array.from(journal.listeners)) {
        try {
          listen(next);
        } catch (error) {
          // A failed effect must not interrupt physics, other readers or tool completion.
          console.error('World commit subscriber failed', error);
        }
      }
    }
  } finally {
    journal.delivering = false;
  }
}
