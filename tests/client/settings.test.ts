import { beforeEach, describe, expect, it, vi } from 'vitest';
import { contextTokensOf, pilotReady, readPilot, writePilot } from '../../src/client/settings.js';

beforeEach(() => {
  localStorage.clear();
});

const EMPTY = {
  baseURL: '',
  model: '',
  apiKey: '',
  contextTokens: null,
  autoMemory: false,
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

  it('stores a context length and drops a legacy compact threshold', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 8 });
    expect(readPilot()).not.toHaveProperty('compact');
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({
        baseURL: 'https://example.com',
        model: 'gpt',
        apiKey: 'key',
        contextTokens: 8,
        compact: true,
        compactKb: 400,
      }),
    );
    expect(readPilot()).toEqual({
      ...EMPTY,
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 8,
    });
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: 0,
    });
    expect(readPilot().contextTokens).toBeNull();
    expect(localStorage.getItem('spider.pilot')).not.toContain('compact');
  });

  it('stores auto memory as an opt-in flag', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      autoMemory: true,
    });
    expect(readPilot().autoMemory).toBe(true);
    writePilot({ baseURL: 'https://example.com', model: 'gpt', apiKey: 'key' });
    expect(readPilot().autoMemory).toBe(false);
  });

  it('reads integers written as strings', () => {
    writePilot({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
      contextTokens: '8' as unknown as number,
    });
    expect(readPilot()).toMatchObject({ contextTokens: 8 });
  });

  it('ignores fields of the wrong type', () => {
    localStorage.setItem(
      'spider.pilot',
      JSON.stringify({ baseURL: 1, model: null, apiKey: { key: 'x' } }),
    );
    expect(readPilot()).toEqual(EMPTY);
  });

  it('falls back to empty on malformed JSON', () => {
    localStorage.setItem('spider.pilot', '{nope');
    expect(readPilot()).toEqual(EMPTY);
  });

  it('keeps the legacy key when the new record is unusable', () => {
    localStorage.setItem('spider.pilot', '{nope');
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://old.example', model: 'o', apiKey: 'old' }),
    );
    expect(readPilot()).toMatchObject({
      baseURL: 'https://old.example',
      model: 'o',
      apiKey: 'old',
    });
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
    expect(localStorage.getItem('spider.pilot')).toContain('old.example');
  });

  it('migrates the previous p5-art key', () => {
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://example.com', model: 'gpt', apiKey: 'key' }),
    );
    expect(readPilot()).toMatchObject({
      baseURL: 'https://example.com',
      model: 'gpt',
      apiKey: 'key',
    });
    expect(localStorage.getItem('spider.pilot')).toBeTruthy();
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('keeps the new key when both exist', () => {
    writePilot({ baseURL: 'https://new.example', model: 'n', apiKey: 'k' });
    localStorage.setItem(
      'p5-art.pilot',
      JSON.stringify({ baseURL: 'https://old.example', model: 'o', apiKey: 'old' }),
    );
    expect(readPilot().baseURL).toBe('https://new.example');
    expect(localStorage.getItem('p5-art.pilot')).toBeNull();
  });

  it('keeps the new key when the old one cannot be deleted', () => {
    writePilot({ baseURL: 'https://new.example', model: 'n', apiKey: 'k' });
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(readPilot().baseURL).toBe('https://new.example');
    writePilot({ baseURL: 'https://newer.example', model: 'n', apiKey: 'k' });
    remove.mockRestore();
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

  it('turns k token into tokens on the 1000 scale vendors publish', () => {
    expect(contextTokensOf(null)).toBeNull();
    expect(contextTokensOf(8)).toBe(8000);
    expect(contextTokensOf(128)).toBe(128_000);
  });
});
