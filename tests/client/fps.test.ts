import { describe, expect, it, vi } from 'vitest';
import { FpsDisplay } from '@/src/client/fps';

describe('FpsDisplay', () => {
  it('exposes slow frames even when the average frame rate hides them', () => {
    const display = new FpsDisplay(document.createElement('div'));
    display.tick(0);
    for (let now = 16; now <= 480; now += 16) display.tick(now);
    display.tick(600);
    expect(display.element.title).toContain('P95 16.0 ms');
    expect(display.element.title).toContain('P99 120.0 ms');
    expect(display.element.title).toContain('长帧 1');
  });
  it('measures real frame intervals and only writes twice per second', () => {
    const host = document.createElement('div');
    const display = new FpsDisplay(host);
    expect(host.querySelector('#fps')?.textContent).toBe('FPS —');
    display.tick(0);
    display.tick(250);
    expect(display.element.textContent).toBe('FPS —');
    display.tick(500);
    expect(display.element.textContent).toBe('FPS 4');
    const observer = new MutationObserver(() => undefined);
    observer.observe(display.element, { childList: true });
    display.tick(750);
    display.tick(1000);
    expect(observer.takeRecords()).toHaveLength(0);
    display.tick(1010);
    display.tick(1500);
    expect(display.element.textContent).toBe('FPS 4');
    observer.disconnect();
  });

  it('resets on background pauses and nonincreasing timestamps', () => {
    const display = new FpsDisplay(document.createElement('div'));
    display.tick(0);
    display.tick(100);
    display.tick(5100);
    expect(display.element.textContent).toBe('FPS —');
    display.tick(5100);
    display.tick(5000);
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    display.tick(5200);
    hidden.mockRestore();
    display.tick(5450);
    display.tick(5700);
    expect(display.element.textContent).toBe('FPS 4');
  });
});
