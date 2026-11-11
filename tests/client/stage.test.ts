import { beforeEach, expect, it, vi } from 'vitest';
import { Stage } from '@/src/client/stage';
import { setLocalBusy } from '@/src/client/local/activity';
import { SimSession } from '@/src/shared/sim/session';
import { captureBody } from '@/src/shared/sim/snapshot';
import type { EntityState } from '@/src/shared/state';
import { waterAt } from '@/src/shared/water';
import { ResizeObserverStub } from '@/tests/stubs';

const sound = vi.hoisted(() => ({
  step: vi.fn(),
  bite: vi.fn(),
  take: vi.fn(),
  grasp: vi.fn(),
  place: vi.fn(),
  knock: vi.fn(),
  voice: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock('@/src/client/sound', () => ({ createSound: () => sound }));

const context = {
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  ellipse: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  arc: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  strokeText: vi.fn(),
  fillText: vi.fn(),
};
const terrainPixels = { fillRect: vi.fn() };
const apple: EntityState = { id: 'apple-test', kind: 'apple', x: 0, y: 0, z: -0.95, stage: 0 };
let frame: FrameRequestCallback;

function stageFor(session: SimSession) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: 900 });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: 600 });
  document.body.append(host);
  const stage = new Stage(host, session.spider);
  const step = vi.fn((dt: number) => session.frame(dt));
  const observe = vi.fn(() => session.observe());
  const canvas = host.querySelector('canvas')!;
  canvas.setPointerCapture = vi.fn();
  return { host, stage, step, observe, canvas };
}

beforeEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
  setLocalBusy(false);
  vi.spyOn(performance, 'now').mockReturnValue(0);
  vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 11, 0).getTime());
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    frame = callback;
    return 19;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValueOnce(context as unknown as CanvasRenderingContext2D)
    .mockReturnValue(terrainPixels as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 20, 900, 600),
  );
});

it('draws and steps the live session, preserving hold, inference pacing and cleanup', () => {
  const session = new SimSession(7);
  const { host, stage, step, observe, canvas } = stageFor(session);
  const anchor = vi.fn();
  stage.start();
  frame(0);
  expect(context.drawImage).not.toHaveBeenCalled();
  stage.follow(anchor);
  stage.bind(step, () => session.world, observe);
  frame(16);
  expect(step).toHaveBeenLastCalledWith(0.016);
  expect(canvas.width).toBe(300);
  expect(canvas.height).toBe(200);
  expect(context.drawImage).toHaveBeenCalledOnce();
  expect(anchor.mock.lastCall?.[0]).toMatchObject({ x: 460, y: expect.any(Number) });
  expect(observe).not.toHaveBeenCalled();
  expect(terrainPixels.fillRect).toHaveBeenCalled();

  const tiles = terrainPixels.fillRect.mock.calls.length;
  setLocalBusy(true);
  frame(32);
  expect(step).toHaveBeenCalledTimes(2);
  expect(context.drawImage).toHaveBeenCalledOnce();
  stage.hold(true);
  frame(120);
  expect(step).toHaveBeenCalledTimes(2);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
  expect(terrainPixels.fillRect).toHaveBeenCalledTimes(tiles);
  setLocalBusy(false);
  stage.hold(false);
  const saved = captureBody(new SimSession(31), null);
  saved.marks = [{ name: '从存档回来', x: 2, z: 1 }];
  session.adopt(saved);
  stage.retile();
  ResizeObserverStub.last?.trigger();
  frame(200);
  expect(step).toHaveBeenLastCalledWith(0.05);
  expect(terrainPixels.fillRect.mock.calls.length).toBeGreaterThan(tiles);
  expect(context.fillText).toHaveBeenCalledWith(
    '从存档回来',
    expect.any(Number),
    expect.any(Number),
  );

  stage.voice();
  expect(sound.voice).toHaveBeenCalledOnce();
  stage.dispose();
  expect(cancelAnimationFrame).toHaveBeenCalledWith(19);
  expect(ResizeObserverStub.last?.disconnect).toHaveBeenCalledOnce();
  expect(sound.dispose).toHaveBeenCalledOnce();
  expect(host.childElementCount).toBe(0);
});

