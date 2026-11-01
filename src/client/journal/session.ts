/** One calendar day's conversation, and the rules for when it gets smaller. */

export const DEFAULT_COMPACT_KB = 400;
export const KEEP_TURNS = 4;

export interface Trace {
  name: string;
  input: unknown;
  output: unknown;
}

export interface Turn {
  role: 'user' | 'assistant';
  text: string;
  tools?: Trace[];
}

export interface ChatSession {
  date: string;
  summary: string;
  turns: Turn[];
  updatedAt: number;
  /** updatedAt of the last digest into the diary. 0 means never. */
  digestedAt: number;
}

export interface CompactLimits {
  contextTokens: number | null;
  compact: boolean;
  compactKb: number | null;
}

export type FitAction =
  | { kind: 'keep' }
  | { kind: 'save'; session: ChatSession }
  | { kind: 'summarize'; session: ChatSession };

export function blankSession(date: string): ChatSession {
  return { date, summary: '', turns: [], updatedAt: 0, digestedAt: 0 };
}

export function hasDialogue(session: ChatSession): boolean {
  if (session.summary.trim() !== '') return true;
  return session.turns.some((turn) => turn.role === 'user' && turn.text.trim() !== '');
}

export function needsDigest(session: ChatSession): boolean {
  return hasDialogue(session) && session.updatedAt > session.digestedAt;
}

export function payloadBytes(session: ChatSession): number {
  const text = JSON.stringify({ summary: session.summary, turns: session.turns });
  return new TextEncoder().encode(text).length;
}

export function estimateTokens(session: ChatSession): number {
  return Math.ceil(payloadBytes(session) / 4);
}

export function byteCap(limits: CompactLimits): number | null {
  if (!limits.compact) return null;
  return (limits.compactKb ?? DEFAULT_COMPACT_KB) * 1024;
}

export function tokenCap(limits: CompactLimits): number | null {
  if (limits.contextTokens == null) return null;
  return Math.floor(limits.contextTokens * 0.8);
}

export function overLimit(session: ChatSession, limits: CompactLimits): boolean {
  const bytes = payloadBytes(session);
  const tokens = Math.ceil(bytes / 4);
  const bytesAt = byteCap(limits);
  const tokensAt = tokenCap(limits);
  if (bytesAt != null && bytes >= bytesAt) return true;
  if (tokensAt != null && tokens >= tokensAt) return true;
  return false;
}

/** Strip tool traces first. Summarize only when automatic compact is on. */
export function fit(session: ChatSession, limits: CompactLimits): FitAction {
  if (!overLimit(session, limits)) return { kind: 'keep' };
  const stripped = stripTools(session);
  if (!overLimit(stripped, limits)) return { kind: 'save', session: stripped };
  if (!limits.compact) return { kind: 'save', session: dropOldest(stripped, limits) };
  return { kind: 'summarize', session: stripped };
}

export function stripTools(session: ChatSession): ChatSession {
  if (!session.turns.some((turn) => (turn.tools?.length ?? 0) > 0)) return session;
  return {
    ...session,
    turns: session.turns.map((turn) =>
      turn.tools && turn.tools.length > 0 ? { role: turn.role, text: turn.text } : turn,
    ),
  };
}

/** Drop the oldest turns until the payload fits, leaving at least one. */
export function dropOldest(session: ChatSession, limits: CompactLimits): ChatSession {
  let turns = session.turns;
  while (turns.length > 1 && overLimit({ ...session, turns }, limits)) turns = turns.slice(1);
  return turns === session.turns ? session : { ...session, turns };
}

/** Replace the older turns with one summary and keep the recent tail. */
export function foldSummary(session: ChatSession, summary: string): ChatSession {
  return { ...stripTools(session), summary, turns: stripTools(session).turns.slice(-KEEP_TURNS) };
}

export function transcript(session: ChatSession): string {
  const lines: string[] = [];
  if (session.summary) lines.push(`更早：${session.summary}`);
  for (const turn of session.turns) {
    lines.push(`${turn.role === 'user' ? '用户' : '蜘蛛'}：${turn.text}`);
    for (const tool of turn.tools ?? [])
      lines.push(`行动 ${tool.name} ${JSON.stringify(tool.output)}`);
  }
  return lines.join('\n');
}

export function toMessages(
  session: ChatSession,
  goal: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const turn of session.turns) {
    if (turn.role === 'user') {
      messages.push({ role: 'user', content: turn.text });
      continue;
    }
    const tools = (turn.tools ?? [])
      .map((tool) => `${tool.name} ${JSON.stringify(tool.output)}`)
      .join('\n');
    const content = tools ? `${turn.text}\n${tools}` : turn.text;
    if (content) messages.push({ role: 'assistant', content });
  }
  messages.push({ role: 'user', content: goal });
  return messages;
}
