import { describe, expect, it, vi } from 'vitest';
import { cleanInlineText, parseInlineCalls, withInlineCalls } from '@/src/client/agent/inline';

const names = ['move_to', 'observe', 'pick_up'];

describe('parseInlineCalls', () => {
  it('recovers nested tool envelopes and preserves all calls in a shared envelope', () => {
    expect(
      parseInlineCalls(
        JSON.stringify({
          tool_calls: [
            { type: 'function', function: { name: 'observe', arguments: '{"distance":8}' } },
            { name: 'move_to', parameters: { x: 1, z: 2 } },
          ],
        }),
        names,
      ),
    ).toMatchObject([
      { name: 'observe', input: { distance: 8 } },
      { name: 'move_to', input: { x: 1, z: 2 } },
    ]);
  });
  it('reads the actions a model wrote into its text', () => {
    const text =
      '我记得东边一点那块地更高，我过去看看。  move_to {"description":"我往东边那块更高的地走。","x":4.9,"z":-6,"fast":true} observe {"description":"我到了高处，看看周围还有没有更高的。","distance":16}';
    const calls = parseInlineCalls(text, names);
    expect(calls).toMatchObject([
      {
        name: 'move_to',
        input: { description: '我往东边那块更高的地走。', x: 4.9, z: -6, fast: true },
      },
      {
        name: 'observe',
        input: { description: '我到了高处，看看周围还有没有更高的。', distance: 16 },
      },
    ]);
    expect(cleanInlineText(text, calls)).toBe('我记得东边一点那块地更高，我过去看看。');
  });

  it('reads fenced and wrapped call formats', () => {
    const text = [
      '先走',
      '```json',
      '{"name":"move_to","arguments":{"x":1,"z":2}}',
      '```',
      '再拿',
      'pick_up({"id":"apple-1"})',
    ].join('\n');
    expect(parseInlineCalls(text, names)).toMatchObject([
      { name: 'move_to', input: { x: 1, z: 2 } },
      { name: 'pick_up', input: { id: 'apple-1' } },
    ]);
  });

  it('ignores names without an object and unknown tools', () => {
    expect(parseInlineCalls('move_to is a tool name, but this is prose.', names)).toEqual([]);
    expect(parseInlineCalls('candy {"x":1}', names)).toEqual([]);
    expect(parseInlineCalls('move_to {"x":1}', [])).toEqual([]);
  });

  it('does not read a call out of an argument string', () => {
    const text = 'move_to {"description":"然后 observe {\\"distance\\":8}","x":1,"z":2}';
    expect(parseInlineCalls(text, names)).toMatchObject([
      { name: 'move_to', input: { description: '然后 observe {"distance":8}', x: 1, z: 2 } },
    ]);
  });

  it('recovers after a name that is only part of a longer word', () => {
    expect(parseInlineCalls('xmove_to move_to {"x":1}', names)).toMatchObject([
      { name: 'move_to', input: { x: 1 } },
    ]);
  });

  it('prefers the longer name when two tools start at the same place', () => {
    expect(parseInlineCalls('move-to {"x":1}', ['move', 'move-to'])).toMatchObject([
      { name: 'move-to', input: { x: 1 } },
    ]);
    expect(parseInlineCalls('move-to {"x":1}', ['move-to', 'move'])).toMatchObject([
      { name: 'move-to', input: { x: 1 } },
    ]);
  });

  it('keeps one call when a direct and a wrapped parse overlap', () => {
    expect(parseInlineCalls('move_to {"name":"move_to","arguments":{"x":1}}', names)).toHaveLength(
      1,
    );
  });

  it('reads colon, paren, and fenced forms', () => {
    expect(parseInlineCalls('move_to: {"x":1}', names)[0].input).toEqual({ x: 1 });
    expect(parseInlineCalls('move_to ( {"x":1})', names)[0].input).toEqual({ x: 1 });
    expect(parseInlineCalls('move_to ```json\n  {"x":1}\n```', names)[0].input).toEqual({ x: 1 });
    expect(parseInlineCalls('move_to ```json {"x":1}', names)).toEqual([]);
  });

  it('skips malformed objects and keeps looking', () => {
    expect(parseInlineCalls('{oops} move_to {"x":1}', names)).toMatchObject([
      { name: 'move_to', input: { x: 1 } },
    ]);
    expect(parseInlineCalls('move_to {"x":1', names)).toEqual([]);
  });

  it('recovers a complete nested call after repeated unclosed arguments', () => {
    const prefix = 'move_to {'.repeat(256);
    expect(parseInlineCalls(`${prefix}observe {"distance":8}`, names)).toMatchObject([
      { name: 'observe', input: { distance: 8 } },
    ]);
    expect(parseInlineCalls(`${prefix}"observe {\\"distance\\":8}`, names)).toEqual([]);
  });

  it('does not lose a later tool when an earlier call consumes a cached name occurrence', () => {
    expect(
      parseInlineCalls(
        'move_to {"description":"observe later","x":1} observe {"distance":4}',
        names,
      ),
    ).toMatchObject([
      { name: 'move_to', input: { description: 'observe later', x: 1 } },
      { name: 'observe', input: { distance: 4 } },
    ]);
  });

  it('ignores an empty tool name and a name at the end of the text', () => {
    expect(parseInlineCalls('move_to {"x":1}', [''])).toEqual([]);
    expect(parseInlineCalls('move_to', names)).toEqual([]);
  });

  it('reads the aliases a wrapped call may use', () => {
    expect(parseInlineCalls('{"name":"move_to","input":{"x":1}}', names)[0].input).toEqual({
      x: 1,
    });
    expect(
      parseInlineCalls('{"function":{"name":"move_to","arguments":{"x":1}}}', names)[0].input,
    ).toEqual({ x: 1 });
    expect(parseInlineCalls('{"tool":"observe"}', names)[0].input).toEqual({});
  });

  it('rejects wrapped calls without usable arguments', () => {
    expect(parseInlineCalls('{"name":"move_to","arguments":1}', names)).toEqual([]);
    expect(parseInlineCalls('{"name":"move_to","arguments":"[]"}', names)).toEqual([]);
    expect(parseInlineCalls('{"name":"move_to","arguments":"{"}', names)).toEqual([]);
    expect(parseInlineCalls('{"arguments":{"x":1}}', names)).toEqual([]);
  });

  it('accepts string arguments and falls back from an empty name', () => {
    expect(
      parseInlineCalls('{"name":"move_to","arguments":"{\\"x\\":1}"}', names)[0].input,
    ).toEqual({ x: 1 });
    expect(
      parseInlineCalls('{"name":"","tool":"move_to","arguments":{"x":1}}', names),
    ).toMatchObject([{ name: 'move_to', input: { x: 1 } }]);
    expect(
      parseInlineCalls('{"name":1,"tool":"move_to","arguments":{"x":1}}', names),
    ).toMatchObject([{ name: 'move_to', input: { x: 1 } }]);
  });
});

