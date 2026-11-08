import type { LanguageModelUsage, ModelMessage } from 'ai';
import type { MemoryPage } from '@/src/client/storage/db';
import type { MemoryApi, MemoryView, MemoryWrite } from '@/src/client/journal/diary';
import type { ChatSession } from '@/src/client/journal/session';
import type { SnapshotStore } from '@/src/client/storage/snapshot';
import type {
  UsageCall,
  UsageCallMeta,
  UsageRange,
  UsageSnapshot,
} from '@/src/client/journal/usage';
import type { PilotSettings } from '@/src/client/settings';

export interface Journal {
  readonly date: string;
  session: ChatSession;
  dismissed: boolean;
  behind(): boolean;
  save(): Promise<void>;
  api(): MemoryApi;
  pages(): Promise<MemoryPage[]>;
  read(date: string): Promise<MemoryView | null>;
  write(input: MemoryWrite): Promise<MemoryView>;
  record(messages: ModelMessage[], settings: PilotSettings): Promise<void>;
  digest(settings: PilotSettings): Promise<void>;
  backfill(settings: PilotSettings): Promise<void>;
  recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now?: Date,
    meta?: UsageCallMeta,
  ): Promise<void>;
  recordUsageCall(call: UsageCall): Promise<void>;
  recordUsageCalls(calls: UsageCall[]): Promise<void>;
  readUsage(today: string, range?: UsageRange): Promise<UsageSnapshot>;
}

export interface OpenedJournal {
  journal: Journal;
  store: SnapshotStore;
}

export async function openJournal(): Promise<OpenedJournal> {
  if (typeof Worker !== 'undefined') {
    try {
      const { createWorkerJournal } = await import('@/src/client/worker/client');
      const journal = await createWorkerJournal();
      return { journal, store: journal };
    } catch {}
  }
  const [{ Diary }, { dbSnapshotStore }] = await Promise.all([
    import('@/src/client/journal/diary'),
    import('@/src/client/storage/snapshot'),
  ]);
  const [journal, store] = await Promise.all([Diary.open(), dbSnapshotStore()]);
  return { journal, store };
}
