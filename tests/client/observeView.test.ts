import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferAttribute, Line, PerspectiveCamera, Vector3 } from 'three';
import { ObserveOverlay } from '../../src/client/observeView.js';
import type { Spider } from '../../src/shared/sim/Spider.js';
import type { EntityState, SpiderState, WorldState } from '../../src/shared/state.js';
import { block, flat } from '../helpers.js';

const view = { left: 0, top: 0, width: 800, height: 600 };

function fakeSpider(x: number, z: number, height = 0): Spider {
  const state: SpiderState = {
    time: 0,
    position: { x, y: 0, z },
    yaw: 0,
    speed: 0,
    height,
    chassisPitch: 0,
    chassisRoll: 0,
    headYaw: 0,
    feet: [],
  };
  return {
    root: { position: new Vector3(x, 0, z) },
    yaw: 0,
    capture: () => state,
  } as unknown as Spider;
}

function entity(over: Partial<EntityState>): EntityState {
  return { id: 'apple-1', kind: 'apple', x: 0, y: 0, z: 0, stage: 0, ...over };
}

function world(over: Partial<WorldState> = {}): WorldState {
  return { seed: 1, terrain: { height: flat }, entities: [], blocks: [], carrying: [], ...over };
}

let parent: HTMLElement;

beforeEach(() => {
  parent = document.createElement('div');
  document.body.append(parent);
});

