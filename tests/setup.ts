import 'fake-indexeddb/auto';
import { afterEach, beforeEach, vi } from 'vitest';
import { AudioContextStub, installDomStubs, ResizeObserverStub } from './stubs.js';

installDomStubs();

beforeEach(() => {
  AudioContextStub.last = null;
  ResizeObserverStub.last = null;
});

afterEach(() => {
  vi.useRealTimers();
});
