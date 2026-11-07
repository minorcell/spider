const COMPACT_AT = 0.8;
const KEEP_TURNS = 4;
const encoder = new TextEncoder();

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
  digestedAt: number;
}

export interface CompactLimits {
  contextTokens: number | null;
}

export type FitAction =
  | { kind: 'keep' }
  | { kind: 'save'; session: ChatSession }
  | { kind: 'summarize'; session: ChatSession };

export function blankSession(date: string): ChatSession {
  return { date, summary: '', turns: [], updatedAt: 0, digestedAt: 0 };
}

function hasDialogue(session: ChatSession): boolean {
  if (session.summary.trim() !== '') return true;
  return session.turns.some((turn) => turn.role === 'user' && turn.text.trim() !== '');
}

export function needsDigest(session: ChatSession): boolean {
  return hasDialogue(session) && session.updatedAt > session.digestedAt;
}

export function payloadBytes(session: ChatSession): number {
  const text = JSON.stringify({ summary: session.summary, turns: session.turns });
  return encoder.encode(text).length;
}

export function estimateTokens(session: ChatSession): number {
  return Math.ceil(payloadBytes(session) / 4);
}

function tokenCap(limits: CompactLimits): number | null {
  if (limits.contextTokens == null) return null;
  return Math.floor(limits.contextTokens * COMPACT_AT);
}

export function overLimit(session: ChatSession, limits: CompactLimits): boolean {
  const tokensAt = tokenCap(limits);
  if (tokensAt == null) return false;
  return estimateTokens(session) >= tokensAt;
}

export function fit(session: ChatSession, limits: CompactLimits): FitAction {
  if (!overLimit(session, limits)) return { kind: 'keep' };
  const stripped = stripTools(session);
  if (!overLimit(stripped, limits)) return { kind: 'save', session: stripped };
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

export function dropOldest(session: ChatSession, limits: CompactLimits): ChatSession {
  const turns = session.turns;
  if (!overLimit(session, limits)) return session;

  let low = 1;
  let high = turns.length;
  let keep = 1;
  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    if (overLimit({ ...session, turns: turns.slice(-candidate) }, limits)) {
      high = candidate - 1;
    } else {
      keep = candidate;
      low = candidate + 1;
    }
  }
  return { ...session, turns: turns.slice(-keep) };
}

export function foldSummary(session: ChatSession, summary: string): ChatSession {
  const stripped = stripTools(session);
  return { ...stripped, summary, turns: stripped.turns.slice(-KEEP_TURNS) };
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
