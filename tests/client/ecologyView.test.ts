import { describe, expect, it, vi } from 'vitest';
import { applyEcologyLighting, EcologySky } from '../../src/client/ecologyView.js';
import { worldClock } from '../../src/shared/ecology.js';
import { Vector3 } from 'three';

describe('applyEcologyLighting', () => {
  it('updates the renderer and returns the local clock', () => {
    const renderer = { setClearColor: vi.fn() };
    const noon = applyEcologyLighting(renderer, new Date(2026, 0, 1, 12));
    const night = applyEcologyLighting(renderer, new Date(2026, 0, 1, 23));

    expect(noon).toMatchObject({ period: 'day', daylight: 1 });
    expect(night).toMatchObject({ period: 'night', daylight: 0 });
    expect(renderer.setClearColor).toHaveBeenCalledTimes(2);
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(expect.anything(), 1);
  });

  it('moves the visible body and shadow light between day and night', () => {
    const sky = new EcologySky();
    const focus = new Vector3(2, 0, -3);
    sky.update(worldClock(new Date(2026, 0, 1, 12)), focus, false);
    expect(sky.clouds.children).toHaveLength(28);
    const cloudX = sky.clouds.children[0].position.x;
    sky.update(worldClock(new Date(2026, 0, 1, 12)), focus, false, 1);
    expect(sky.clouds.children[0].position.x).not.toBe(cloudX);
    expect(sky.sun.visible).toBe(true);
    expect(sky.moon.visible).toBe(false);
    sky.update(worldClock(new Date(2026, 0, 1, 23)), focus, true, 1);
    expect(sky.sun.visible).toBe(false);
    expect(sky.moon.visible).toBe(true);
    sky.update(worldClock(new Date(2026, 0, 1, 23)), focus, true);
    sky.dispose();
  });
});
