/**
 * Some models write a tool call into the text channel instead of the tool-call
 * channel: `go {"mode": "point", "x": 1, "z": 2}`. The SDK has already run its own tool
 * loop by the time the text reaches the page, so these would end the turn as
 * prose. Parse them at the model stream and hand the SDK real tool calls.
 */

export interface InlineCall {
  name: string;
  input: Record<string, unknown>;
  start: number;
  end: number;
}

interface JsonObject {
  value: Record<string, unknown>;
  start: number;
  end: number;
}

const IDENT = /[A-Za-z0-9_]/;
const SPACE = /\s/;

/** Every tool call the text contains, in the order written. */
export function parseInlineCalls(text: string, names: readonly string[]): InlineCall[] {
  if (text === '' || names.length === 0) return [];
  const found: InlineCall[] = [];
  const add = (call: InlineCall): void => {
    if (!found.some((other) => overlaps(other, call))) found.push(call);
  };

  let cursor = 0;
  while (cursor < text.length) {
    const hit = nextName(text, names, cursor);
    if (!hit) break;
    const object = jsonAfter(text, hit.index + hit.name.length);
    if (object) {
      add({ name: hit.name, input: object.value, start: hit.index, end: object.end });
      cursor = object.end;
    } else {
      cursor = hit.index + hit.name.length;
    }
  }

  for (const object of jsonObjects(text)) {
    const call = wrappedCall(object.value, names);
    if (call) add({ ...call, start: object.start, end: object.end });
  }

  return found.toSorted((a, b) => a.start - b.start);
}

