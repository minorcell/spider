import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindFocus, onMedia, paint } from './style.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('style', () => {
  it('copies declarations onto the element', () => {
    const node = document.createElement('div');
    paint(node, { color: '#1b1714', display: 'grid' });
    expect(node.style.color).toBe('rgb(27, 23, 20)');
    expect(node.style.display).toBe('grid');
  });

  it('treats a missing matchMedia as a wide viewport', () => {
    vi.stubGlobal('matchMedia', undefined);
    const seen: boolean[] = [];
    onMedia('(max-width: 820px)', (matches) => seen.push(matches));
    expect(seen).toEqual([false]);
  });

  it('follows a media query across changes', () => {
    let matches = false;
    const listeners: Array<() => void> = [];
    vi.stubGlobal('matchMedia', (query: string) => {
      expect(query).toBe('(max-width: 820px)');
      return {
        get matches() {
          return matches;
        },
        addEventListener(_type: string, listener: () => void) {
          listeners.push(listener);
        },
      };
    });
    const seen: boolean[] = [];
    onMedia('(max-width: 820px)', (value) => seen.push(value));
    matches = true;
    listeners[0]?.();
    expect(seen).toEqual([false, true]);
  });

  it('draws and clears a focus outline', () => {
    const node = document.createElement('button');
    document.body.append(node);
    bindFocus(node);
    node.dispatchEvent(new FocusEvent('focus'));
    expect(node.style.outline).toBe('1px solid var(--ui-ink)');
    node.dispatchEvent(new FocusEvent('blur'));
    expect(node.style.outline).toBe('');
    node.remove();
  });
});
