import { LOCAL_MODEL } from '@/src/client/local/types';
import { localMetadata } from '@/src/client/local/metrics';
import { localBackend } from '@/src/client/local/backend';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  isLoopFinished,
  isStepCount,
  streamText,
  type LanguageModelUsage,
  type ModelMessage,
} from 'ai';
import type { SimSession } from '@/src/shared/sim/session';
import type { MemoryApi } from '@/src/client/journal/diary';
import { blankSession, dropOldest, type ChatSession } from '@/src/client/journal/session';
import {
  byteSize,
  usageCallFromStep,
  type UsageCall,
  type UsageTool,
} from '@/src/client/journal/usage';
import { localDate } from '@/src/shared/dates';
import { apiKeyFor } from '@/src/client/providers';
import { contextTokensOf, reasoningOf, type PilotSettings } from '@/src/client/settings';
import { withInlineCalls } from '@/src/client/agent/inline';
import { spiderTools } from '@/src/client/agent/tools';
import { systemFor } from '@/src/client/agent/prompt';

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; name: string; input: unknown }
  | { type: 'tool-result'; name: string; output: unknown }
  | {
      type: 'context';
      step: number;
      instructions: unknown;
      messages: unknown;
      tools: string[];
      local: boolean;
    }
  | {
      type: 'usage';
      step: number;
      input: number | null;
      output: number | null;
      cacheRead: number | null;
      cacheWrite: number | null;
      reasoning: number | null;
    }
  | { type: 'error'; message: string };

export interface AgentReply {
  text: string;
  messages: ModelMessage[];
  usage: LanguageModelUsage | null;
  calls: UsageCall[];
}

export interface RunAgentOptions {
  goal: string;
  session: SimSession;
  settings: PilotSettings;
  chat?: ChatSession;
  memory?: MemoryApi;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
}

export async function runAgent({
  goal,
  session,
  settings,
  chat,
  memory,
  signal,
  onEvent,
}: RunAgentOptions): Promise<AgentReply> {
  const local = settings.mode === 'local';
  const turnId = uniqueId();
  // Reserve the conversation across asynchronous tool execution, not just token generation.
  const backend = local ? await localBackend() : null;
  if (backend) await backend.localSession?.(turnId, true);
  try {
    const provider = createOpenAICompatible({
      name: 'openai-compatible',
      baseURL: local ? 'http://local.invalid/v1' : settings.baseURL,
      ...(local
        ? { fetch: (await import('@/src/client/local/fetch')).createLocalFetch({ kind: 'action' }) }
        : {}),
      apiKey: apiKeyFor(settings),
      includeUsage: true,
      ...(local ? { metadataExtractor: localMetadata } : {}),
    });

    signal?.addEventListener('abort', () => session.cancel(), { once: true });
    if (signal?.aborted) session.cancel();

    const today = chat?.date ?? localDate(new Date());
    const calls: UsageCall[] = [];
    const pendingTools = new Map<string, UsageTool>();
    const allTools = spiderTools(session, memory);
    const tools = local
      ? {
          observe: allTools.observe,
          go: allTools.go,
          set_height: allTools.set_height,
        }
      : allTools;
    const messages = dropOldest(
      {
        ...(chat ?? blankSession(today)),
        messages: [...(chat?.messages ?? []), { role: 'user', content: goal }],
      },
      { contextTokens: contextTokensOf(local ? 4 : settings.contextTokens) },
    ).messages;
    const result = streamText({
      model: withInlineCalls(provider(local ? LOCAL_MODEL : settings.model), Object.keys(tools)),
      system: systemFor(),
      messages,
      tools,
      stopWhen: local ? [isLoopFinished(), isStepCount(6)] : isLoopFinished(),
      ...(local ? { maxRetries: 0 } : {}),
      reasoning: reasoningOf(settings),
      abortSignal: signal,
      toolCallConcurrency: 1,
      onStepStart(event) {
        onEvent?.({
          type: 'context',
          step: event.stepNumber,
          instructions: event.instructions,
          messages: event.messages,
          tools: Object.keys(event.tools ?? {}),
          local,
        });
      },
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
        onEvent?.({
          type: 'usage',
          step: step.stepNumber,
          input: step.usage?.inputTokens ?? null,
          output: step.usage?.outputTokens ?? null,
          cacheRead: step.usage?.inputTokenDetails?.cacheReadTokens ?? null,
          cacheWrite: step.usage?.inputTokenDetails?.cacheWriteTokens ?? null,
          reasoning: step.usage?.outputTokenDetails?.reasoningTokens ?? null,
        });
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
    const response = signal?.aborted ? [] : await result.responseMessages;
    return {
      text: answer,
      messages: [...messages, ...response],
      usage: await takenUsage(result.usage),
      calls,
    };
  } finally {
    await backend?.localSession?.(turnId, false).catch(() => undefined);
  }
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
