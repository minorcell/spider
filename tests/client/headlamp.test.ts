import { describe, expect, it } from 'vitest';
import { Group, SphereGeometry, Vector3 } from 'three';
import { Headlamp } from '../../src/client/headlamp.js';
import { worldClock } from '../../src/shared/ecology.js';

function rig() {
  const root = new Group();
  const chassis = new Group();
  const head = new Group();
  head.name = 'head';
  root.add(chassis);
  chassis.add(head);
  return { root, chassis, head };
}

describe('Headlamp', () => {
  it('puts glow on the eyes and a larger lantern on the back', () => {
    const { root, chassis, head } = rig();
    const lamp = new Headlamp();
    lamp.attach({ root, chassis });
    head.updateWorldMatrix(true, true);

    const eye = head.getObjectByName('headlamp-eye')!;
    const at = new Vector3();
    const lens = new Vector3();
    head.getWorldPosition(at);
    eye.getWorldPosition(lens);
    expect(lens.z).toBeLessThan(at.z);
    expect(lamp.back.position.z).toBeGreaterThan(0.5);
    const back = lamp.back.getObjectByName('headlamp-back-bulb') as {
      geometry: SphereGeometry;
    };
    expect(back.geometry.parameters.radius).toBeGreaterThan(
      (eye as { geometry: SphereGeometry }).geometry.parameters.radius,
    );
    expect(lamp.eyeLight.decay).toBe(1);
    expect(lamp.backLight.distance).toBeLessThan(10);

    lamp.update(worldClock(new Date(2026, 0, 1, 23)), true);
    expect(lamp.eyes.visible).toBe(true);
    expect(lamp.back.visible).toBe(true);
    expect(lamp.eyeLight.intensity).toBeGreaterThan(1);
    expect(lamp.backLight.intensity).toBeGreaterThan(lamp.eyeLight.intensity);

    lamp.update(worldClock(new Date(2026, 0, 1, 23)), false);
    expect(lamp.eyes.visible).toBe(false);
    expect(lamp.backLight.intensity).toBe(0);

    lamp.update(worldClock(new Date(2026, 0, 1, 12)), true);
    expect(lamp.eyes.visible).toBe(false);
    lamp.dispose();
  });

  it('turns the eyes with the head and leaves the back lantern put', () => {
    const { root, chassis, head } = rig();
    const lamp = new Headlamp();
    lamp.attach({ root, chassis });
    head.rotation.y = Math.PI / 2;
    root.updateWorldMatrix(true, true);
    const lens = new Vector3();
    const at = new Vector3();
    head.getWorldPosition(at);
    head.getObjectByName('headlamp-eye')!.getWorldPosition(lens);
    expect(lens.x).toBeLessThan(at.x - 0.03);
    expect(lamp.back.parent).toBe(chassis);
    lamp.dispose();
  });
});
