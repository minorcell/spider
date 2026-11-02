import type { LanguageModelUsage } from 'ai';
import type { MemoryPage } from './db.js';
import type { MemoryApi, MemoryView, MemoryWrite } from './diary.js';
import type { ChatSession, Trace } from './session.js';
import type { SnapshotStore } from './store.js';
import type { UsageSnapshot } from './usage.js';
import type { PilotSettings } from '../settings.js';

/** What the panel needs from today's conversation and the diary. */
export interface Journal {
  readonly date: string;
  session: ChatSession;
  dismissed: boolean;
  behind(): boolean;
  save(): Promise<void>;
  indexBlock(): Promise<string>;
  api(): MemoryApi;
  pages(): Promise<MemoryPage[]>;
  read(date: string): Promise<MemoryView | null>;
  write(input: MemoryWrite): Promise<MemoryView>;
  record(user: string, assistant: string, tools: Trace[], settings: PilotSettings): Promise<void>;
  digest(settings: PilotSettings): Promise<void>;
  backfill(settings: PilotSettings): Promise<void>;
  recordUsage(usage: LanguageModelUsage | null | undefined, now?: Date): Promise<void>;
  readUsage(today: string): Promise<UsageSnapshot>;
}

export interface OpenedJournal {
  journal: Journal;
  store: SnapshotStore;
}

/**
 * Modern pages run the journal and its IndexedDB work in a Worker. Tests and
 * browsers without module Workers keep the direct implementation. The fallback
 * is imported lazily, so the Worker bundle stays off the main path.
 */
export async function openJournal(): Promise<OpenedJournal> {
  if (typeof Worker !== 'undefined') {
    try {
      const { createWorkerJournal } = await import('../worker/client.js');
      const journal = await createWorkerJournal();
      return { journal, store: journal };
    } catch {
      // Module workers can be unavailable despite the global existing (CSP,
      // older browsers, or a failed startup). Keep the direct implementation
      // as the documented fallback instead of silently losing the journal.
    }
  }
  const [{ Diary }, { dbSnapshotStore }] = await Promise.all([
    import('./diary.js'),
    import('./store.js'),
  ]);
  const [journal, store] = await Promise.all([Diary.open(), dbSnapshotStore()]);
  return { journal, store };
}
