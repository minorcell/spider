import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { WorldRecord } from '../../shared/sim/snapshot.js';
import type { ChatSession } from './session.js';

export interface MemoryPage {
  date: string;
  description: string;
  noted: string;
  summary: string;
  updatedAt: number;
}

export interface PreferenceRecord {
  id: string;
  updatedAt: number;
  value: unknown;
}

/** One local day's model usage. `total` is input plus output, as the provider reported it. */
export interface UsageDay {
  date: string;
  input: number;
  output: number;
  total: number;
  calls: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning: number;
  textTokens: number;
  toolCalls: number;
}

export type UsageKind = 'agent' | 'summary';

export interface UsageTool {
  id: string;
  name: string;
  ok: boolean;
  durationMs: number;
  inputBytes: number;
  outputBytes: number;
}

/** One model step. `id` is callId plus step number so a turn with several steps does not overwrite. */
export interface UsageCall {
  id: string;
  ts: number;
  date: string;
  kind: UsageKind;
  sessionId: string;
  turnId: string;
  step: number;
  provider: string;
  modelId: string;
  total: number;
  input: {
    total: number;
    noCache: number;
    cacheRead: number;
    cacheWrite: number;
  };
  output: { total: number; text: number; reasoning: number };
  tools: UsageTool[];
  timing: { ttftMs?: number; responseMs?: number; stepMs?: number };
  finishReason: string;
  /** Requests this row stands for. Absent means one; legacy day rows can stand for several. */
  count?: number;
  /** Tool calls in a legacy day row, which has no per-tool detail. */
  toolCalls?: number;
}

interface SpiderDB extends DBSchema {
  sessions: { key: string; value: ChatSession };
  memories: { key: string; value: MemoryPage };
  usage: { key: string; value: UsageDay };
  usageCalls: { key: string; value: UsageCall; indexes: { date: string } };
  snapshots: { key: string; value: WorldRecord };
  preferences: { key: string; value: PreferenceRecord };
}

const DB_NAME = 'spider';
const DB_VERSION = 6;

let opening: Promise<IDBPDatabase<SpiderDB>> | null = null;

export function openSpiderDb(): Promise<IDBPDatabase<SpiderDB>> {
  if (opening) return opening;
  const connection = openDB<SpiderDB>(DB_NAME, DB_VERSION, {
    upgrade(db, _oldVersion, _newVersion, transaction) {
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('memories')) {
        db.createObjectStore('memories', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('usage')) {
        db.createObjectStore('usage', { keyPath: 'date' });
      }
      if (!db.objectStoreNames.contains('usageCalls')) {
        const calls = db.createObjectStore('usageCalls', { keyPath: 'id' });
        calls.createIndex('date', 'date');
      } else {
        const calls = transaction.objectStore('usageCalls');
        if (!calls.indexNames.contains('date')) calls.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'id' });
      }
    },
    blocking() {
      void connection.then((db) => db.close());
      opening = null;
    },
    terminated() {
      opening = null;
    },
  });
  opening = connection.catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

export function blankMemory(date: string): MemoryPage {
  return { date, description: '', noted: '', summary: '', updatedAt: 0 };
}

/** Close and delete the database. Tests use this between cases. */
export async function resetSpiderDb(): Promise<void> {
  if (opening) {
    const db = await opening;
    db.close();
    opening = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('delete failed'));
    request.onblocked = () => resolve();
  });
}