describe('cleanInlineText', () => {
  it('leaves text without calls alone', () => {
    expect(cleanInlineText('到了', [])).toBe('到了');
  });

  it('ignores overlapping ranges', () => {
    expect(
      cleanInlineText('abcdef', [
        { name: 'move_to', input: {}, start: 0, end: 4 },
        { name: 'observe', input: {}, start: 2, end: 6 },
      ]),
    ).toBe('ef');
  });
});

describe('withInlineCalls', () => {
  it.each([
    '普通回答：这里有 `{}` 和 [苹果]。',
    '{"ok":true,"observation":{"x":1}}',
    '{"name":"unknown","arguments":{}}',
    '```json\n{"name":"observe","arguments":',
    '工具执行结果：{"ok":true}',
  ])('preserves text that is not a recognized tool call: %s', async (text) => {
    const { stream } = await withInlineCalls(
      fakeModel([{ type: 'text-delta', delta: text }, { type: 'finish' }]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => chunk.delta)
        .join(''),
    ).toBe(text);
    expect(chunks.some((chunk) => chunk.type === 'error')).toBe(false);
  });

  it('preserves ordinary text across chunk boundaries without a reply marker', async () => {
    const parts = ['这里有 ', '`{', '}` 和 [', '苹果]。'];
    const { stream } = await withInlineCalls(
      fakeModel([...parts.map((delta) => ({ type: 'text-delta', delta })), { type: 'finish' }]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(
      chunks
        .filter((chunk) => chunk.type === 'text-delta')
        .map((chunk) => chunk.delta)
        .join(''),
    ).toBe(parts.join(''));
  });

  it('turns inline text into tool-call chunks before finish', async () => {
    const model = fakeModel([
      { type: 'text-start', id: 't0' },
      {
        type: 'text-delta',
        id: 't0',
        delta: '去看看 move_to {"x":1,"z":2} observe {"distance":8}',
      },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ]);
    const wrapped = withInlineCalls(model, names);
    const { stream } = await wrapped.doStream({} as never);
    const chunks = await read(stream);
    expect(chunks).toMatchObject([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', delta: '去看看' },
      { type: 'text-end', id: 't0' },
      { type: 'tool-call', toolName: 'move_to', input: '{"x":1,"z":2}' },
      { type: 'tool-call', toolName: 'observe', input: '{"distance":8}' },
      { type: 'finish' },
    ]);
  });

  it('leaves an ordinary answer alone', async () => {
    const model = fakeModel([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: '到了' },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ]);
    const { stream } = await withInlineCalls(model, names).doStream({} as never);
    const chunks = await read(stream);
    expect(chunks).toMatchObject([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', delta: '到了' },
      { type: 'text-end', id: 't0' },
      { type: 'finish' },
    ]);
  });

  it('does not repeat a call the model already made properly', async () => {
    const model = fakeModel([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', id: 't0', delta: '走 move_to {"x":1,"z":2}' },
      { type: 'text-end', id: 't0' },
      { type: 'tool-call', toolName: 'move_to', input: '{"x":1,"z":2}' },
      { type: 'finish' },
    ]);
    const { stream } = await withInlineCalls(model, names).doStream({} as never);
    const chunks = await read(stream);
    expect(chunks.filter((chunk) => chunk.type === 'tool-call')).toHaveLength(1);
  });

  it('emits multiple unmarked prose deltas while the upstream is still open', async () => {
    const live = await gatedStream();
    await live.send({ type: 'text-start', id: 'prose' }, { type: 'text-delta', delta: '我看到' });
    expect(live.chunks).toMatchObject([
      { type: 'text-start', id: 'prose' },
      { type: 'text-delta', id: 'prose', delta: '我看到' },
    ]);
    await live.send({ type: 'text-delta', delta: '一棵树。' });
    expect(live.chunks.filter((chunk) => chunk.type === 'text-delta')).toHaveLength(2);
    expect(body(live.chunks)).toBe('我看到一棵树。');
    await live.send({ type: 'finish', finishReason: { unified: 'stop' } });
    expect(live.chunks.some((chunk) => chunk.type === 'finish')).toBe(false);
    live.close();
    await live.done;
    expect(live.chunks.at(-1)).toMatchObject({ type: 'finish' });
  });

  it.each([
    'move_to {"x":1,"nested":{"a":[1,{"b":"a\\\"}b"}]}}',
    'move_to: ( {"x":1} )',
    'move_to ```json\n {"x":1}\n```',
    '```json\n{"name":"observe","arguments":{"distance":8}}\n```',
    '[{"tool":"observe"},{"function":{"name":"move_to","arguments":"{\\\"x\\\":1}"}}]',
    '<|tool_call|> move_to {"x":1}',
    '<｜tool_call｜> observe {}',
  ])('withholds split candidate syntax until a clean final completion: %s', async (syntax) => {
    const live = await gatedStream();
    await live.send({ type: 'text-delta', delta: '先看看 ' });
    for (const delta of syntax) await live.send({ type: 'text-delta', delta });
    expect(body(live.chunks)).toBe('先看看');
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
    await live.send({ type: 'finish-step' });
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
    await live.send({ type: 'finish', finishReason: 'tool-calls' });
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
    live.close();
    await live.done;
    expect(live.chunks.filter((chunk) => chunk.type === 'tool-call')).toHaveLength(
      parseInlineCalls(syntax, names).length,
    );
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(true);
    expect(body(live.chunks)).toBe('先看看');
  });

  it.each([
    'observe the view; observer is a word; move_to is a name.',
    'observation and xobserve and pick_upwards.',
    'observe: nope; move_to:: nope; pick_up(apple)',
    'one `tick`, two ``ticks`` and ```ts\nconst x = { a: [1] };\n```',
    '<div>hello</div> <|not a marker> <|marker|> plain text',
    '<|marker|> observe the view',
    '<|marker|> \n',
    '<',
    '<|incomplete',
    'move_to',
    'mov',
    '`',
    '```json\n{"name":"observe","arguments":',
    '{"name":"unknown","arguments":{"x":[1,2]}}',
    '{oops} ordinary text',
    'plain trailing whitespace \n\t',
    'plain before [apples and pears] after',
  ])('preserves non-tool and incomplete formats across character boundaries: %s', async (text) => {
    const { stream } = await withInlineCalls(
      fakeModel([
        ...Array.from(text, (delta) => ({ type: 'text-delta', delta })),
        { type: 'finish' },
      ]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(body(chunks)).toBe(text);
    expect(chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('recovers tools at every split point and streams prose following a call', async () => {
    const syntax = 'move_to:({"x":1,"note":"brace } and \\\"quote\\\""})';
    for (let split = 0; split <= syntax.length; split += 1) {
      const live = await gatedStream();
      await live.send(
        { type: 'text-delta', delta: 'before ' + syntax.slice(0, split) },
        { type: 'text-delta', delta: syntax.slice(split) + ' after' },
      );
      expect(body(live.chunks).replace(/ +/g, ' ')).toBe('before after');
      expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
      await live.send({ type: 'finish' });
      live.close();
      await live.done;
      expect(live.chunks.filter((chunk) => chunk.type === 'tool-call')).toMatchObject([
        { toolName: 'move_to', input: JSON.stringify({ x: 1, note: 'brace } and "quote"' }) },
      ]);
    }
  });

  it('keeps trailing prose when a recognized call omits its closing parenthesis', async () => {
    const { stream } = await withInlineCalls(
      fakeModel([
        { type: 'text-delta', delta: 'move_to({"x":1} then continue' },
        { type: 'finish' },
      ]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(body(chunks)).toBe(' then continue');
    expect(chunks.filter((chunk) => chunk.type === 'tool-call')).toHaveLength(1);
  });

  it.each([
    [],
    [{ type: 'finish-step' }],
    [{ type: 'finish', finishReason: 'length' }],
    [{ type: 'finish', finishReason: { unified: 'length', raw: 'max_tokens' } }],
    [{ type: 'finish', finishReason: 'content-filter' }],
    [{ type: 'finish', finishReason: { raw: 'length' } }],
    [{ type: 'finish', finishReason: null }],
    [{ type: 'finish', finishReason: 'error' }],
    [
      { type: 'finish', finishReason: 'length' },
      { type: 'finish', finishReason: 'stop' },
    ],
    [{ type: 'abort' }],
    [{ type: 'error', error: 'boom' }, { type: 'finish' }],
    [{ type: 'finish' }, { type: 'error', error: 'boom' }],
    [{ type: 'finish' }, { type: 'abort' }],
  ])('never executes a candidate without successful completion: %j', async (...terminal) => {
    const { stream } = await withInlineCalls(
      fakeModel([{ type: 'text-delta', delta: '走 move_to {"x":1}' }, ...terminal]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(body(chunks)).toBe('走');
    expect(chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('propagates upstream rejection after a finish without releasing calls', async () => {
    const live = await gatedStream();
    await live.send({ type: 'text-delta', delta: '走 move_to {"x":1}' }, { type: 'finish' });
    const error = new Error('disconnected');
    live.fail(error);
    expect(await live.done).toBe(error);
    expect(body(live.chunks)).toBe('走');
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('propagates reader cancellation before completion without releasing calls', async () => {
    const live = await gatedStream();
    await live.send({ type: 'text-delta', delta: '走 move_to {"x":1}' }, { type: 'finish' });
    await live.cancel('user stopped');
    await live.done;
    await expect.poll(() => live.cancelSource.mock.calls).toEqual([['user stopped']]);
    expect(live.chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('preserves native chunks exactly and suppresses duplicate recovery and syntax', async () => {
    const native = [
      { type: 'tool-input-start', id: 'native', toolName: 'move_to' },
      { type: 'tool-input-delta', id: 'native', delta: '{"x":1}' },
      { type: 'tool-input-end', id: 'native' },
      { type: 'tool-call', toolCallId: 'native', toolName: 'move_to', input: '{"x":1}' },
    ];
    const live = await gatedStream();
    await live.send({ type: 'text-delta', delta: '走 move_to {"x":1}' }, ...native);
    expect(live.chunks.filter((chunk) => chunk.type.startsWith('tool-'))).toEqual(native);
    await live.send({ type: 'finish' });
    live.close();
    await live.done;
    expect(body(live.chunks)).toBe('走');
    expect(live.chunks.filter((chunk) => chunk.type === 'tool-call')).toHaveLength(1);
  });

  it('scans long malformed candidates once, including a complete nested call', async () => {
    const malformed = 'move_to {'.repeat(8192) + 'observe {"distance":8}';
    const parse = vi.spyOn(JSON, 'parse');
    const { stream } = await withInlineCalls(
      fakeModel([
        ...Array.from(malformed, (delta) => ({ type: 'text-delta', delta })),
        { type: 'finish' },
      ]),
      names,
    ).doStream();
    const chunks = await read(stream);
    expect(chunks.filter((chunk) => chunk.type === 'tool-call')).toMatchObject([
      { toolName: 'observe', input: '{"distance":8}' },
    ]);
    // Only the complete object is parsed; unclosed ancestors are scanned,
    // independent of the 73,000+ upstream deltas and 8,192 candidate tool names.
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('handles long whitespace and plain malformed JSON without argument-spread limits', async () => {
    const text = ' '.repeat(150_000) + '{'.repeat(20_000);
    const { stream } = await withInlineCalls(
      fakeModel([{ type: 'text-delta', delta: text }, { type: 'finish' }]),
      names,
    ).doStream();
    expect(body(await read(stream))).toBe(text);
  });

  it('keeps the model when there is nothing to recover', () => {
    const model = fakeModel([]);
    expect(withInlineCalls(model, [])).toBe(model);
    const plain = { modelId: 'plain' };
    expect(withInlineCalls(plain, names)).toBe(plain);
  });

  it('passes through values and parts it does not understand', async () => {
    const chunks = [null, 'raw', { foo: 'bar' }, { type: 'reasoning-delta', delta: '想' }];
    const { stream } = await withInlineCalls(
      fakeModel([...chunks, { type: 'finish' }]),
      names,
    ).doStream({} as never);
    expect(await read(stream)).toEqual([...chunks, { type: 'finish' }]);
  });

  it('does not parse text when the stream ends in an error', async () => {
    const error = { type: 'error', error: 'boom' };
    const { stream } = await withInlineCalls(
      fakeModel([
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: '走 move_to {"x":1}' },
        { type: 'text-end', id: 't0' },
        error,
      ]),
      names,
    ).doStream({} as never);
    const chunks = await read(stream);
    expect(chunks).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'text-delta', delta: '走' }), error]),
    );
    expect(chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('flushes on finish-step', async () => {
    const { stream } = await withInlineCalls(
      fakeModel([
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: '到了' },
        { type: 'finish-step' },
      ]),
      names,
    ).doStream({} as never);
    expect(await read(stream)).toMatchObject([
      { type: 'text-start', id: 't0' },
      { type: 'text-delta', delta: '到了' },
      { type: 'text-end', id: 't0' },
      { type: 'finish-step' },
    ]);
  });

  it('treats streamed tool input as a real call', async () => {
    const { stream } = await withInlineCalls(
      fakeModel([
        { type: 'text-start', id: 't0' },
        { type: 'text-delta', id: 't0', delta: '走 move_to {"x":1}' },
        { type: 'tool-input-start', toolCallId: 't1', toolName: 'move_to' },
        { type: 'tool-input-delta', toolCallId: 't1', inputTextDelta: '{"x":1}' },
        { type: 'finish' },
      ]),
      names,
    ).doStream({} as never);
    const chunks = await read(stream);
    expect(chunks.some((chunk) => chunk.type === 'tool-input-start')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'tool-input-delta')).toBe(true);
    expect(chunks.some((chunk) => chunk.type === 'tool-call')).toBe(false);
  });

  it('uses the text field and fills in missing ids', async () => {
    const { stream } = await withInlineCalls(
      fakeModel([
        { type: 'text-start' },
        { type: 'text-delta', text: '到了' },
        { type: 'text-delta' },
        { type: 'text-end' },
        { type: 'finish' },
      ]),
      names,
    ).doStream({} as never);
    const chunks = await read(stream);
    const id = chunks[0].id as string;
    expect(id).toMatch(/^inline-text-/);
    expect(chunks).toMatchObject([
      { type: 'text-start', id },
      { type: 'text-delta', id, delta: '到了' },
      { type: 'text-end', id },
      { type: 'finish' },
    ]);
  });

  it('emits nothing when there is no text', async () => {
    const { stream } = await withInlineCalls(fakeModel([{ type: 'finish' }]), names).doStream(
      {} as never,
    );
    expect(await read(stream)).toEqual([{ type: 'finish' }]);
  });
});

function fakeModel(chunks: unknown[]): {
  doStream: () => Promise<{ stream: ReadableStream<unknown> }>;
  modelId: string;
} {
  return {
    modelId: 'fake',
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
    }),
  };
}

async function read(stream: ReadableStream<unknown>): Promise<Record<string, unknown>[]> {
  const chunks: Record<string, unknown>[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return chunks;
    chunks.push(value as Record<string, unknown>);
  }
}

function body(chunks: Record<string, unknown>[]): string {
  return chunks
    .filter((chunk) => chunk.type === 'text-delta')
    .map((chunk) => chunk.delta)
    .join('');
}

async function gatedStream() {
  let source!: ReadableStreamDefaultController<unknown>;
  const cancelSource = vi.fn();
  const { stream } = await withInlineCalls(
    {
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            source = controller;
          },
          cancel: cancelSource,
        }),
      }),
    },
    names,
  ).doStream();
  const reader = stream.getReader();
  const chunks: Record<string, unknown>[] = [];
  const done = (async () => {
    try {
      for (;;) {
        const { done: ended, value } = await reader.read();
        if (ended) return;
        const chunk = value as Record<string, unknown>;
        if (chunk.type === 'test-gate') (chunk.resolve as () => void)();
        else chunks.push(chunk);
      }
    } catch (error) {
      return error;
    }
  })();
  return {
    chunks,
    done,
    cancelSource,
    close: () => source.close(),
    fail: (error: unknown) => source.error(error),
    cancel: (reason: string) => reader.cancel(reason),
    send: (...parts: unknown[]) =>
      new Promise<void>((resolve) => {
        for (const part of parts) source.enqueue(part);
        source.enqueue({ type: 'test-gate', resolve });
      }),
  };
}
