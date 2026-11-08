import type { LocalBackend } from '@/src/client/local/types';
import type {
  LocalControl,
  LocalReplyMessage,
  LocalRequest,
} from '@/src/client/local/workerProtocol';

export interface InferenceScope {
  onmessage: ((event: MessageEvent<LocalRequest | LocalControl>) => void) | null;
  postMessage(message: LocalReplyMessage): void;
}
interface Endpoint {
  postMessage(message: LocalReplyMessage): void;
  onmessage: ((event: MessageEvent<LocalRequest>) => void) | null;
  start?(): void;
  close?(): void;
}

/** All endpoints dispatch to this one runtime, including its priority/cancellation queue. */
export function attachInferenceWorker(scope: InferenceScope, runtime: LocalBackend): void {
  let sequence = 0;
  const ports = new Map<number, () => void>();
  const attach = (port: Endpoint): { handle(request: LocalRequest): void; close(): void } => {
    const prefix = ++sequence;
    const qualify = (id: string) => JSON.stringify([prefix, id]);
    const pending = new Set<string>();
    const sessions = new Set<string>();
    let closed = false;
    const send = (reply: LocalReplyMessage) => {
      if (!closed) port.postMessage(reply);
    };
    const dispatch = async (request: LocalRequest): Promise<unknown> => {
      switch (request.method) {
        case 'localLoad':
          return runtime.localLoad(...request.args);
        case 'localStatus':
          return runtime.localStatus();
        case 'localUnload':
          return runtime.localUnload();
        case 'localSession': {
          const [id, active] = request.args;
          const key = qualify(id);
          if (active) sessions.add(key);
          else sessions.delete(key);
          return runtime.localSession?.(key, active);
        }
        case 'localCancel':
          return runtime.localCancel(qualify(request.args[0]));
        case 'localComplete': {
          const [id, messages, options] = request.args;
          const key = qualify(id);
          pending.add(key);
          try {
            return await runtime.localComplete(
              key,
              messages,
              options,
              request.stream
                ? (text) => send({ event: 'localDelta', id: request.id, text })
                : undefined,
            );
          } finally {
            pending.delete(key);
          }
        }
      }
    };
    const handle = (request: LocalRequest): void => {
      void dispatch(request).then(
        (value) => send({ id: request.id, ok: true, value }),
        (error: unknown) => {
          const failure = error instanceof Error || error instanceof DOMException ? error : null;
          send({
            id: request.id,
            ok: false,
            error: failure ? failure.message : String(error),
            name: failure?.name,
          });
        },
      );
    };
    port.onmessage = ({ data }) => handle(data);
    port.start?.();
    return {
      handle,
      close() {
        closed = true;
        for (const id of pending) void runtime.localCancel(id).catch(() => undefined);
        for (const id of sessions) void runtime.localSession?.(id, false).catch(() => undefined);
        port.close?.();
      },
    };
  };
  const main = attach(scope as Endpoint);
  scope.onmessage = ({ data }) => {
    if (!('event' in data)) main.handle(data);
    else if (data.event === 'connect') {
      ports.get(data.key)?.();
      ports.set(data.key, attach(data.port).close);
    } else {
      ports.get(data.key)?.();
      ports.delete(data.key);
    }
  };
}