function camera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 800 / 600, 0.1, 1000);
  cam.position.set(0, 10, 10);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('ObserveOverlay', () => {
  it('builds its layer hidden', () => {
    const overlay = new ObserveOverlay(parent);
    expect(overlay.object.visible).toBe(true);
    expect(parent.querySelector<HTMLElement>('#observe')!.hidden).toBe(true);
  });

  it('shows and hides with the view flag', () => {
    const overlay = new ObserveOverlay(parent);
    overlay.sync(false, camera(), fakeSpider(0, 0), world(), view);
    expect(overlay.object.visible).toBe(false);
    expect(parent.querySelector<HTMLElement>('#observe')!.hidden).toBe(true);
  });

  it('marks reach, seen, hidden, and beyond, and projects pins', () => {
    const overlay = new ObserveOverlay(parent);
    const blocks = [block('screen', -1, 1, -4, -2)];
    const entities = [
      entity({ id: 'apple-reach', x: 0, y: 0.5, z: -0.5 }),
      entity({ id: 'apple-seen', x: 5, y: 0.5, z: 0 }),
      entity({ id: 'apple-hidden', x: 0, y: 0.5, z: -5 }),
      entity({ id: 'apple-beyond', x: 30, y: 0.5, z: 0 }),
      entity({ id: 'rock-1', kind: 'rock', x: 2, y: 0.5, z: 0 }),
      entity({ id: 'apple-behind', x: 0, y: 0.5, z: 30 }),
    ];
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ entities, blocks }), view);
    const pins = parent.querySelector('#observe-pins')!;
    expect(pins.innerHTML).toContain('data-state="reach"');
    expect(pins.innerHTML).toContain('data-state="seen"');
    expect(pins.innerHTML).toContain('data-state="hidden"');
    expect(pins.innerHTML).toContain('data-state="beyond"');
    expect(pins.innerHTML).toContain('rock-1　rock');
    const behind = Array.from(pins.querySelectorAll<HTMLElement>('.observe-pin')).find((pin) =>
      pin.textContent?.includes('apple-behind'),
    );
    expect(behind?.hidden).toBe(true);
    const readout = parent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('在巢里');
    expect(readout.textContent).toContain('面前');
    expect(readout.textContent).toContain('是 screen');
    expect(readout.textContent).toContain('背上 空');
    expect(readout.textContent).toContain('被挡住');
  });

  it('shows the ground height and each target rise', () => {
    const overlay = new ObserveOverlay(parent);
    const entities = [
      entity({ id: 'apple-high', x: 2, y: 2.5, z: 0 }),
      entity({ id: 'apple-low', x: -2, y: -0.5, z: 0 }),
    ];
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ entities }), view);
    const pins = parent.querySelector('#observe-pins')!;
    expect(pins.textContent).toContain('高 2.5');
    expect(pins.textContent).toContain('低 0.5');
    const readout = parent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('地面 0 米');
    expect(readout.textContent).toContain('离地 0 米');
  });

  it('reports grass cover and what is carried', () => {
    const overlay = new ObserveOverlay(parent);
    const grass = entity({
      id: 'grass-1',
      kind: 'grass',
      x: 5,
      z: 0,
      footprint: { kind: 'circle', r: 2 },
    });
    overlay.sync(
      true,
      camera(),
      fakeSpider(5, 0),
      world({
        entities: [grass],
        carrying: [entity({ id: 'apple-back', kind: 'apple', stage: 1 })],
      }),
      view,
    );
    const readout = parent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('在草里');
    expect(readout.textContent).toContain('背上 apple-back');
    expect(readout.textContent).toContain('面前 8 米是空的');
  });

  it('reports open ground and a steep rise', () => {
    const overlay = new ObserveOverlay(parent);
    const steep = (x: number, z: number): number => (z < -1 ? 10 + x : 0);
    overlay.sync(true, camera(), fakeSpider(10, 0), world({ terrain: { height: steep } }), view);
    const readout = parent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('在空地上');
    expect(readout.textContent).toContain('近乎竖直的坡');
  });

  it('renders untrusted entity labels as text', () => {
    const overlay = new ObserveOverlay(parent);
    overlay.sync(
      true,
      camera(),
      fakeSpider(0, 0),
      world({ entities: [entity({ id: '<img src=x onerror=alert(1)>' })] }),
      view,
    );
    expect(parent.querySelector('#observe-pins img')).toBeNull();
    expect(parent.querySelector('#observe-pins')?.textContent).toContain(
      '<img src=x onerror=alert(1)>',
    );
  });

  it('drops pins for entities that leave the map', () => {
    const overlay = new ObserveOverlay(parent);
    const apple = entity({ id: 'apple-1', x: 0, z: 0 });
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ entities: [apple] }), view);
    expect(parent.querySelector('#observe-pins')!.children).toHaveLength(1);
    overlay.sync(false, camera(), fakeSpider(0, 0), world({ entities: [apple] }), view);
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ entities: [] }), view);
    expect(parent.querySelector('#observe-pins')!.children).toHaveLength(0);
  });

  it('keeps a pin when the same entity is observed again', () => {
    const overlay = new ObserveOverlay(parent);
    const apple = entity({ id: 'apple-1', x: 0, z: 0 });
    const seen = world({ entities: [apple] });
    overlay.sync(true, camera(), fakeSpider(0, 0), seen, view);
    const pin = parent.querySelector('#observe-pins')!.children[0];
    overlay.sync(false, camera(), fakeSpider(0, 0), seen, view);
    overlay.sync(true, camera(), fakeSpider(0, 0), seen, view);
    expect(parent.querySelector('#observe-pins')!.children[0]).toBe(pin);
  });

  it('reuses a recent observation within the refresh window', () => {
    const overlay = new ObserveOverlay(parent);
    const spider = fakeSpider(0, 0);
    const capture = vi.spyOn(spider, 'capture');
    overlay.sync(true, camera(), spider, world(), view);
    overlay.sync(true, camera(), spider, world(), view);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('relays the sight ring with the observation, not every frame', () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
    const overlay = new ObserveOverlay(parent);
    const spider = fakeSpider(0, 0);
    const plain = world({ terrain: { height: () => 0 } });
    overlay.sync(true, camera(), spider, plain, view);
    const ring = (overlay.object.children[0] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    const first = ring.getX(0);

    spider.root.position.x = 3;
    overlay.sync(true, camera(), spider, plain, view);
    expect(ring.getX(0)).toBe(first);

    clock.mockReturnValue(1_000);
    overlay.sync(true, camera(), spider, plain, view);
    expect(ring.getX(0)).toBeCloseTo(3);
  });

  it('relays rings after reset even when the body has not moved', () => {
    const overlay = new ObserveOverlay(parent);
    const spider = fakeSpider(0, 0);
    overlay.sync(true, camera(), spider, world({ terrain: { height: () => 0 } }), view);
    const ring = (overlay.object.children[0] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    const y0 = ring.getY(0);
    overlay.reset();
    overlay.sync(true, camera(), spider, world({ terrain: { height: () => 4 } }), view);
    expect(ring.getY(0)).toBeGreaterThan(y0);
  });

  it('draws the sight area around a bank instead of a circle', () => {
    const overlay = new ObserveOverlay(parent);
    const bank = (_x: number, z: number): number => (z < -4 ? 3 : 0);
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ terrain: { height: bank } }), view);
    const ring = (overlay.object.children[0] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    expect(Math.hypot(ring.getX(0), ring.getZ(0))).toBeLessThan(5);
    expect(Math.hypot(ring.getX(36), ring.getZ(36))).toBeCloseTo(16);
  });

  it('widens the sight area when the body rears up', () => {
    const overlay = new ObserveOverlay(parent);
    const bank = (_x: number, z: number): number => (z < -4 ? 3 : 0);
    const ring = (overlay.object.children[0] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    overlay.sync(true, camera(), fakeSpider(0, 0), world({ terrain: { height: bank } }), view);
    const low = Math.hypot(ring.getX(0), ring.getZ(0));
    overlay.reset();
    overlay.sync(true, camera(), fakeSpider(0, 0, 1.6), world({ terrain: { height: bank } }), view);
    expect(Math.hypot(ring.getX(0), ring.getZ(0))).toBeGreaterThan(low);
  });

  it('reports the nearest water and standing in it', () => {
    const overlay = new ObserveOverlay(parent);
    const bank = (x: number): number => (x > 1 ? -2 : 0);
    overlay.sync(
      true,
      camera(),
      fakeSpider(0, 0),
      world({
        terrain: { height: bank, surface: (x) => Math.max(bank(x), -0.8) },
      }),
      view,
    );
    expect(parent.querySelector('#observe-readout')!.textContent).toContain('水在 90° 方向 1.3 米');

    const wetParent = document.createElement('div');
    document.body.append(wetParent);
    const wet = new ObserveOverlay(wetParent);
    wet.sync(
      true,
      camera(),
      fakeSpider(10, 0),
      world({ terrain: { height: () => -2, surface: () => -0.8 } }),
      view,
    );
    const readout = wetParent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('在水里');
    expect(readout.textContent).toContain('脚下是水');
  });

  it('aims the ahead line with the live yaw', () => {
    const overlay = new ObserveOverlay(parent);
    const spider = fakeSpider(0, 0);
    overlay.sync(true, camera(), spider, world(), view);
    const pos = (overlay.object.children[2] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    expect(pos.getX(1)).toBeCloseTo(0);
    expect(pos.getZ(1)).toBeLessThan(0);
    spider.yaw = Math.PI / 2;
    overlay.sync(true, camera(), spider, world(), view);
    expect(pos.getX(1)).toBeLessThan(0);
    expect(pos.getZ(1)).toBeCloseTo(0);
  });

  it('re-probes ahead along the live yaw', () => {
    const overlay = new ObserveOverlay(parent);
    const spider = fakeSpider(0, 0);
    const wall = block('nest-w', -8, -0.4, -1, 1, 2);
    overlay.sync(true, camera(), spider, world({ blocks: [wall] }), view);
    spider.yaw = Math.PI / 2;
    overlay.sync(true, camera(), spider, world({ blocks: [wall] }), view);
    const pos = (overlay.object.children[2] as Line).geometry.getAttribute(
      'position',
    ) as BufferAttribute;
    expect(pos.getX(1)).toBeGreaterThan(-2);
    expect(pos.getX(1)).toBeLessThan(0);
  });
});
