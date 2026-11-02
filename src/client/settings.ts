/** Model credentials live in this browser only. Empty means hand driving. */

const STORAGE_KEY = 'spider.pilot';
const LEGACY_KEY = 'p5-art.pilot';

export interface PilotSettings {
  baseURL: string;
  model: string;
  apiKey: string;
  /** Model context window, in tokens. Null leaves the length unset. */
  contextTokens: number | null;
  /** When on, a full session may be summarized once it passes a size limit. */
  compact: boolean;
  /** Compact threshold in KB. Null uses the built-in 400 KB default. */
  compactKb: number | null;
  /** When on, a long idle stretch may write the day's conversation into the diary. */
  autoMemory: boolean;
}

export type PilotInput = {
  baseURL: string;
  model: string;
  apiKey: string;
  contextTokens?: number | null;
  compact?: boolean;
  compactKb?: number | null;
  autoMemory?: boolean;
};

const EMPTY: PilotSettings = {
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  compact: false,
  compactKb: null,
  autoMemory: false,
};

function readRaw(): string | null {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    if (current != null) {
      try {
        localStorage.removeItem(LEGACY_KEY);
      } catch {
        // The new key is the source. A blocked delete leaves the old copy.
      }
      return current;
    }
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy == null) return null;
    localStorage.setItem(STORAGE_KEY, legacy);
    localStorage.removeItem(LEGACY_KEY);
    return legacy;
  } catch {
    return null;
  }
}

export function readPilot(): PilotSettings {
  try {
    const raw = readRaw();
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<PilotSettings>;
    return {
      baseURL: typeof parsed.baseURL === 'string' ? parsed.baseURL : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      contextTokens: positiveInt(parsed.contextTokens),
      compact: parsed.compact === true,
      compactKb: positiveInt(parsed.compactKb),
      autoMemory: parsed.autoMemory === true,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function writePilot(settings: PilotInput): void {
  const next: PilotSettings = {
    baseURL: settings.baseURL.trim().replace(/\/+$/, ''),
    model: settings.model.trim(),
    apiKey: settings.apiKey.trim(),
    contextTokens: positiveInt(settings.contextTokens),
    compact: settings.compact === true,
    compactKb: positiveInt(settings.compactKb),
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

function positiveInt(value: unknown): number | null {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}
