import { describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseInlineCalls, withInlineCalls } from '../src/client/agent/inline.js';
import { spiderTools } from '../src/client/agent/tools.js';
import { localMessages } from '../src/client/local/fetch.js';
import { SimSession } from '../src/shared/sim/session.js';
import { systemFor } from '../src/client/agent/prompt.js';

const all = spiderTools(new SimSession(1234), {
  list: async () => [],
  get: async () => null,
  write: async (input) => ({ date: input.date, line: '', noted: '', summary: '' }),
});
const tools = Object.entries(all).map(([name, tool]) => ({
  type: 'function',
  function: {
    name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
  },
}));
const names = Object.keys(all);
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
const system = systemFor('2026-11-08', '', '', false);
const request = {
  tools,
  messages: [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: '向右转九十度' },
  ],
};
const malformed = '{'.repeat(4096);

describe('local inference application overhead (no GPU)', () => {
  test('adapt the complete shared prompt and tools without changing their definitions', async ({
    bench,
  }) => {
    const prompt = localMessages(request)[0].content;
    const schemaStart = prompt.indexOf('[{"type":"function"');
    expect(prompt.startsWith(system)).toBe(true);
    expect(JSON.parse(prompt.slice(schemaStart))).toEqual(tools);
    console.info(
      `Shared tools: ${tools.length}; full prompt bytes: ${new TextEncoder().encode(prompt).length}`,
    );
    await bench('adapt shared agent prompt', () => {
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
});
