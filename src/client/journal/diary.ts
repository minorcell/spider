import type { LanguageModelUsage } from 'ai';
import { contextTokensOf, pilotReady, type PilotSettings } from '../settings.js';
import type { Journal } from './api.js';
import { blankMemory, openSpiderDb, type MemoryPage } from './db.js';
import { localDate, shiftDate } from '../../shared/dates.js';
import {
  blankSession,
  dropOldest,
  fit,
  foldSummary,
  needsDigest,
  transcript,
  type ChatSession,
  type CompactLimits,
  type Trace,
} from './session.js';
import {
  readUsage,
  recordUsage,
  recordUsageCall,
  recordUsageCalls,
  type UsageCall,
  type UsageCallMeta,
  type UsageRange,
  type UsageSnapshot,
} from './usage.js';

const INDEX_DAYS = 60;

let onDiary: (() => void) | null = null;

/** The page registers this so a diary write can schedule a cloud upload. */
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
  return { contextTokens: contextTokensOf(settings.contextTokens) };
}

function viewOf(page: MemoryPage): MemoryView {
  return { date: page.date, line: page.description, noted: page.noted, summary: page.summary };
}

/** Today's conversation plus the diary that outlives it. */
export class Diary implements Journal {
  /** Set when the user dismisses the leave dialog without summarizing. */
  dismissed = false;

  private constructor(
    private readonly db: Awaited<ReturnType<typeof openSpiderDb>>,
    readonly date: string,
    public session: ChatSession,
  ) {}

  static async open(now = new Date()): Promise<Diary> {
    const db = await openSpiderDb();
    const date = localDate(now);
    const stored = await db.get('sessions', date);
    return new Diary(db, date, stored ?? blankSession(date));
  }

  behind(): boolean {
    return needsDigest(this.session) && !this.dismissed;
  }

  async save(): Promise<void> {
    if (this.session.turns.length === 0 && !this.session.summary) return;
    await this.db.put('sessions', this.session);
  }

  async indexBlock(): Promise<string> {
    const pages = await this.pages();
    const recent = pages.slice(-INDEX_DAYS);
    if (recent.length === 0) return '记忆目录是空的。';
    return recent.map((page) => `${page.date} ${page.description || '（无）'}`).join('\n');
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

  /** Append one exchange, then shrink it if a limit says so. */
  async record(
    user: string,
    assistant: string,
    tools: Trace[],
    settings: PilotSettings,
  ): Promise<void> {
    const turn: ChatSession['turns'][number] = { role: 'assistant', text: assistant };
    if (tools.length > 0) turn.tools = tools;
    this.session = {
      ...this.session,
      turns: [...this.session.turns, { role: 'user', text: user }, turn],
      updatedAt: Date.now(),
    };
    this.dismissed = false;
    const limits = limitsOf(settings);
    const action = fit(this.session, limits);
    if (action.kind === 'summarize') {
      try {
        const page = await this.db.get('memories', this.date);
        const { summarizeDiary } = await import('./summarize.js');
        const note = await summarizeDiary({
          settings,
          transcript: transcript(action.session),
          noted: page?.noted ?? '',
          prior: action.session.summary,
        });
        await recordUsage(note.usage, new Date(), {
          kind: 'summary',
          sessionId: this.date,
          provider: 'openai-compatible',
          modelId: settings.model,
        });
        const folded = foldSummary(action.session, note.summary || action.session.summary);
        this.session = { ...dropOldest(folded, limits), updatedAt: Date.now() };
      } catch {
        this.session = { ...dropOldest(action.session, limits), updatedAt: Date.now() };
      }
    } else if (action.kind === 'save') {
      this.session = { ...action.session, updatedAt: Date.now() };
    }
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

  /** Write today's summary into the diary. Noted lines stay as they are. */
  async digest(settings: PilotSettings): Promise<void> {
    if (!needsDigest(this.session) || !pilotReady(settings)) return;
    await this.digestSession(this.session, settings);
    this.session = { ...this.session, digestedAt: this.session.updatedAt };
    await this.save();
  }

  /** If yesterday's conversation never made it into the diary, write it now. */
  async backfill(settings: PilotSettings): Promise<void> {
    if (!pilotReady(settings)) return;
    const date = shiftDate(this.date, -1);
    const stored = await this.db.get('sessions', date);
    if (!stored || !needsDigest(stored)) return;
    await this.digestSession(stored, settings);
    await this.db.put('sessions', { ...stored, digestedAt: stored.updatedAt });
  }

  private async digestSession(session: ChatSession, settings: PilotSettings): Promise<void> {
    const page = (await this.db.get('memories', session.date)) ?? blankMemory(session.date);
    const { summarizeDiary } = await import('./summarize.js');
    const note = await summarizeDiary({
      settings,
      transcript: transcript(session),
      noted: page.noted,
      prior: session.summary,
    });
    await recordUsage(note.usage, new Date(), {
      kind: 'summary',
      sessionId: session.date,
      provider: 'openai-compatible',
      modelId: settings.model,
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
