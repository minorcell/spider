import type {
  LocalBackend,
  LocalLoadOptions,
  LocalMessage,
  LocalOptions,
  LocalReply,
} from '@/src/client/local/types';
import type {
  LocalReplyMessage,
  LocalRequest,
  LocalResultMap,
} from '@/src/client/local/workerProtocol';

export interface LocalPort {
  postMessage(message: LocalRequest): void;
  onmessage: ((event: MessageEvent<LocalReplyMessage>) => void) | null;
  onmessageerror?: ((event: MessageEvent) => void) | null;
  onerror?: ((event: ErrorEvent) => void) | null;
  start?(): void;
}

interface Waiter {
  resolve(value: unknown): void;
  reject(error: Error): void;
  onDelta?: (text: string) => void;
}

/** The same RPC client works on the page's Worker and the diary's direct MessagePort. */
export class WorkerLocalBackend implements LocalBackend {
  readonly #pending = new Map<number, Waiter>();
  #seq = 0;
  #failure: Error | null = null;

  constructor(
    readonly port: LocalPort,
    readonly activity: (busy: boolean) => void = () => {},
    readonly onFailure: (error: Error) => void = () => {},
  ) {
    port.onmessage = ({ data }) => this.#receive(data);
    port.onmessageerror = () => this.fail(new Error('本机模型线程消息无法读取'));
    if ('onerror' in port) port.onerror = (event) => this.fail(new Error(event.message));
    port.start?.();
  }

  localSession(id: string, active: boolean): Promise<void> {
    return this.#call<'localSession'>((seq) => ({
      id: seq,
      method: 'localSession',
      args: [id, active],
    }));
  }
  localLoad(options?: LocalLoadOptions): Promise<void> {
    return this.#call<'localLoad'>((id) => ({ id, method: 'localLoad', args: [options] }));
  }
  localStatus(): Promise<LocalResultMap['localStatus']> {
    return this.#call<'localStatus'>((id) => ({ id, method: 'localStatus' }));
  }
  localUnload(): Promise<void> {
    return this.#call<'localUnload'>((id) => ({ id, method: 'localUnload' }));
  }
  localComplete(
    id: string,
    messages: LocalMessage[],
    options?: LocalOptions,
    onDelta?: (text: string) => void,
  ): Promise<LocalReply> {
    return this.#call<'localComplete'>(
      (seq) => ({
        id: seq,
        method: 'localComplete',
        args: options ? [id, messages, options] : [id, messages],
        stream: onDelta != null,
      }),
      onDelta,
    );
  }
  localCancel(id: string): Promise<void> {
    return this.#call<'localCancel'>((seq) => ({ id: seq, method: 'localCancel', args: [id] }));
  }

  fail(error: Error): void {
    if (this.#failure) return;
    this.#failure = error;
    this.activity(false);
    for (const waiter of this.#pending.values()) waiter.reject(error);
    this.#pending.clear();
    this.onFailure(error);
  }

  #receive(reply: LocalReplyMessage): void {
    if (this.#failure) return;
    if ('event' in reply) {
      if (reply.event === 'failure') this.fail(new Error(reply.error));
      else if (reply.event === 'localActivity') this.activity(reply.busy);
      else this.#pending.get(reply.id)?.onDelta?.(reply.text);
      return;
    }
    const waiter = this.#pending.get(reply.id);
    if (!waiter) return;
    this.#pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else {
      const error = new Error(reply.error);
      error.name = reply.name ?? 'Error';
      waiter.reject(error);
    }
  }

  #call<K extends keyof LocalResultMap>(
    make: (id: number) => LocalRequest,
    onDelta?: (text: string) => void,
  ): Promise<LocalResultMap[K]> {
    return new Promise((resolve, reject) => {
      if (this.#failure) return reject(this.#failure);
      const id = ++this.#seq;
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onDelta });
      try {
        this.port.postMessage(make(id));
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
