import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pilotReady, readPilot, writePilot } from '../../src/client/settings.js';

const EMPTY = { baseURL: '', model: '', apiKey: '' };

beforeEach(() => {
  localStorage.clear();
});

describe('pilot settings', () => {
  it('starts empty', () => {
    expect(readPilot()).toEqual(EMPTY);
  });

  it('round-trips trimmed values and strips trailing slashes', () => {
    writePilot({ baseURL: ' https://example.com/// ', model: ' gpt ', apiKey: ' key ' });
    expect(readPilot()).toEqual({ baseURL: 'https://example.com', model: 'gpt', apiKey: 'key' });
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
