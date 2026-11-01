import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SimSession } from '../../../src/shared/sim/session.js';

const aiControl = vi.hoisted(() => ({
  streamText: vi.fn(),
  isStepCount: vi.fn((count: number) => ({ steps: count })),
  provider: null as null | ReturnType<typeof vi.fn>,
  providerOptions: null as null | Record<string, unknown>,
}));

vi.mock('ai', () => ({
  streamText: aiControl.streamText,
  isStepCount: aiControl.isStepCount,
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

function stream(parts: unknown[]): void {
  aiControl.streamText.mockReturnValue({
    fullStream: (async function* generate() {
      for (const part of parts) {
        await Promise.resolve();
        yield part;
      }
    })(),
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
    expect(answer).toBe('ab');
    expect(events).toEqual([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
      { type: 'tool-result', name: 'walk', output: { ok: true } },
      { type: 'error', message: 'walk：nope' },
      { type: 'error', message: 'walk：plain' },
      { type: 'error', message: 'boom' },
      { type: 'error', message: 'plain' },
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
    });
    expect(aiControl.provider!).toHaveBeenCalledWith('model-1');
    const options = aiControl.streamText.mock.calls[0][0] as Record<string, unknown>;
    expect(options.prompt).toBe('go');
    expect(String(options.system)).toContain('你是一个蜘蛛');
    expect(options.toolCallConcurrency).toBe(1);
    expect(options.stopWhen).toEqual({ steps: 20 });
    expect(options.tools).toBeTypeOf('object');
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
    await expect(promise).resolves.toBe('');
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
    expect(answer).toBe('');
    expect(events).toEqual([]);
  });

  it('runs without an event handler', async () => {
    stream([{ type: 'text-delta', text: 'a' }]);
    await expect(runAgent({ goal: 'go', session: fakeSession(), settings })).resolves.toBe('a');
    const options = aiControl.streamText.mock.calls[0][0] as {
      onToolExecutionStart: (event: { toolCall: { toolName: string; input: unknown } }) => void;
    };
    expect(() =>
      options.onToolExecutionStart({ toolCall: { toolName: 'walk', input: null } }),
    ).not.toThrow();
  });
});
