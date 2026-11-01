import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ChatSession } from './session.js';

export interface MemoryPage {
  date: string;
  description: string;
  noted: string;
  summary: string;
  updatedAt: number;
}

interface SpiderDB extends DBSchema {
  sessions: { key: string; value: ChatSession };
  memories: { key: string; value: MemoryPage };
}

const DB_NAME = 'spider';
const DB_VERSION = 1;

let opening: Promise<IDBPDatabase<SpiderDB>> | null = null;

export function openSpiderDb(): Promise<IDBPDatabase<SpiderDB>> {
  opening ??= openDB<SpiderDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('sessions', { keyPath: 'date' });
      db.createObjectStore('memories', { keyPath: 'date' });
    },
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
