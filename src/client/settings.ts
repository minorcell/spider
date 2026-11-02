/** Model credentials live in this browser only. Empty means hand driving. */

const STORAGE_KEY = 'spider.pilot';
const LEGACY_KEY = 'p5-art.pilot';

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

function parsePilot(raw: string | null): PilotSettings | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PilotSettings>;
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      contextTokens: positiveInt(parsed.contextTokens),
      autoMemory: parsed.autoMemory === true,
    };
  } catch {
    return null;
  }
}

function filled(settings: PilotSettings): boolean {
  return settings.baseURL !== '' || settings.model !== '' || settings.apiKey !== '';
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
  const current = parsePilot(readStore(STORAGE_KEY));
  if (current && filled(current)) {
    dropLegacy();
    return current;
  }
  const legacy = parsePilot(readStore(LEGACY_KEY));
  if (legacy && filled(legacy)) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
      dropLegacy();
    } catch {
      // Still return the migrated values this load.
    }
    return legacy;
  }
  if (current) return current;
  return { ...EMPTY };
}

export function writePilot(settings: PilotInput): void {
  const next: PilotSettings = {
    baseURL: settings.baseURL.trim().replace(/\/+$/, ''),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    contextTokens: positiveInt(settings.contextTokens),
    autoMemory: settings.autoMemory === true,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // The new key is already written.
  }
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
