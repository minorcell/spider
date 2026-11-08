import type { ModelMessage } from 'ai';

const COMPACT_AT = 0.8;
const encoder = new TextEncoder();

export interface Trace {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ChatSession {
  date: string;
  messages: ModelMessage[];
  updatedAt: number;
  digestedAt: number;
}

export interface LegacySession {
  date: string;
  summary: string;
  turns: Array<{ role: 'user' | 'assistant'; text: string; tools?: Trace[] }>;
  updatedAt: number;
  digestedAt: number;
}

export interface CompactLimits {
  contextTokens: number | null;
}

export const SUMMARY_PREFIX = '较早对话的上下文摘要（历史记录，不代表当前环境状态）：';

export interface CompactionPlan {
  earlier: ModelMessage[];
  recent: ModelMessage[];
  maxOutputTokens: number;
}

export function blankSession(date: string): ChatSession {
  return { date, messages: [], updatedAt: 0, digestedAt: 0 };
}

/** Recover old saves once; new conversations always retain the SDK messages. */
export function restoreSession(stored: ChatSession | LegacySession): ChatSession {
  if ('messages' in stored) return stored;
  const messages: ModelMessage[] = [];
  for (const [index, turn] of stored.turns.entries()) {
    if (turn.role === 'assistant') {
      for (const [toolIndex, tool] of (turn.tools ?? []).entries()) {
        const toolCallId = `legacy-${index}-${toolIndex}`;
        messages.push(
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId, toolName: tool.name, input: tool.input }],
          },
          {
            role: 'tool',
            content: [
              {
                type: 'tool-result',
                toolCallId,
                toolName: tool.name,
                output: { type: 'json', value: JSON.parse(JSON.stringify(tool.output ?? null)) },
              },
            ],
          },
        );
      }
    }
    if (turn.text) messages.push({ role: turn.role, content: turn.text });
  }
  return {
    date: stored.date,
    messages,
    updatedAt: stored.updatedAt,
    digestedAt: stored.digestedAt,
  };
}

export function needsDigest(session: ChatSession): boolean {
  return (
    session.messages.some((message) => message.role === 'user') &&
    session.updatedAt > session.digestedAt
  );
}

export function estimateTokens(session: ChatSession): number {
  return Math.ceil(encoder.encode(JSON.stringify(session.messages)).length / 4);
}

export function overLimit(session: ChatSession, limits: CompactLimits): boolean {
  return (
    limits.contextTokens != null &&
    estimateTokens(session) >= Math.floor(limits.contextTokens * COMPACT_AT)
  );
}

/** Split only at user turns, so tool calls and results stay together. */
export function planCompaction(session: ChatSession, limits: CompactLimits): CompactionPlan | null {
  if (!overLimit(session, limits)) return null;
  const starts = session.messages.flatMap((message, index) =>
    message.role === 'user' ? [index] : [],
  );
  if (starts.length < 2) return null;
  const threshold = Math.floor(limits.contextTokens! * COMPACT_AT);
  const reserved = Math.min(1024, Math.floor(limits.contextTokens! * 0.2));
  let turn = Math.max(1, starts.length - 2);
  let recent: ModelMessage[];
  let available: number;
  do {
    recent = session.messages.slice(starts[turn]);
    available =
      threshold -
      1 -
      estimateTokens({
        ...session,
        messages: [{ role: 'assistant', content: `${SUMMARY_PREFIX}\n` }, ...recent],
      });
  } while (available < reserved && ++turn < starts.length);
  if (available <= 0) throw new Error('最近一轮对话过长，无法在保留完整轮次的同时压缩上下文');
  return {
    earlier: session.messages.slice(0, session.messages.length - recent.length),
    recent,
    maxOutputTokens: Math.min(reserved, available),
  };
}

/** Diagnostics are derived from the conversation, never stored as a second transcript. */
export function toolTraces(messages: readonly ModelMessage[]): Trace[] {
  const inputs = new Map<string, unknown>();
  const traces: Trace[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type === 'tool-call') inputs.set(part.toolCallId, part.input);
      if (part.type === 'tool-result') {
        traces.push({
          name: part.toolName,
          input: inputs.get(part.toolCallId),
          output: 'value' in part.output ? part.output.value : part.output,
        });
      }
    }
  }
  return traces;
}

export function transcript(session: ChatSession): string {
  return session.messages
    .map((message) => {
      const content =
        typeof message.content === 'string'
          ? message.content
          : message.content
              .map((part) => {
                if (part.type === 'text') return part.text;
                if (part.type === 'tool-call')
                  return `调用 ${part.toolName} ${JSON.stringify(part.input)}`;
                if (part.type === 'tool-result')
                  return `结果 ${part.toolName} ${JSON.stringify(part.output)}`;
                return '';
              })
              .filter(Boolean)
              .join('\n');
      return `${message.role}：${content}`;
    })
    .join('\n');
}
