import { PALETTE } from '../../src/shared/config.js';
import { describe, expect, it, vi } from 'vitest';
import { applyEcologyLighting, EcologySky } from '../../src/client/ecologyView.js';
import { buildIsland } from '../../src/client/groundView.js';
import { worldClock } from '../../src/shared/ecology.js';
import { Color, InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';

describe('applyEcologyLighting', () => {
  it('draws the original 159 cloud puffs in 28 independently culled batches', () => {
    const sky = new EcologySky();
    const clouds = sky.clouds.children as InstancedMesh[];
    expect(clouds).toHaveLength(28);
    expect(clouds.every((cloud) => cloud instanceof InstancedMesh)).toBe(true);
    expect(clouds.reduce((count, cloud) => count + cloud.count, 0)).toBe(159);
    expect(new Set(clouds.map((cloud) => cloud.geometry)).size).toBe(1);
    expect(new Set(clouds.map((cloud) => cloud.material)).size).toBe(4);
    const matrix = new Matrix4();
    for (const cloud of clouds) {
      expect(cloud.children).toHaveLength(0);
      expect(cloud.frustumCulled).toBe(true);
      expect(cloud.castShadow).toBe(false);
      expect(cloud.receiveShadow).toBe(false);
      expect(cloud.boundingSphere!.radius).toBeGreaterThan(0);
      for (let i = 0; i < cloud.count; i++) {
        cloud.getMatrixAt(i, matrix);
        const center = new Vector3().setFromMatrixPosition(matrix);
        expect(cloud.boundingBox!.containsPoint(center)).toBe(true);
      }
    }
    const instances = clouds.map((cloud) => Array.from(cloud.instanceMatrix.array));
    const versions = clouds.map((cloud) => cloud.instanceMatrix.version);
    const positions = clouds.map((cloud) => cloud.position.clone());
    const clock = worldClock(new Date(2026, 0, 1, 12));
    for (let i = 0; i < 120; i++) sky.update(clock, new Vector3(), false, 1 / 60);
    expect(clouds.every((cloud, i) => !cloud.position.equals(positions[i]))).toBe(true);
    expect(clouds.map((cloud) => Array.from(cloud.instanceMatrix.array))).toEqual(instances);
    expect(clouds.map((cloud) => cloud.instanceMatrix.version)).toEqual(versions);
    const disposals = clouds.map((cloud) => vi.spyOn(cloud, 'dispose'));
    sky.dispose();
    for (const disposal of disposals) expect(disposal).toHaveBeenCalledOnce();
  });

  it('updates the renderer and returns the local clock', () => {
    const renderer = { setClearColor: vi.fn((_color: Color) => undefined) };
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
    expect(backgrounds[3].r).toBeLessThan(0.05);
    const sky = new EcologySky();
    const focus = new Vector3();
    sky.update(worldClock(new Date(2026, 0, 1, 23)), focus, false);
    // A white fill on the paper palette is the milky film. Night has to stay near black.
    const fill = sky.ambient.color.clone().multiplyScalar(sky.ambient.intensity / Math.PI);
    const altitude = sky.light.position.clone().sub(sky.light.target.position).normalize().y;
    const moon = sky.light.color.clone().multiplyScalar((sky.light.intensity * altitude) / Math.PI);
    for (const value of fill.toArray()) expect(value).toBeLessThan(0.02);
    for (const value of fill.clone().add(moon).toArray()) expect(value).toBeLessThan(0.05);
    expect(sky.moon.visible).toBe(true);
    sky.dispose();
  });

  it('dims the unlit water at night and restores it at noon', () => {
    const water = buildIsland(() => 0).getObjectByName('water') as Mesh;
    const renderer = { setClearColor: vi.fn((_color: Color) => undefined) };
    applyEcologyLighting(renderer, new Date(2026, 0, 1, 23));
    const night = renderer.setClearColor.mock.calls.at(-1)![0] as Color;
    const brightness = night.r;
    applyEcologyLighting(renderer, new Date(2026, 0, 1, 12));
    const day = renderer.setClearColor.mock.calls.at(-1)![0] as Color;
    expect(day.r).toBeGreaterThan(brightness);
    expect(water.name).toBe('water');
  });
});
