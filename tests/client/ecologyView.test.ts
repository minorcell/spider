import { describe, expect, it, vi } from 'vitest';
import { applyEcologyLighting, EcologySky } from '../../src/client/ecologyView.js';
import { worldClock } from '../../src/shared/ecology.js';
import { Color, Vector3 } from 'three';
import { PALETTE } from '../../src/shared/config.js';

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

  it('keeps daylight paper bright and neutral while retaining visible shadows', () => {
    const sky = new EcologySky();
    const focus = new Vector3();
    for (const hour of [8, 12, 16]) {
      sky.update(worldClock(new Date(2026, 0, 1, hour)), focus, false);
      // Lambert diffuse response on upward-facing paper, matching Three's BRDF.
      const shadow = sky.ambient.color.clone().multiplyScalar(sky.ambient.intensity / Math.PI);
      const altitude = sky.light.position.clone().sub(sky.light.target.position).normalize().y;
      const lit = shadow
        .clone()
        .add(sky.light.color.clone().multiplyScalar((sky.light.intensity * altitude) / Math.PI));
      for (const value of lit.toArray()) {
        expect(value).toBeGreaterThan(0.85);
        expect(value).toBeLessThan(1.05);
      }
      for (const value of shadow.toArray()) {
        expect(value).toBeGreaterThan(0.7);
        expect(value).toBeLessThan(0.85);
      }
      expect(Math.max(...lit.toArray()) - Math.min(...lit.toArray())).toBeLessThan(0.06);
      expect(lit.r - shadow.r).toBeGreaterThan(0.1);
      expect(sky.light.castShadow).toBe(true);
    }
    sky.dispose();
  });

  it('keeps the daytime sky on paper and still darkens it at night', () => {
    const backgrounds: Color[] = [];
    const renderer = { setClearColor: (color: Color) => backgrounds.push(color.clone()) };
    for (const hour of [8, 12, 16, 23]) {
      applyEcologyLighting(renderer, new Date(2026, 0, 1, hour));
    }
    for (const color of backgrounds.slice(0, 3)) {
      expect(color.getHex()).toBe(PALETTE.paper);
    }
    expect(backgrounds[3].r).toBeLessThan(backgrounds[0].r * 0.3);
    const sky = new EcologySky();
    sky.update(worldClock(new Date(2026, 0, 1, 23)), new Vector3(), false);
    expect(sky.ambient.intensity / Math.PI).toBeLessThan(0.2);
    expect(sky.moon.visible).toBe(true);
    sky.dispose();
  });
});
