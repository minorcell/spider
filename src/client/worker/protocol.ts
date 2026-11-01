import type { LanguageModelUsage } from 'ai';
import type { WorldRecord } from '../../shared/sim/snapshot.js';
import type { PilotSettings } from '../settings.js';
import type { MemoryPage } from '../journal/db.js';
import type { MemoryView, MemoryWrite } from '../journal/diary.js';
import type { ChatSession, Trace } from '../journal/session.js';
import type { UsageSnapshot } from '../journal/usage.js';

/** The small, cloneable part of a Diary the page mirrors for synchronous reads. */
export interface JournalState {
  date: string;
  session: ChatSession;
  behind: boolean;
  dismissed: boolean;
}

export type JournalRequest =
  | { id: number; method: 'open' }
  | { id: number; method: 'state' }
  | { id: number; method: 'save' }
  | { id: number; method: 'record'; args: [string, string, Trace[], PilotSettings] }
  | { id: number; method: 'digest'; args: [PilotSettings] }
  | { id: number; method: 'backfill'; args: [PilotSettings] }
  | { id: number; method: 'indexBlock' }
  | { id: number; method: 'pages' }
  | { id: number; method: 'read'; args: [string] }
  | { id: number; method: 'write'; args: [MemoryWrite] }
  | { id: number; method: 'listLines' }
  | { id: number; method: 'dismiss'; args: [boolean] }
  | { id: number; method: 'recordUsage'; args: [LanguageModelUsage | null | undefined, number?] }
  | { id: number; method: 'readUsage'; args: [string] }
  | { id: number; method: 'snapshotRead' }
  | { id: number; method: 'snapshotPut'; args: [WorldRecord] }
  | { id: number; method: 'snapshotRemove' }
  | { id: number; method: 'snapshotSweep'; args: [string] };

export type JournalReply =
  | { id: number; ok: true; value: unknown }
  | { id: number; ok: false; error: string };

export interface JournalResultMap {
  open: JournalState;
  state: JournalState;
  save: JournalState;
  record: JournalState;
  digest: JournalState;
  backfill: JournalState;
  indexBlock: string;
  pages: MemoryPage[];
  read: MemoryView | null;
  write: MemoryView;
  listLines: Array<{ date: string; line: string }>;
  dismiss: JournalState;
  recordUsage: JournalState;
  readUsage: UsageSnapshot;
  snapshotRead: unknown;
  snapshotPut: null;
  snapshotRemove: null;
  snapshotSweep: null;
}
