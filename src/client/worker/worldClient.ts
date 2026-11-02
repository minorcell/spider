import type { Group } from 'three';
import { islandGroup } from '../groundView.js';
import { islandBuffers } from '../../shared/island.js';
import { bakeTerrainGrid, Terrain } from '../../shared/terrain.js';
import type { PreparedBuffers, WorldReply, WorldRequest } from './worldProtocol.js';

/** The slice of Worker the client needs. Tests supply their own. */
export interface WorldPort {
  postMessage(message: WorldRequest): void;
  onmessage: ((event: MessageEvent<WorldReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}

interface Waiter {
  resolve(value: PreparedBuffers): void;
  reject(error: Error): void;
}

export interface PreparedWorld {
  seed: number;
  terrain: Terrain;
  island: Group;
}

/** Messages to the world worker. One island at a time. */
export class WorldClient {
  readonly #port: WorldPort;
  readonly #pending = new Map<number, Waiter>();
  #seq = 0;
  #failure: Error | null = null;

  constructor(port: WorldPort) {
    this.#port = port;
    port.onmessage = (event) => this.#receive(event.data);
    port.onerror = (event) => this.#fail(new Error(event.message));
  }

  prepare(seed: number): Promise<PreparedWorld> {
    return this.buffers(seed).then(assemble);
  }

  buffers(seed: number): Promise<PreparedBuffers> {
    return this.#call(seed);
  }

  #receive(reply: WorldReply): void {
    const waiter = this.#pending.get(reply.id);
    if (!waiter) return;
    this.#pending.delete(reply.id);
    if (reply.ok) waiter.resolve(reply.value);
    else waiter.reject(new Error(reply.error));
  }

  #fail(error: Error): void {
    this.#failure ??= error;
    for (const waiter of this.#pending.values()) waiter.reject(error);
    this.#pending.clear();
  }

  #call(seed: number): Promise<PreparedBuffers> {
    const id = ++this.#seq;
    return new Promise<PreparedBuffers>((resolve, reject) => {
      if (this.#failure) {
        reject(this.#failure);
        return;
      }
      this.#pending.set(id, { resolve, reject });
      try {
        this.#port.postMessage({ id, method: 'prepare', seed });
      } catch (error) {
        this.#pending.delete(id);
        const failure = error instanceof Error ? error : new Error(String(error));
        this.#failure ??= failure;
        reject(failure);
      }
    });
  }
}

export function assemble(data: PreparedBuffers): PreparedWorld {
  return {
    seed: data.seed,
    terrain: new Terrain(data.seed, data.grid),
    island: islandGroup(data.island),
  };
}

/** The same bake, on this thread. Used when the worker cannot start. */
export function prepareLocal(seed: number): PreparedWorld {
  return assemble(localBuffers(seed));
}

function localBuffers(seed: number): PreparedBuffers {
  const baked = seed >>> 0;
  const grid = bakeTerrainGrid(baked);
  const terrain = new Terrain(baked, grid);
  return { seed: baked, grid, island: islandBuffers((x, z) => terrain.height(x, z)) };
}

let opening: Promise<WorldClient | null> | null = null;

function openWorldWorker(): Promise<WorldClient | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  opening ??= new Promise<WorldClient>((resolve, reject) => {
    try {
      const worker = new Worker(new URL('./world.worker.ts', import.meta.url), { type: 'module' });
      resolve(new WorldClient(worker as unknown as WorldPort));
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  }).catch(() => null);
  return opening;
}

let cached: { seed: number; buffers: PreparedBuffers; terrain: Terrain } | null = null;

async function loadBuffers(
  seed: number,
  open: () => Promise<WorldClient | null>,
): Promise<PreparedBuffers> {
  try {
    const client = await open();
    if (!client) return localBuffers(seed);
    return await client.buffers(seed);
  } catch {
    return localBuffers(seed);
  }
}

/** Bake one island beside the page when a worker is available. Same seed reuses the grid. */
export async function prepareWorld(
  seed: number,
  open: () => Promise<WorldClient | null> = openWorldWorker,
): Promise<PreparedWorld> {
  const baked = seed >>> 0;
  if (!cached || cached.seed !== baked) {
    const buffers = await loadBuffers(baked, open);
    cached = { seed: buffers.seed, buffers, terrain: new Terrain(buffers.seed, buffers.grid) };
  }
  return { seed: cached.seed, terrain: cached.terrain, island: islandGroup(cached.buffers.island) };
}
