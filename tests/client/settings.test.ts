import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pilotReady, readPilot, writePilot } from '../../src/client/settings.js';

beforeEach(() => {
  localStorage.clear();
});

const EMPTY = {
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  compact: false,
  compactKb: null,
};

describe('pilot settings', () => {
  it('starts empty', () => {
    expect(readPilot()).toEqual(EMPTY);
  });

  it('round-trips trimmed values and strips trailing slashes', () => {
    writePilot({ baseURL: ' https://example.com/// ', model: ' gpt ', apiKey: ' key ' });
    expect(readPilot()).toEqual({
      ...EMPTY,
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
    });
  });

  it('stores a context length and a compact threshold', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8192,
      compact: true,
      compactKb: 400,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 8192, compact: true, compactKb: 400 });
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 0,
      compactKb: -3,
    });
    expect(readPilot()).toMatchObject({ contextTokens: null, compact: false, compactKb: null });
  });

  it('reads integers written as strings', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: '4096' as unknown as number,
      compactKb: '128' as unknown as number,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 4096, compactKb: 128 });
  });

  it('ignores fields of the wrong type', () => {
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 1, model: null, apiKey: { key: 'x' } }),
    );
    expect(readPilot()).toEqual(EMPTY);
  });

  it('falls back to empty on malformed JSON', () => {
    localStorage.setItem('p5-art.pilot', '{nope');
    expect(readPilot()).toEqual(EMPTY);
  });

  it('falls back to empty when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPilot()).toEqual(EMPTY);
  });

  it('needs all three fields', () => {
    expect(pilotReady({ baseURL: 'a', model: 'b', apiKey: 'c' })).toBe(true);
    expect(pilotReady({ baseURL: '', model: 'b', apiKey: 'c' })).toBe(false);
    expect(pilotReady({ baseURL: 'a', model: '', apiKey: 'c' })).toBe(false);
    expect(pilotReady({ baseURL: 'a', model: 'b', apiKey: '' })).toBe(false);
  });
});
