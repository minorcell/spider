import type { LanguageModelUsage, ModelMessage } from 'ai';
import { contextTokensOf, modelIdOf, pilotReady, type PilotSettings } from '@/src/client/settings';
import type { Journal } from '@/src/client/journal/api';
import { blankMemory, openSpiderDb, type MemoryPage } from '@/src/client/journal/db';
import { localDate, shiftDate } from '@/src/shared/dates';
import {
  blankSession,
  dropOldest,
  needsDigest,
  restoreSession,
  transcript,
  type ChatSession,
  type CompactLimits,
} from '@/src/client/journal/session';
import {
  readUsage,
  recordUsage,
  recordUsageCall,
  recordUsageCalls,
  type UsageCall,
  type UsageCallMeta,
  type UsageRange,
  type UsageSnapshot,
} from '@/src/client/journal/usage';

let onDiary: (() => void) | null = null;

export function onDiaryChange(listen: (() => void) | null): void {
  onDiary = listen;
}

export interface MemoryView {
  date: string;
  line: string;
  noted: string;
  summary: string;
}

export interface MemoryWrite {
  date: string;
  line?: string;
  noted?: string;
  summary?: string;
}

export interface MemoryApi {
  list(): Promise<Array<{ date: string; line: string }>>;
  get(date: string): Promise<MemoryView | null>;
  write(input: MemoryWrite): Promise<MemoryView>;
}

function limitsOf(settings: PilotSettings): CompactLimits {
  return { contextTokens: contextTokensOf(settings.mode === 'local' ? 4 : settings.contextTokens) };
}

function viewOf(page: MemoryPage): MemoryView {
  return { date: page.date, line: page.description, noted: page.noted, summary: page.summary };
}

export class Diary implements Journal {
  dismissed = false;

  private constructor(
    private readonly db: Awaited<ReturnType<typeof openSpiderDb>>,
    readonly date: string,
    public session: ChatSession,
  ) {}

  static async open(now = new Date()): Promise<Diary> {
    const db = await openSpiderDb();
    const date = localDate(now);
    const stored = await loadSession(db, date);
    return new Diary(db, date, stored ?? blankSession(date));
  }

  behind(): boolean {
    return needsDigest(this.session) && !this.dismissed;
  }

  async save(): Promise<void> {
    if (this.session.messages.length === 0) return;
    await this.db.put('sessions', this.session);
  }

  api(): MemoryApi {
    return {
      list: async () => {
        const pages = await this.pages();
        return pages.map((page) => ({ date: page.date, line: page.description }));
      },
      get: (date) => this.read(date),
      write: (input) => this.write(input),
    };
  }

  async pages(): Promise<MemoryPage[]> {
    const all = await this.db.getAll('memories');
    return all.toSorted((a, b) => a.date.localeCompare(b.date));
  }

  async read(date: string): Promise<MemoryView | null> {
    const page = await this.db.get('memories', date);
    return page ? viewOf(page) : null;
  }

  async write(input: MemoryWrite): Promise<MemoryView> {
    const current = (await this.db.get('memories', input.date)) ?? blankMemory(input.date);
    const next: MemoryPage = {
      date: input.date,
      description: input.line ?? current.description,
      noted: input.noted ?? current.noted,
      summary: input.summary ?? current.summary,
      updatedAt: Date.now(),
    };
    await this.db.put('memories', next);
    onDiary?.();
    return viewOf(next);
  }

  async record(messages: ModelMessage[], settings: PilotSettings): Promise<void> {
    this.session = dropOldest(
      {
        ...this.session,
        messages,
        updatedAt: Date.now(),
      },
      limitsOf(settings),
    );
    this.dismissed = false;
    await this.save();
  }

  recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now = new Date(),
    meta?: UsageCallMeta,
  ): Promise<void> {
    return recordUsage(usage, now, meta);
  }

  recordUsageCall(call: UsageCall): Promise<void> {
    return recordUsageCall(call);
  }

  recordUsageCalls(calls: UsageCall[]): Promise<void> {
    return recordUsageCalls(calls);
  }

  readUsage(today: string, range?: UsageRange): Promise<UsageSnapshot> {
    return readUsage(today, range);
  }

  async digest(settings: PilotSettings): Promise<void> {
    if (!needsDigest(this.session) || !pilotReady(settings)) return;
    await this.digestSession(this.session, settings);
    this.session = { ...this.session, digestedAt: this.session.updatedAt };
    await this.save();
  }

  async backfill(settings: PilotSettings): Promise<void> {
    if (!pilotReady(settings)) return;
    const date = shiftDate(this.date, -1);
    const stored = await loadSession(this.db, date);
    if (!stored || !needsDigest(stored)) return;
    await this.digestSession(stored, settings);
    await this.db.put('sessions', { ...stored, digestedAt: stored.updatedAt });
  }

  private async digestSession(session: ChatSession, settings: PilotSettings): Promise<void> {
    const page = (await this.db.get('memories', session.date)) ?? blankMemory(session.date);
    const { summarizeDiary } = await import('@/src/client/journal/summarize');
    const note = await summarizeDiary({
      settings,
      transcript: transcript(session),
      noted: page.noted,
      prior: page.summary,
    });
    await recordUsage(note.usage, new Date(), {
      kind: 'summary',
      sessionId: session.date,
      provider: 'openai-compatible',
      modelId: modelIdOf(settings),
    });
    await this.db.put('memories', {
      ...page,
      description: note.line || page.description,
      summary: note.summary || page.summary,
      updatedAt: Date.now(),
    });
    onDiary?.();
  }
}

async function loadSession(db: Awaited<ReturnType<typeof openSpiderDb>>, date: string) {
  const tx = db.transaction(['sessions', 'memories'], 'readwrite');
  const stored = await tx.objectStore('sessions').get(date);
  if (!stored || 'messages' in stored) {
    await tx.done;
    return stored;
  }
  const session = restoreSession(stored);
  // Archive older summaries with the diary, atomically with the session migration.
  if (stored.summary) {
    const page = (await tx.objectStore('memories').get(date)) ?? blankMemory(date);
    await tx.objectStore('memories').put({
      ...page,
      summary: [page.summary, stored.summary].filter(Boolean).join('\n'),
      updatedAt: Date.now(),
    });
  }
  await tx.objectStore('sessions').put(session);
  await tx.done;
  return session;
}
