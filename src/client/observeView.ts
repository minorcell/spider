import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Vector3,
  type Camera,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { paintObserve, paintPin } from '../ui/dress.js';
import { aheadAt } from '../shared/sense.js';
import { EYE_HEIGHT, grassHere, sightOutline } from '../shared/sight.js';
import { surfaceOf } from '../shared/terrain.js';
import { toHeading, toObservation, type Observation, type WorldState } from '../shared/state.js';

import { GRASS_VIEW, REACH, REACH_Y, VIEW_DISTANCE } from '../shared/world.js';
import type { Spider } from '../shared/sim/Spider.js';

const RING = 72;
const OBSERVE_REFRESH_MS = 100;
const NAME: Record<string, string> = { apple: '苹果', grass: '草', nest: '巢' };

/** God view of what the spider can sense. The chase camera stays as it is. */
export class ObserveOverlay {
  readonly #root = new Group();
  readonly #viewRing: Line;
  readonly #viewFill: Mesh;
  readonly #reachRing: Line;
  readonly #ahead: Line;
  readonly #marks: LineSegments;
  readonly #dim: LineSegments;
  readonly #layer: HTMLElement;
  readonly #readout: HTMLElement;
  readonly #pins: HTMLElement;
  /** One span per visible entity, reused so the DOM is not rebuilt every frame. */
  readonly #nodes = new Map<string, HTMLSpanElement>();
  readonly #at = new Map<string, { x: number; y: number; z: number }>();
  #observation: Observation | null = null;
  #observedAt = Number.NEGATIVE_INFINITY;
  #ringAt = { x: Number.NaN, z: Number.NaN, view: Number.NaN, lift: Number.NaN };
  #aheadAt = { x: Number.NaN, z: Number.NaN, heading: Number.NaN, open: Number.NaN };

