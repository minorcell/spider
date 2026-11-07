import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { isLoopFinished, streamText, type LanguageModelUsage } from 'ai';
import type { SimSession } from '../../shared/sim/session.js';
import type { MemoryApi } from '../journal/diary.js';
import { toMessages, type ChatSession } from '../journal/session.js';
import { byteSize, usageCallFromStep, type UsageCall, type UsageTool } from '../journal/usage.js';
import { localDate } from '../../shared/dates.js';
import { apiKeyFor } from '../providers.js';
import { reasoningOf, type PilotSettings } from '../settings.js';
import { withInlineCalls } from './inline.js';
import { spiderTools } from './tools.js';
import { systemFor } from './prompt.js';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; output: unknown }
  | { type: 'error'; message: string };

export interface AgentReply {
  text: string;
  usage: LanguageModelUsage | null;
  calls: UsageCall[];
}

export interface RunAgentOptions {
  goal: string;
  session: SimSession;
  settings: PilotSettings;
  /** Today's conversation so far. Omitted on a fresh day. */
  chat?: ChatSession;
  /** Directory of diary pages, already trimmed to the recent days. */
  memoryIndex?: string;
  memory?: MemoryApi;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

/**
 * One agent turn in the page. One reply may call several tools. They run in
 * the order written, each until it finishes, and then the loop continues.
 */
export async function runAgent({
  goal,
  session,
  settings,
  chat,
  memoryIndex,
  memory,
  signal,
  onEvent,
}: RunAgentOptions): Promise<AgentReply> {
  const provider = createOpenAICompatible({
    name: 'openai-compatible',
    baseURL: settings.baseURL,
    apiKey: apiKeyFor(settings),
    includeUsage: true,
  });

  signal?.addEventListener('abort', () => session.cancel(), { once: true });

  const today = chat?.date ?? localDate(new Date());
  const turnId = uniqueId();
  const calls: UsageCall[] = [];
  const pendingTools = new Map<string, UsageTool>();
  const tools = spiderTools(session, memory);
  const result = streamText({
    // A model that writes its calls as text still gets them executed, and the
    // tool loop continues as if it had used the tool-call channel.
    model: withInlineCalls(provider(settings.model), Object.keys(tools)),
    system: systemFor(
      today,
      chat?.summary ?? '',
      memoryIndex ?? '记忆目录是空的。',
      memory != null,
    ),
    messages: toMessages(
      chat ?? { date: today, summary: '', turns: [], updatedAt: 0, digestedAt: 0 },
      goal,
    ),
    tools,
    stopWhen: isLoopFinished(),
    reasoning: reasoningOf(settings),
    abortSignal: signal,
    // One body. A second call started early would cancel the goal still running.
    toolCallConcurrency: 1,
    onToolExecutionStart(event) {
      onEvent?.({
        type: 'tool-call',
        name: event.toolCall.toolName,
        input: event.toolCall.input,
      });
    },
    onToolExecutionEnd(event) {
      const output = event.toolOutput;
      const ok = output.type === 'tool-result';
      pendingTools.set(event.toolCall.toolCallId, {
        id: event.toolCall.toolCallId,
        name: event.toolCall.toolName,
        ok,
        durationMs: finiteMs(event.toolExecutionMs),
        inputBytes: byteSize(event.toolCall.input),
        outputBytes: ok ? byteSize(output.output) : byteSize(output.error),
      });
    },
    onStepEnd(step) {
      const stepTools = step.toolCalls.map((call) => {
        const recorded = pendingTools.get(call.toolCallId);
        if (recorded) return recorded;
        const matched = step.toolResults.find((item) => item.toolCallId === call.toolCallId);
        return {
          id: call.toolCallId,
          name: call.toolName,
          ok: matched != null,
          durationMs: finiteMs(step.performance.toolExecutionMs[call.toolCallId]),
          inputBytes: byteSize(call.input),
          outputBytes: byteSize(matched?.output),
        };
      });
      calls.push(
        usageCallFromStep(step, {
          kind: 'agent',
          sessionId: today,
          turnId,
          date: today,
          ts: Date.now(),
          tools: stepTools,
        }),
      );
    },
  });

  // A sentence in the same step as a tool call is not a message. The tool's
  // description is the line beside the spider. The reply is text from a step
  // that calls nothing.
  let answer = '';
  let stepHasTool = false;
  const pending: string[] = [];
  const flush = (): void => {
    if (pending.length === 0) return;
    const chunks = pending.splice(0, pending.length);
    for (const text of chunks) {
      answer += text;
      onEvent?.({ type: 'text', text });
    }
  };
  for await (const part of result.fullStream) {
    if (signal?.aborted) break;
    switch (part.type) {
      case 'text-delta':
        if (!stepHasTool) pending.push(part.text);
        break;
      case 'tool-call':
        stepHasTool = true;
        pending.length = 0;
        break;
      case 'finish-step':
        if (!stepHasTool) flush();
        stepHasTool = false;
        break;
      case 'tool-result':
        onEvent?.({ type: 'tool-result', name: part.toolName, output: part.output });
        break;
      case 'tool-error':
        onEvent?.({
          type: 'error',
          message: `${part.toolName}：${part.error instanceof Error ? part.error.message : String(part.error)}`,
        });
        break;
      case 'error':
        onEvent?.({ type: 'error', message: errorText(part.error) });
        break;
      default:
        break;
    }
  }
  if (!signal?.aborted && !stepHasTool) flush();
  return { text: answer, usage: await takenUsage(result.usage), calls };
}

async function takenUsage(
  usage: PromiseLike<LanguageModelUsage> | undefined,
): Promise<LanguageModelUsage | null> {
  try {
    return (await usage) ?? null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function uniqueId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function finiteMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}
