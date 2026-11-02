import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Vector3,
  type Camera,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { grassHere } from '../shared/sight.js';
import { toObservation, type Observation, type WorldState } from '../shared/state.js';
import { surfaceAt } from '../shared/terrain.js';
import { GRASS_VIEW, REACH, VIEW_DISTANCE } from '../shared/world.js';
import type { Spider } from '../shared/sim/Spider.js';

const RING = 72;
const OBSERVE_REFRESH_MS = 100;
const NAME: Record<string, string> = { apple: '苹果', grass: '草', nest: '巢' };

/** God view of what the spider can sense. The chase camera stays as it is. */
export class ObserveOverlay {
  readonly #root = new Group();
  readonly #viewRing: Line;
  readonly #reachRing: Line;
  readonly #ahead: Line;
  readonly #marks: LineSegments;
  readonly #dim: LineSegments;
  readonly #layer: HTMLElement;
  readonly #readout: HTMLElement;
  readonly #pins: HTMLElement;
  #observation: Observation | null = null;
  #observedAt = Number.NEGATIVE_INFINITY;

  constructor(parent: HTMLElement) {
    const ink = new LineBasicMaterial({ color: PALETTE.ink });
    const quiet = new LineBasicMaterial({ color: PALETTE.grid });
    this.#viewRing = new Line(ringGeometry(), ink);
    this.#reachRing = new Line(ringGeometry(), quiet);
    this.#ahead = new Line(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)),
      ink,
    );
    this.#marks = new LineSegments(tickGeometry(24), ink);
    this.#dim = new LineSegments(tickGeometry(24), quiet);
    this.#root.add(this.#viewRing, this.#reachRing, this.#ahead, this.#marks, this.#dim);

    this.#layer = document.createElement('div');
    this.#layer.id = 'observe';
    this.#layer.hidden = true;
    this.#readout = document.createElement('div');
    this.#readout.id = 'observe-readout';
    this.#pins = document.createElement('div');
    this.#pins.id = 'observe-pins';
    this.#layer.append(this.#readout, this.#pins);
    parent.append(this.#layer);
  }

  get object(): Group {
    return this.#root;
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
    const distance = grassHere(x, z, world.entities)
      ? Math.min(VIEW_DISTANCE, GRASS_VIEW)
      : VIEW_DISTANCE;
    const now = performance.now();
    if (!this.#observation || now - this.#observedAt >= OBSERVE_REFRESH_MS) {
      this.#observation = toObservation(spider.capture(), world, REACH, distance);
      this.#observedAt = now;
    }
    const observation = this.#observation;
    const ground = (px: number, pz: number) => surfaceAt(height, px, pz) + 0.14;

    layRing(this.#viewRing.geometry, x, z, observation.view, ground);
    layRing(this.#reachRing.geometry, x, z, REACH, ground);

    const heading = (observation.self.heading * Math.PI) / 180;
    const fx = Math.sin(heading);
    const fz = -Math.cos(heading);
    const open = Math.max(observation.self.ahead.open, 0.6);
    const ahead = this.#ahead.geometry.getAttribute('position') as BufferAttribute;
    const y0 = ground(x, z);
    const y1 = ground(x + fx * open, z + fz * open);
    ahead.setXYZ(0, x, y0, z);
    ahead.setXYZ(1, x + fx * open, y1, z + fz * open);
    ahead.needsUpdate = true;

    const seen = new Map(observation.entities.map((entity) => [entity.id, entity]));
    let inkCount = 0;
    let dimCount = 0;
    const pins = this.#layer.ownerDocument.createDocumentFragment();
    for (const entity of world.entities) {
      const hit = seen.get(entity.id);
      const state = hit
        ? hit.inReach
          ? 'reach'
          : 'seen'
        : Math.hypot(entity.x - x, entity.z - z) > observation.view
          ? 'beyond'
          : 'hidden';
      const slot = state === 'seen' || state === 'reach' ? inkCount++ : dimCount++;
      const lines = state === 'seen' || state === 'reach' ? this.#marks : this.#dim;
      layTick(
        lines.geometry.getAttribute('position') as BufferAttribute,
        slot,
        entity.x,
        entity.z,
        ground,
      );
      const point = project(camera, entity.x, ground(entity.x, entity.z) + 0.4, entity.z, view);
      if (!point) continue;
      const name = NAME[entity.kind] ?? entity.kind;
      const note =
        state === 'reach'
          ? '够得着'
          : state === 'seen'
            ? '看见'
            : state === 'hidden'
              ? '挡住'
              : '视线外';
      const pin = this.#layer.ownerDocument.createElement('span');
      pin.className = 'observe-pin';
      pin.dataset.state = state;
      pin.style.left = `${point.x}px`;
      pin.style.top = `${point.y}px`;
      pin.textContent = `${entity.id}　${name}　${note}`;
      pins.append(pin);
    }
    (this.#marks.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.#dim.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.#marks.geometry.setDrawRange(0, inkCount * 4);
    this.#dim.geometry.setDrawRange(0, dimCount * 4);
    this.#pins.replaceChildren(pins);

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
      : observation.self.cover === 'grass'
        ? '在草里'
        : '在空地上';
    this.#readout.textContent = [
      `${where}　朝向 ${observation.self.heading}°　速度 ${observation.self.speed}`,
      `看见 ${observation.view}　够得着 ${REACH}　${front}`,
      `背上 ${carrying}　超出视线 ${observation.beyond}　被挡住 ${observation.hidden}`,
      ...observation.self.ways,
    ].join('\n');
  }
}

function ringGeometry(): BufferGeometry {
  return new BufferGeometry().setAttribute(
    'position',
    new BufferAttribute(new Float32Array((RING + 1) * 3), 3),
  );
}

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
