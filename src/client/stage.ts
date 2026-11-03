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
import { kindOf } from '../shared/kinds.js';
import { WORLD_RADIUS } from '../shared/terrain.js';
import type { EntityState, WorldState } from '../shared/state.js';
import type { Spider } from '../shared/sim/Spider.js';
import { paintCanvas } from '../ui/dress.js';
import { buildIsland, tickWater } from './groundView.js';
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

/** Renderer and camera. It steps the one spider, then paints that same spider. */
export class Stage {
  readonly #host: HTMLElement;
  readonly #renderer: WebGLRenderer;
  readonly #scene = new Scene();
  readonly #camera: PerspectiveCamera;
  readonly #spider: Spider;
  readonly #props = new Map<string, Group>();
  #island: Group | null = null;
  /** While set, a restored seed waits for the world worker instead of meshing here. */
  #islandPending = false;
  #islandRequest = 0;
  #islandSource: ((seed: number) => Promise<Group>) | null = null;
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
  readonly #lookPos = new Vector3();
  #camReady = false;
  #last = performance.now();

  constructor(host: HTMLElement, spider: Spider) {
    this.#host = host;
    this.#spider = spider;

    this.#renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    // Draw at the screen's own pixels, capped at 2, so the ink stays sharp.
    this.#renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.#renderer.setClearColor(PALETTE.paper, 1);
    host.appendChild(this.#renderer.domElement);
    paintCanvas(this.#renderer.domElement);

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

  /** Use an island the world worker already built. */
  placeIsland(group: Group): void {
    this.#dropIsland();
    this.#island = group;
    this.#islandPending = false;
    this.#scene.add(group);
  }

  /** A restored seed can be meshed off the page thread. */
  setIslandSource(source: (seed: number) => Promise<Group>): void {
    this.#islandSource = source;
  }

  /** The ground mesh is baked once. A restored seed needs a new island. */
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
    // 背得多时排成两列，别让七只苹果从背上排到尾巴外面。
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
    const spec = kindOf(entity.kind)?.physics;
    const roll = spec?.rolls ? spec.radius : 0;
    if (!prop) {
      const built = buildProp(entity.kind, entity.stage, entity.footprint, entity.id);
      if (!built) return;
      if (roll > 0) {
        // The mesh origin is its bottom. Spin around the center, so the
        // contact point stays on the ground while the body turns.
        const pivot = new Group();
        built.position.y = -roll;
        pivot.add(built);
        prop = pivot;
      } else {
        prop = built;
      }
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
      // 像拖地图一样：内容跟着指针走，镜头就朝反方向平移。
      // 横竖都按同一个方向约定，斜着拖才不会一边跟手一边反着跑。
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

  // Orbit angles are an offset in the character frame, then applied with the
  // same quaternion the body moves with. They are not a second heading.
  #placeCamera(dt: number): void {
    if (this.#overlook) {
      const world = this.#world?.();
      const ground = world?.terrain.height(this.#focus.x, this.#focus.z) ?? 0;
      const sky = this.#distance;
      const back = sky * 0.18;
      desired.set(this.#focus.x, ground + sky, this.#focus.z + back);
      look.set(this.#focus.x, ground, this.#focus.z);
      // 三维地面有起伏：山脊挡在焦点和机位之间时，把机位抬到山脊上方，
      // 而不是让俯视镜头穿进山体里。
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
      // 地形有起伏，镜头不能钻进山腹；沿视线把机位抬到山脊之上。
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
      // Position and look target ease together. Entering the overlook then
      // turns and pulls back in one motion instead of snapping the heading.
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
    this.#step?.(dt);
    tickWater(now * 0.001);
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
