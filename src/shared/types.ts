export interface Controls {
  readonly throttle: number;
  readonly turn: number;
  readonly lift: number;
  readonly boost: number;
}

export const IDLE_CONTROLS: Controls = { throttle: 0, turn: 0, lift: 0, boost: 0 };
