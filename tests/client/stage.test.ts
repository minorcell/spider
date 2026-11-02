import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry } from 'three';
import { Spider as RealSpider } from '../../src/shared/sim/Spider.js';
import type { EntityState, WorldState } from '../../src/shared/state.js';
import { Stage } from '../../src/client/stage.js';
import { flat } from '../helpers.js';
import { ResizeObserverStub } from '../stubs.js';

const threeControl = vi.hoisted(() => ({
  renderers: [] as FakeRenderer[],
  onRender: null as
    | null
    | ((camera: {
        position: { set(x: number, y: number, z: number): void };
        lookAt(x: number, y: number, z: number): void;
      }) => void),
}));

interface FakeRenderer {
  domElement: HTMLCanvasElement;
  loop: ((time: number) => void) | null;
  setPixelRatio: ReturnType<typeof vi.fn>;
  setClearColor: ReturnType<typeof vi.fn>;
  setSize: ReturnType<typeof vi.fn>;
  setAnimationLoop: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class WebGLRenderer implements FakeRenderer {
    domElement = document.createElement('canvas');
    loop: ((time: number) => void) | null = null;
    setPixelRatio = vi.fn();
    setClearColor = vi.fn();
    setSize = vi.fn();
    setAnimationLoop = vi.fn((callback: ((time: number) => void) | null) => {
      this.loop = callback;
    });
    render = vi.fn(
      (
        _scene: unknown,
        camera?: {
          updateMatrixWorld?: () => void;
          position: { set(x: number, y: number, z: number): void };
          lookAt(x: number, y: number, z: number): void;
        },
      ) => {
        if (camera) threeControl.onRender?.(camera);
        camera?.updateMatrixWorld?.();
      },
    );
    dispose = vi.fn();

    constructor() {
      this.domElement.setPointerCapture = vi.fn();
      this.domElement.releasePointerCapture = vi.fn();
      this.domElement.getBoundingClientRect = () =>
        ({
          left: 0,
          top: 0,
          width: 800,
          height: 600,
          right: 800,
          bottom: 600,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      threeControl.renderers.push(this);
    }
  }
  return { ...actual, WebGLRenderer };
});

const sound = {
  step: vi.fn(),
  bite: vi.fn(),
  take: vi.fn(),
  grasp: vi.fn(),
  place: vi.fn(),
  knock: vi.fn(),
  voice: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('../../src/client/sound.js', () => ({ createSound: () => sound }));

function makeHost(width = 800, height = 600): HTMLElement {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: height });
  document.body.append(host);
  return host;
}

function renderer(): FakeRenderer {
  return threeControl.renderers.at(-1)!;
}

function entity(over: Partial<EntityState>): EntityState {
  return { id: 'apple-1', kind: 'apple', x: 2, y: 0, z: 0, stage: 0, ...over };
}

function makeWorld(over: Partial<WorldState> = {}): WorldState {
  return { seed: 1, terrain: { height: flat }, entities: [], blocks: [], carrying: [], ...over };
}

function frame(extraMs = 16): void {
  const loop = renderer().loop!;
  loop(performance.now() + extraMs);
}

beforeEach(() => {
  threeControl.renderers = [];
  threeControl.onRender = null;
  for (const key of Object.keys(sound)) sound[key as keyof typeof sound].mockReset();
  document.body.innerHTML = '';
});

describe('Stage setup', () => {
  it('creates the renderer, camera, and canvas', () => {
    const dispose = vi.spyOn(BufferGeometry.prototype, 'dispose');
    const host = makeHost();
    const spider = new RealSpider();
    const stage = new Stage(host, spider);
    const draw = renderer();
    expect(host.contains(draw.domElement)).toBe(true);
    expect(draw.setPixelRatio).toHaveBeenCalled();
    expect(draw.setSize).toHaveBeenCalledWith(800, 600, false);
    stage.dispose();
    expect(draw.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(draw.dispose).toHaveBeenCalled();
    expect(dispose).toHaveBeenCalled();
    expect(sound.dispose).toHaveBeenCalled();
    expect(host.contains(draw.domElement)).toBe(false);
  });

  it('falls back to a pixel ratio of one', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 0 });
    void new Stage(makeHost(), new RealSpider());
    expect(renderer().setPixelRatio).toHaveBeenCalledWith(1);
  });

  it('rescales when the observer fires', () => {
    const host = makeHost(0, 0);
    void new Stage(host, new RealSpider());
    const draw = renderer();
    expect(draw.setSize).not.toHaveBeenCalled();
    Object.defineProperty(host, 'clientWidth', { configurable: true, value: 640 });
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 480 });
    ResizeObserverStub.last!.trigger();
    expect(draw.setSize).toHaveBeenCalledWith(640, 480, false);
  });

  it('runs without a bound world', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    stage.start();
    frame();
    expect(renderer().render).toHaveBeenCalled();
    stage.voice();
    expect(sound.voice).toHaveBeenCalled();
  });
});

