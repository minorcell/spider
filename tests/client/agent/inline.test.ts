import { describe, expect, it } from 'vitest';
import {
  cleanInlineText,
  parseInlineCalls,
  withInlineCalls,
} from '../../../src/client/agent/inline.js';

const names = ['move_to', 'observe', 'pick_up'];

describe('parseInlineCalls', () => {
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
      expect.arrayContaining([
        expect.objectContaining({ type: 'text-delta', delta: '走 move_to {"x":1}' }),
        error,
      ]),
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
