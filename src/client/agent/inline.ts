import { speechText } from './speech.js';

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

export function parseInlineCalls(text: string, names: readonly string[]): InlineCall[] {
  if (text === '' || names.length === 0) return [];
  const found: InlineCall[] = [];

  let cursor = 0;
  while (cursor < text.length) {
    const hit = nextName(text, names, cursor);
    if (!hit) break;
    const object = jsonAfter(text, hit.index + hit.name.length);
    if (object) {
      found.push({ name: hit.name, input: object.value, start: hit.index, end: object.end });
      cursor = object.end;
    } else {
      cursor = hit.index + hit.name.length;
    }
  }

  for (const object of jsonObjects(text)) {
    const calls = wrappedCalls(object.value, names);
    if (!found.some((other) => overlaps(other, object))) {
      for (const call of calls) found.push({ ...call, start: object.start, end: object.end });
    }
  }

  return found.toSorted((a, b) => a.start - b.start);
}

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

export function withInlineCalls<M extends object>(
  model: M,
  names: readonly string[],
  local = false,
): M {
  const source = model as unknown as Partial<StreamingModel>;
  if (names.length === 0 || typeof source.doStream !== 'function') return model;
  const stream = source.doStream.bind(model);
  const wrapped = Object.create(model) as M & StreamingModel;
  wrapped.doStream = async (options: never) => {
    const result = await stream(options);
    return { ...result, stream: recover(result.stream, names, local) };
  };
  return wrapped;
}

function recover(
  source: ReadableStream<unknown>,
  names: readonly string[],
  local: boolean,
): ReadableStream<unknown> {
  let text = '';
  let textId = inlineId('text');
  let hasToolCall = false;
  let flushed = false;
  let emitted = '';
  let opened = false;
  const emit = (controller: TransformStreamDefaultController<unknown>, body: string): void => {
    if (body.length <= emitted.length) return;
    if (!opened) {
      opened = true;
      controller.enqueue({ type: 'text-start', id: textId });
    }
    controller.enqueue({ type: 'text-delta', id: textId, delta: body.slice(emitted.length) });
    emitted = body;
  };

  const flush = (controller: TransformStreamDefaultController<unknown>, parse: boolean): void => {
    if (!flushed) {
      flushed = true;
      const calls = parse && !hasToolCall ? parseInlineCalls(text, names) : [];
      const body = local
        ? calls.length || hasToolCall || !parse
          ? ''
          : speechText(text)
        : calls.length > 0
          ? cleanInlineText(text, calls)
          : text;
      if (body !== '') {
        emit(controller, body);
      }
      if (opened) controller.enqueue({ type: 'text-end', id: textId });
      if (local && parse && text.trim() && !body && !calls.length && !hasToolCall) {
        controller.enqueue({
          type: 'error',
          error: new Error('本机模型返回了无法识别的工具消息，请重试'),
        });
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
            // Only explicitly marked answers may stream. Unmarked prose and action
            // envelopes stay buffered until the whole reply has been classified.
            if (local && !hasToolCall && /^\s*答[：:]/.test(text) && speechText(text).length >= 6) {
              emit(controller, speechText(text));
            }
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
    // A malformed outer object must not repeatedly rescan its nested braces.
    index = text.length;
    const object = readObject(text, start, (end) => {
      index = end;
    });
    if (object) yield object;
  }
}

function readObject(text: string, start: number, onEnd?: (end: number) => void): JsonObject | null {
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
    onEnd?.(index + 1);
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
  const args = value.arguments ?? value.input ?? value.parameters ?? fn?.arguments;
  const input = args == null ? {} : asRecord(args);
  return input ? { name, input } : null;
}

function wrappedCalls(
  value: Record<string, unknown>,
  names: readonly string[],
): Array<{ name: string; input: Record<string, unknown> }> {
  const direct = wrappedCall(value, names);
  if (direct) return [direct];
  for (const key of ['tool_calls', 'tool_call', 'function_call', 'calls']) {
    const nested = value[key];
    const items = Array.isArray(nested) ? nested : [nested];
    const calls = items.flatMap((item) => (isRecord(item) ? wrappedCalls(item, names) : []));
    if (calls.length) return calls;
  }
  return [];
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

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

let sequence = 0;

function inlineId(prefix: string): string {
  sequence += 1;
  return `inline-${prefix}-${sequence.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