/** The prose around the removed calls, with the token debris some models leave. */
export function cleanInlineText(text: string, calls: readonly InlineCall[]): string {
  if (calls.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const call of calls) {
    if (call.start < cursor) continue;
    out += text.slice(cursor, call.start);
    cursor = call.end;
  }
  out += text.slice(cursor);
  return out
    .replace(/<[|｜][^>]*[|｜]>/g, ' ')
    .replace(/```(?:json)?/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface StreamChunk {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
  [key: string]: unknown;
}

interface StreamingModel {
  doStream: (options: never) => PromiseLike<{ stream: ReadableStream<unknown> }>;
}

/**
 * Wrap a streaming model so inline tool calls become real ones before the SDK
 * decides the turn is finished. The wrapper sits on the prototype so the
 * provider object keeps its other methods and getters.
 */
export function withInlineCalls<M extends object>(model: M, names: readonly string[]): M {
  const source = model as unknown as Partial<StreamingModel>;
  if (names.length === 0 || typeof source.doStream !== 'function') return model;
  const stream = source.doStream.bind(model);
  const wrapped = Object.create(model) as M & StreamingModel;
  wrapped.doStream = async (options: never) => {
    const result = await stream(options);
    return { ...result, stream: recover(result.stream, names) };
  };
  return wrapped;
}

function recover(
  source: ReadableStream<unknown>,
  names: readonly string[],
): ReadableStream<unknown> {
  let text = '';
  let textId = inlineId('text');
  let hasToolCall = false;
  let flushed = false;

  const flush = (controller: TransformStreamDefaultController<unknown>, parse: boolean): void => {
    if (!flushed) {
      flushed = true;
      const calls = parse && !hasToolCall ? parseInlineCalls(text, names) : [];
      const body = calls.length > 0 ? cleanInlineText(text, calls) : text;
      if (body !== '') {
        controller.enqueue({ type: 'text-start', id: textId });
        controller.enqueue({ type: 'text-delta', id: textId, delta: body });
        controller.enqueue({ type: 'text-end', id: textId });
      }
      for (const call of calls) {
        controller.enqueue({
          type: 'tool-call',
          toolCallId: inlineId('call'),
          toolName: call.name,
          input: JSON.stringify(call.input),
        });
      }
    }
  };

  return source.pipeThrough(
    new TransformStream<unknown, unknown>({
      transform(chunk, controller) {
        if (!isChunk(chunk)) {
          controller.enqueue(chunk);
          return;
        }
        switch (chunk.type) {
          case 'text-start':
            if (typeof chunk.id === 'string') textId = chunk.id;
            return;
          case 'text-delta':
            if (typeof chunk.id === 'string') textId = chunk.id;
            text += chunk.delta ?? chunk.text ?? '';
            return;
          case 'text-end':
            return;
          case 'tool-input-start':
          case 'tool-input-delta':
          case 'tool-call':
            hasToolCall = true;
            controller.enqueue(chunk);
            return;
          case 'finish':
          case 'finish-step':
            flush(controller, true);
            controller.enqueue(chunk);
            return;
          case 'error':
            flush(controller, false);
            controller.enqueue(chunk);
            return;
          default:
            controller.enqueue(chunk);
        }
      },
      flush(controller) {
        flush(controller, true);
      },
    }),
  );
}

function isChunk(value: unknown): value is StreamChunk {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function nextName(
  text: string,
  names: readonly string[],
  from: number,
): { name: string; index: number } | null {
  let best: { name: string; index: number } | null = null;
  for (const name of names) {
    if (name === '') continue;
    let index = text.indexOf(name, from);
    while (index >= 0 && !wholeWord(text, index, name.length))
      index = text.indexOf(name, index + 1);
    if (index < 0) continue;
    if (
      best == null ||
      index < best.index ||
      (index === best.index && name.length > best.name.length)
    ) {
      best = { name, index };
    }
  }
  return best;
}

function wholeWord(text: string, index: number, length: number): boolean {
  const before = index > 0 ? text[index - 1] : '';
  const after = text[index + length] ?? '';
  return !IDENT.test(before) && !IDENT.test(after);
}

/** The JSON object right after a tool name, with or without fences and parens. */
function jsonAfter(text: string, from: number): JsonObject | null {
  let index = from;
  while (index < text.length && SPACE.test(text[index])) index += 1;
  if (text[index] === ':') {
    index += 1;
    while (index < text.length && SPACE.test(text[index])) index += 1;
  }
  if (text[index] === '(') {
    index += 1;
    while (index < text.length && SPACE.test(text[index])) index += 1;
  }
  if (text.startsWith('```', index)) {
    const newline = text.indexOf('\n', index + 3);
    if (newline < 0) return null;
    index = newline + 1;
    while (index < text.length && SPACE.test(text[index])) index += 1;
  }
  if (text[index] !== '{') return null;
  return readObject(text, index);
}

function* jsonObjects(text: string): Generator<JsonObject> {
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('{', index);
    if (start < 0) return;
    const object = readObject(text, start);
    if (!object) {
      index = start + 1;
      continue;
    }
    yield object;
    index = object.end;
  }
}

function readObject(text: string, start: number): JsonObject | null {
  let depth = 0;
  let string = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (string) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') {
      string = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char !== '}') continue;
    depth -= 1;
    if (depth !== 0) continue;
    try {
      const value = JSON.parse(text.slice(start, index + 1)) as Record<string, unknown>;
      return { value, start, end: index + 1 };
    } catch {
      return null;
    }
  }
  return null;
}

function wrappedCall(
  value: Record<string, unknown>,
  names: readonly string[],
): { name: string; input: Record<string, unknown> } | null {
  const fn = isRecord(value.function) ? value.function : null;
  const name = firstString(value.name, value.tool, value.tool_name, fn?.name);
  if (name == null || !names.includes(name)) return null;
  const args = value.arguments ?? value.input ?? fn?.arguments;
  const input = args == null ? {} : asRecord(args);
  return input ? { name, input } : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) if (typeof value === 'string' && value !== '') return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function overlaps(a: InlineCall, b: InlineCall): boolean {
  return a.start < b.end && b.start < a.end;
}

let sequence = 0;

function inlineId(prefix: string): string {
  sequence += 1;
  return `inline-${prefix}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
