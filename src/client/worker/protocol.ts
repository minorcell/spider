import type { ModelMessage } from 'ai';
import type { PilotSettings } from '@/src/client/settings';
import type { MemoryPage } from '@/src/client/storage/db';
import type { MemoryView, MemoryWrite } from '@/src/client/journal/diary';
import type { ChatSession } from '@/src/client/journal/session';

export interface JournalState {
  date: string;
  session: ChatSession;
  behind: boolean;
  dismissed: boolean;
}

// Bootstrap controls are independent of diary RPC and can also carry a storage port.
export type JournalControl =
  | { event: 'inferencePort'; port: MessagePort }
  | { event: 'inferenceFailure'; error: string }
  | { event: 'storagePort'; port: MessagePort }
  | { event: 'storageFailure'; error: string };

export type JournalRequest =
  | { id: number; method: 'open' }
  | { id: number; method: 'save' }
  | { id: number; method: 'record'; args: [ModelMessage[], PilotSettings] }
  | { id: number; method: 'digest'; args: [PilotSettings] }
  | { id: number; method: 'backfill'; args: [PilotSettings] }
  | { id: number; method: 'pages' }
  | { id: number; method: 'read'; args: [string] }
  | { id: number; method: 'write'; args: [MemoryWrite] }
  | { id: number; method: 'dismiss'; args: [boolean] };

export type JournalReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export interface JournalResultMap {
  open: JournalState;
  save: JournalState;
  record: JournalState;
  digest: JournalState;
  backfill: JournalState;
  pages: MemoryPage[];
  read: MemoryView | null;
  write: MemoryView;
  dismiss: JournalState;
}
