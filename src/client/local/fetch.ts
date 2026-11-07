import { localBackend } from './backend.js';
import { parseInlineCalls } from '../agent/inline.js';
import { localText } from './text.js';
import { LOCAL_MODEL, type LocalMessage, type LocalOptions, type LocalReply } from './types.js';

interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_call_id?: string;
  tool_calls?: { function: { name: string; arguments: string } }[];
}
interface RequestBody extends NonNullable<LocalOptions['generation']> {
  messages: Message[];
  tools?: Array<{ function: { name: string; [key: string]: unknown }; [key: string]: unknown }>;
  stream?: boolean;
}

export function localMessages(body: RequestBody): LocalMessage[] {
  const messages: LocalMessage[] = body.messages.map((message) => {
    if (message.role === 'tool')
      return {
        role: 'tool',
        content: message.content ?? '',
        tool_call_id: message.tool_call_id ?? '',
      };
    if (message.tool_calls?.length)
      return {
        role: 'assistant',
        content: JSON.stringify(
          singleOrMany(
            message.tool_calls.map(({ function: fn }) => ({
              name: fn.name,
              arguments: JSON.parse(fn.arguments) as unknown,
            })),
          ),
        ),
      };
    return { role: message.role, content: message.content ?? '' };
  });
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n');
  const instruction = body.tools?.length
    ? `${system}\n\n工具消息的传输格式：调用工具时输出 JSON {"name":"工具名","arguments":{参数}}，或此类对象的数组；普通回答直接输出正文。工具定义：${JSON.stringify(body.tools)}`
    : system;
  // Preserve the common agent's system rules, complete history and tool results.
  const history = messages.filter((m) => m.role !== 'system');
  return [{ role: 'system', content: instruction }, ...history];
}

/** Adapt the SDK's OpenAI request locally. This function never uses network fetch. */
export function createLocalFetch(options: LocalOptions = {}): typeof fetch {
  // One closure per agent run: retain exact model history, without keeping old runs alive.
  let previous: { canonical: LocalMessage[]; sent: LocalMessage[]; reply: LocalReply } | undefined;
  return async (_url, init) => {
    const body = JSON.parse(init!.body as string) as RequestBody;
    const requestOptions: LocalOptions = {
      ...options,
      generation: {
        max_tokens: body.max_tokens,
        temperature: body.temperature,
        top_p: body.top_p,
        frequency_penalty: body.frequency_penalty,
        presence_penalty: body.presence_penalty,
        stop: body.stop,
      },
    };
    const backend = await localBackend();
    const signal = init?.signal;
    signal?.throwIfAborted();
    const id = crypto.randomUUID();
    const canonical = localMessages(body);
    let messages = canonical;
    if (previous) {
      const count = previous.canonical.length;
      const next = canonical[count];
      const names = parseInlineCalls(
        previous.reply.text,
        body.tools?.map((tool) => tool.function.name) ?? [],
      );
      const normalized = names.length
        ? JSON.stringify(
            singleOrMany(
              names.map((call) => ({
                name: call.name,
                arguments: call.input,
              })),
            ),
          )
        : previous.reply.text;
      if (
        next?.role === 'assistant' &&
        next.content === normalized &&
        previous.canonical.every(
          (message, i) =>
            message.role === canonical[i]?.role && message.content === canonical[i]?.content,
        )
      ) {
        messages = [
          ...previous.sent,
          { role: 'assistant', content: previous.reply.rawText ?? previous.reply.text },
          ...canonical.slice(count + 1),
        ];
      }
    }
    const remember = (reply: LocalReply): void => {
      previous = { canonical, sent: messages, reply };
    };
    const abort = (): void => {
      void backend.localCancel(id).catch(() => undefined);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const cleanup = (): void => signal?.removeEventListener('abort', abort);
    const base = { id, created: Math.floor(Date.now() / 1000), model: LOCAL_MODEL };
    const usageOf = (result: LocalReply) => ({
      prompt_tokens: result.input,
      completion_tokens: result.output,
      total_tokens: result.input + result.output,
    });
    if (!body.stream)
      try {
        const result = await backend.localComplete(id, messages, requestOptions);
        signal?.throwIfAborted();
        remember(result);
        return Response.json({
          ...base,
          object: 'chat.completion',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: result.text },
              finish_reason: 'stop',
            },
          ],
          usage: usageOf(result),
          local_metrics: result.metrics,
        });
      } finally {
        cleanup();
      }
    const encoder = new TextEncoder();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let raw = '';
        let sent = '';
        const push = (chunk: unknown): void => {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        };
        const delta = (visible: string): void => {
          const text = visible.slice(sent.length);
          if (!text) return;
          sent = visible;
          push({
            ...base,
            object: 'chat.completion.chunk',
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          });
        };
        void backend
          .localComplete(id, messages, requestOptions, (text) => {
            if (closed || signal?.aborted) return;
            raw += text;
            delta(localText(raw, false));
          })
          .then((result) => {
            signal?.throwIfAborted();
            if (closed) return;
            remember(result);
            delta(result.text);
            push({
              ...base,
              object: 'chat.completion.chunk',
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
              usage: usageOf(result),
              local_metrics: result.metrics,
            });
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            closed = true;
            controller.close();
          })
          .catch((error: unknown) => {
            if (closed) return;
            closed = true;
            controller.error(error);
          })
          .finally(cleanup);
      },
      cancel() {
        closed = true;
        cleanup();
        return backend.localCancel(id);
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  };
}

export const localFetch = createLocalFetch();

function singleOrMany<T>(items: T[]): T | T[] {
  return items.length === 1 ? items[0] : items;
}
