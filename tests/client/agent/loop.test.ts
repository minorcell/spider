import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimSession } from '../../../src/shared/sim/session.js';

const aiControl = vi.hoisted(() => ({
  streamText: vi.fn(),
  isLoopFinished: vi.fn(() => ({ until: 'finished' })),
  provider: null as null | ReturnType<typeof vi.fn>,
  providerOptions: null as null | Record<string, unknown>,
}));

vi.mock('ai', () => ({
  streamText: aiControl.streamText,
  isLoopFinished: aiControl.isLoopFinished,
  tool: (config: unknown) => config,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: (options: Record<string, unknown>) => {
    aiControl.providerOptions = options;
    const provider = vi.fn((model: string) => ({ model }));
    aiControl.provider = provider;
    return provider;
  },
}));

import { runAgent, type AgentEvent } from '../../../src/client/agent/loop.js';

function stream(parts: unknown[], usage: unknown = undefined, failUsage = false): void {
  aiControl.streamText.mockReturnValue({
    fullStream: (async function* generate() {
      for (const part of parts) {
        await Promise.resolve();
        yield part;
      }
    })(),
    get usage() {
      return failUsage ? Promise.reject(new Error('no usage')) : Promise.resolve(usage);
    },
  });
}

function fakeSession(): SimSession {
  return { cancel: vi.fn() } as unknown as SimSession;
}

const settings = { baseURL: 'https://example.com', model: 'model-1', apiKey: 'secret' };

beforeEach(() => {
  aiControl.streamText.mockReset();
  aiControl.providerOptions = null;
  aiControl.provider = null;
});

