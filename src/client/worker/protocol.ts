import type {
  LocalLoadOptions,
  LocalMessage,
  LocalOptions,
  LocalReply,
  LocalStatus,
} from '@/src/client/local/types';
import type { LanguageModelUsage, ModelMessage } from 'ai';
import type { WorldRecord } from '@/src/shared/sim/snapshot';
import type { PilotSettings } from '@/src/client/settings';
import type { MemoryPage } from '@/src/client/journal/db';
import type { MemoryView, MemoryWrite } from '@/src/client/journal/diary';
import type { ChatSession } from '@/src/client/journal/session';
import type {
  UsageCall,
  UsageCallMeta,
  UsageRange,
  UsageSnapshot,
} from '@/src/client/journal/usage';

export interface JournalState {
  date: string;
  session: ChatSession;
  behind: boolean;
  dismissed: boolean;
}

export type JournalRequest =
  | { id: number; method: 'localSession'; args: [string, boolean] }
  | { id: number; method: 'localLoad'; args: [LocalLoadOptions?] }
  | { id: number; method: 'localStatus' | 'localUnload' }
  | {
      id: number;
      method: 'localComplete';
      args: [string, LocalMessage[], LocalOptions?];
      stream?: boolean;
    }
  | { id: number; method: 'localCancel'; args: [string] }
  | { id: number; method: 'open' }
  | { id: number; method: 'save' }
  | { id: number; method: 'record'; args: [ModelMessage[], PilotSettings] }
  | { id: number; method: 'digest'; args: [PilotSettings] }
  | { id: number; method: 'backfill'; args: [PilotSettings] }
  | { id: number; method: 'pages' }
  | { id: number; method: 'read'; args: [string] }
  | { id: number; method: 'write'; args: [MemoryWrite] }
  | { id: number; method: 'dismiss'; args: [boolean] }
  | {
      id: number;
      method: 'recordUsage';
      args: [LanguageModelUsage | null | undefined, number?, UsageCallMeta?];
    }
  | { id: number; method: 'recordUsageCall'; args: [UsageCall] }
  | { id: number; method: 'recordUsageCalls'; args: [UsageCall[]] }
  | { id: number; method: 'readUsage'; args: [string, UsageRange?] }
  | { id: number; method: 'snapshotRead' }
  | { id: number; method: 'snapshotPut'; args: [WorldRecord] }
  | { id: number; method: 'snapshotRemove' }
  | { id: number; method: 'snapshotSweep'; args: [string] };

export type JournalReply =
  | { event: 'localActivity'; busy: boolean }
  | { event: 'localDelta'; id: number; text: string }
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export interface JournalResultMap {
  localSession: void;
  localLoad: void;
  localStatus: LocalStatus;
  localUnload: void;
  localComplete: LocalReply;
  localCancel: void;
  open: JournalState;
  save: JournalState;
  record: JournalState;
  digest: JournalState;
  backfill: JournalState;
  pages: MemoryPage[];
  read: MemoryView | null;
  write: MemoryView;
  dismiss: JournalState;
  recordUsage: null;
  recordUsageCall: null;
  recordUsageCalls: null;
  readUsage: UsageSnapshot;
  snapshotRead: unknown;
  snapshotPut: null;
  snapshotRemove: null;
  snapshotSweep: null;
}
