import type { LanguageModelUsage } from 'ai';
import type { MemoryPage } from '@/src/client/storage/db';
import type { ChatSession } from '@/src/client/journal/session';
import type { SnapshotStore } from '@/src/client/storage/snapshot';
import type {
  UsageCall,
  UsageCallMeta,
  UsageRange,
  UsageSnapshot,
} from '@/src/client/journal/usage';

export interface MemoryPatch {
  date: string;
  description?: string;
  noted?: string;
  summary?: string;
}

/** Structured-cloneable persistence operations; no callbacks or live database handles. */
export interface PersistenceRepository extends SnapshotStore {
  loadSession(date: string): Promise<ChatSession | undefined>;
  saveSession(session: ChatSession): Promise<void>;
  listMemories(): Promise<MemoryPage[]>;
  getMemory(date: string): Promise<MemoryPage | null>;
  patchMemory(patch: MemoryPatch): Promise<MemoryPage>;
  recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now?: Date,
    meta?: UsageCallMeta,
  ): Promise<void>;
  recordUsageCall(call: UsageCall): Promise<void>;
  recordUsageCalls(calls: UsageCall[]): Promise<void>;
  readUsage(today: string, range?: UsageRange): Promise<UsageSnapshot>;
}
