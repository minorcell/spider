import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachWorldWorker, type WorldScope } from '../../../src/client/worker/worldAttach.js';
import {
  prepareLocal,
  prepareWorld,
  WorldClient,
  type WorldPort,
} from '../../../src/client/worker/worldClient.js';
import { createWorldHandler } from '../../../src/client/worker/worldHandler.js';
import type { WorldReply, WorldRequest } from '../../../src/client/worker/worldProtocol.js';
import { Terrain } from '../../../src/shared/terrain.js';

function scope(): WorldScope & { postMessage: ReturnType<typeof vi.fn> } {
  return { onmessage: null, postMessage: vi.fn() };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('world worker', () => {
  it('bakes a grid that matches the page terrain', async () => {
    const handle = createWorldHandler();
    const prepared = await handle({ id: 1, method: 'prepare', seed: 3 });
    const local = new Terrain(3);
    expect(prepared.seed).toBe(3);
    expect(new Terrain(3, prepared.grid).height(14, -8)).toBeCloseTo(local.height(14, -8));
    expect(prepared.island.groundPosition.length).toBeGreaterThan(0);
    expect(prepared.island.contourMinor.length).toBeGreaterThan(0);
  });

  it('posts the buffers so the page can take them', async () => {
    const port = scope();
    attachWorldWorker(port, async (request) => ({
      seed: request.seed,
      grid: new Float32Array([1]),
      island: {
        groundPosition: new Float32Array([0, 1, 2]),
        groundColor: new Float32Array([1, 1, 1]),
        groundIndex: new Uint32Array([0]),
        grid: new Float32Array([0, 0, 0]),
        contourMinor: new Float32Array(),
        contourMajor: new Float32Array([4]),
      },
    }));
    port.onmessage?.({ data: { id: 2, method: 'prepare', seed: 1 } } as MessageEvent<WorldRequest>);
    await settle();
    const reply = port.postMessage.mock.calls[0][0] as WorldReply;
    const transfer = port.postMessage.mock.calls[0][1] as ArrayBuffer[];
    expect(reply).toMatchObject({ id: 2, ok: true });
    expect(transfer).toHaveLength(7);
  });

  it('turns a thrown error into a failed reply', async () => {
    const port = scope();
    let call = 0;
    attachWorldWorker(port, async () => {
      call += 1;
      throw call === 1 ? new Error('boom') : 'plain';
    });
    const send = (id: number) =>
      port.onmessage?.({ data: { id, method: 'prepare', seed: 1 } } as MessageEvent<WorldRequest>);
    send(3);
    await settle();
    send(4);
    await settle();
    expect(port.postMessage).toHaveBeenNthCalledWith(1, { id: 3, ok: false, error: 'boom' });
    expect(port.postMessage).toHaveBeenNthCalledWith(2, { id: 4, ok: false, error: 'plain' });
  });

  it('builds an island from a port and falls back when the worker is missing', async () => {
    const handle = createWorldHandler();
    const port: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        void handle(message).then(
          (value) =>
            port.onmessage?.({
              data: { id: message.id, ok: true, value },
            } as MessageEvent<WorldReply>),
          (error: unknown) =>
            port.onmessage?.({
              data: {
                id: message.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              },
            } as MessageEvent<WorldReply>),
        );
      },
    };
    const client = new WorldClient(port);
    const prepared = await client.prepare(6);
    expect(prepared.island.children).toHaveLength(4);
    expect(prepared.terrain.height(0, 0)).toBe(0);
    expect(prepared.terrain.height(0, 0)).toBeCloseTo(new Terrain(6).height(0, 0));

    const local = await prepareWorld(6, async () => null);
    expect(local.terrain.height(11, 4)).toBeCloseTo(prepared.terrain.height(11, 4));
    const again = await prepareWorld(6, async () => null);
    expect(again.island).not.toBe(local.island);
    expect(again.terrain).toBe(local.terrain);

    const fallback = await prepareWorld(2, async () => {
      throw new Error('closed');
    });
    expect(fallback.seed).toBe(2);
    expect(prepareLocal(2).terrain.height(8, 3)).toBeCloseTo(fallback.terrain.height(8, 3));
  });

  it('rejects a broken port and ignores a late reply', async () => {
    const port: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage() {
        throw new Error('blocked');
      },
    };
    const client = new WorldClient(port);
    await expect(client.prepare(1)).rejects.toThrow('blocked');
    await expect(client.prepare(1)).rejects.toThrow('blocked');
    port.onmessage?.({ data: { id: 99, ok: false, error: 'late' } } as MessageEvent<WorldReply>);
    port.onerror?.(new ErrorEvent('error', { message: 'down' }));

    const hung: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage() {},
    };
    const waiting = new WorldClient(hung);
    const pending = waiting.prepare(4);
    hung.onerror?.(new ErrorEvent('error', { message: 'down' }));
    await expect(pending).rejects.toThrow('down');
  });

  it('bakes locally when the browser has no worker', async () => {
    vi.stubGlobal('Worker', undefined);
    const local = await prepareWorld(9);
    expect(local.terrain.height(10, -3)).toBeCloseTo(prepareLocal(9).terrain.height(10, -3));
  });

  it('rejects a failed reply and a thrown string', async () => {
    const failed: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        this.onmessage?.({
          data: { id: message.id, ok: false, error: 'nope' },
        } as MessageEvent<WorldReply>);
      },
    };
    await expect(new WorldClient(failed).prepare(1)).rejects.toThrow('nope');

    const thrown: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage() {
        throw 'blocked';
      },
    };
    await expect(new WorldClient(thrown).prepare(1)).rejects.toThrow('blocked');

    const raced: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage() {
        this.onerror?.(new ErrorEvent('error', { message: 'already' }));
        throw 'blocked';
      },
    };
    await expect(new WorldClient(raced).prepare(1)).rejects.toThrow('already');
  });

  it('keeps a grid the worker already baked', async () => {
    const handle = createWorldHandler();
    const port: WorldPort = {
      onmessage: null,
      onerror: null,
      postMessage(message) {
        void handle(message).then((value) =>
          port.onmessage?.({
            data: { id: message.id, ok: true, value },
          } as MessageEvent<WorldReply>),
        );
      },
    };
    const prepared = await prepareWorld(21, async () => new WorldClient(port));
    expect(prepared.terrain.height(4, -2)).toBeCloseTo(new Terrain(21).height(4, -2));
    const reused = await prepareWorld(21, async () => {
      throw new Error('should not open');
    });
    expect(reused.terrain).toBe(prepared.terrain);
  });

  it('bakes with the default handler', async () => {
    const port = scope();
    attachWorldWorker(port);
    port.onmessage?.({ data: { id: 8, method: 'prepare', seed: 5 } } as MessageEvent<WorldRequest>);
    await settle();
    expect(port.postMessage.mock.calls[0][1]).toHaveLength(7);
  });

  it('starts a worker when the browser has one and reuses it', async () => {
    vi.resetModules();
    const { createWorldHandler: handleOf } =
      await import('../../../src/client/worker/worldHandler.js');
    const handle = handleOf();
    class FakeWorker {
      static count = 0;
      static last: FakeWorker | null = null;
      onmessage: ((event: MessageEvent<WorldReply>) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      readonly url: URL;
      readonly options: WorkerOptions;
      constructor(url: URL, options: WorkerOptions) {
        this.url = url;
        this.options = options;
        FakeWorker.count += 1;
        FakeWorker.last = this;
      }
      postMessage(message: WorldRequest): void {
        void handle(message).then((value) =>
          this.onmessage?.({
            data: { id: message.id, ok: true, value },
          } as MessageEvent<WorldReply>),
        );
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const { prepareWorld: prepare } = await import('../../../src/client/worker/worldClient.js');
    const first = await prepare(11);
    const second = await prepare(12);
    expect(FakeWorker.count).toBe(1);
    expect(FakeWorker.last?.url.pathname.endsWith('/world.worker.ts')).toBe(true);
    expect(FakeWorker.last?.options).toEqual({ type: 'module' });
    expect(first.terrain.height(1, 2)).toBeCloseTo(new Terrain(11).height(1, 2));
    expect(second.seed).toBe(12);
    expect(second.terrain).not.toBe(first.terrain);
  });

  it('bakes on this thread when the worker constructor throws', async () => {
    vi.resetModules();
    let constructed = 0;
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          constructed += 1;
          throw new Error('denied');
        }
      },
    );
    const { prepareLocal: local, prepareWorld: prepare } =
      await import('../../../src/client/worker/worldClient.js');
    const baked = await prepare(13);
    const again = await prepare(14);
    expect(constructed).toBe(1);
    expect(baked.terrain.height(1, 1)).toBeCloseTo(local(13).terrain.height(1, 1));
    expect(again.seed).toBe(14);
  });

  it('wraps a non-error from the worker constructor', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw 'denied';
        }
      },
    );
    const { prepareLocal: local, prepareWorld: prepare } =
      await import('../../../src/client/worker/worldClient.js');
    const baked = await prepare(15);
    expect(baked.terrain.height(2, 2)).toBeCloseTo(local(15).terrain.height(2, 2));
  });
});
