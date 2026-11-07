import { LOCAL_MODEL } from './local/types.js';
import { openSpiderDb, type PreferenceRecord } from './journal/db.js';
import { providerById, providerNeedsKey } from './providers.js';
import { PersistentCache } from './store/cache.js';

const STORAGE_KEY = 'spider.pilot';
const OPEN_MS = 1500;

export interface PilotSettings {
  mode?: 'api' | 'local';
  provider: string;
  baseURL: string;
  model: string;
  apiKey: string;
  contextTokens: number | null;
  autoMemory: boolean;
  thinking: boolean;
}

export type PilotInput = {
  mode?: 'api' | 'local';
  provider?: string;
  baseURL: string;
  model: string;
  apiKey: string;
  contextTokens?: number | null;
  autoMemory?: boolean;
  thinking?: boolean;
};

const EMPTY: PilotSettings = {
  provider: 'custom',
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
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
    ...(parsed.mode === 'local' ? { mode: 'local' as const } : {}),
    provider: knownProvider(parsed.provider, 'custom'),
    baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
    model: typeof parsed.model === 'string' ? parsed.model : '',
    apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
    contextTokens: positiveInt(parsed.contextTokens),
    autoMemory: parsed.autoMemory === true,
    thinking: typeof parsed.thinking === 'boolean' ? parsed.thinking : true,
  };
}

function recordOf(raw: unknown): PilotRecord | null {
  const parsed = parsedValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Partial<PilotRecord>;
  if (record.id !== 'pilot' || !Number.isFinite(record.updatedAt)) return null;
  const value = parsePilot(record.value);
  return value ? { id: 'pilot', updatedAt: record.updatedAt as number, value } : null;
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
  if (!current) return { ...EMPTY };
  store.hydrate(current);
  return structuredClone(current.value);
}

export function writePilot(settings: PilotInput): void {
  const previous = readPilot();
  const next: PilotSettings = {
    ...((settings.mode ?? previous.mode) === 'local' ? { mode: 'local' as const } : {}),
    provider:
      settings.provider === undefined
        ? previous.provider
        : knownProvider(settings.provider, 'custom'),
    baseURL: settings.baseURL.trim().replace(/\/+$/, ''),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    contextTokens:
      settings.contextTokens === undefined
        ? previous.contextTokens
        : positiveInt(settings.contextTokens),
    autoMemory: settings.autoMemory ?? previous.autoMemory,
    thinking: settings.thinking ?? previous.thinking,
  };
  const store = pilotCache();
  edits += 1;
  const updatedAt = Math.max(Date.now(), (store.peek()?.updatedAt ?? 0) + 1);
  store.stage({ id: 'pilot', updatedAt, value: next });
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
    store.stage(chosen);
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

export function pilotReady(settings: PilotInput): boolean {
  return (
    settings.mode === 'local' ||
    (settings.baseURL !== '' &&
      settings.model !== '' &&
      (settings.apiKey !== '' || !providerNeedsKey(settings.provider)))
  );
}

export function reasoningOf(settings: PilotInput): 'provider-default' | 'none' {
  return settings.thinking === false ? 'none' : 'provider-default';
}

export function contextTokensOf(k: number | null): number | null {
  if (k == null) return null;
  return k * 1000;
}

function knownProvider(value: unknown, fallback: string): string {
  return typeof value === 'string' && providerById(value) !== null ? value : fallback;
}

function positiveInt(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

/** Keep local usage separate from the saved API model's account. */
export function modelIdOf(settings: PilotInput): string {
  return settings.mode === 'local' ? LOCAL_MODEL : settings.model;
}