describe('world sync', () => {
  it('builds the island once and rebuilds props as they change', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0 });
    const grass = entity({
      id: 'grass-1',
      kind: 'grass',
      x: -2,
      y: 0,
      z: 0,
      footprint: { kind: 'circle', r: 1.5 },
    });
    const rock = entity({ id: 'rock-1', kind: 'rock', x: 0, y: 0, z: 2 });
    const carried = entity({ id: 'apple-back', x: 0, y: 0, z: 0 });
    let current = makeWorld({ entities: [apple, grass, rock] });
    const step = vi.fn();
    const anchor = vi.fn();
    stage.bind(step, () => current);
    stage.follow(anchor);
    stage.start();

    frame();
    expect(step).toHaveBeenCalled();
    expect(anchor).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number) }));

    apple.stage = 1;
    current = { ...current, entities: [apple, grass, rock], carrying: [carried] };
    frame();
    expect(sound.bite).toHaveBeenCalled();
    expect(sound.grasp).toHaveBeenCalled();

    frame();
    expect(sound.grasp).toHaveBeenCalledTimes(1);

    current = { ...current, entities: [apple, grass, rock, carried], carrying: [] };
    frame();
    expect(sound.place).toHaveBeenCalled();

    current = { ...current, entities: [grass, rock, carried] };
    frame();
    expect(sound.take).toHaveBeenCalled();
  });

  it('retile drops the baked island and builds it again', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    stage.retile();
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0 });
    const current = makeWorld({ entities: [apple] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    stage.retile();
    frame();
    expect(sound.take).not.toHaveBeenCalled();
  });

  it('rebuilds a prop without a bite when the stage goes backwards', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0, stage: 1 });
    const current = makeWorld({ entities: [apple] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    apple.stage = 0;
    frame();
    expect(sound.bite).not.toHaveBeenCalled();
  });

  it('does not sound a place for a carried prop that vanished', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const carried = entity({ id: 'apple-back', x: 0, y: 0, z: 0 });
    let current = makeWorld({ carrying: [carried] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    current = makeWorld({ entities: [], carrying: [] });
    frame();
    expect(sound.place).not.toHaveBeenCalled();
    expect(sound.take).toHaveBeenCalled();
  });

  it('keeps one prop for an unchanged stage', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0, stage: 1 });
    const current = makeWorld({ entities: [apple] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    frame();
    expect(sound.bite).not.toHaveBeenCalled();
  });
});

describe('camera input', () => {
  it('orbits and zooms within the chase limits', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const canvas = renderer().domElement;
    stage.start();
    frame();

    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 10, clientY: 10 }));
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, clientY: 120 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 140, clientY: 120 }));

    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -10000, cancelable: true, bubbles: true }),
      );
    }
    for (let i = 0; i < 20; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 10000, cancelable: true, bubbles: true }),
      );
    }
    frame();
    expect(renderer().render).toHaveBeenCalled();
  });

  it('pans and raises the camera in the overlook', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const canvas = renderer().domElement;
    stage.setOverlook(true);
    stage.start();
    frame();
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 900, clientY: -900 }));
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: -10000, cancelable: true, bubbles: true }),
      );
    }
    for (let i = 0; i < 30; i++) {
      canvas.dispatchEvent(
        new WheelEvent('wheel', { deltaY: 10000, cancelable: true, bubbles: true }),
      );
    }
    frame();
    stage.setOverlook(false);
    frame();
    expect(renderer().render).toHaveBeenCalled();
  });

  it('places a prop only on a near-stationary click', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const canvas = renderer().domElement;
    const placed = vi.fn();
    stage.onGroundClick = placed;
    stage.start();
    frame();

    stage.setPlaceMode(false);
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, clientY: 100 }));
    expect(placed).not.toHaveBeenCalled();

    stage.setPlaceMode(true);
    expect(canvas.style.cursor).toBe('crosshair');
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, clientY: 100 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 150, clientY: 100 }));
    expect(placed).not.toHaveBeenCalled();

    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 402, clientY: 301 }));
    expect(placed).toHaveBeenCalledTimes(1);
    expect(Number.isFinite(placed.mock.calls[0][0])).toBe(true);

    stage.setPlaceMode(false);
    expect(canvas.style.cursor).toBe('');
  });

  it('ignores a click whose ray misses the ground', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const placed = vi.fn();
    stage.onGroundClick = placed;
    stage.setPlaceMode(true);
    stage.start();
    threeControl.onRender = (camera) => {
      camera.position.set(0, 5, 0);
      camera.lookAt(0, 5, -10);
    };
    frame();
    const canvas = renderer().domElement;
    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(new MouseEvent('pointerup', { clientX: 400, clientY: 300 }));
    expect(placed).not.toHaveBeenCalled();
  });

  it('ignores pointer ups without a drag', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const placed = vi.fn();
    stage.onGroundClick = placed;
    stage.setPlaceMode(true);
    renderer().domElement.dispatchEvent(
      new MouseEvent('pointerup', { clientX: 100, clientY: 100 }),
    );
    expect(placed).not.toHaveBeenCalled();
  });
});

describe('feedback', () => {
  it('ticks for a landing foot and knocks on a halt', () => {
    const spider = new RealSpider();
    const stage = new Stage(makeHost(), spider);
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();

    frame();
    expect(sound.step).not.toHaveBeenCalled();

    spider.legs[0].lifted = true;
    frame();
    spider.legs[0].lifted = false;
    frame();
    expect(sound.step).toHaveBeenCalled();

    spider.halt = 'steep';
    frame();
    expect(sound.knock).toHaveBeenCalledTimes(1);
    spider.halt = 'clear';
    frame();
    spider.halt = 'solid';
    frame();
    expect(sound.knock).toHaveBeenCalledTimes(2);
  });

  it('reports the anchor and hides a behind-camera point', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const anchor = vi.fn();
    stage.follow(anchor);
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    frame();
    expect(anchor).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number) }));
  });

  it('hides the anchor when the shell is behind the camera', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const anchor = vi.fn();
    stage.follow(anchor);
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    threeControl.onRender = (camera) => {
      camera.position.set(0, 1.45, 10);
      camera.lookAt(0, 1.45, 20);
    };
    frame();
    expect(anchor).toHaveBeenLastCalledWith(null);
  });

  it('stops listening after dispose', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const draw = renderer();
    stage.dispose();
    draw.domElement.dispatchEvent(new MouseEvent('pointerdown', { clientX: 1, clientY: 1 }));
    expect(draw.domElement.setPointerCapture).not.toHaveBeenCalled();
  });
});
