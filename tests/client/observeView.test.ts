import { beforeEach, describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { ObserveOverlay } from '../../src/client/observeView.js';
import type { Spider } from '../../src/shared/sim/Spider.js';
import type { EntityState, SpiderState, WorldState } from '../../src/shared/state.js';
import { block, flat } from '../helpers.js';

const view = { left: 0, top: 0, width: 800, height: 600 };

function fakeSpider(x: number, z: number): Spider {
  const state: SpiderState = {
    time: 0,
    position: { x, y: 0, z },
    yaw: 0,
    speed: 0,
    height: 0,
    chassisPitch: 0,
    chassisRoll: 0,
    headYaw: 0,
    feet: [],
  };
  return {
    root: { position: new Vector3(x, 0, z) },
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
    expect(pins.innerHTML).not.toContain('apple-behind');
    const readout = parent.querySelector('#observe-readout')!;
    expect(readout.textContent).toContain('在巢里');
    expect(readout.textContent).toContain('面前');
    expect(readout.textContent).toContain('是 screen');
    expect(readout.textContent).toContain('背上 空');
    expect(readout.textContent).toContain('被挡住');
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
});
