import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseInlineCalls, withInlineCalls } from '@/src/client/agent/inline';
import { spiderTools } from '@/src/client/agent/tools';
import { localMessages } from '@/src/client/local/fetch';
import { SimSession } from '@/src/shared/sim/session';

const all = spiderTools(new SimSession(1234));
const tools = [all.observe, all.go, all.set_height].map((tool, i) => ({
  type: 'function',
  function: {
    name: ['observe', 'go', 'set_height'][i],
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
  },
}));
const names = ['observe', 'go', 'set_height'];
const reply = JSON.stringify({
  tool_calls: [
    {
      function: {
        name: 'go',
        arguments: '{"description":"我转向右边","mode":"degrees","degrees":90}',
      },
    },
  ],
});
const request = { tools, messages: [{ role: 'user' as const, content: '向右转九十度' }] };
const malformed = '{'.repeat(4096);

describe('local inference application overhead (no GPU)', () => {
  test('compact a real three-tool prompt', async ({ bench }) => {
    const prompt = localMessages(request)[0].content;
    const schemaStart = prompt.indexOf('[{"type":"function"');
    const compactBytes = new TextEncoder().encode(prompt.slice(schemaStart)).length;
    const originalBytes = new TextEncoder().encode(JSON.stringify(tools)).length;
    expect(compactBytes).toBeLessThan(originalBytes);
    console.info(
      `Tool schema bytes: ${originalBytes} -> ${compactBytes} (${((1 - compactBytes / originalBytes) * 100).toFixed(1)}% reduction)`,
    );
    await bench('build compact tool prompt', () => {
      localMessages(request);
    }).run();
  });

  test('parse a nested action envelope', async ({ bench }) => {
    expect(parseInlineCalls(reply, names)[0].name).toBe('go');
    await bench('parse nested tool envelope', () => {
      parseInlineCalls(reply, names);
    }).run();
  });

  test('reject an incomplete 4 KiB response', async ({ bench }) => {
    expect(parseInlineCalls(malformed, names)).toEqual([]);
    await bench('reject incomplete 4 KiB response', () => {
      parseInlineCalls(malformed, names);
    }).run();
  });

  test('classify a streamed tool reply', async ({ bench }) => {
    const model = {
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            for (let i = 0; i < reply.length; i += 8)
              controller.enqueue({ type: 'text-delta', delta: reply.slice(i, i + 8) });
            controller.enqueue({ type: 'finish' });
            controller.close();
          },
        }),
      }),
    };
    await bench('classify 8-character tool chunks', async () => {
      const { stream } = await withInlineCalls(model, names).doStream();
      const reader = stream.getReader();
      while (!(await reader.read()).done) {
        /* drain */
      }
    }).run();
  });

  for (const [label, text] of [
    ['prose', '我看到岛上的树、石头和苹果，先在这里休息一会儿。'.repeat(16)],
    ['incomplete 4 KiB JSON', malformed],
  ]) {
    test(`stream ${label} in 8-character chunks`, async ({ bench }) => {
      const model = {
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
      await bench(`stream ${label}, 8-character chunks`, async () => {
        const { stream } = await withInlineCalls(model, names).doStream();
        const reader = stream.getReader();
        while (!(await reader.read()).done) {
          /* drain */
        }
      }).run();
    });
  }
});
