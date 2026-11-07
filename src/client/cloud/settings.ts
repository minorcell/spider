import type { PreferenceRecord } from '../journal/db.js';
import { openSpiderDb } from '../journal/db.js';
import { PersistentCache } from '../store/cache.js';

const STORAGE_KEY = 'spider.cloud';
const OPEN_MS = 1500;

export interface CloudSettings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  ready: boolean;
}

export type CloudInput = Omit<CloudSettings, 'ready'>;

const EMPTY: CloudSettings = {
  endpoint: '',
  region: '',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  ready: false,
};

interface CloudRecord extends PreferenceRecord {
  id: 'cloud';
  value: CloudSettings;
}

let cache: PersistentCache<CloudRecord> | null = null;
let edits = 0;

function cloudCache(): PersistentCache<CloudRecord> {
  cache ??= new PersistentCache<CloudRecord>(
    {
      async read() {
        return (await openSpiderDb()).get('preferences', 'cloud');
      },
      async write(record) {
        await (await openSpiderDb()).put('preferences', record);
      },
    },
    {
      read: () => readStore(),
      write(record) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
        return true;
      },
    },
  );
  return cache;
}

function readStore(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parsedValue(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function parseSettings(raw: unknown): CloudSettings | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const parsed = raw as Partial<CloudSettings>;
  return {
    endpoint: typeof parsed.endpoint === 'string' ? parsed.endpoint : '',
    region: typeof parsed.region === 'string' ? parsed.region : '',
    bucket: typeof parsed.bucket === 'string' ? parsed.bucket : '',
    accessKeyId: typeof parsed.accessKeyId === 'string' ? parsed.accessKeyId : '',
    secretAccessKey: typeof parsed.secretAccessKey === 'string' ? parsed.secretAccessKey : '',
    ready: parsed.ready === true,
  };
}

function recordOf(raw: unknown): CloudRecord | null {
  const parsed = parsedValue(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Partial<CloudRecord>;
  if (record.id !== 'cloud' || !Number.isFinite(record.updatedAt)) return null;
  const value = parseSettings(record.value);
  return value ? { id: 'cloud', updatedAt: record.updatedAt as number, value } : null;
}

export function readCloud(): CloudSettings {
  const store = cloudCache();
  const cached = store.peek();
  if (cached) return structuredClone(cached.value);
  const current = recordOf(store.readRecovery());
  if (!current) return { ...EMPTY };
  store.hydrate(current);
  return structuredClone(current.value);
}

export function cloudReady(settings: CloudSettings = readCloud()): boolean {
  return settings.ready && cloudComplete(settings);
}

export function cloudComplete(settings: CloudInput): boolean {
  return (
    settings.endpoint !== '' &&
    settings.region !== '' &&
    settings.bucket !== '' &&
    settings.accessKeyId !== '' &&
    settings.secretAccessKey !== ''
  );
}

export function writeCloud(input: CloudInput, ready = false): CloudSettings {
  const previous = readCloud();
  const next: CloudSettings = {
    endpoint: input.endpoint.trim().replace(/\/+$/, ''),
    region: input.region.trim(),
    bucket: input.bucket.trim(),
    accessKeyId: input.accessKeyId.trim(),
    secretAccessKey: input.secretAccessKey.trim(),
    ready: false,
  };
  const same =
    next.endpoint === previous.endpoint &&
    next.region === previous.region &&
    next.bucket === previous.bucket &&
    next.accessKeyId === previous.accessKeyId &&
    next.secretAccessKey === previous.secretAccessKey;
  next.ready = same ? (ready ? cloudComplete(next) : previous.ready) : ready && cloudComplete(next);
  const store = cloudCache();
  edits += 1;
  const updatedAt = Math.max(Date.now(), (store.peek()?.updatedAt ?? 0) + 1);
  store.stage({ id: 'cloud', updatedAt, value: next });
  void store.flush().catch(() => undefined);
  return next;
}

export async function restoreCloud(): Promise<void> {
  readCloud();
  const store = cloudCache();
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

export function flushCloudSettings(): Promise<void> {
  return cloudCache().flush();
}

export function resetCloudSettings(): void {
  cache = null;
  edits = 0;
}
