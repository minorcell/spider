import { vi } from 'vitest';

export class ResizeObserverStub {
  static last: ResizeObserverStub | null = null;

  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();

  constructor(readonly callback: ResizeObserverCallback) {
    ResizeObserverStub.last = this;
  }

  trigger(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

class AudioParamStub {
  value = 0;
  setValueAtTime = vi.fn(() => this);
  exponentialRampToValueAtTime = vi.fn(() => this);
}

class AudioNodeStub {
  connect = vi.fn();
  disconnect = vi.fn();
}

class GainNodeStub extends AudioNodeStub {
  gain = new AudioParamStub();
}

export class OscillatorNodeStub extends AudioNodeStub {
  type = 'sine';
  frequency = new AudioParamStub();
  start = vi.fn();
  stop = vi.fn();
}

export class BufferSourceStub extends AudioNodeStub {
  buffer: AudioBuffer | null = null;
  start = vi.fn();
  stop = vi.fn();
}

export class BiquadFilterStub extends AudioNodeStub {
  type = 'lowpass';
  frequency = new AudioParamStub();
  Q = new AudioParamStub();
}

export class AudioContextStub {
  static last: AudioContextStub | null = null;

  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 8000;
  destination = new AudioNodeStub();
  buffers: AudioBuffer[] = [];
  gains: GainNodeStub[] = [];
  oscillators: OscillatorNodeStub[] = [];
  sources: BufferSourceStub[] = [];
  filters: BiquadFilterStub[] = [];

  constructor() {
    AudioContextStub.last = this;
  }

  resume = vi.fn(async () => {
    this.state = 'running';
  });

  close = vi.fn(async () => {
    this.state = 'closed';
  });

  createGain = vi.fn(() => {
    const node = new GainNodeStub();
    this.gains.push(node);
    return node;
  });

  createOscillator = vi.fn(() => {
    const node = new OscillatorNodeStub();
    this.oscillators.push(node);
    return node;
  });

  createBufferSource = vi.fn(() => {
    const node = new BufferSourceStub();
    this.sources.push(node);
    return node;
  });

  createBiquadFilter = vi.fn(() => {
    const node = new BiquadFilterStub();
    this.filters.push(node);
    return node;
  });

  createBuffer = vi.fn((channels: number, length: number, rate: number) => {
    const data = new Float32Array(length);
    const buffer = {
      sampleRate: rate,
      length,
      duration: length / rate,
      numberOfChannels: channels,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    this.buffers.push(buffer);
    return buffer;
  });
}

export function installDomStubs(): void {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    configurable: true,
    value: ResizeObserverStub,
  });
  Object.defineProperty(globalThis, 'AudioContext', {
    writable: true,
    configurable: true,
    value: AudioContextStub,
  });

  if (typeof HTMLDialogElement === 'undefined') return;
  const dialog = HTMLDialogElement.prototype as HTMLDialogElement & {
    showModal?: () => void;
    close?: () => void;
  };
  dialog.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true;
  };
  dialog.close = function close(this: HTMLDialogElement): void {
    this.open = false;
    this.dispatchEvent(new Event('close'));
  };
}
