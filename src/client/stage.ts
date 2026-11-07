import {
  Group,
  MathUtils,
  PerspectiveCamera,
  PCFShadowMap,
  Scene,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { PALETTE } from '../shared/config.js';
import { kindOf } from '../shared/kinds.js';
import { WORLD_RADIUS } from '../shared/terrain.js';
import type { EntityState, WorldState } from '../shared/state.js';
import type { Spider } from '../shared/sim/Spider.js';
import { paintCanvas } from '../ui/dress.js';
import { FpsDisplay } from './fps.js';
import { buildIsland, tickWater } from './groundView.js';
import { waterContact, waterSplashes } from './waterMotion.js';
import { applyEcologyLighting, EcologySky, enableWorldShadows } from './ecologyView.js';
import { Headlamp } from './headlamp.js';
import { worldClock } from '../shared/ecology.js';
import { ObserveOverlay } from './observeView.js';
import { buildProp, drapeGrass } from './props.js';
import { createSound } from './sound.js';

const VIEW = {
  fov: 32,
  near: 0.08,
  far: 200,
  yaw: Math.PI + 0.62,
  pitch: 0.32,
  distance: 9.8,
  minDistance: 6,
  maxDistance: 30,
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

export class Stage {
  readonly #fps: FpsDisplay;
  readonly #host: HTMLElement;
  readonly #renderer: WebGPURenderer;
  readonly #scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #spider: Spider;
  readonly #props = new Map<string, Group>();
  #island: Group | null = null;
  #islandPending = false;
  #islandRequest = 0;
  #islandSource: ((seed: number) => Promise<Group>) | null = null;
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
  #carried: Set<string> | null = null;
  readonly #alive = new Set<string>();
  #halt: 'clear' | 'solid' | 'steep' = 'clear';

  #yaw: number = VIEW.yaw;
  #pitch: number = VIEW.pitch;
  #distance: number = VIEW.distance;
  #overlook = false;
  readonly #observe: ObserveOverlay;
  readonly #focus = new Vector3();
  #dragging = false;
  #pointerX = 0;
  #pointerY = 0;
  #step: ((dt: number) => void) | null = null;
  #held = false;
  #world: (() => WorldState) | null = null;
  #onAnchor: ((point: { x: number; y: number } | null) => void) | null = null;
  readonly #camPos = new Vector3();
  readonly #lookPos = new Vector3();
  #camReady = false;
  #last = performance.now();
  #ecologySecond = -1;
  readonly #sky = new EcologySky();
  readonly #lamp = new Headlamp();
  #clock = worldClock();

  constructor(host: HTMLElement, spider: Spider) {
    this.#host = host;
    this.#spider = spider;

    this.#renderer = new WebGPURenderer({
      alpha: false,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.#renderer.shadowMap.enabled = true;
    this.#renderer.shadowMap.type = PCFShadowMap;
    this.#renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.#renderer.setClearColor(PALETTE.paper, 1);
    host.appendChild(this.#renderer.domElement);
    paintCanvas(this.#renderer.domElement);
    this.#fps = new FpsDisplay(host);

    this.#camera = new PerspectiveCamera(VIEW.fov, 1, VIEW.near, VIEW.far);
    this.#observe = new ObserveOverlay(host);
    enableWorldShadows(this.#spider.root);
    enableWorldShadows(this.#spider.rig);
    this.#scene.add(
      this.#spider.root,
      this.#spider.rig,
      this.#observe.object,
      this.#sky.object,
      waterSplashes,
    );

    this.#lamp.attach(this.#spider);

    this.#bindEvents();
    this.#resize();
  }

  bind(step: (dt: number) => void, world: () => WorldState): void {
    this.#step = step;
    this.#world = world;
  }

  hold(on: boolean): void {
    this.#held = on;
  }

  follow(onAnchor: (point: { x: number; y: number } | null) => void): void {
    this.#onAnchor = onAnchor;
  }

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

  placeIsland(group: Group): void {
    this.#dropIsland();
    enableWorldShadows(group);
    this.#island = group;
    this.#islandPending = false;
    this.#scene.add(group);
  }

  setIslandSource(source: (seed: number) => Promise<Group>): void {
    this.#islandSource = source;
  }

  retile(): void {
    const seed = this.#world?.().seed;
    if (this.#islandSource && seed != null) {
      const request = ++this.#islandRequest;
      this.#islandPending = true;
      this.#dropIsland();
      void this.#islandSource(seed).then(
        (group) => {
          if (request !== this.#islandRequest) return;
          this.placeIsland(group);
        },
        () => {
          if (request !== this.#islandRequest) return;
          this.#islandPending = false;
          this.#syncWorld();
        },
      );
    } else {
      this.#dropIsland();
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
    if (!this.#island && !this.#islandPending) {
      this.#island = buildIsland((x, z) => world.terrain.height(x, z));
      enableWorldShadows(this.#island);
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
    const rows = held.length > 3 ? 2 : 1;
    const cols = Math.ceil(held.length / rows);
    const rightX = -fz;
    const rightZ = fx;
    for (let index = 0; index < held.length; index++) {
      const item = held[index];
      alive.add(item.id);
      const row = index % rows;
      const col = Math.floor(index / rows);
      const along = (col - (cols - 1) / 2) * 0.42;
      const lateral = rows === 1 ? 0 : row === 0 ? -0.24 : 0.24;
      this.#syncProp(
        item,
        back.x - fx * along + rightX * lateral,
        back.y + 0.95,
        back.z - fz * along + rightZ * lateral,
        world,
      );
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
    const spec = kindOf(entity.kind)?.physics;
    const roll = spec?.rolls ? spec.radius : 0;
    if (!prop) {
      const built = buildProp(entity.kind, entity.stage, entity.footprint, entity.id);
      if (!built) return;
      if (roll > 0) {
        const pivot = new Group();
        built.position.y = -roll;
        pivot.add(built);
        prop = pivot;
      } else {
        prop = built;
      }
      enableWorldShadows(prop);
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
      return;
    }
    const py = y + roll;
    if (prop.position.x !== x || prop.position.y !== py || prop.position.z !== z) {
      prop.position.set(x, py, z);
    }
    if (roll > 0) {
      prop.quaternion.set(entity.qx ?? 0, entity.qy ?? 0, entity.qz ?? 0, entity.qw ?? 1);
    }
  }

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
    this.#sky.dispose();
    this.#lamp.dispose();
    this.#renderer.dispose();
    this.#sound.dispose();
    el.remove();
    this.#fps.element.remove();
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
      this.#focus.x = MathUtils.clamp(this.#focus.x - dx * span, -WORLD_RADIUS, WORLD_RADIUS);
      this.#focus.z = MathUtils.clamp(this.#focus.z - dy * span, -WORLD_RADIUS, WORLD_RADIUS);
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

  #placeCamera(dt: number): void {
    if (this.#overlook) {
      const world = this.#world?.();
      const ground = world?.terrain.height(this.#focus.x, this.#focus.z) ?? 0;
      const sky = this.#distance;
      const back = sky * 0.18;
      desired.set(this.#focus.x, ground + sky, this.#focus.z + back);
      look.set(this.#focus.x, ground, this.#focus.z);
      if (world) {
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          const gx = look.x + (desired.x - look.x) * t;
          const gz = look.z + (desired.z - look.z) * t;
          const ridge = world.terrain.height(gx, gz) + 1.2;
          desired.y = Math.max(desired.y, look.y + (ridge - look.y) / t);
        }
      }
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
      const world = this.#world?.();
      if (world) {
        for (let k = 1; k <= 6; k++) {
          const t = k / 6;
          const gx = look.x + (desired.x - look.x) * t;
          const gz = look.z + (desired.z - look.z) * t;
          const ground = world.terrain.height(gx, gz) + 1.2;
          desired.y = Math.max(desired.y, look.y + (ground - look.y) / t);
        }
      }
    }

    if (!this.#camReady) {
      this.#camPos.copy(desired);
      this.#lookPos.copy(look);
      this.#camReady = true;
    } else {
      const blend = 1 - Math.exp(-VIEW.ease * Math.max(dt, 0.001));
      this.#camPos.lerp(desired, blend);
      this.#lookPos.lerp(look, blend);
    }
    this.#camera.position.copy(this.#camPos);
    this.#camera.lookAt(this.#lookPos);
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

  #dropIsland(): void {
    if (!this.#island) return;
    disposeGeometries(this.#island);
    this.#scene.remove(this.#island);
    this.#island = null;
  }

  #frame = (now: number): void => {
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    if (!this.#held) this.#step?.(dt);
    this.#syncEcology();
    tickWater(now * 0.001, waterContact(this.#spider, this.#wasLifted, this.#world?.() ?? null));
    this.#syncWorld();
    this.#feedback();

    this.#placeCamera(dt);
    this.#sky.update(
      this.#clock,
      this.#overlook ? this.#focus : this.#spider.root.position,
      this.#overlook,
      dt,
    );
    this.#lamp.update(this.#clock, this.#spider.lamp);
    const world = this.#world?.();
    if (world) this.#observe.sync(this.#overlook, this.#camera, this.#spider, world, this.#view);
    this.#renderer.render(this.#scene, this.#camera);
    this.#fps.tick(now);
    this.#onAnchor?.(this.#aboveSpider());
  };

  #syncEcology(): void {
    const epochSecond = Math.floor(Date.now() / 1000);
    if (epochSecond === this.#ecologySecond) return;
    this.#ecologySecond = epochSecond;
    this.#clock = applyEcologyLighting(this.#renderer, new Date(epochSecond * 1000));
  }

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

function disposeGeometries(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  root.traverse((node) => {
    if (keepsGeometry(node)) return;
    const geometry = (node as Object3D & { geometry?: BufferGeometry }).geometry;
    if (geometry) geometries.add(geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

function keepsGeometry(node: Object3D): boolean {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (current.userData.retainGeometry === true) return true;
  }
  return false;
}
