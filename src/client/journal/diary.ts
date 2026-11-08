import type { LanguageModelUsage, ModelMessage } from 'ai';
import { modelIdOf, pilotReady, type PilotSettings } from '@/src/client/settings';
import type { Journal } from '@/src/client/journal/api';
import type { MemoryPage } from '@/src/client/storage/db';
import type { PersistenceRepository } from '@/src/client/storage/repository';
import { localDate, shiftDate } from '@/src/shared/dates';
import {
  blankSession,
  needsDigest,
  transcript,
  type ChatSession,
} from '@/src/client/journal/session';
import {
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

function viewOf(page: MemoryPage): MemoryView {
  return {
    date: page.date,
    line: page.description,
    noted: page.noted,
    summary: page.summary,
  };
}

export class Diary implements Journal {
  dismissed = false;

  private constructor(
    private readonly repository: PersistenceRepository,
    readonly date: string,
    public session: ChatSession,
  ) {}

  static async open(now = new Date(), repository?: PersistenceRepository): Promise<Diary> {
    repository ??= (await import('@/src/client/storage/direct')).createDbRepository();
    const date = localDate(now);
    const stored = await repository.loadSession(date);
    return new Diary(repository, date, stored ?? blankSession(date));
  }

  behind(): boolean {
    return needsDigest(this.session) && !this.dismissed;
  }

  async save(): Promise<void> {
    if (this.session.messages.length === 0) return;
    await this.repository.saveSession(this.session);
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
    return this.repository.listMemories();
  }

  async read(date: string): Promise<MemoryView | null> {
    const page = await this.repository.getMemory(date);
    return page ? viewOf(page) : null;
  }

  async write(input: MemoryWrite): Promise<MemoryView> {
    const next = await this.repository.patchMemory({
      date: input.date,
      description: input.line,
      noted: input.noted,
      summary: input.summary,
    });
    onDiary?.();
    return viewOf(next);
  }

  async record(messages: ModelMessage[], _settings: PilotSettings): Promise<void> {
    this.session = { ...this.session, messages, updatedAt: Date.now() };
    this.dismissed = false;
    await this.save();
  }

  recordUsage(
    usage: LanguageModelUsage | null | undefined,
    now = new Date(),
    meta?: UsageCallMeta,
  ): Promise<void> {
    return this.repository.recordUsage(usage, now, meta);
  }

  recordUsageCall(call: UsageCall): Promise<void> {
    return this.repository.recordUsageCall(call);
  }

  recordUsageCalls(calls: UsageCall[]): Promise<void> {
    return this.repository.recordUsageCalls(calls);
  }

  readUsage(today: string, range?: UsageRange): Promise<UsageSnapshot> {
    return this.repository.readUsage(today, range);
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
    const stored = await this.repository.loadSession(date);
    if (!stored || !needsDigest(stored)) return;
    await this.digestSession(stored, settings);
    await this.repository.saveSession({ ...stored, digestedAt: stored.updatedAt });
  }

  private async digestSession(session: ChatSession, settings: PilotSettings): Promise<void> {
    const page = await this.repository.getMemory(session.date);
    const { summarizeDiary } = await import('@/src/client/journal/summarize');
    const note = await summarizeDiary({
      settings,
      transcript: transcript(session),
      noted: page?.noted ?? '',
      prior: page?.summary ?? '',
    });
    await this.repository.recordUsage(note.usage, new Date(), {
      kind: 'summary',
      sessionId: session.date,
      provider: 'openai-compatible',
      modelId: modelIdOf(settings),
    });
    await this.repository.patchMemory({
      date: session.date,
      description: note.line || undefined,
      summary: note.summary || undefined,
    });
    onDiary?.();
  }
}
