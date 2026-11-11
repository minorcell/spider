import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Vector3,
  type Camera,
} from 'three';
import { PALETTE } from '@/src/shared/config';
import { kindOf } from '@/src/shared/kinds';
import { paintObserve, paintPin } from '@/src/ui/dress';
import { aheadAt } from '@/src/shared/sense';
import { surfaceOf } from '@/src/shared/terrain';
import { toHeading, toObservation, type Observation, type WorldState } from '@/src/shared/state';
import { heldBy } from '@/src/shared/sim/tether';
import { viewDistance } from '@/src/shared/vision';

import { REACH, REACH_Y } from '@/src/shared/world';
import type { Controller } from '@/src/shared/sim/controller';
import { describeObservation, meters } from './observationText';

const RING = 72;
const OBSERVE_REFRESH_MS = 100;
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
  readonly #nodes = new Map<string, HTMLSpanElement>();
  readonly #at = new Map<string, { x: number; y: number; z: number }>();
  #observation: Observation | null = null;
  #observedAt = Number.NEGATIVE_INFINITY;
  #ringAt = { x: Number.NaN, z: Number.NaN, view: Number.NaN };
  #aheadAt = { x: Number.NaN, z: Number.NaN, heading: Number.NaN, open: Number.NaN };
  readonly #pinCamera = new Matrix4();
  readonly #pinProjection = new Matrix4();
  #pinsDirty = true;
  #pinWidth = Number.NaN;
  #pinHeight = Number.NaN;

  constructor(parent: HTMLElement) {
    const ink = new LineBasicMaterial({ color: PALETTE.ink });
    const quiet = new LineBasicMaterial({ color: PALETTE.grid });
    this.#viewRing = new Line(
      ringGeometry(),
      new LineBasicMaterial({
        color: 0xd88e81,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.#reachRing = new Line(
      ringGeometry(),
      new LineBasicMaterial({
        color: PALETTE.paper,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.#ahead = new Line(
      new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(6), 3)),
      ink,
    );
    this.#marks = new LineSegments(tickGeometry(24), ink);
    this.#dim = new LineSegments(tickGeometry(24), quiet);
    this.#root.add(this.#viewRing, this.#reachRing, this.#ahead, this.#marks, this.#dim);
    for (const object of [this.#viewRing, this.#reachRing, this.#ahead, this.#marks, this.#dim]) {
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

  dispose(): void {
    this.#layer.remove();
  }

  reset(): void {
    this.#observation = null;
    this.#observedAt = Number.NEGATIVE_INFINITY;
    this.#ringAt = { x: Number.NaN, z: Number.NaN, view: Number.NaN };
    this.#aheadAt = { x: Number.NaN, z: Number.NaN, heading: Number.NaN, open: Number.NaN };
    this.#pinsDirty = true;
  }

  sync(
    on: boolean,
    camera: Camera,
    actor: Pick<Controller, 'position' | 'yaw' | 'heightSet' | 'lamp' | 'capture'>,
    world: WorldState,
    view: { left: number; top: number; width: number; height: number },
  ): void {
    this.#root.visible = on;
    this.#layer.hidden = !on;
    if (!on) {
      this.#observation = null;
      return;
    }

    const x = actor.position.x;
    const z = actor.position.z;
    const walk = (px: number, pz: number) => surfaceOf(world.terrain, px, pz);
    const now = performance.now();
    let observation = this.#observation;
    let fresh = false;
    if (!observation || now - this.#observedAt >= OBSERVE_REFRESH_MS) {
      const distance = viewDistance(world, x, z, actor.heightSet, actor.lamp);
      observation = toObservation(actor.capture(), world, REACH, distance, REACH_Y);
      this.#observation = observation;
      this.#observedAt = now;
      fresh = true;
    }
    const ground = (px: number, pz: number) => walk(px, pz) + 0.14;

    const ring = this.#ringAt;
    if (fresh && (ring.x !== x || ring.z !== z || ring.view !== observation.view)) {
      ring.x = x;
      ring.z = z;
      ring.view = observation.view;
      layRing(this.#viewRing.geometry, x, z, observation.view, ground);
      layRing(this.#reachRing.geometry, x, z, REACH, ground);
    }

    const yaw = actor.yaw;
    const ahead = this.#aheadAt;
    if (ahead.x !== x || ahead.z !== z || ahead.heading !== yaw) {
      const inside = world.terrain.inside
        ? (px: number, pz: number, margin?: number): boolean =>
            world.terrain.inside!(px, pz, margin)
        : undefined;
      const felt = aheadAt(x, z, toHeading(yaw), walk, world.blocks, inside);
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
      const readout = describeObservation(observation);
      if (this.#readout.textContent !== readout) this.#readout.textContent = readout;
    }
    this.#place(camera, view);
  }

  #layout(
    x: number,
    z: number,
    observation: Observation,
    world: WorldState,
    ground: (x: number, z: number) => number,
  ): void {
    ensureTickCapacity(this.#marks, world.entities.size);
    ensureTickCapacity(this.#dim, world.entities.size);
    const seen = new Map(observation.entities.map((entity) => [entity.id, entity]));
    const live = new Set<string>();
    let inkCount = 0;
    let dimCount = 0;
    for (const entity of world.entities.values()) {
      if (entity.id === world.controlledId) continue;
      if (heldBy(world, entity.id)) continue;
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
      const name = kindOf(entity.kind)?.label ?? entity.kind;
      const rise = entity.y - observation.self.ground;
      const climb =
        Math.abs(rise) < 0.05 ? '' : rise > 0 ? `　高 ${meters(rise)}` : `　低 ${meters(-rise)}`;
      let pin = this.#nodes.get(entity.id);
      if (!pin) {
        pin = this.#layer.ownerDocument.createElement('span');
        pin.className = 'observe-pin';
        this.#pins.append(pin);
        this.#nodes.set(entity.id, pin);
        this.#pinsDirty = true;
      }
      if (pin.dataset.state !== state) {
        pin.dataset.state = state;
        paintPin(pin, state);
      }
      const label = `${entity.id}　${name}　${note}${climb}`;
      if (pin.textContent !== label) pin.textContent = label;
      const py = ground(entity.x, entity.z) + 0.4;
      const previous = this.#at.get(entity.id);
      if (!previous || previous.x !== entity.x || previous.y !== py || previous.z !== entity.z) {
        this.#at.set(entity.id, { x: entity.x, y: py, z: entity.z });
        this.#pinsDirty = true;
      }
    }

    for (const [id, pin] of this.#nodes) {
      if (live.has(id)) continue;
      pin.remove();
      this.#nodes.delete(id);
      this.#at.delete(id);
      this.#pinsDirty = true;
    }

    (this.#marks.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.#dim.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    this.#marks.geometry.setDrawRange(0, inkCount * 4);
    this.#dim.geometry.setDrawRange(0, dimCount * 4);
  }

  #place(camera: Camera, view: { width: number; height: number }): void {
    camera.updateMatrixWorld();
    if (
      !this.#pinsDirty &&
      this.#pinWidth === view.width &&
      this.#pinHeight === view.height &&
      this.#pinCamera.equals(camera.matrixWorldInverse) &&
      this.#pinProjection.equals(camera.projectionMatrix)
    )
      return;
    this.#pinsDirty = false;
    this.#pinWidth = view.width;
    this.#pinHeight = view.height;
    this.#pinCamera.copy(camera.matrixWorldInverse);
    this.#pinProjection.copy(camera.projectionMatrix);
    for (const [id, pin] of this.#nodes) {
      const at = this.#at.get(id)!;
      const point = project(camera, at.x, at.y, at.z, view);
      if (!point) {
        if (!pin.hidden) pin.hidden = true;
        continue;
      }
      if (pin.hidden) pin.hidden = false;
      const left = `${point.x}px`;
      const top = `${point.y}px`;
      if (pin.style.left !== left) pin.style.left = left;
      if (pin.style.top !== top) pin.style.top = top;
    }
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

function ensureTickCapacity(lines: LineSegments, count: number): void {
  let capacity = lines.geometry.getAttribute('position').count / 4;
  if (capacity >= count) return;
  while (capacity < count) capacity *= 2;
  lines.geometry.dispose();
  lines.geometry = tickGeometry(capacity);
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
