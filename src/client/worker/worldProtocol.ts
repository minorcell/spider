export interface PreparedBuffers {
  seed: number;
  grid: Float32Array;
}

export type WorldRequest = { id: number; method: 'prepare'; seed: number };

export type WorldReply =
  | { id: number; ok: true; value: PreparedBuffers }
  | { id: number; ok: false; error: string };
