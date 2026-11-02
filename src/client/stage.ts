import {
  Group,
  MathUtils,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { TERRAIN } from '../shared/terrain.js';
import type { EntityState, WorldState } from '../shared/state.js';
import type { Spider } from '../shared/sim/Spider.js';
import { buildIsland } from './groundView.js';
import { ObserveOverlay } from './observeView.js';
import { buildProp, drapeGrass } from './props.js';
import { createSound } from './sound.js';

// Camera framing. Drag orbits, wheel dollies; both clamp at the same limits.
const VIEW = {
  fov: 32,
  near: 0.08,
  far: 200,
  yaw: Math.PI + 0.62,
  pitch: 0.32,
  distance: 9.8,
  minDistance: 6,
  maxDistance: 24,
  minPitch: 0.12,
  maxPitch: 1.15,
  dragYaw: 0.005,
  dragPitch: 0.004,
  zoom: 0.001,
  ease: 6.5,
  lookUp: 1.15,
} as const;

const local = new Vector3();
const look = new Vector3();
const desired = new Vector3();
const bubbleAt = new Vector3();

/** Renderer and camera. It steps the one spider, then paints that same spider. */
export class Stage {
  readonly #host: HTMLElement;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #spider: Spider;
  readonly #props = new Map<string, Group>();
  #island: Group | null = null;
  /** Last drawn action stage, so a new bite can make a sound. */
  readonly #stages = new Map<string, number>();
  readonly #drapedGrass = new Map<
    string,
    { x: number; z: number; terrain: WorldState['terrain'] }
  >();
  #resizeObserver!: ResizeObserver;
  #view = { left: 0, top: 0, width: 1, height: 1 };
  readonly #sound = createSound(window);
  #heard = false;
  readonly #wasLifted: boolean[] = [];
  /** Ids on the back last frame. Null until the first sync, so birth is silent. */
  #carried: Set<string> | null = null;
  /** Reused so an idle frame does not allocate a set of ids. */
  readonly #alive = new Set<string>();
  #halt: 'clear' | 'solid' | 'steep' = 'clear';

  #yaw: number = VIEW.yaw;
  #pitch: number = VIEW.pitch;
  #distance: number = VIEW.distance;
  /** God view. Drag pans, the wheel changes height, and the sense overlay is on. */
  #overlook = false;
  readonly #observe: ObserveOverlay;
  readonly #focus = new Vector3();
  #dragging = false;
  #pointerX = 0;
  #pointerY = 0;
  /** Advance the one simulation, then read its world for the props. */
  #step: ((dt: number) => void) | null = null;
  #world: (() => WorldState) | null = null;
  /** Screen point just above the body, for the speech bubble. */
  #onAnchor: ((point: { x: number; y: number } | null) => void) | null = null;
  readonly #camPos = new Vector3();
  #camReady = false;
  #last = performance.now();

  constructor(host: HTMLElement, spider: Spider) {
    this.#host = host;
    this.#spider = spider;

    this.#renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.#renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.#renderer.setClearColor(PALETTE.paper, 1);
    host.appendChild(this.#renderer.domElement);

    this.#camera = new PerspectiveCamera(VIEW.fov, 1, VIEW.near, VIEW.far);
    this.#observe = new ObserveOverlay(host);
    this.#scene.add(this.#spider.root, this.#spider.rig, this.#observe.object);

    this.#bindEvents();
    this.#resize();
  }

  /** The render loop steps this once, then draws the same spider. */
  bind(step: (dt: number) => void, world: () => WorldState): void {
    this.#step = step;
    this.#world = world;
  }

  /** Called after each paint with a point above the spider, in page pixels. */
  follow(onAnchor: (point: { x: number; y: number } | null) => void): void {
    this.#onAnchor = onAnchor;
  }

  /** Switch between the chase camera and the overhead observation view. */
  setOverlook(on: boolean): void {
    this.#overlook = on;
    if (on) {
      this.#focus.copy(this.#spider.root.position);
      this.#distance = 34;
    } else {
      this.#distance = VIEW.distance;
      this.#pitch = VIEW.pitch;
    }
  }

  start(): void {
    this.#last = performance.now();
    this.#renderer.setAnimationLoop(this.#frame);
  }

  /** The ground mesh is baked once. A restored seed needs a new island. */
  retile(): void {
    if (this.#island) {
      disposeGeometries(this.#island);
      this.#scene.remove(this.#island);
      this.#island = null;
    }
    for (const [id, prop] of this.#props) {
      disposeGeometries(prop);
      this.#scene.remove(prop);
      this.#props.delete(id);
      this.#stages.delete(id);
    }
    this.#drapedGrass.clear();
    this.#carried = null;
    this.#observe.reset();
    this.#syncWorld();
  }

  #syncWorld(): void {
    const world = this.#world?.();
    if (!world) return;
    if (!this.#island) {
      this.#island = buildIsland((x, z) => world.terrain.height(x, z));
      this.#scene.add(this.#island);
    }

    const held = world.carrying;
    const carried = this.#carried;
    if (!carried || carried.size !== held.length || held.some((item) => !carried.has(item.id))) {
      if (carried) {
        for (const item of held) if (!carried.has(item.id)) this.#sound.grasp();
        for (const id of carried) {
          if (held.some((item) => item.id === id)) continue;
          if (world.entities.some((item) => item.id === id)) this.#sound.place();
        }
      }
      this.#carried = new Set(held.map((item) => item.id));
    }

    const alive = this.#alive;
    alive.clear();
    for (const entity of world.entities) {
      alive.add(entity.id);
      this.#syncProp(entity, entity.x, entity.y, entity.z, world);
    }

    const back = this.#spider.root.position;
    const yaw = this.#spider.yaw;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (let index = 0; index < held.length; index++) {
      const item = held[index];
      alive.add(item.id);
      const along = (index - (held.length - 1) / 2) * 0.42;
      this.#syncProp(item, back.x - fx * along, back.y + 0.95, back.z - fz * along, world);
    }

    for (const [id, prop] of this.#props) {
      if (alive.has(id)) continue;
      disposeGeometries(prop);
      this.#scene.remove(prop);
      this.#props.delete(id);
      this.#stages.delete(id);
      this.#drapedGrass.delete(id);
      this.#sound.take();
    }
  }

  /** Draw one entity, rebuilding it only when its bite stage changes. */
  #syncProp(entity: EntityState, x: number, y: number, z: number, world: WorldState): void {
    const previous = this.#stages.get(entity.id);
    let prop = this.#props.get(entity.id);
    if (prop && previous !== entity.stage) {
      disposeGeometries(prop);
      this.#scene.remove(prop);
      this.#props.delete(entity.id);
      this.#drapedGrass.delete(entity.id);
      prop = undefined;
      if (previous != null && entity.stage > previous) this.#sound.bite();
    }
    if (!prop) {
      const built = buildProp(entity.kind, entity.stage, entity.footprint);
      if (!built) return;
      prop = built;
      this.#props.set(entity.id, prop);
      this.#scene.add(prop);
    }
    this.#stages.set(entity.id, entity.stage);
    if (entity.kind === 'grass') {
      const draped = this.#drapedGrass.get(entity.id);
      if (!draped || draped.x !== x || draped.z !== z || draped.terrain !== world.terrain) {
        drapeGrass(prop, x, z, (px, pz) => world.terrain.height(px, pz));
        this.#drapedGrass.set(entity.id, { x, z, terrain: world.terrain });
      }
    } else if (prop.position.x !== x || prop.position.y !== y || prop.position.z !== z) {
      prop.position.set(x, y, z);
    }
  }

  /** A quiet tick for words appearing beside the spider. */
  voice(): void {
    this.#sound.voice();
  }

  dispose(): void {
    this.#renderer.setAnimationLoop(null);
    this.#resizeObserver.disconnect();
    const el = this.#renderer.domElement;
    el.removeEventListener('pointerdown', this.#onPointerDown);
    el.removeEventListener('pointerup', this.#onPointerUp);
    el.removeEventListener('pointermove', this.#onPointerMove);
    el.removeEventListener('wheel', this.#onWheel);
    disposeGeometries(this.#scene);
    this.#renderer.dispose();
    this.#sound.dispose();
    el.remove();
  }

  #bindEvents(): void {
    const el = this.#renderer.domElement;
    el.addEventListener('pointerdown', this.#onPointerDown);
    el.addEventListener('pointerup', this.#onPointerUp);
    el.addEventListener('pointermove', this.#onPointerMove);
    el.addEventListener('wheel', this.#onWheel, { passive: false });

    this.#resizeObserver = new ResizeObserver(() => this.#resize());
    this.#resizeObserver.observe(this.#host);
  }

  #onPointerDown = (event: PointerEvent): void => {
    this.#dragging = true;
    this.#pointerX = event.clientX;
    this.#pointerY = event.clientY;
    this.#renderer.domElement.setPointerCapture(event.pointerId);
  };

  #onPointerUp = (): void => {
    this.#dragging = false;
  };

  #onPointerMove = (event: PointerEvent): void => {
    if (!this.#dragging) return;
    const dx = event.clientX - this.#pointerX;
    const dy = event.clientY - this.#pointerY;
    this.#pointerX = event.clientX;
    this.#pointerY = event.clientY;
    if (this.#overlook) {
      const span = this.#distance * 0.0015;
      this.#focus.x = MathUtils.clamp(this.#focus.x - dx * span, -TERRAIN.half, TERRAIN.half);
      this.#focus.z = MathUtils.clamp(this.#focus.z + dy * span, -TERRAIN.half, TERRAIN.half);
      return;
    }
    this.#yaw -= dx * VIEW.dragYaw;
    this.#pitch = MathUtils.clamp(this.#pitch + dy * VIEW.dragPitch, VIEW.minPitch, VIEW.maxPitch);
  };

  #onWheel = (event: WheelEvent): void => {
    const min = this.#overlook ? 10 : VIEW.minDistance;
    const max = this.#overlook ? 96 : VIEW.maxDistance;
    this.#distance = MathUtils.clamp(this.#distance * (1 + event.deltaY * VIEW.zoom), min, max);
    event.preventDefault();
  };

  // Orbit angles are an offset in the character frame, then applied with the
  // same quaternion the body moves with. They are not a second heading.
  #placeCamera(dt: number): void {
    if (this.#overlook) {
      const height = this.#distance;
      desired.set(this.#focus.x, height, this.#focus.z + height * 0.18);
      look.set(this.#focus.x, 0, this.#focus.z);
    } else {
      const c = Math.cos(this.#pitch);
      local.set(
        Math.sin(this.#yaw) * c * this.#distance,
        Math.sin(this.#pitch) * this.#distance,
        Math.cos(this.#yaw) * c * this.#distance,
      );
      local.applyQuaternion(this.#spider.root.quaternion);
      desired.copy(this.#spider.root.position).add(local);
      look.copy(this.#spider.root.position);
      look.y += VIEW.lookUp;
    }

    if (!this.#camReady) {
      this.#camPos.copy(desired);
      this.#camReady = true;
    } else {
      this.#camPos.lerp(desired, 1 - Math.exp(-VIEW.ease * Math.max(dt, 0.001)));
    }
    this.#camera.position.copy(this.#camPos);
    this.#camera.lookAt(look);
  }

  #resize(): void {
    const w = this.#host.clientWidth;
    const h = this.#host.clientHeight;
    if (w < 2 || h < 2) return;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
    const rect = this.#renderer.domElement.getBoundingClientRect();
    this.#view = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  #frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    this.#step?.(dt);
    this.#syncWorld();
    this.#feedback();

    this.#placeCamera(dt);
    const world = this.#world?.();
    if (world) this.#observe.sync(this.#overlook, this.#camera, this.#spider, world, this.#view);
    this.#renderer.render(this.#scene, this.#camera);
    this.#onAnchor?.(this.#aboveSpider());
  };

  /** One tick when any foot lands, and one when an apple disappears. */
  #feedback(): void {
    const legs = this.#spider.legs;
    if (!this.#heard) {
      for (let i = 0; i < legs.length; i++) this.#wasLifted[i] = legs[i].lifted;
      this.#heard = true;
      return;
    }
    let landed = false;
    for (let i = 0; i < legs.length; i++) {
      const lifted = legs[i].lifted;
      if (this.#wasLifted[i] && !lifted) landed = true;
      this.#wasLifted[i] = lifted;
    }
    if (landed) this.#sound.step(this.#spider.speed);
    const halt = this.#spider.halt;
    if (halt !== 'clear' && this.#halt === 'clear') this.#sound.knock();
    this.#halt = halt;
  }

  /** A point above the shell, or null when it is behind the camera. */
  #aboveSpider(): { x: number; y: number } | null {
    bubbleAt.copy(this.#spider.root.position);
    bubbleAt.y += 1.45;
    bubbleAt.project(this.#camera);
    if (bubbleAt.z > 1) return null;
    const view = this.#view;
    return {
      x: view.left + (bubbleAt.x * 0.5 + 0.5) * view.width,
      y: view.top + (-bubbleAt.y * 0.5 + 0.5) * view.height,
    };
  }
}

/** Release geometry owned by a scene subtree without touching shared materials. */
function disposeGeometries(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  root.traverse((node) => {
    const geometry = (node as Object3D & { geometry?: BufferGeometry }).geometry;
    if (geometry) geometries.add(geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}