it('projects the Agent observation onto the map and pans the same world', () => {
  const session = new SimSession(7);
  session.world.entities = [
    apple,
    { ...apple, id: 'visible', x: 4, z: 0 },
    { ...apple, id: 'distant', x: 32, z: -9, kind: 'test' },
  ];
  session.world.terrain = { height: () => 0 };
  session.world.blocks = [];
  session.world.marks = [{ name: '水边', x: 2, z: 3 }];
  session.spider.lamp = true;
  const { host, stage, step, observe, canvas } = stageFor(session);
  stage.bind(step, () => session.world, observe);
  const anchor = vi.fn();
  stage.follow(anchor);
  stage.setOverlook(true);
  stage.start();
  frame(16);
  expect(host.querySelector<HTMLElement>('#observe')?.hidden).toBe(false);
  expect(host.querySelector('#observe-readout')?.textContent).toContain('看见');
  expect(context.fillText).toHaveBeenCalledWith('水边', expect.any(Number), expect.any(Number));
  expect(context.createRadialGradient).toHaveBeenCalled();
  expect(observe).toHaveBeenCalledOnce();
  frame(32);
  expect(observe).toHaveBeenCalledOnce();
  frame(132);
  expect(observe).toHaveBeenCalledTimes(2);
  expect(observe.mock.lastCall).toBeDefined();
  expect(observe.mock.results[0].value.entities.some((item) => !item.inReach)).toBe(true);

  const move = new PointerEvent('pointermove', { clientX: 900, clientY: 600 });
  canvas.dispatchEvent(move);
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: 20, clientY: 20 }));
  canvas.dispatchEvent(move);
  canvas.dispatchEvent(new PointerEvent('pointercancel'));
  expect(canvas.setPointerCapture).toHaveBeenCalledWith(2);
  const wheel = new WheelEvent('wheel', { deltaY: -5000, cancelable: true });
  canvas.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(true);
  frame(160);
  expect(anchor).toHaveBeenLastCalledWith(null);
  stage.setOverlook(false);
  vi.mocked(Date.now).mockReturnValue(new Date(2026, 10, 11, 12).getTime());
  session.spider.bindWater(() => waterAt({ height: () => -2 }, 0, 0));
  frame(200);
  expect(host.querySelector<HTMLElement>('#observe')?.hidden).toBe(true);
  expect(anchor.mock.lastCall?.[0]).not.toBeNull();
  expect(context.ellipse).toHaveBeenCalledOnce();
  stage.dispose();
});

it('paints carrying and listens to item and gait changes in the real world', async () => {
  const session = new SimSession(7);
  const fruit = { ...apple };
  session.world.entities = [
    fruit,
    { ...fruit, id: 'leaf', kind: 'grass', x: 3, footprint: { kind: 'circle', r: 1.2 } },
    { ...fruit, id: 'tree', kind: 'tree', x: 5 },
    { ...fruit, id: 'far', kind: 'stone', x: 400, z: 400 },
  ];
  session.world.blocks = [];
  const { stage } = stageFor(session);
  stage.bind(
    () => {},
    () => session.world,
    () => session.observe(),
  );
  stage.start();
  frame(16);
  expect(sound.grasp).not.toHaveBeenCalled();

  const pickingUp = session.pickUp(fruit.id);
  for (let i = 0; i < 100; i++) session.frame(0.025);
  expect(await pickingUp).toMatchObject({ ok: true });
  frame(32);
  expect(session.world.carrying.map(({ id }) => id)).toEqual([fruit.id]);
  expect(sound.grasp).toHaveBeenCalledOnce();
  expect(context.stroke).toHaveBeenCalled();
  session.world.carrying[0].stage++;
  session.spider.legs[0].lifted = true;
  frame(48);
  session.spider.legs[0].lifted = false;
  session.spider.halt = 'solid';
  frame(64);
  expect(sound.bite).toHaveBeenCalledOnce();
  expect(sound.step).toHaveBeenCalledOnce();
  expect(sound.knock).toHaveBeenCalledOnce();

  session.world.entities.push(session.world.carrying.pop()!);
  session.spider.interaction = { target: session.spider.root.position, phase: 'drag' };
  frame(80);
  expect(sound.place).toHaveBeenCalledOnce();
  session.world.entities.pop();
  session.spider.interaction = null;
  frame(96);
  expect(sound.take).toHaveBeenCalledOnce();
  const a = { ...apple, id: 'a' };
  const b = { ...apple, id: 'b' };
  session.world.carrying = [a];
  frame(112);
  session.world.carrying.push(b);
  frame(128);
  expect(sound.grasp).toHaveBeenCalledTimes(3);
  session.world.carrying.shift();
  frame(144);
  expect(sound.take).toHaveBeenCalledTimes(2);
  expect(sound.place).toHaveBeenCalledOnce();
  stage.dispose();
});
