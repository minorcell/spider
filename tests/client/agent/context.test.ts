import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runAgent } from '@/src/client/agent/loop';
import { Diary } from '@/src/client/journal/diary';
import { resetSpiderDb } from '@/src/client/storage/db';
import { SimSession } from '@/src/shared/sim/session';
import type { PilotSettings } from '@/src/client/settings';
import {
  blankSession,
  overLimit,
  SUMMARY_PREFIX,
  type ChatSession,
} from '@/src/client/journal/session';

const settings: PilotSettings = {
  provider: 'custom',
  baseURL: 'https://model.test/v1',
  model: 'test',
  apiKey: 'test',
  contextTokens: null,
  autoMemory: false,
  thinking: true,
};

beforeEach(() => resetSpiderDb());
afterEach(() => vi.unstubAllGlobals());

function completion(delta: unknown, reason: string): Response {
  const chunk = (delta: unknown, finish_reason: string | null) => ({
    id: 'completion',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'test',
    choices: [{ index: 0, delta, finish_reason }],
  });
  return new Response(
    [chunk(delta, null), chunk({}, reason)]
      .map((value) => `data: ${JSON.stringify(value)}\n\n`)
      .join('') + 'data: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

it('continues the exact SDK conversation across requests, persistence and the next user turn', async () => {
  const requests: Array<{ messages: Array<Record<string, unknown>>; tools: unknown[] }> = [];
  const fetcher = vi.fn(async (_url: unknown, init: RequestInit) => {
    requests.push(JSON.parse(init.body as string));
    if (requests.length === 1)
      return completion(
        {
          reasoning_content: '先观察',
          tool_calls: [
            {
              index: 0,
              id: 'observe-1',
              type: 'function',
              function: {
                name: 'observe',
                arguments: '{"description":"我看看周围"}',
              },
            },
          ],
        },
        'tool_calls',
      );
    return completion({ content: requests.length === 2 ? '看到了。' : '好的。' }, 'stop');
  });
  vi.stubGlobal('fetch', fetcher);
  const diary = await Diary.open();
  await diary.write({ date: diary.date, line: '不应该自动注入', summary: '私人日记' });
  const world = new SimSession(1);
  const first = await runAgent({
    goal: '看看附近',
    session: world,
    settings,
    chat: diary.session,
    memory: diary.api(),
  });
  expect(first.messages.map((message) => message.role)).toEqual([
    'user',
    'assistant',
    'tool',
    'assistant',
  ]);
  await diary.record(first.messages, settings);
  const reopened = await Diary.open();
  expect(reopened.session.messages).toEqual(first.messages);
  const next = await runAgent({
    goal: '谢谢',
    session: world,
    settings,
    chat: reopened.session,
    memory: reopened.api(),
  });
  expect(next.messages.slice(0, first.messages.length)).toEqual(first.messages);
  expect(requests[2].messages.map((message) => message.role)).toEqual([
    'system',
    'user',
    'assistant',
    'tool',
    'assistant',
    'user',
  ]);
  expect(requests[2].messages[2]).toEqual(requests[1].messages[2]);
  expect(requests[2].messages[2].reasoning_content).toBe('先观察');
  expect(requests[2].messages[3]).toEqual(requests[1].messages[3]);
  expect(requests[2].messages[3].tool_call_id).toBe('observe-1');
  expect(requests[2].messages[4].content).toBe('看到了。');
  expect(requests[2].messages[5].content).toBe('谢谢');
  expect(JSON.stringify(requests.map((request) => request.messages[0]))).not.toMatch(
    /私人日记|不应该自动注入/,
  );
});

function longConversation(): ChatSession {
  return {
    ...blankSession('2026-11-09'),
    messages: [
      { role: 'user', content: '记住不要吃红色的。'.repeat(300) },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'old', toolName: 'observe', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'old',
            toolName: 'observe',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      },
      { role: 'assistant', content: '看到了。' },
      { role: 'user', content: '再看看' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'recent', toolName: 'observe', input: {} }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'recent',
            toolName: 'observe',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      },
      { role: 'assistant', content: '又看到了。' },
    ],
  };
}

it('summarizes old tool pairs before acting and persists the summary with recent pairs', async () => {
  const requests: Array<{
    messages: Array<Record<string, unknown>>;
    tools?: unknown[];
    max_tokens?: number;
  }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      requests.push(body);
      if (!body.stream)
        return Response.json({
          id: 'summary',
          object: 'chat.completion',
          created: 1,
          model: 'test',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '用户要求不要吃红色的，之前已观察附近。' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        });
      return completion({ content: '记得。' }, 'stop');
    }),
  );
  const diary = await Diary.open();
  const chat = longConversation();
  await diary.record(chat.messages, { ...settings, contextTokens: 1 });
  const reply = await runAgent({
    goal: '还记得我的要求吗',
    session: new SimSession(1),
    settings: { ...settings, contextTokens: 1 },
    chat: diary.session,
  });
  expect(requests).toHaveLength(2);
  expect(requests[0].tools).toBeUndefined();
  expect(requests[0].max_tokens).toBe(200);
  expect(requests[0].messages.map((message) => message.role)).toEqual([
    'system',
    'user',
    'assistant',
    'tool',
    'assistant',
    'user',
  ]);
  expect(requests[0].messages[3].tool_call_id).toBe('old');
  expect(requests[1].messages.map((message) => message.role)).toEqual([
    'system',
    'assistant',
    'user',
    'assistant',
    'tool',
    'assistant',
    'user',
  ]);
  expect(requests[1].messages[1].content).toContain(SUMMARY_PREFIX);
  expect(requests[1].messages[4].tool_call_id).toBe('recent');
  expect(reply.messages.slice(1, 5)).toEqual(chat.messages.slice(4));
  expect(reply.calls[0]).toMatchObject({
    kind: 'summary',
    input: { total: 100 },
    output: { total: 20 },
  });
  expect(overLimit({ ...chat, messages: reply.messages }, { contextTokens: 1000 })).toBe(false);
  await diary.record(reply.messages, settings);
  expect((await Diary.open()).session.messages).toEqual(reply.messages);
  await runAgent({
    goal: '谢谢',
    session: new SimSession(2),
    settings: { ...settings, contextTokens: 1 },
    chat: diary.session,
  });
  expect(requests).toHaveLength(3);
  expect(requests[2].messages[1]).toEqual(requests[1].messages[1]);
});

it('retries compaction three times without sending an action or changing persisted history', async () => {
  const fetcher = vi.fn(async () => new Response('unavailable', { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  const diary = await Diary.open();
  const chat = longConversation();
  await diary.record(chat.messages, settings);
  await expect(
    runAgent({
      goal: '继续',
      session: new SimSession(1),
      settings: { ...settings, contextTokens: 1 },
      chat: diary.session,
    }),
  ).rejects.toThrow('已重试 3 次，原始对话已保留');
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(diary.session.messages).toEqual(chat.messages);
  expect((await Diary.open()).session.messages).toEqual(chat.messages);
});
