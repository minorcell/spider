import { initialControl } from '@/src/shared/control';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BufferGeometry, Group, Line, Mesh, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { KINDS } from '@/src/shared/kinds';
import { AnimatedActor as RealSpider } from '@/tests/rigHelpers';
import { ActorPresenter } from '@/src/client/rig/presenter';
import { drive } from '@/tests/simHelpers';
import type { EntityState, WorldState } from '@/src/shared/state';
import { Stage } from '@/src/client/stage';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import { attachTether, detachTether, tetherAnchor } from '@/src/shared/sim/tether';
import { indexEntities, propBlocks, removeEntity } from '@/src/shared/world';
import { NEST_RO, NEST_SCALE_XZ } from '@/src/shared/nestShape';
import { flat } from '@/tests/helpers';
import { setLocalBusy } from '@/src/client/local/activity';
import { ResizeObserverStub } from '@/tests/stubs';

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

vi.mock('three/webgpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three/webgpu')>();
  class WebGPURenderer implements FakeRenderer {
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
  return { ...actual, WebGPURenderer };
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

vi.mock('@/src/client/sound', () => ({ createSound: () => sound }));

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

function makeWorld(entities: EntityState[] = [], tethered: EntityState[] = []): WorldState {
  return {
    seed: 1,
    terrain: { height: flat },
    entities: indexEntities([
      entity({ id: 'spider-1', kind: 'spider', x: 0, y: 0, z: 0, control: initialControl() }),
      ...entities,
      ...tethered,
    ]),
    entitySerials: new Map(),
    clock: { tick: 0, simSeconds: 0, wallNowMs: Date.now() },
    blocks: [],
    marks: [],
    populations: new Map(),
    controlledId: 'spider-1',
    tethers: new Map(
      tethered.map((item) => [item.id, { sourceId: 'spider-1', targetId: item.id, length: 3.5 }]),
    ),
  };
}

function simScene(): SimSession {
  const session = new SimSession(7);
  session.world.entities = new Map([[session.actor.entity.id, session.actor.entity]]);
  session.world.blocks = [];
  session.world.terrain = { height: flat };
  session.world.populations.clear();
  return session;
}

function ticks(session: SimSession, count: number): void {
  for (let i = 0; i < count; i++) session.frame(1 / 60, session.world.clock.wallNowMs);
}

function frame(extraMs = 17): void {
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
  it('reduces inference rendering without slowing simulation and restores quality afterward', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    const stage = new Stage(makeHost(), new RealSpider());
    const step = vi.fn();
    stage.bind(step, () => makeWorld());
    stage.start();
    const draw = renderer();
    const start = performance.now();
    setLocalBusy(true);
    expect(draw.setPixelRatio).toHaveBeenLastCalledWith(1);
    for (const dt of [0, 16, 34, 50, 68]) draw.loop!(start + dt);
    expect(step).toHaveBeenCalledTimes(4);
    expect(step.mock.calls.every(([dt]) => dt === 1 / 60)).toBe(true);
    expect(draw.render).toHaveBeenCalledTimes(3);
    setLocalBusy(false);
    expect(draw.setPixelRatio).toHaveBeenLastCalledWith(2);
    draw.loop!(start + 84);
    expect(draw.render).toHaveBeenCalledTimes(4);
    stage.dispose();
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1 });
  });
  it('shows the pack at night only while the spider leaves the lamp on', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 1, 23));
    try {
      const spider = new RealSpider();
      const stage = new Stage(makeHost(), spider);
      const pack = spider.chassis.getObjectByName('headlamp');
      expect(pack?.visible).toBe(false);
      spider.lamp = true;
      stage.start();
      frame();
      expect(pack?.visible).toBe(true);
      spider.lamp = false;
      frame();
      expect(pack?.visible).toBe(false);
      stage.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

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
    let current = makeWorld([apple, grass, rock]);
    const step = vi.fn();
    const anchor = vi.fn();
    stage.bind(step, () => current);
    stage.follow(anchor);
    stage.start();

    frame();
    expect(step).toHaveBeenCalled();
    expect(anchor).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number) }));
    const scene = renderer().render.mock.calls.at(-1)![0] as Group;
    const appleProp = () => scene.children.find((child) => child.position.x === apple.x);
    const whole = appleProp();
    expect(whole).toBeDefined();

    apple.stage = 1;
    current = makeWorld([apple, grass, rock], [carried]);
    frame();
    expect(appleProp()).toBeDefined();
    expect(appleProp()).not.toBe(whole);
    expect(scene.children.some((child) => child instanceof Line && child.name === carried.id)).toBe(
      true,
    );
    expect(sound.bite).not.toHaveBeenCalled();
    expect(sound.grasp).not.toHaveBeenCalled();

    const bitten = appleProp();
    frame();
    expect(appleProp()).toBe(bitten);
    expect(sound.grasp).not.toHaveBeenCalled();

    current = makeWorld([apple, grass, rock, carried]);
    frame();
    expect(sound.place).not.toHaveBeenCalled();

    current = makeWorld([grass, rock, carried]);
    frame();
    expect(appleProp()).toBeUndefined();
    expect(sound.take).not.toHaveBeenCalled();
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
    stage.bind(vi.fn(), () => makeWorld([apple, nest]));
    stage.start();
    frame();
    const scene = renderer().render.mock.calls.at(-1)?.[0] as {
      children: {
        position: { x: number; y: number; z: number };
        quaternion: { z: number; w: number };
        children: { position: { y: number } }[];
      }[];
    };
    const radius = KINDS.apple.physics!.radius;
    const prop = scene.children.find((child) => Math.abs(child.position.x - 2) < 1e-6);
    expect(prop?.position.y).toBeCloseTo(0.5 + radius);
    expect(prop?.quaternion.z).toBeCloseTo(0.1);
    expect(prop?.quaternion.w).toBeCloseTo(0.995);
    expect(prop?.children[0]?.position.y).toBeCloseTo(-radius);
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
    expect(scene.children.map((child) => (child as { name: string }).name)).toContain(
      'water-splash',
    );
    expect(scene.children).toHaveLength(5);
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
    const current = makeWorld([apple]);
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
    const current = makeWorld([apple]);
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    apple.stage = 0;
    frame();
    expect(sound.bite).not.toHaveBeenCalled();
  });

  it('keeps a change in rendered carry state silent', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const first = entity({ id: 'apple-a', x: 0, y: 0, z: 0 });
    const second = entity({ id: 'apple-b', x: 0, y: 0, z: 0 });
    let current = makeWorld([], [first]);
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    current = makeWorld([], [first, second]);
    frame();
    expect(sound.grasp).not.toHaveBeenCalled();
    expect(sound.place).not.toHaveBeenCalled();
  });

  it('draws every tether in the seven-item carry limit', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const held = Array.from({ length: 7 }, (_, index) =>
      entity({ id: `apple-${index}`, x: 0, y: 0, z: 0 }),
    );
    const current = makeWorld([], held);
    stage.bind(vi.fn(), () => current);
    stage.start();
    frame();
    const scene = renderer().render.mock.calls.at(-1)![0] as Group;
    expect(
      scene.children.filter((node) => node instanceof Line && current.tethers.has(node.name)),
    ).toHaveLength(7);
  });

  it('silently removes a naturally expired carried prop', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    const food = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, food.id);
    stage.bind(vi.fn(), () => session.world);
    stage.start();
    frame();

    session.reconcileWallTime(session.world.clock.wallNowMs + 24 * 3_600_000);
    frame();

    expect(session.world.entities.has(food.id)).toBe(false);
    expect(session.world.tethers.has(food.id)).toBe(false);
    expect(sound.grasp).not.toHaveBeenCalled();
    expect(sound.place).not.toHaveBeenCalled();
    expect(sound.take).not.toHaveBeenCalled();
  });

  it('keeps one prop for an unchanged stage', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const apple = entity({ id: 'apple-1', x: 2, y: 0.5, z: 0, stage: 1 });
    const current = makeWorld([apple]);
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
    canvas.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 300 }));
    frame();
    settle();
    expect(at.x).toBeLessThan(start.x);
    expect(at.z).toBeCloseTo(start.z);
    expect(spin).toEqual(heading);

    const panned = { ...at };
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
    stage.bind(vi.fn(), () => ({ ...makeWorld(), terrain }));
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
    stage.bind(vi.fn(), () => ({ ...makeWorld(), terrain }));
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
  it('ticks for a landing foot', () => {
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
  });

  it('plays every bite and the final take once between draws', async () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    const food = session.addEntity('apple', 0, -0.8);
    stage.bind(vi.fn(), () => session.world);
    stage.start();
    frame();

    const draws = renderer().render.mock.calls.length;
    const eating = session.eat(food.id);
    for (let bite = 1; bite <= 6; bite++) {
      ticks(session, 30);
      expect(sound.bite).toHaveBeenCalledTimes(bite);
      expect(sound.take).toHaveBeenCalledTimes(bite === 6 ? 1 : 0);
    }
    await expect(eating).resolves.toMatchObject({ ok: true, stage: 6 });
    expect(renderer().render).toHaveBeenCalledTimes(draws);

    stage.retile();
    frame();
    expect(sound.bite).toHaveBeenCalledTimes(6);
    expect(sound.take).toHaveBeenCalledOnce();
  });

  it('plays grasp and release only for the controlled actor', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    const food = session.addEntity('apple', 0, -0.8);
    const other = session.addEntity('spider', 0, 0);
    stage.bind(vi.fn(), () => session.world);

    expect(attachTether(session.world, other.id, food.id).ok).toBe(true);
    expect(detachTether(session.world, food.id, 'released')).toBe(true);
    expect(sound.grasp).not.toHaveBeenCalled();
    expect(sound.place).not.toHaveBeenCalled();

    expect(attachTether(session.world, session.actor.entity.id, food.id).ok).toBe(true);
    expect(session.release(food.id)).toMatchObject({ ok: true });
    expect(sound.grasp).toHaveBeenCalledOnce();
    expect(sound.place).toHaveBeenCalledOnce();
  });

  it('does not replay sound when restoring a world with an expired carried item', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    const food = session.addEntity('apple', 0, -0.8);
    attachTether(session.world, session.actor.entity.id, food.id);
    const saved = captureBody(session, null);
    stage.bind(vi.fn(), () => session.world);
    stage.start();
    frame();

    applyBody(session, saved, undefined, session.world.clock.wallNowMs + 24 * 3_600_000);
    frame();
    expect(session.world.entities.has(food.id)).toBe(false);
    expect(sound.grasp).not.toHaveBeenCalled();
    expect(sound.place).not.toHaveBeenCalled();
    expect(sound.take).not.toHaveBeenCalled();
    expect(sound.bite).not.toHaveBeenCalled();
  });

  it('stays silent for an unattributed food removal after the controlled actor leaves', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    const food = session.addEntity('apple', 0, -0.8);
    stage.bind(vi.fn(), () => session.world);

    removeEntity(session.world, session.actor.entity);
    removeEntity(session.world, food, 'eaten');

    expect(session.world.controlledId).toBeUndefined();
    expect(session.world.entities.has(food.id)).toBe(false);
    expect(sound.take).not.toHaveBeenCalled();
  });

  it('listens only to the current world until disposed', () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const first = simScene();
    const next = simScene();
    const firstFood = first.addEntity('apple', 0, -0.8);
    const nextFood = next.addEntity('apple', 0, -0.8);

    stage.bind(vi.fn(), () => first.world);
    stage.bind(vi.fn(), () => next.world);
    stage.bind(vi.fn(), () => next.world);
    expect(attachTether(first.world, first.actor.entity.id, firstFood.id).ok).toBe(true);
    expect(sound.grasp).not.toHaveBeenCalled();
    expect(attachTether(next.world, next.actor.entity.id, nextFood.id).ok).toBe(true);
    expect(sound.grasp).toHaveBeenCalledOnce();

    stage.dispose();
    expect(next.release(nextFood.id)).toMatchObject({ ok: true });
    expect(sound.place).not.toHaveBeenCalled();
  });

  it('knocks once when the world blocks a walk without a draw', async () => {
    const stage = new Stage(makeHost(), new RealSpider());
    const session = simScene();
    session.world.blocks = [{ id: 'wall', minX: -3, maxX: 3, minZ: -2, maxZ: -1, height: 3 }];
    stage.bind(vi.fn(), () => session.world);

    const walking = session.walk(10);
    ticks(session, 120);
    session.cancel();
    await walking;
    expect(sound.knock).toHaveBeenCalledOnce();
    expect(renderer().render).not.toHaveBeenCalled();
  });

  it('moves the painted spider at 120 Hz and projects its bubble from the same pose', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const food = entity({ id: 'apple-carried' });
    const world = makeWorld([], [food]);
    const actor = world.entities.get(world.controlledId!)!;
    const spider = new RealSpider(actor);
    const stage = new Stage(makeHost(), spider);
    let authoritativeX = 0;
    const step = vi.fn(() => {
      expect(spider.root.position.x).toBeCloseTo(authoritativeX);
      authoritativeX += 0.12;
      spider.yaw += 0.16;
      spider.place(authoritativeX, 0, 0);
    });
    stage.bind(step, () => world);
    const drawX: number[] = [];
    const projected: { x: number; y: number }[] = [];
    const silk: Vector3[] = [];
    const expectedSilk: Vector3[] = [];
    const localAnchor = KINDS.spider.tether!.anchor;
    threeControl.onRender = (camera) => {
      drawX.push(spider.root.position.x);
      const view = camera as PerspectiveCamera;
      view.updateMatrixWorld();
      const point = spider.root.position
        .clone()
        .add(new Vector3(0, 1.45, 0))
        .project(view);
      projected.push({ x: (point.x * 0.5 + 0.5) * 800, y: (-point.y * 0.5 + 0.5) * 600 });
      const scene = renderer().render.mock.calls.at(-1)![0] as Group;
      const line = scene.getObjectByName(food.id) as Line;
      silk.push(new Vector3().fromBufferAttribute(line.geometry.getAttribute('position'), 0));
      expectedSilk.push(
        new Vector3(localAnchor.x, localAnchor.y, localAnchor.z)
          .applyQuaternion(spider.root.quaternion)
          .add(spider.root.position),
      );
    };
    const anchors: ({ x: number; y: number } | null)[] = [];
    stage.follow((point) => anchors.push(point));
    stage.start();
    for (let i = 0; i <= 8; i++) renderer().loop!((i * 1000) / 120);

    expect(step).toHaveBeenCalledTimes(4);
    expect(authoritativeX).toBeCloseTo(0.48);
    expect(drawX).toHaveLength(9);
    for (let i = 3; i < drawX.length; i++) {
      expect(drawX[i] - drawX[i - 1]).toBeCloseTo(0.06, 4);
      expect(anchors[i]?.x).toBeCloseTo(projected[i].x, 4);
      expect(anchors[i]?.y).toBeCloseTo(projected[i].y, 4);
      expect(silk[i].distanceTo(expectedSilk[i])).toBeLessThan(1e-4);
    }
    stage.dispose();
  });

  it('keeps the moving camera and bubble continuous as the real spider leaves the nest', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const session = new SimSession(7);
    const world = session.world;
    const nest = [...world.entities.values()].find(({ kind }) => kind === 'nest')!;
    world.entities = indexEntities([session.actor.entity, nest]);
    world.blocks = propBlocks(world.entities.values());
    world.populations.clear();
    const presenter = new ActorPresenter(session);
    const stage = new Stage(makeHost(), presenter.model);
    const root = presenter.model.root;
    const authority: Vector3[] = [];
    stage.bind(
      (dt, wall) => {
        presenter.step(dt, wall);
        const { x, y, z } = session.actor.position;
        authority.push(new Vector3(x, y, z));
      },
      () => world,
    );
    const drawn: Vector3[] = [];
    const cameraMatrices: number[][] = [];
    const projected: Vector3[] = [];
    threeControl.onRender = (camera) => {
      const view = camera as PerspectiveCamera;
      drawn.push(root.position.clone());
      cameraMatrices.push(view.matrixWorld.elements.slice());
      projected.push(
        root.position
          .clone()
          .add(new Vector3(0, 1.45, 0))
          .project(view),
      );
    };
    const anchors: Vector3[] = [];
    stage.follow((point) => {
      expect(point).not.toBeNull();
      anchors.push(new Vector3(point!.x, point!.y, 0));
    });
    stage.start();
    const loop = renderer().loop!;
    for (let i = 0; i <= 24; i++) loop((i * 1000) / 120);
    const walking = drive(session, 3.4, { throttle: 1 });
    for (let i = 25; i <= 450; i++) loop((i * 1000) / 120);

    await expect(walking).resolves.toMatchObject({ ok: true });
    expect(session.actor.position.z).toBeLessThan(nest.z - NEST_RO * NEST_SCALE_XZ);
    expect(authority).toHaveLength(225);
    for (let i = 26; i < drawn.length; i++) {
      const current = drawn[i];
      const previous = drawn[i - 1];
      expect(current.distanceTo(previous)).toBeLessThan(0.12);
      const endpoint = authority[Math.floor(i / 2) - 1];
      const start = authority[Math.floor(i / 2) - 2];
      const interpolated = start.clone().lerp(endpoint, (i % 2) / 2);
      expect(current.distanceTo(interpolated)).toBeLessThan(1e-4);
      const matrixChange = Math.max(
        ...cameraMatrices[i].map((value, index) => Math.abs(value - cameraMatrices[i - 1][index])),
      );
      expect(matrixChange).toBeLessThan(0.15);
      expect(anchors[i].distanceTo(anchors[i - 1])).toBeLessThan(8);
      expect(anchors[i].x).toBeCloseTo((projected[i].x * 0.5 + 0.5) * 800, 4);
      expect(anchors[i].y).toBeCloseTo((-projected[i].y * 0.5 + 0.5) * 600, 4);
    }
    stage.dispose();
  });

  it('keeps the spider, camera and bubble stable through multiple turns and a reversal', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const session = simScene();
    const presenter = new ActorPresenter(session);
    const stage = new Stage(makeHost(), presenter.model);
    const root = presenter.model.root;
    const vertical = new Vector3(0, 1, 0);
    const expected = new Quaternion();
    const previous = new Quaternion();
    const current = new Quaternion();
    let minYaw = 0;
    let maxYaw = 0;
    stage.bind(
      (dt, wall) => {
        presenter.step(dt, wall);
        const yaw = session.actor.yaw;
        minYaw = Math.min(minYaw, yaw);
        maxYaw = Math.max(maxYaw, yaw);
        previous.copy(current);
        current.setFromAxisAngle(vertical, yaw);
        expect(root.quaternion.angleTo(current)).toBeLessThan(1e-5);
      },
      () => session.world,
    );

    let index = 0;
    let projected: Vector3 | undefined;
    let lastAnchor: Vector3 | undefined;
    let lastCamera: Quaternion | undefined;
    threeControl.onRender = (camera) => {
      const view = camera as PerspectiveCamera;
      expected.slerpQuaternions(previous, current, (index % 2) / 2);
      expect(root.quaternion.angleTo(expected)).toBeLessThan(1e-5);
      if (lastCamera) expect(view.quaternion.angleTo(lastCamera)).toBeLessThan(0.06);
      lastCamera = view.quaternion.clone();
      projected = root.position
        .clone()
        .add(new Vector3(0, 1.45, 0))
        .project(view);
    };
    stage.follow((point) => {
      expect(point).not.toBeNull();
      const anchor = new Vector3(point!.x, point!.y, 0);
      if (lastAnchor) expect(anchor.distanceTo(lastAnchor)).toBeLessThan(8);
      lastAnchor = anchor;
      expect(anchor.x).toBeCloseTo((projected!.x * 0.5 + 0.5) * 800, 4);
      expect(anchor.y).toBeCloseTo((-projected!.y * 0.5 + 0.5) * 600, 4);
    });
    stage.start();
    const walking = session.run({
      timeout: 14,
      controls: () => ({ throttle: 0.45, turn: index < 480 ? 1 : -1, boost: 0, lift: 0 }),
      done: () => session.actor.time >= 12.1,
      result: () => ({}),
    });
    for (index = 0; index <= 1460; index++) renderer().loop!((index * 1000) / 120);
    await expect(walking).resolves.toMatchObject({ ok: true });
    expect(minYaw).toBeLessThan(-2 * Math.PI);
    expect(maxYaw).toBeGreaterThan(2 * Math.PI);
    stage.dispose();
  });

  it('snaps to a restored spider pose without blending across the island', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const spider = new RealSpider();
    const stage = new Stage(makeHost(), spider);
    const world = makeWorld();
    const step = vi.fn(() => spider.place(0.2, 0, 0));
    stage.bind(step, () => world);
    stage.start();
    renderer().loop!(25);
    expect(spider.root.position.x).toBeCloseTo(0.1);

    spider.place(-12, 0, 0);
    stage.retile();
    renderer().loop!(26);
    expect(step).toHaveBeenCalledOnce();
    expect(spider.root.position.x).toBeCloseTo(-12);
    stage.dispose();
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

it('draws the registered models and updates their silk until release', () => {
  const spider = new RealSpider();
  const stage = new Stage(makeHost(), spider);
  const stone = entity({ id: 'pebble-1', kind: 'pebble', x: 3, z: 2 });
  const berry = entity({ id: 'berry-1', kind: 'berry', x: 0, z: 3 });
  KINDS.marker = { rest: 0, carryable: { anchor: { x: 0, y: 0, z: 0 } } };
  const marker = entity({ id: 'marker-1', kind: 'marker', x: 0, y: 0.5, z: 3 });
  const world = makeWorld([berry], [stone, marker]);
  world.tethers.get(stone.id)!.length = 12;
  world.tethers.set('missing', { sourceId: 'spider-1', targetId: 'missing', length: 2 });
  stage.bind(vi.fn(), () => world);
  stage.start();
  frame();

  const scene = renderer().render.mock.calls.at(-1)![0] as Group;
  const tether = scene.children.find((node) => node.name === stone.id) as Line;
  expect(tether).toBeInstanceOf(Line);
  expect(scene.getObjectByName('missing')).toBeUndefined();
  const plainEndpoint = scene.getObjectByName(marker.id) as Line;
  expect(plainEndpoint.geometry.getAttribute('position').getY(8)).toBeCloseTo(marker.y);
  const points = tether.geometry.getAttribute('position');
  const anchor = tetherAnchor(world.entities.get('spider-1')!, KINDS.spider.tether!.anchor);
  expect(points.getX(0)).toBeCloseTo(anchor.x);
  expect(points.getY(0)).toBeCloseTo(anchor.y);
  expect(points.getZ(0)).toBeCloseTo(anchor.z);
  expect(points.getY(4)).toBeLessThan((points.getY(0) + points.getY(8)) / 2);
  for (const name of ['river-pebble', 'berry-skin']) {
    const mesh = scene.getObjectByName(name) as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    const positions = mesh.geometry.getAttribute('position');
    expect(positions.count).toBeGreaterThan(0);
    expect(mesh.geometry.getAttribute('color').count).toBe(positions.count);
  }

  stone.x += 1;
  frame();
  expect(scene.children).toContain(tether);
  expect(points.getX(8)).toBeCloseTo(stone.x);
  const dispose = vi.spyOn(tether.geometry, 'dispose');
  world.tethers.clear();
  frame();
  expect(scene.children).not.toContain(tether);
  expect(dispose).toHaveBeenCalledOnce();
  stage.dispose();
  delete KINDS.marker;
});

it('runs at most three fixed steps and clears hidden time on resume', () => {
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  const wallNow = vi.spyOn(Date, 'now').mockReturnValue(1000);
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const stage = new Stage(makeHost(), new RealSpider());
  const step = vi.fn();
  stage.bind(step, () => makeWorld());
  stage.start();
  const tick = renderer().loop!;
  tick(100);
  expect(step).toHaveBeenCalledTimes(3);
  expect(step.mock.calls).toEqual(Array.from({ length: 3 }, () => [1 / 60, 1000]));
  tick(108);
  expect(step).toHaveBeenCalledTimes(3);
  hidden.mockReturnValue(true);
  now.mockReturnValue(108);
  document.dispatchEvent(new Event('visibilitychange'));
  tick(200);
  expect(step).toHaveBeenCalledTimes(3);
  hidden.mockReturnValue(false);
  now.mockReturnValue(1000);
  document.dispatchEvent(new Event('visibilitychange'));
  stage.hold(false);
  tick(1010);
  expect(step).toHaveBeenCalledTimes(3);
  wallNow.mockReturnValue(2000);
  tick(1017);
  expect(step).toHaveBeenLastCalledWith(1 / 60, 2000);
  expect(step).toHaveBeenCalledTimes(4);
  stage.dispose();
});

it('draws the controlled rig once even when its kind also has a prop model', () => {
  const spider = new RealSpider();
  const stage = new Stage(makeHost(), spider);
  const current = makeWorld();
  stage.bind(
    () => {},
    () => current,
  );
  stage.start();
  frame();
  const scene = renderer().render.mock.calls.at(-1)![0] as Group;
  const count = scene.children.length;
  KINDS.spider.model = 'apple';
  try {
    current.entities.delete(current.controlledId!);
    current.controlledId = spider.controller.entity.id;
    current.entities.set(current.controlledId, spider.controller.entity);
    frame();
    expect(scene.children).toContain(spider.root);
    expect(scene.children.length).toBe(count);
  } finally {
    delete KINDS.spider.model;
  }
});

it('draws silk from its registered owner and removes it when that endpoint disappears', () => {
  const spider = new RealSpider();
  const stage = new Stage(makeHost(), spider);
  KINDS.post = {
    rest: 0,
    model: { color: 0x777777, segments: 8 },
    tether: {
      anchor: { x: 1, y: 2, z: 0 },
      limit: 1,
      minLength: 1,
      spacing: 0,
      stiffness: 1,
      damping: 0.1,
    },
  };
  try {
    const source = entity({
      id: 'post-1',
      kind: 'post',
      x: 5,
      y: 1,
      z: 3,
      qx: 0,
      qy: 0,
      qz: Math.SQRT1_2,
      qw: Math.SQRT1_2,
    });
    const cargo = entity({
      id: 'pebble-1',
      kind: 'pebble',
      x: 6,
      y: 1,
      z: 3,
      qx: 0.6,
      qy: 0,
      qz: 0,
      qw: 0.8,
    });
    const world = makeWorld([source, cargo]);
    world.tethers.set(cargo.id, { sourceId: source.id, targetId: cargo.id, length: 1 });
    stage.bind(vi.fn(), () => world);
    stage.start();
    frame();
    const scene = renderer().render.mock.calls.at(-1)![0] as Group;
    const silk = scene.getObjectByName(cargo.id) as Line;
    const points = silk.geometry.getAttribute('position');
    expect(points.getX(0)).toBeCloseTo(3);
    expect(points.getY(0)).toBeCloseTo(2);
    expect(points.getZ(0)).toBeCloseTo(3);
    expect(points.getY(8)).toBeCloseTo(cargo.y + 0.19);
    spider.root.position.set(-10, 0, -10);
    source.x += 1;
    frame();
    expect(points.getX(0)).toBeCloseTo(4);
    expect(sound.grasp).not.toHaveBeenCalled();
    world.entities.delete(source.id);
    const dispose = vi.spyOn(silk.geometry, 'dispose');
    frame();
    expect(scene.children).not.toContain(silk);
    expect(dispose).toHaveBeenCalledOnce();
  } finally {
    delete KINDS.post;
    stage.dispose();
  }
});