describe('runAgent', () => {
  it('keeps only the final words when one message mixes prose and tools', async () => {
    stream([
      { type: 'text-delta', text: '我先看看' },
      { type: 'tool-input-start' },
      { type: 'tool-call', toolName: 'walk', toolCallId: '1', input: {} },
      { type: 'text-delta', text: '别显示' },
      { type: 'tool-result', toolName: 'walk', output: { ok: true } },
      { type: 'finish-step' },
      { type: 'text-delta', text: '到了' },
      { type: 'finish-step' },
      { type: 'tool-call', toolName: 'walk', toolCallId: '2', input: {} },
      { type: 'text-delta', text: '也不显示' },
    ]);
    const events: AgentEvent[] = [];
    const answer = await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      onEvent: (event) => events.push(event),
    });
    expect(answer.text).toBe('到了');
    expect(events).toEqual([
      { type: 'tool-result', name: 'walk', output: { ok: true } },
      { type: 'text', text: '到了' },
    ]);
  });

  it('tells the spider to batch handling and stops only on a reply with no actions', async () => {
    stream([]);
    await runAgent({ goal: 'go', session: fakeSession(), settings });
    const system = String(aiControl.streamText.mock.calls[0][0].system);
    expect(system).toContain('对各件各写一次 drop');
    expect(system).toContain('一次回复不要同时写一段话和一个行动');
    expect(system).toContain('正文留空');
    expect(system).toContain('只写文字、不再调用行动的那一次回复会结束这一轮');
    expect(system).not.toContain('另起一条消息');
    expect(system).not.toContain('只放行动调用');
  });

  it('streams text, tool results, and errors', async () => {
    stream([
      { type: 'text-delta', text: 'a' },
      { type: 'text-delta', text: 'b' },
      { type: 'tool-result', toolName: 'walk', output: { ok: true } },
      { type: 'tool-error', toolName: 'walk', error: new Error('nope') },
      { type: 'tool-error', toolName: 'walk', error: 'plain' },
      { type: 'error', error: new Error('boom') },
      { type: 'error', error: 'plain' },
      { type: 'step-start' },
    ]);
    const events: AgentEvent[] = [];
    const answer = await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      onEvent: (event) => events.push(event),
    });
    expect(answer.text).toBe('ab');
    expect(answer.usage).toBeNull();
    expect(events).toEqual([
      { type: 'tool-result', name: 'walk', output: { ok: true } },
      { type: 'error', message: 'walk：nope' },
      { type: 'error', message: 'walk：plain' },
      { type: 'error', message: 'boom' },
      { type: 'error', message: 'plain' },
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]);
  });

  it('reports a tool call when its execution starts', async () => {
    stream([]);
    const events: AgentEvent[] = [];
    await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      onEvent: (event) => events.push(event),
    });
    const options = aiControl.streamText.mock.calls[0][0] as {
      onToolExecutionStart: (event: { toolCall: { toolName: string; input: unknown } }) => void;
    };
    options.onToolExecutionStart({ toolCall: { toolName: 'walk', input: { distance: 1 } } });
    expect(events).toEqual([{ type: 'tool-call', name: 'walk', input: { distance: 1 } }]);
  });

  it('configures the provider and the stream', async () => {
    stream([]);
    const session = fakeSession();
    await runAgent({ goal: 'go', session, settings });
    expect(aiControl.providerOptions).toMatchObject({
      name: 'openai-compatible',
      baseURL: settings.baseURL,
      apiKey: settings.apiKey,
      includeUsage: true,
    });
    expect(aiControl.provider!).toHaveBeenCalledWith('model-1');
    const options = aiControl.streamText.mock.calls[0][0] as Record<string, unknown>;
    expect(options.messages).toEqual([{ role: 'user', content: 'go' }]);
    expect(String(options.system)).toContain('你是一个蜘蛛');
    expect(options.toolCallConcurrency).toBe(1);
    expect(options.stopWhen).toEqual({ until: 'finished' });
    expect(options.tools).toBeTypeOf('object');
  });

  it('adds the diary and an earlier summary to the system prompt', async () => {
    stream([]);
    await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      chat: { date: '2026-11-02', summary: '更早的事', turns: [], updatedAt: 1, digestedAt: 0 },
      memoryIndex: '目录',
      memory: { list: vi.fn(), get: vi.fn(), write: vi.fn() },
    });
    const system = String(aiControl.streamText.mock.calls[0][0].system);
    expect(system).toContain('这一天更早的对话收成');
    expect(system).toContain('目录');
  });

  it('omits the summary when the day has none yet', async () => {
    stream([]);
    await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      chat: { date: '2026-11-02', summary: '', turns: [], updatedAt: 1, digestedAt: 0 },
      memoryIndex: '目录',
      memory: { list: vi.fn(), get: vi.fn(), write: vi.fn() },
    });
    const system = String(aiControl.streamText.mock.calls[0][0].system);
    expect(system).not.toContain('这一天更早的对话收成');
    expect(system).toContain('目录');
  });

  it('cancels the session when the signal aborts', async () => {
    stream([{ type: 'text-delta', text: 'a' }]);
    const session = fakeSession();
    const controller = new AbortController();
    const promise = runAgent({
      goal: 'go',
      session,
      settings,
      signal: controller.signal,
    });
    controller.abort();
    await expect(promise).resolves.toMatchObject({ text: '' });
    expect((session.cancel as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
  });

  it('stops streaming immediately when already aborted', async () => {
    stream([{ type: 'text-delta', text: 'a' }]);
    const controller = new AbortController();
    controller.abort();
    const events: AgentEvent[] = [];
    const answer = await runAgent({
      goal: 'go',
      session: fakeSession(),
      settings,
      signal: controller.signal,
      onEvent: (event) => events.push(event),
    });
    expect(answer.text).toBe('');
    expect(events).toEqual([]);
  });

  it('runs without an event handler', async () => {
    stream([{ type: 'text-delta', text: 'a' }]);
    await expect(runAgent({ goal: 'go', session: fakeSession(), settings })).resolves.toMatchObject(
      {
        text: 'a',
      },
    );
    const options = aiControl.streamText.mock.calls[0][0] as {
      onToolExecutionStart: (event: { toolCall: { toolName: string; input: unknown } }) => void;
    };
    expect(() =>
      options.onToolExecutionStart({ toolCall: { toolName: 'walk', input: null } }),
    ).not.toThrow();
  });

  it('returns usage reported by the stream', async () => {
    const usage = {
      inputTokens: 3,
      outputTokens: 1,
      totalTokens: 4,
      inputTokenDetails: { noCacheTokens: 3, cacheReadTokens: 0, cacheWriteTokens: undefined },
      outputTokenDetails: { textTokens: 1, reasoningTokens: 0 },
    };
    stream([{ type: 'text-delta', text: 'a' }], usage);
    await expect(runAgent({ goal: 'go', session: fakeSession(), settings })).resolves.toMatchObject(
      {
        text: 'a',
        usage,
      },
    );
  });

  it('drops usage when the stream cannot report it', async () => {
    stream([{ type: 'text-delta', text: 'a' }], undefined, true);
    await expect(runAgent({ goal: 'go', session: fakeSession(), settings })).resolves.toMatchObject(
      {
        text: 'a',
        usage: null,
        calls: [],
      },
    );
  });

  it('makes a turn id when randomUUID is missing', async () => {
    vi.stubGlobal('crypto', {});
    stream([]);
    await expect(runAgent({ goal: 'go', session: fakeSession(), settings })).resolves.toMatchObject(
      {
        calls: [],
      },
    );
  });

  it('records each model step and failed tools', async () => {
    aiControl.streamText.mockImplementation(
      (options: {
        onToolExecutionEnd?: (event: unknown) => void;
        onStepEnd?: (step: unknown) => void;
      }) => {
        options.onToolExecutionEnd?.({
          toolCall: { toolCallId: 't1', toolName: 'observe', input: { n: 1 } },
          toolOutput: { type: 'tool-result', output: { ok: true } },
          toolExecutionMs: 18,
        });
        options.onToolExecutionEnd?.({
          toolCall: { toolCallId: 't2', toolName: 'pick_up', input: {} },
          toolOutput: { type: 'tool-error', error: new Error('nope') },
          toolExecutionMs: 4,
        });
        options.onStepEnd?.({
          callId: 'c1',
          stepNumber: 0,
          model: { provider: 'openai-compatible', modelId: 'deepseek-chat' },
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            totalTokens: 12,
            inputTokenDetails: { noCacheTokens: 6, cacheReadTokens: 4, cacheWriteTokens: 0 },
            outputTokenDetails: { textTokens: 2, reasoningTokens: 0 },
          },
          finishReason: 'tool-calls',
          toolCalls: [
            { toolCallId: 't1', toolName: 'observe', input: { n: 1 } },
            { toolCallId: 't2', toolName: 'pick_up', input: {} },
          ],
          toolResults: [{ toolCallId: 't1', output: { ok: true } }],
          performance: {
            timeToFirstOutputMs: 80,
            responseTimeMs: 200,
            stepTimeMs: 240,
            toolExecutionMs: { t1: 18, t2: 4 },
          },
        });
        options.onStepEnd?.({
          callId: 'c1',
          stepNumber: 1,
          model: { provider: 'openai-compatible', modelId: 'deepseek-chat' },
          finishReason: 'stop',
          toolCalls: [{ toolCallId: 't3', toolName: 'wait', input: null }],
          toolResults: [{ toolCallId: 'other', output: { ok: true } }],
          performance: { responseTimeMs: 100, stepTimeMs: 120, toolExecutionMs: {} },
        });
        return {
          fullStream: (async function* generate() {
            yield { type: 'text-delta', text: 'ok' };
          })(),
          usage: Promise.resolve(undefined),
        };
      },
    );
    const answer = await runAgent({ goal: 'go', session: fakeSession(), settings });
    expect(answer.calls).toHaveLength(2);
    expect(answer.calls[0]).toMatchObject({
      id: 'c1:0',
      kind: 'agent',
      modelId: 'deepseek-chat',
      finishReason: 'tool-calls',
    });
    expect(answer.calls[0].tools).toEqual([
      expect.objectContaining({ name: 'observe', ok: true, durationMs: 18 }),
      expect.objectContaining({ name: 'pick_up', ok: false, durationMs: 4 }),
    ]);
    expect(answer.calls[1].tools[0]).toMatchObject({ name: 'wait', ok: false });
  });
});
