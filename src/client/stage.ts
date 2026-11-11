import { FpsDisplay } from '@/src/client/fps';
import { onLocalBusy } from '@/src/client/local/activity';
import { describeObservation } from '@/src/client/observationText';
import {
  observeOutline,
  PIXEL,
  PixelIsland,
  project,
  type Projection,
} from '@/src/client/pixelIsland';
import { createSound } from '@/src/client/sound';
import { worldClock } from '@/src/shared/ecology';
import type { Spider } from '@/src/shared/sim/Spider';
import type { Observation, WorldState } from '@/src/shared/state';
import { WORLD_RADIUS } from '@/src/shared/terrain';
import { paintCanvas, paintObserve } from '@/src/ui/dress';

const REFRESH_MS = 100;

type Point = { x: number; y: number };
type Outline = ReturnType<typeof observeOutline>;

/** Browser host for the existing simulation. Canvas reads its state after each update. */
export class Stage {
  readonly #host: HTMLElement;
  readonly #spider: Spider;
  readonly #canvas: HTMLCanvasElement;
  readonly #island: PixelIsland;
  readonly #fps: FpsDisplay;
  readonly #sound = createSound(window);
  readonly #stopLocal: () => void;
  readonly #observer: ResizeObserver;
  readonly #listeners = new AbortController();
  readonly #layer: HTMLElement;
  readonly #readout: HTMLElement;
  #inferenceBusy = false;
  #held = false;
  #overlook = false;
  #zoom = 1;
  #pan = { x: 0, z: 0 };
  #pointer: Point | undefined;
  #view: Projection = { x: 0, z: 0, scale: 1, width: 1, height: 1 };
  #bounds = { left: 0, top: 0, width: 1, height: 1 };
  #step: ((dt: number) => void) | undefined;
  #world: (() => WorldState) | undefined;
  #observe: (() => Observation) | undefined;
  #anchor: ((point: Point | null) => void) | undefined;
  #frameId = 0;
  #last = 0;
  #lastPaint = -Infinity;
  #lastObserved = -Infinity;
  #observation: Observation | undefined;
  #outline: Outline = [];
  #clock = worldClock();
  #clockSecond = -1;
  #lastFeet: boolean[] = [];
  #halt: Spider['halt'] = 'clear';
  #carrying: Set<string> | undefined;
  readonly #stages = new Map<string, number>();
  readonly #seen = new Set<string>();