  constructor(parent: HTMLElement) {
    const ink = new LineBasicMaterial({ color: PALETTE.ink });
    const quiet = new LineBasicMaterial({ color: PALETTE.grid });
    this.#viewRing = new Line(ringGeometry(), ink);
    this.#viewFill = new Mesh(fillGeometry(), fillMat);
    this.#reachRing = new Line(ringGeometry(), quiet);
    this.#ahead = new Line(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)),
      ink,
    );
    this.#marks = new LineSegments(tickGeometry(24), ink);
    this.#dim = new LineSegments(tickGeometry(24), quiet);
    this.#root.add(
      this.#viewRing,
      this.#reachRing,
      this.#ahead,
      this.#marks,
      this.#dim,
      this.#viewFill,
    );
    for (const object of [
      this.#viewRing,
      this.#viewFill,
      this.#reachRing,
      this.#ahead,
      this.#marks,
      this.#dim,
    ]) {
      object.frustumCulled = false;
    }

    this.#layer = document.createElement('div');
    this.#layer.id = 'observe';
    this.#layer.hidden = true;
    this.#readout = document.createElement('div');
    this.#readout.id = 'observe-readout';
    this.#pins = document.createElement('div');
    this.#pins.id = 'observe-pins';
    this.#layer.append(this.#readout, this.#pins);
    paintObserve(this.#layer, this.#readout, this.#pins);
    parent.append(this.#layer);
  }

  get object(): Group {
    return this.#root;
  }

  /** Drop cached rings and the last look. A new island is a different height field. */
  reset(): void {
    this.#observation = null;
    this.#observedAt = Number.NEGATIVE_INFINITY;
    this.#ringAt = { x: Number.NaN, z: Number.NaN, view: Number.NaN, lift: Number.NaN };
    this.#aheadAt = { x: Number.NaN, z: Number.NaN, heading: Number.NaN, open: Number.NaN };
  }

  sync(
    on: boolean,
    camera: Camera,
    spider: Spider,
    world: WorldState,
    view: { left: number; top: number; width: number; height: number },
  ): void {
    this.#root.visible = on;
    this.#layer.hidden = !on;
    if (!on) {
      this.#observation = null;
      return;
    }

    const x = spider.root.position.x;
    const z = spider.root.position.z;
    const height = (px: number, pz: number) => world.terrain.height(px, pz);
    const walk = (px: number, pz: number) => surfaceOf(world.terrain, px, pz);
    const eye = walk(x, z) + EYE_HEIGHT + spider.heightSet;
    const distance = grassHere(x, z, world.entities, eye)
      ? Math.min(VIEW_DISTANCE, GRASS_VIEW)
      : VIEW_DISTANCE;
    const now = performance.now();
    let observation = this.#observation;
    let fresh = false;
    if (!observation || now - this.#observedAt >= OBSERVE_REFRESH_MS) {
      observation = toObservation(spider.capture(), world, REACH, distance, REACH_Y);
      this.#observation = observation;
      this.#observedAt = now;
      fresh = true;
    }
    const ground = (px: number, pz: number) => walk(px, pz) + 0.14;

    // The rings depend on where the body stands, how high it has reared, and
    // how far it sees, not on the camera. They only need to keep up with the
    // observation; re-tracing 72 bearings every frame stutters the view.
    const ring = this.#ringAt;
    const lift = observation.self.height;
    if (
      fresh &&
      (ring.x !== x || ring.z !== z || ring.view !== observation.view || ring.lift !== lift)
    ) {
      ring.x = x;
      ring.z = z;
      ring.view = observation.view;
      ring.lift = lift;
      const outline = sightOutline(
        x,
        z,
        walk(x, z) + EYE_HEIGHT + lift,
        observation.view,
        height,
        world.blocks,
        RING,
      );
      layOutline(this.#viewRing.geometry, outline, ground);
      layFill(this.#viewFill.geometry, outline, x, z, ground);
      layRing(this.#reachRing.geometry, x, z, REACH, ground);
    }

    const yaw = spider.yaw;
    const ahead = this.#aheadAt;
    if (ahead.x !== x || ahead.z !== z || ahead.heading !== yaw) {
      const felt = aheadAt(x, z, toHeading(yaw), walk, world.blocks);
      const open = Math.max(felt.open, 0.6);
      ahead.x = x;
      ahead.z = z;
      ahead.heading = yaw;
      ahead.open = open;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const y0 = ground(x, z);
      const y1 = ground(x + fx * open, z + fz * open);
      const position = this.#ahead.geometry.getAttribute('position') as BufferAttribute;
      position.setXYZ(0, x, y0, z);
      position.setXYZ(1, x + fx * open, y1, z + fz * open);
      position.needsUpdate = true;
    }

    if (fresh) {
      this.#layout(x, z, observation, world, ground);
      this.#readout.textContent = this.#readoutOf(observation);
    }
    this.#place(camera, view);
  }

  /** Marks and labels, only when a new observation arrives. */
  #layout(
    x: number,
    z: number,
    observation: Observation,
    world: WorldState,
    ground: (x: number, z: number) => number,
  ): void {
    const seen = new Map(observation.entities.map((entity) => [entity.id, entity]));
    const live = new Set<string>();
    let inkCount = 0;
    let dimCount = 0;
    for (const entity of world.entities) {
      const hit = seen.get(entity.id);
      const state = hit
        ? hit.inReach
          ? 'reach'
          : 'seen'
        : Math.hypot(entity.x - x, entity.z - z) > observation.view
          ? 'beyond'
          : 'hidden';
      const visible = state === 'seen' || state === 'reach';
      const lines = visible ? this.#marks : this.#dim;
      layTick(
        lines.geometry.getAttribute('position') as BufferAttribute,
        visible ? inkCount++ : dimCount++,
        entity.x,
        entity.z,
        ground,
      );

      live.add(entity.id);
      const note =
        state === 'reach'
          ? '够得着'
          : state === 'seen'
            ? '看见'
            : state === 'hidden'
              ? '挡住'
              : '视线外';
      const name = NAME[entity.kind] ?? entity.kind;
      const rise = entity.y - observation.self.y;
      const climb =
        Math.abs(rise) < 0.05 ? '' : rise > 0 ? `　高 ${meters(rise)}` : `　低 ${meters(-rise)}`;
      let pin = this.#nodes.get(entity.id);
      if (!pin) {
        pin = this.#layer.ownerDocument.createElement('span');
        pin.className = 'observe-pin';
        this.#pins.append(pin);
        this.#nodes.set(entity.id, pin);
      }
      if (pin.dataset.state !== state) {
        pin.dataset.state = state;
        paintPin(pin, state);
      }
      const label = `${entity.id}　${name}　${note}${climb}`;
      if (pin.textContent !== label) pin.textContent = label;
      this.#at.set(entity.id, { x: entity.x, y: ground(entity.x, entity.z) + 0.4, z: entity.z });
    }

    for (const [id, pin] of this.#nodes) {
      if (live.has(id)) continue;
      pin.remove();
      this.#nodes.delete(id);
      this.#at.delete(id);
    }

    (this.#marks.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.#dim.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.#marks.geometry.setDrawRange(0, inkCount * 4);
    this.#dim.geometry.setDrawRange(0, dimCount * 4);
  }

  /** Screen positions follow the camera every frame; the spans themselves stay put. */
  #place(camera: Camera, view: { width: number; height: number }): void {
    for (const [id, pin] of this.#nodes) {
      const at = this.#at.get(id);
      /* v8 ignore next */
      if (!at) continue;
      const point = project(camera, at.x, at.y, at.z, view);
      if (!point) {
        pin.hidden = true;
        continue;
      }
      pin.hidden = false;
      pin.style.left = `${point.x}px`;
      pin.style.top = `${point.y}px`;
    }
  }

  #readoutOf(observation: Observation): string {
    const aheadInfo = observation.self.ahead;
    const front =
      aheadInfo.by === 'wall'
        ? `面前 ${aheadInfo.open} 米是 ${aheadInfo.id}`
        : aheadInfo.by === 'slope'
          ? `面前 ${aheadInfo.open} 米是近乎竖直的坡`
          : `面前 ${aheadInfo.open} 米是空的`;
    const carrying = observation.self.carrying.map((item) => item.id).join('、') || '空';
    const where = observation.self.home
      ? '在巢里'
      : observation.self.wet
        ? '在水里'
        : observation.self.cover === 'grass'
          ? '在草里'
          : '在空地上';
    const water = observation.self.water;
    const shore = observation.self.shore;
    const pool = observation.self.wet
      ? `脚下是水 ${meters(observation.self.waterDepth)} 米，${observation.self.swimming ? '正浮着' : '在涉水'}` +
        `${shore ? `，最近的岸在 ${shore.bearing}° 方向 ${meters(shore.distance)} 米` : ''}`
      : water
        ? `水在 ${water.bearing}° 方向 ${meters(water.distance)} 米，深 ${meters(water.depth)} 米，至少 ${meters(water.span)} 米宽`
        : '附近没有水';
    return [
      `${where}　地面 ${meters(observation.self.ground)} 米　离地 ${meters(observation.self.height)} 米`,
      `朝向 ${observation.self.heading}°　速度 ${observation.self.speed}`,
      `看见 ${observation.view}　够得着 ${REACH}　${front}`,
      `背上 ${carrying}　超出视线 ${observation.beyond}　被挡住 ${observation.hidden}`,
      pool,
      ...observation.self.ways,
    ].join('\n');
  }
}

function meters(value: number): string {
  const text = (Math.round(value * 10) / 10).toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function ringGeometry(): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array((RING + 1) * 3), 3),
  );
}

