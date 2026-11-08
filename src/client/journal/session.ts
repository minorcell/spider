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

/** Drop whole user turns, preserving every retained tool call and its result. */
export function dropOldest(session: ChatSession, limits: CompactLimits): ChatSession {
  if (!overLimit(session, limits)) return session;
  const starts = session.messages.flatMap((message, index) =>
    message.role === 'user' ? [index] : [],
  );
  let low = 1;
  let high = starts.length - 1;
  let keep = starts.at(-1) ?? 0;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = starts[middle];
    if (overLimit({ ...session, messages: session.messages.slice(start) }, limits)) {
      low = middle + 1;
    } else {
      keep = start;
      high = middle - 1;
    }
  }
  return keep === 0 ? session : { ...session, messages: session.messages.slice(keep) };
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
