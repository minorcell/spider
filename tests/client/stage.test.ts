import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group } from 'three';
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
    shadowMap = { enabled: false, type: 0 };
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
  return {
    seed: 1,
    terrain: { height: flat },
    entities: [],
    blocks: [],
    marks: [],
    carrying: [],
    ...over,
  };
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

  it('draws at the screen pixels on a retina display', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    void new Stage(makeHost(), new RealSpider());
    expect(renderer().setPixelRatio).toHaveBeenCalledWith(2);
  });

  it('caps the pixel ratio at two', () => {
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 3 });
    void new Stage(makeHost(), new RealSpider());
    expect(renderer().setPixelRatio).toHaveBeenCalledWith(2);
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

  it('keeps drawing while a cloud hold skips the simulation step', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const step = vi.fn();
    stage.bind(step, () => makeWorld());
    stage.start();
    stage.hold(true);
    frame();
    expect(step).not.toHaveBeenCalled();
    expect(renderer().render).toHaveBeenCalled();
    stage.hold(false);
    frame();
    expect(step).toHaveBeenCalledTimes(1);
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

  it('spins a round prop around its center and leaves the bottom on the ground', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const apple = entity({
      id: 'apple-1',
      x: 2,
      y: 0.5,
      z: 0,
      qx: 0,
      qy: 0,
      qz: 0.1,
      qw: 0.995,
    });
    const nest = entity({ id: 'home', kind: 'nest', x: 0, y: 0.02, z: 0 });
    stage.bind(vi.fn(), () => makeWorld({ entities: [apple, nest] }));
    stage.start();
    frame();
    const scene = renderer().render.mock.calls.at(-1)?.[0] as {
      children: {
        position: { x: number; y: number; z: number };
        quaternion: { z: number; w: number };
        children: { position: { y: number } }[];
      }[];
    };
    const prop = scene.children.find((child) => Math.abs(child.position.x - 2) < 1e-6);
    expect(prop?.position.y).toBeCloseTo(0.5 + 0.36);
    expect(prop?.quaternion.z).toBeCloseTo(0.1);
    expect(prop?.quaternion.w).toBeCloseTo(0.995);
    expect(prop?.children[0]?.position.y).toBeCloseTo(-0.36);
  });

  it('keeps a placed island and swaps in the next one from the source', async () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const first = new Group();
    first.name = 'ready';
    stage.placeIsland(first);
    const next = new Group();
    next.name = 'next';
    stage.setIslandSource(async () => next);
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    frame();
    const scene = () =>
      renderer().render.mock.calls.at(-1)?.[0] as { children: { name: string }[] };
    expect(scene().children.some((child) => child.name === 'ready')).toBe(true);
    stage.retile();
    frame();
    expect(scene().children.some((child) => child.name === 'ready')).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame();
    expect(scene().children.some((child) => child.name === 'next')).toBe(true);

    stage.setIslandSource(async () => {
      throw new Error('no mesh');
    });
    stage.retile();
    await new Promise((resolve) => setTimeout(resolve, 0));
    frame();
    expect(scene().children.some((child) => child.name === 'next')).toBe(false);
  });

  it('drops a placed island when the world is not bound yet', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const placed = new Group();
    placed.name = 'placed';
    stage.placeIsland(placed);
    const source = vi.fn(async () => new Group());
    stage.setIslandSource(source);
    stage.retile();
    expect(source).not.toHaveBeenCalled();
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    frame();
    const scene = renderer().render.mock.calls.at(-1)?.[0] as { children: { name: string }[] };
    expect(scene.children.some((child) => child.name === 'placed')).toBe(false);
  });

  it('ignores an island that arrives after a newer one was requested', async () => {
    const stage = new Stage(makeHost(), new RealSpider());
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    let resolveStale: (group: Group) => void = () => {};
    let resolveFresh: (group: Group) => void = () => {};
    const stale = new Group();
    stale.name = 'stale';
    const fresh = new Group();
    fresh.name = 'fresh';
    stage.setIslandSource(
      () =>
        new Promise((resolve) => {
          resolveStale = resolve;
        }),
    );
    stage.retile();
    stage.setIslandSource(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
    stage.retile();
    resolveStale(stale);
    await Promise.resolve();
    frame();
    const names = (): string[] => {
      const scene = renderer().render.mock.calls.at(-1)?.[0] as { children: { name: string }[] };
      return scene.children.map((child) => child.name);
    };
    expect(names()).not.toContain('stale');
    resolveFresh(fresh);
    await Promise.resolve();
    frame();
    expect(names()).toContain('fresh');
    expect(names()).not.toContain('stale');
  });

  it('ignores a failed island after a newer one was requested', async () => {
    const stage = new Stage(makeHost(), new RealSpider());
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    let rejectStale: (error: Error) => void = () => {};
    let resolveFresh: (group: Group) => void = () => {};
    const fresh = new Group();
    fresh.name = 'fresh';
    stage.setIslandSource(
      () =>
        new Promise((_, reject) => {
          rejectStale = reject;
        }),
    );
    stage.retile();
    stage.setIslandSource(
      () =>
        new Promise((resolve) => {
          resolveFresh = resolve;
        }),
    );
    stage.retile();
    rejectStale(new Error('late'));
    await Promise.resolve();
    frame();
    const scene = renderer().render.mock.calls.at(-1)?.[0] as { children: unknown[] };
    expect(scene.children.map((child) => (child as { name: string }).name)).toContain(
      'ecology-sky',
    );
    expect(scene.children).toHaveLength(4);
    resolveFresh(fresh);
    await Promise.resolve();
    frame();
    const drawn = renderer().render.mock.calls.at(-1)?.[0] as { children: { name: string }[] };
    expect(drawn.children.map((child) => child.name)).toContain('fresh');
  });

  it('retile drops the baked island and builds it again', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    stage.retile();
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0 });
    const current = makeWorld({ entities: [apple] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    stage.setOverlook(true);
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

  it('keeps a carried prop silent when another joins the back', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const first = entity({ id: 'apple-a', x: 0, y: 0, z: 0 });
    const second = entity({ id: 'apple-b', x: 0, y: 0, z: 0 });
    let current = makeWorld({ carrying: [first] });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    current = makeWorld({ carrying: [first, second] });
    frame();
    expect(sound.grasp).toHaveBeenCalledTimes(1);
    expect(sound.place).not.toHaveBeenCalled();
  });

  it('lays seven carried props out in two rows', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const held = Array.from({ length: 7 }, (_, index) =>
      entity({ id: `apple-${index}`, x: 0, y: 0, z: 0 }),
    );
    const current = makeWorld({ carrying: held });
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    expect(renderer().render).toHaveBeenCalled();
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

  it('drags the overlook like a map and holds the view angle', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const canvas = renderer().domElement;
    const at = { x: 0, y: 0, z: 0 };
    const spin = [0, 0, 0, 0];
    threeControl.onRender = (camera) => {
      const placed = camera as unknown as {
        position: { x: number; y: number; z: number };
        quaternion: { x: number; y: number; z: number; w: number };
      };
      at.x = placed.position.x;
      at.y = placed.position.y;
      at.z = placed.position.z;
      spin[0] = placed.quaternion.x;
      spin[1] = placed.quaternion.y;
      spin[2] = placed.quaternion.z;
      spin[3] = placed.quaternion.w;
    };

    stage.setOverlook(true);
    stage.start();
    frame();

    let tick = 16;
    const settle = (): void => {
      for (let i = 0; i < 80; i++) {
        tick += 16;
        frame(tick);
      }
    };
    const start = { ...at };
    const heading = [...spin];

    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300 }));
    // 往右拖：地图向右走，镜头向左让出位置。
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 300 }));
    frame();
    settle();
    expect(at.x).toBeLessThan(start.x);
    expect(at.z).toBeCloseTo(start.z);
    // 视角不跟着摆。
    expect(spin).toEqual(heading);

    const panned = { ...at };
    // 往下拖：地图向下走，镜头往回退。
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 400 }));
    frame();
    settle();
    expect(at.z).toBeLessThan(panned.z);
    expect(at.x).toBeCloseTo(panned.x);
    expect(spin).toEqual(heading);
  });

  it('eases from the chase view into the overlook', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    let cameraY = 0;
    threeControl.onRender = (camera) => {
      cameraY = (camera as unknown as { position: { y: number } }).position.y;
    };
    stage.bind(vi.fn(), () => makeWorld());
    stage.start();
    frame();
    const chaseY = cameraY;

    stage.setOverlook(true);
    frame();
    // 第一帧只走一段，不会直接瞬移到 34 米高。
    expect(cameraY).toBeGreaterThan(chaseY);
    expect(cameraY).toBeLessThan(34);

    let tick = 16;
    for (let i = 0; i < 80; i++) {
      tick += 16;
      frame(tick);
    }
    expect(cameraY).toBeCloseTo(34, 1);
  });

  it('follows the ground and clears ridges in the overlook', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const canvas = renderer().domElement;
    let cameraY = 0;
    threeControl.onRender = (camera) => {
      cameraY = (camera as unknown as { position: { y: number } }).position.y;
    };
    const terrain = { height: (x: number) => (x < -1 ? 5 : 0) };
    stage.bind(vi.fn(), () => makeWorld({ terrain }));
    stage.setOverlook(true);
    stage.start();
    frame();
    const level = cameraY;

    canvas.dispatchEvent(new MouseEvent('pointerdown', { clientX: 400, clientY: 300 }));
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 300 }));
    let tick = 16;
    for (let i = 0; i < 80; i++) {
      tick += 16;
      frame(tick);
    }
    // 焦点移到 5 米高的坡上，镜头也抬 5 米。
    expect(cameraY).toBeGreaterThan(level);
    expect(cameraY).toBeCloseTo(level + 5, 1);
  });

  it('raises the overlook camera over a ridge instead of into it', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    let cameraY = 0;
    threeControl.onRender = (camera) => {
      cameraY = (camera as unknown as { position: { y: number } }).position.y;
    };
    const terrain = { height: (_x: number, z: number) => (z > 3 ? 20 : 0) };
    stage.bind(vi.fn(), () => makeWorld({ terrain }));
    stage.setOverlook(true);
    stage.start();
    frame();
    expect(cameraY).toBeGreaterThan(34);
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
