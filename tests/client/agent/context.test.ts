import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runAgent } from '@/src/client/agent/loop';
import { Diary } from '@/src/client/journal/diary';
import { resetSpiderDb } from '@/src/client/journal/db';
import { SimSession } from '@/src/shared/sim/session';
import type { PilotSettings } from '@/src/client/settings';

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
