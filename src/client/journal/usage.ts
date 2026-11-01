import type { LanguageModelUsage } from 'ai';
import { openSpiderDb, type UsageDay } from './db.js';
import { localDate } from './dates.js';

export interface UsageSnapshot {
  today: UsageDay;
  sum: UsageDay;
  /** Stored days, newest first. */
  days: UsageDay[];
}

/** Add one model call to the local day of `now`. Missing usage is ignored. */
export async function recordUsage(
  usage: LanguageModelUsage | null | undefined,
  now = new Date(),
): Promise<void> {
  const delta = deltaOf(usage);
  if (!delta) return;
  try {
    const db = await openSpiderDb();
    const date = localDate(now);
    const tx = db.transaction('usage', 'readwrite');
    const store = tx.store;
    const current = normalize(await store.get(date), date);
    await store.put(add(current, delta));
    await tx.done;
  } catch {
    // The conversation still stands when the ledger cannot be written.
  }
}

/** Today's row, the sum of every stored day, and those days newest first. */
export async function readUsage(today: string): Promise<UsageSnapshot> {
  const db = await openSpiderDb();
  const stored = await db.getAll('usage');
  const days = stored
    .map((day) => normalize(day, day.date))
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const sum = days.reduce(add, blankUsage(''));
  return { today: days.find((day) => day.date === today) ?? blankUsage(today), sum, days };
}

export function blankUsage(date: string): UsageDay {
  return { date, input: 0, output: 0, total: 0, calls: 0, cacheRead: 0, reasoning: 0 };
}

function deltaOf(usage: LanguageModelUsage | null | undefined): UsageDay | null {
  if (usage == null) return null;
  if (usage.inputTokens == null && usage.outputTokens == null && usage.totalTokens == null) {
    return null;
  }
  return {
    date: '',
    input: count(usage.inputTokens),
    output: count(usage.outputTokens),
    total: count(usage.totalTokens),
    calls: 1,
    cacheRead: count(usage.inputTokenDetails?.cacheReadTokens),
    reasoning: count(usage.outputTokenDetails?.reasoningTokens),
  };
}

function add(base: UsageDay, delta: UsageDay): UsageDay {
  return {
    date: base.date,
    input: base.input + delta.input,
    output: base.output + delta.output,
    total: base.total + delta.total,
    calls: base.calls + delta.calls,
    cacheRead: base.cacheRead + delta.cacheRead,
    reasoning: base.reasoning + delta.reasoning,
  };
}

function normalize(value: Partial<UsageDay> | undefined, date: string): UsageDay {
  return {
    date,
    input: count(value?.input),
    output: count(value?.output),
    total: count(value?.total),
    calls: count(value?.calls),
    cacheRead: count(value?.cacheRead),
    reasoning: count(value?.reasoning),
  };
}

const TOKEN_SUFFIX = ['', 'k', 'm', 'b'] as const;

/** Compact a token count: 999, 1.5k, 2m, 1.2b. */
export function formatTokens(value: number): string {
  let scaled = value;
  let unit = 0;
  while (scaled >= 1000 && unit < TOKEN_SUFFIX.length - 1) {
    scaled /= 1000;
    unit += 1;
  }
  if (unit === 0) return String(Math.trunc(scaled));
  let shown = Math.round(scaled * 10) / 10;
  if (shown >= 1000 && unit < TOKEN_SUFFIX.length - 1) {
    shown = Math.round((shown / 1000) * 10) / 10;
    unit += 1;
  }
  const text = Number.isInteger(shown) ? String(shown) : shown.toFixed(1);
  return `${text}${TOKEN_SUFFIX[unit]}`;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
