import type { IslandBuffers } from '../../shared/island.js';

export interface PreparedBuffers {
  seed: number;
  grid: Float32Array;
  island: IslandBuffers;
}

export type WorldRequest = { id: number; method: 'prepare'; seed: number };

export type WorldReply =
  | { id: number; ok: true; value: PreparedBuffers }
  | { id: number; ok: false; error: string };