  constructor(host: HTMLElement, spider: Spider) {
    this.#host = host;
    this.#spider = spider;
    const doc = host.ownerDocument;
    this.#canvas = doc.createElement('canvas');
    this.#canvas.setAttribute('aria-label', '蛛岛像素场景');
    paintCanvas(this.#canvas);
    this.#canvas.style.imageRendering = 'pixelated';
    this.#canvas.style.touchAction = 'none';
    host.append(this.#canvas);
    this.#island = new PixelIsland(this.#canvas);
    this.#fps = new FpsDisplay(host);
    this.#stopLocal = onLocalBusy((busy) => {
      this.#inferenceBusy = busy;
    });

    this.#layer = doc.createElement('div');
    this.#layer.id = 'observe';
    this.#layer.hidden = true;
    this.#readout = doc.createElement('div');
    this.#readout.id = 'observe-readout';
    const pins = doc.createElement('div');
    paintObserve(this.#layer, this.#readout, pins);
    this.#readout.style.background = 'var(--ui-paper)';
    this.#readout.style.padding = '4px 7px';
    this.#layer.append(this.#readout, pins);
    host.append(this.#layer);

    const signal = this.#listeners.signal;
    this.#canvas.addEventListener('pointerdown', this.#beginPan, { signal });
    this.#canvas.addEventListener('pointermove', this.#movePan, { signal });
    this.#canvas.addEventListener('pointerup', this.#endPan, { signal });
    this.#canvas.addEventListener('pointercancel', this.#endPan, { signal });
    this.#canvas.addEventListener('wheel', this.#wheel, { signal, passive: false });
    this.#observer = new ResizeObserver(() => this.#resize());
    this.#observer.observe(host);
    this.#resize();
  }

  bind(step: (dt: number) => void, world: () => WorldState, observe: () => Observation): void {
    this.#step = step;
    this.#world = world;
    this.#observe = observe;
  }

  hold(on: boolean): void {
    this.#held = on;
  }

  follow(onAnchor: (point: Point | null) => void): void {
    this.#anchor = onAnchor;
  }

  setOverlook(on: boolean): void {
    this.#overlook = on;
    this.#layer.hidden = !on;
    this.#pan = { x: 0, z: 0 };
    this.#zoom = 1;
    this.#lastObserved = -Infinity;
    this.#observation = undefined;
  }

  retile(): void {
    this.#stages.clear();
    this.#carrying = undefined;
    this.#lastFeet = [];
    this.#halt = 'clear';
    this.setOverlook(this.#overlook);
  }

  start(): void {
    this.#last = performance.now();
    this.#frameId = requestAnimationFrame(this.#frame);
  }

  voice(): void {
    this.#sound.voice();
  }

  dispose(): void {
    cancelAnimationFrame(this.#frameId);
    this.#listeners.abort();
    this.#observer.disconnect();
    this.#stopLocal();
    this.#sound.dispose();
    this.#canvas.remove();
    this.#fps.element.remove();
    this.#layer.remove();
  }

  #beginPan = (event: PointerEvent): void => {
    this.#pointer = { x: event.clientX, y: event.clientY };
    this.#canvas.setPointerCapture(event.pointerId);
  };

  #movePan = (event: PointerEvent): void => {
    if (!this.#pointer) return;
    const scale = this.#view.scale;
    const dx =
      ((event.clientX - this.#pointer.x) * this.#view.width) / Math.max(1, this.#bounds.width);
    const dz =
      ((event.clientY - this.#pointer.y) * this.#view.height) / Math.max(1, this.#bounds.height);
    this.#pan.x = Math.max(-WORLD_RADIUS, Math.min(WORLD_RADIUS, this.#pan.x - dx / scale));
    this.#pan.z = Math.max(-WORLD_RADIUS, Math.min(WORLD_RADIUS, this.#pan.z - dz / scale));
    this.#pointer = { x: event.clientX, y: event.clientY };
  };

  #endPan = (): void => {
    this.#pointer = undefined;
  };

  #wheel = (event: WheelEvent): void => {
    this.#zoom = Math.max(0.65, Math.min(3, this.#zoom * Math.exp(-event.deltaY * 0.001)));
    event.preventDefault();
  };

  #resize(): void {
    this.#canvas.width = Math.max(1, Math.round(this.#host.clientWidth / PIXEL));
    this.#canvas.height = Math.max(1, Math.round(this.#host.clientHeight / PIXEL));
    this.#bounds = this.#canvas.getBoundingClientRect();
  }

  #frame = (now: number): void => {
    this.#frameId = requestAnimationFrame(this.#frame);
    const dt = Math.min(0.05, Math.max(0, (now - this.#last) / 1000));
    this.#last = now;
    if (!this.#held) this.#step?.(dt);
    const world = this.#world?.();
    if (!world) return;
    this.#feedback(world);

    if (this.#inferenceBusy && now - this.#lastPaint < 1000 / 30) return;
    this.#lastPaint = now;
    const second = Math.floor(Date.now() / 1000);
    if (second !== this.#clockSecond) {
      this.#clockSecond = second;
      this.#clock = worldClock(new Date(second * 1000));
    }
    const position = this.#spider.root.position;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    this.#view = {
      x: this.#pan.x + (this.#overlook ? 0 : position.x),
      z: this.#pan.z + (this.#overlook ? 0 : position.z),
      width,
      height,
      scale: (Math.min(width, height) * this.#zoom) / (this.#overlook ? 105 : 20),
    };
    if (this.#overlook && now - this.#lastObserved >= REFRESH_MS) {
      const observation = this.#observe!();
      this.#observation = observation;
      this.#outline = observeOutline(world, observation);
      this.#readout.textContent = describeObservation(observation);
      this.#lastObserved = now;
    }
    const darkness = (1 - this.#clock.daylight) * 0.3;
    this.#island.draw(this.#view, world, this.#spider, darkness, this.#observation, this.#outline);
    this.#fps.tick(now);
    this.#anchor?.(this.#aboveSpider());
  };

  #aboveSpider(): Point | null {
    const view = this.#view;
    const point = project(view, this.#spider.root.position);
    if (point.x < 0 || point.x > view.width || point.y < 0 || point.y > view.height) return null;
    return {
      x: this.#bounds.left + (point.x / view.width) * this.#bounds.width,
      y: this.#bounds.top + ((point.y - 1.7 * view.scale) / view.height) * this.#bounds.height,
    };
  }

  #feedback(world: WorldState): void {
    const spider = this.#spider;
    let landed = false;
    for (const [i, leg] of spider.legs.entries()) {
      if (this.#lastFeet[i] && !leg.lifted) landed = true;
      this.#lastFeet[i] = leg.lifted;
    }
    if (landed) this.#sound.step(spider.speed);
    if (spider.halt !== 'clear' && this.#halt === 'clear') this.#sound.knock();
    this.#halt = spider.halt;

    const carried = this.#carrying;
    if (
      !carried ||
      carried.size !== world.carrying.length ||
      world.carrying.some((item) => !carried.has(item.id))
    ) {
      if (carried) {
        for (const item of world.carrying) if (!carried.has(item.id)) this.#sound.grasp();
        for (const id of carried) {
          if (world.entities.some((item) => item.id === id)) this.#sound.place();
        }
      }
      this.#carrying = new Set(world.carrying.map((item) => item.id));
    }

    this.#seen.clear();
    for (const list of [world.entities, world.carrying]) {
      for (const item of list) {
        this.#seen.add(item.id);
        if (item.stage > (this.#stages.get(item.id) ?? item.stage)) this.#sound.bite();
        this.#stages.set(item.id, item.stage);
      }
    }
    for (const id of this.#stages.keys()) {
      if (this.#seen.has(id)) continue;
      this.#stages.delete(id);
      this.#sound.take();
    }
  }
}