/** A fan from the body to the sight outline. One triangle per bearing. */
function fillGeometry(): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array((RING + 1) * 3), 3));
  const index = new Uint16Array(RING * 3);
  for (let i = 0; i < RING; i++) {
    index[i * 3] = 0;
    index[i * 3 + 1] = i + 1;
    index[i * 3 + 2] = ((i + 1) % RING) + 1;
  }
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}

const fillMat = new MeshBasicMaterial({
  color: PALETTE.eye,
  transparent: true,
  opacity: 0.12,
  depthWrite: false,
  side: DoubleSide,
});

function tickGeometry(count: number): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array(count * 4 * 3), 3),
  );
}

function layRing(
  geometry: BufferGeometry,
  x: number,
  z: number,
  radius: number,
  ground: (x: number, z: number) => number,
): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i <= RING; i++) {
    const angle = (i / RING) * Math.PI * 2;
    const px = x + Math.sin(angle) * radius;
    const pz = z - Math.cos(angle) * radius;
    position.setXYZ(i, px, ground(px, pz), pz);
  }
  position.needsUpdate = true;
}

function layOutline(
  geometry: BufferGeometry,
  points: readonly { x: number; z: number }[],
  ground: (x: number, z: number) => number,
): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    position.setXYZ(i, point.x, ground(point.x, point.z), point.z);
  }
  const first = points[0]!;
  position.setXYZ(points.length, first.x, ground(first.x, first.z), first.z);
  position.needsUpdate = true;
}

function layFill(
  geometry: BufferGeometry,
  points: readonly { x: number; z: number }[],
  x: number,
  z: number,
  ground: (x: number, z: number) => number,
): void {
  const position = geometry.getAttribute('position') as BufferAttribute;
  position.setXYZ(0, x, ground(x, z) - 0.03, z);
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    position.setXYZ(i + 1, point.x, ground(point.x, point.z) - 0.03, point.z);
  }
  position.needsUpdate = true;
}

function layTick(
  position: BufferAttribute,
  index: number,
  x: number,
  z: number,
  ground: (x: number, z: number) => number,
): void {
  const y = ground(x, z);
  const o = index * 4;
  position.setXYZ(o, x - 0.28, y, z);
  position.setXYZ(o + 1, x + 0.28, y, z);
  position.setXYZ(o + 2, x, y, z - 0.28);
  position.setXYZ(o + 3, x, y, z + 0.28);
}

function project(
  camera: Camera,
  x: number,
  y: number,
  z: number,
  view: { width: number; height: number },
): { x: number; y: number } | null {
  const point = projected.set(x, y, z).project(camera);
  if (point.z > 1) return null;
  return {
    x: (point.x * 0.5 + 0.5) * view.width,
    y: (-point.y * 0.5 + 0.5) * view.height,
  };
}

const projected = new Vector3();
