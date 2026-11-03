/** Model credentials live in this browser only. Empty means hand driving. */

import { openSpiderDb, type PreferenceRecord } from './journal/db.js';
import { PersistentCache } from './store/cache.js';

const STORAGE_KEY = 'spider.pilot';
const LEGACY_KEY = 'p5-art.pilot';
const OPEN_MS = 1500;

export interface PilotSettings {
  baseURL: string;
  model: string;
  apiKey: string;
  /** Model context window in k token (×1000). Null leaves the length unset. */
  contextTokens: number | null;
  /** When on, a long idle stretch may write the day's conversation into the diary. */
  autoMemory: boolean;
}

export type PilotInput = {
  baseURL: string;
  model: string;
  apiKey: string;
  contextTokens?: number | null;
  autoMemory?: boolean;
};

const EMPTY: PilotSettings = {
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  autoMemory: false,
};

interface PilotRecord extends PreferenceRecord {
  id: 'pilot';
  value: PilotSettings;
}

let cache: PersistentCache<PilotRecord> | null = null;
let edits = 0;

function pilotCache(): PersistentCache<PilotRecord> {
  cache ??= new PersistentCache<PilotRecord>(
    {
      async read() {
        return (await openSpiderDb()).get('preferences', 'pilot');
      },
      async write(record) {
        await (await openSpiderDb()).put('preferences', record);
      },
    },
    {
      read: () => readStore(STORAGE_KEY),
      write(record) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        return true;
      },
    },
  );
  return cache;
}

function parsedValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parsePilot(raw: unknown): PilotSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = raw as Partial<PilotSettings>;
  return {
    baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    contextTokens: positiveInt(parsed.contextTokens),
    autoMemory: parsed.autoMemory === true,
  };
}

function recordOf(raw: unknown): PilotRecord | null {
  const parsed = parsedValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Partial<PilotRecord>;
  if ('id' in record) {
    if (record.id !== 'pilot' || !Number.isFinite(record.updatedAt)) return null;
    const value = parsePilot(record.value);
    return value ? { id: 'pilot', updatedAt: record.updatedAt as number, value } : null;
  }
  const value = parsePilot(parsed) as PilotSettings;
  return { id: 'pilot', updatedAt: 0, value };
}

function filled(settings: PilotSettings): boolean {
  return (
    settings.baseURL !== '' ||
    settings.model !== '' ||
    settings.apiKey !== '' ||
    settings.contextTokens != null ||
    settings.autoMemory
  );
}

function dropLegacy(): void {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // The new key is already the source.
  }
}

function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function readPilot(): PilotSettings {
  const store = pilotCache();
  const cached = store.peek();
  if (cached) return cached.value;
  const current = recordOf(store.readRecovery());
  if (current && (current.updatedAt > 0 || filled(current.value))) {
    store.hydrate(current);
    dropLegacy();
    return structuredClone(current.value);
  }
  const legacy = parsePilot(parsedValue(readStore(LEGACY_KEY)));
  if (legacy && filled(legacy)) {
    if (store.stage({ id: 'pilot', updatedAt: 0, value: legacy })) dropLegacy();
    return legacy;
  }
  if (current) {
    store.hydrate(current);
    return structuredClone(current.value);
  }
  return { ...EMPTY };
}

export function writePilot(settings: PilotInput): void {
  const previous = readPilot();
  const next: PilotSettings = {
    baseURL: settings.baseURL.trim().replace(/\/+$/, ''),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    contextTokens:
      settings.contextTokens === undefined
        ? previous.contextTokens
        : positiveInt(settings.contextTokens),
    autoMemory: settings.autoMemory ?? previous.autoMemory,
  };
  const store = pilotCache();
  edits += 1;
  const updatedAt = Math.max(Date.now(), (store.peek()?.updatedAt ?? 0) + 1);
  if (store.stage({ id: 'pilot', updatedAt, value: next })) dropLegacy();
  void store.flush().catch(() => undefined);
}

export async function restoreSettings(): Promise<void> {
  readPilot();
  const store = pilotCache();
  const initialEdits = edits;
  const restore = store.readPersistent().then(
    (raw) => recordOf(raw),
    () => null,
  );
  const loading = restore.then(async (saved) => {
    if (store !== cache || edits !== initialEdits) return;
    const current = store.peek();
    const chosen = saved && (!current || saved.updatedAt > current.updatedAt) ? saved : current;
    if (!chosen) return;
    if (store.stage(chosen)) dropLegacy();
    await store.flush().catch(() => undefined);
  });
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, OPEN_MS);
    void loading.finally(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function flushSettings(): Promise<void> {
  return pilotCache().flush();
}

export function resetPilotStore(): void {
  cache = null;
  edits = 0;
}

/** All three fields are required before the page will call a model. */
export function pilotReady(settings: PilotInput): boolean {
  return settings.baseURL !== '' && settings.model !== '' && settings.apiKey !== '';
}

/** Stored k token → tokens. Vendors count 8k as 8000, 128k as 128000. */
export function contextTokensOf(k: number | null): number | null {
  if (k == null) return null;
  return k * 1000;
}

function positiveInt(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}
