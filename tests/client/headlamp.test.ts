import { describe, expect, it } from 'vitest';
import { CylinderGeometry, Group } from 'three';
import { DECK_Y } from '../../src/shared/config.js';
import { Headlamp } from '../../src/client/headlamp.js';
import { worldClock } from '../../src/shared/ecology.js';

describe('Headlamp', () => {
  it('lies flat on the cephalothorax, between the leg mounts', () => {
    const chassis = new Group();
    const lamp = new Headlamp();
    lamp.attach({ chassis });

    expect(lamp.pack.parent).toBe(chassis);
    expect(lamp.pack.position.z).toBeGreaterThan(-0.3);
    expect(lamp.pack.position.z).toBeLessThan(0.2);
    expect(lamp.pack.position.y).toBeGreaterThan(DECK_Y);
    expect(lamp.pack.position.y).toBeLessThan(DECK_Y + 0.35);
    expect(chassis.getObjectByName('headlamp-eye')).toBeUndefined();

    const lens = chassis.getObjectByName('headlamp-lens') as { geometry: CylinderGeometry };
    const { radiusTop, height } = lens.geometry.parameters;
    expect(height).toBeLessThan(radiusTop);
    expect(lamp.light.decay).toBe(1);
    expect(lamp.light.distance).toBeLessThan(10);

    lamp.update(worldClock(new Date(2026, 0, 1, 23)), true);
    expect(lamp.pack.visible).toBe(true);
    expect(lamp.light.intensity).toBeGreaterThan(2);

    lamp.update(worldClock(new Date(2026, 0, 1, 23)), false);
    expect(lamp.pack.visible).toBe(false);
    expect(lamp.light.intensity).toBe(0);

    lamp.update(worldClock(new Date(2026, 0, 1, 12)), true);
    expect(lamp.pack.visible).toBe(false);
    lamp.dispose();
  });
});
