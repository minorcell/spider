import { describe, expect, test } from 'vitest';
import { parseInlineCalls, withInlineCalls } from '@/src/client/agent/inline';
import { blankSession, dropOldest, type ChatSession } from '@/src/client/journal/session';

const names = ['observe', 'go', 'set_height'];

function streamReply(text: string) {
  return {
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (let i = 0; i < text.length; i += 8)
            controller.enqueue({ type: 'text-delta', delta: text.slice(i, i + 8) });
          controller.enqueue({ type: 'finish' });
          controller.close();
        },
      }),
    }),
  };
}

async function classify(model: ReturnType<typeof streamReply>) {
  const { stream } = await withInlineCalls(model, names, true).doStream();
  const reader = stream.getReader();
  let text = '';
  let calls = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value.type === 'text-delta') text += next.value.delta;
    if (next.value.type === 'tool-call') calls++;
  }
  return { text, calls };
}

describe('message scaling', () => {
  for (const size of [1024, 2048, 4096, 8192]) {
    test(`incomplete braces ${size} chars`, async ({ bench }) => {
      const text = '{'.repeat(size);
      expect(parseInlineCalls(text, names)).toEqual([]);
      await bench(`incomplete braces ${size} chars`, () => {
        parseInlineCalls(text, names);
      }).run();
    });

    test(`incomplete named calls ${size} chars`, async ({ bench }) => {
      const text = 'go {'.repeat(size / 4);
      expect(parseInlineCalls(text, names)).toEqual([]);
      await bench(`incomplete named calls ${size} chars`, () => {
        parseInlineCalls(text, names);
      }).run();
    });
  }

  for (const size of [256, 1024, 4096, 16384]) {
    test(`marked answer ${size} chars in 8-char chunks`, async ({ bench }) => {
      const body = '好'.repeat(size);
      const model = streamReply(`答：${body}`);
      expect(await classify(model)).toEqual({ text: body, calls: 0 });
      await bench(`marked answer ${size} chars`, () => classify(model)).run();
    });

    test(`tool envelope ${size} chars in 8-char chunks`, async ({ bench }) => {
      const model = streamReply(
        JSON.stringify({
          name: 'go',
          arguments: { description: 'x'.repeat(size), mode: 'degrees', degrees: 90 },
        }),
      );
      expect(await classify(model)).toEqual({ text: '', calls: 1 });
      await bench(`tool envelope ${size} chars`, () => classify(model)).run();
    });
  }
});

describe('journal scaling', () => {
  for (const turns of [100, 400, 1600, 6400]) {
    test(`drop oldest of ${turns} turns`, async ({ bench }) => {
      const session: ChatSession = {
        ...blankSession('2026-11-08'),
        messages: Array.from({ length: turns }, (_, i) => ({
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: '对话内容'.repeat(20),
        })),
      };
      const limits = { contextTokens: 4000 };
      const trimmed = dropOldest(session, limits);
      expect(trimmed.messages.length).toBeLessThan(turns);
      expect(trimmed.messages.at(-1)).toBe(session.messages.at(-1));
      await bench(`drop oldest of ${turns} turns`, () => {
        dropOldest(session, limits);
      }).run();
    });
  }
});
