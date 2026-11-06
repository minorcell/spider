import { BufferGeometry, Euler, Group, MathUtils, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { BONES, CONTACT, GAIT, MOUNTS } from '../config.js';
import { WORLD_RADIUS } from '../terrain.js';
import type { SpiderState } from '../state.js';
import { IDLE_CONTROLS, type Controls } from '../types.js';
import { floatHeight, WATER, waterPace, type Water } from '../water.js';
import { Leg } from './Leg.js';
import { solveLeg, supportY, type LegSphere } from './legPose.js';
import { ballGeo, ballShell, inkSolidMat, spiderMat } from './parts.js';
import { buildSpiderBody } from './spiderBody.js';

// A cephalothorax on eight jointed legs, an abdomen hung behind it, and an
// alternating tetrapod gait. The drawn shell is finer than these two clearance
// ellipsoids; the ellipsoids stay the walkable body.

const UP = new Vector3(0, 1, 0);
const NO_WATER: Water = Object.freeze({ surface: Number.NEGATIVE_INFINITY, depth: 0 });

// Scratch vectors: posing must not allocate per frame.
const worldFwd = new Vector3();
const worldRight = new Vector3();
const shoulderW = new Vector3();
const reachW = new Vector3();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const basisM = new Matrix4();

/**
 * Clearance shells. The head shell covers the face, eyes, fangs, and palps,
 * which sit ahead of the belly. Samples run over the whole shell, including
 * the top, so a slope cannot leave the upper body in the ground.
 */
const SHELLS: readonly {
  c: readonly [number, number, number];
  r: readonly [number, number, number];
}[] = [
  { c: [0, 0.78, -0.12], r: [0.55, 0.18, 0.46] },
  { c: [0, 0.84, 1.08], r: [0.46, 0.32, 0.62] },
  { c: [0, 0.76, -0.48], r: [0.24, 0.18, 0.26] },
];
const SHELL_PHI = [-1.35, -0.9, -0.45, 0, 0.45, 0.9, 1.35];
const SHELL_THETA = 12;
const shellEuler = new Euler(0, 0, 0, 'XYZ');
const shellPoint = new Vector3();
const partWorld = new Matrix4();

export class Spider {
  readonly root = new Group();
  /** The legs are solved and placed in world space, so rig is a sibling of root. */
  readonly rig = new Group();
  readonly chassis = new Group();

  readonly legs: Leg[];
  yaw = 0;
  yawRate = 0;
  headYaw = 0;
  heightSet = 0;
  speed = 0;
  time = 0;
  /** Downward speed while the body is above the ground. */
  fall = 0;
  /** How long a commanded step has been held still by a solid or a slope. */
  stuckFor = 0;
  /** Why the last step failed to move. `clear` means it moved, or nothing was asked. */
  halt: 'clear' | 'solid' | 'steep' = 'clear';

  #head!: Group;
  #seeded = false;
  #ground: (x: number, z: number) => number = () => 0;
  #blocked: (x: number, z: number) => boolean = () => false;
  #water: (x: number, z: number) => Water = () => NO_WATER;
  #waterNow: Water = NO_WATER;
  /** True while the water is deep enough that the feet leave the bottom. */
  #swimming = false;
  #limit = WORLD_RADIUS;
  /** Stays on while the body is still turning or walking, so feet are not glued mid-settle. */
  #stepping = false;
  /** How long the body has been fully still, in seconds. */
  #stillFor = 0;
  /** Ground height under the shell, cached for one pose. */
  #shellX = Number.NaN;
  #shellZ = Number.NaN;
  #shellYaw = Number.NaN;
  #shellGround = 0;
  /** Loose bodies the legs must not pass through. Filled once per pose. */
  #spheres: LegSphere[] = [];
  #fillLegs: (into: LegSphere[]) => void = (into) => {
    into.length = 0;
  };
  #mound: (x: number, z: number) => number = () => Number.NEGATIVE_INFINITY;
  readonly #chain = [0, 1, 2, 3, 4].map(() => new Vector3());

  constructor() {
    this.root.add(this.chassis);
    const mounts = this.#buildBody();
    this.legs = MOUNTS.map((spec, index) => new Leg(this.rig, spec, mounts[index], index));
    this.update(0, IDLE_CONTROLS);
  }

  /** The ground the feet plant on. Reseeds the stance for the new surface. */
  bindGround(ground: (x: number, z: number) => number, limit = WORLD_RADIUS): void {
    this.#ground = ground;
    this.#limit = limit;
    this.fall = 0;
    this.#seeded = false;
    this.#shellX = Number.NaN;
    this.update(0, IDLE_CONTROLS);
  }

  /** Solids you cannot walk through. */
  bindBlocked(blocked: (x: number, z: number) => boolean): void {
    this.#blocked = blocked;
  }

  /**
   * What a leg may not pass through. `fill` lists sphere centers (apples).
   * `mound` is extra ground, or −∞ where there is none (the nest).
   */
  bindLegs(fill: (into: LegSphere[]) => void, mound: (x: number, z: number) => number): void {
    this.#fillLegs = fill;
    this.#mound = mound;
  }

  /** The water column the body floats or wades through. */
  bindWater(water: (x: number, z: number) => Water): void {
    this.#water = water;
    this.#refreshWater();
  }

  /** True while buoyancy, not the ground, is holding the body up. */
  get swimming(): boolean {
    return this.#swimming;
  }

  /** Water depth under the body right now. Zero on dry ground. */
  get waterDepth(): number {
    return this.#waterNow.depth;
  }

  update(dt: number, input: Controls = IDLE_CONTROLS): void {
    const throttle = input.throttle || 0;
    const turn = input.turn || 0;
    const lift = input.lift || 0;
    const boost = input.boost ? 1 : 0;

    this.root.rotation.y = this.yaw;
    this.#readAxes();
    this.#refreshWater();
    this.#refreshLegs();
    if (!this.#seeded) this.#seedFeet();

    if (dt <= 0) {
      this.#pose();
      return;
    }

    this.time += dt;
    this.#steer(dt, turn, boost);
    const beforeX = this.root.position.x;
    const beforeZ = this.root.position.z;
    this.#drive(dt, throttle, boost);
    this.#refreshWater();
    const moved = Math.hypot(this.root.position.x - beforeX, this.root.position.z - beforeZ);
    if (Math.abs(throttle) > 0.05 && this.halt !== 'clear' && moved < 1e-4) this.stuckFor += dt;
    else this.stuckFor = 0;

    this.heightSet = MathUtils.clamp(
      this.heightSet + lift * GAIT.liftRate * dt,
      GAIT.heightMin,
      GAIT.heightMax,
    );
    this.#vertical(dt);
    this.chassis.rotation.x = -throttle * GAIT.pitch;
    this.chassis.rotation.z = this.yawRate * GAIT.roll;

    this.#stepGait(dt, throttle, turn, boost);
    this.#applySlope();
    this.#pose();
  }

  /** Snapshot for the wire: everything a viewer needs to rebuild the pose. */
  capture(): SpiderState {
    return {
      time: this.time,
      position: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z },
      yaw: this.yaw,
      speed: this.speed,
      height: this.heightSet,
      chassisPitch: this.chassis.rotation.x,
      chassisRoll: this.chassis.rotation.z,
      headYaw: this.headYaw,
      feet: this.legs.map((leg) => ({ x: leg.foot.x, y: leg.foot.y, z: leg.foot.z })),
    };
  }

  /** Viewer path: adopt an authoritative state and re-solve the pose. */
  applyState(state: SpiderState): void {
    this.time = state.time;
    this.yaw = state.yaw;
    this.speed = state.speed;
    this.heightSet = state.height;
    this.root.position.set(state.position.x, state.position.y, state.position.z);
    this.root.rotation.y = state.yaw;
    this.chassis.rotation.x = state.chassisPitch;
    this.chassis.rotation.z = state.chassisRoll;
    this.#head.rotation.y = state.headYaw;
    for (let i = 0; i < this.legs.length; i++) {
      const foot = state.feet[i];
      this.legs[i].foot.set(foot.x, foot.y, foot.z);
    }
    this.#pose();
  }

  /** Put a saved pose back and stop. The saved speed is not resumed. */
  settle(state: SpiderState): void {
    this.applyState(state);
    this.speed = 0;
    this.yawRate = 0;
    this.fall = 0;
    this.stuckFor = 0;
    this.halt = 'clear';
    this.headYaw = state.headYaw;
    for (const leg of this.legs) {
      leg.plant.copy(leg.foot);
      leg.swingFrom.copy(leg.foot);
      leg.swingTo.copy(leg.foot);
      leg.lifted = false;
    }
    this.#seeded = true;
    this.#stepping = false;
    this.#stillFor = 0;
    this.chassis.position.y = 0;
    this.#pose();
  }

  #buildBody(): Mesh[] {
    this.#head = buildSpiderBody(this.chassis);
    return MOUNTS.map((spec) => {
      const ball = new Mesh(ballGeo, spiderMat);
      ball.name = 'coxa';
      ball.scale.setScalar(0.05);
      ball.position.set(spec.x, spec.y, spec.z);
      ball.add(new Mesh(ballShell, inkSolidMat));
      this.chassis.add(ball);
      return ball;
    });
  }

  #readAxes(): void {
    worldFwd.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    worldRight.crossVectors(worldFwd, UP).normalize();
  }

  /** Read the water column once where the body is, for steering and support. */
  #refreshWater(): void {
    const water = this.#water(this.root.position.x, this.root.position.z);
    this.#waterNow = water;
    this.#swimming =
      water.depth > 0 &&
      floatHeight(water) > this.#ground(this.root.position.x, this.root.position.z);
  }

  #steer(dt: number, turn: number, boost: number): void {
    const pace = this.#waterNow.depth > 0 ? WATER.turnPace : 1;
    const yawTarget = turn * (boost ? GAIT.yawBoost : GAIT.yaw) * pace;
    this.yawRate += MathUtils.clamp(
      yawTarget - this.yawRate,
      -GAIT.yawAccel * dt,
      GAIT.yawAccel * dt,
    );
    this.yaw -= this.yawRate * dt;
    this.root.rotation.y = this.yaw;
    this.headYaw += (-turn * GAIT.headYaw - this.headYaw) * (1 - Math.exp(-GAIT.headEase * dt));
    this.#head.rotation.y = this.headYaw;
  }

  #drive(dt: number, throttle: number, boost: number): void {
    this.halt = 'clear';
    const water = this.#waterNow;
    const cruise = (boost ? GAIT.cruiseBoost : GAIT.cruise) * waterPace(water.depth);
    const ease = GAIT.speedEase + (water.depth > 0 ? WATER.spiderDrag : 0);
    this.speed += (throttle * cruise - this.speed) * (1 - Math.exp(-ease * dt));
    this.#readAxes();
    const stepX = worldFwd.x * this.speed * dt;
    const stepZ = worldFwd.z * this.speed * dt;
    const run = Math.hypot(stepX, stepZ);
    if (run < 1e-6) return;
    const x = this.root.position.x;
    const z = this.root.position.z;
    const next = clampToRadius(x + stepX, z + stepZ, this.#limit);
    const nextX = next.x;
    const nextZ = next.z;
    const rise = this.#travel(nextX, nextZ) - this.#travel(x, z);
    if (rise > GAIT.maxSlope * run) {
      this.speed = 0;
      this.halt = 'steep';
      return;
    }
    let moved = false;
    if (!this.#blocked(nextX, nextZ)) {
      this.root.position.x = nextX;
      this.root.position.z = nextZ;
      moved = true;
    } else if (!this.#blocked(nextX, z) && Math.abs(nextX - x) > 1e-5) {
      this.root.position.x = nextX;
      moved = true;
    } else if (!this.#blocked(x, nextZ) && Math.abs(nextZ - z) > 1e-5) {
      this.root.position.z = nextZ;
      moved = true;
    }
    // A free axis with a zero step is not progress. Head-on into a wall used to
    // count that as a slide and keep the gait stepping until the goal timed out.
    if (!moved) {
      this.speed = 0;
      this.halt = 'solid';
    }
  }

  /** Ease onto the commanded deck height. A real drop falls into the water. */
  #vertical(dt: number): void {
    const support = this.#support();
    const gap = this.root.position.y - support;
    if (gap > GAIT.drop) {
      this.fall = Math.min(GAIT.fallMax, this.fall + GAIT.fallAccel * dt);
      this.root.position.y = Math.max(support, this.root.position.y - this.fall * dt);
      return;
    }
    this.fall = 0;
    // Buoyancy is softer than the leg lift on land, so entering water settles
    // instead of snapping onto a hard plane.
    const ease = this.#swimming ? WATER.buoyancyEase : GAIT.liftEase;
    this.root.position.y += (support - this.root.position.y) * Math.min(1, ease * dt);
  }

  /** The ground, or the buoyant water line when the hollow is deep enough. */
  #support(): number {
    const float = this.#waterNow.depth > 0 ? floatHeight(this.#waterNow) : Number.NEGATIVE_INFINITY;
    return Math.max(this.#shellGroundAt(), float) + this.heightSet;
  }

  /** The surface a step follows. Water is crossed at its line, not the seabed. */
  #travel(x: number, z: number): number {
    const water = this.#water(x, z);
    const ground = this.#ground(x, z);
    return water.depth > 0 ? Math.max(ground, floatHeight(water)) : ground;
  }

  /** Highest ground under the shell. One pose reuses the samples. */
  #shellGroundAt(): number {
    const x = this.root.position.x;
    const z = this.root.position.z;
    if (x === this.#shellX && z === this.#shellZ && this.yaw === this.#shellYaw) {
      return this.#shellGround;
    }
    const center = this.#ground(x, z);
    // Same tilt #applySlope adds, so the lift accounts for the belly dipping.
    const ahead = this.#ground(x + worldFwd.x * 0.8, z + worldFwd.z * 0.8) - center;
    const side = this.#ground(x + worldRight.x * 0.8, z + worldRight.z * 0.8) - center;
    shellEuler.set(
      -MathUtils.clamp(ahead / 0.8, -0.35, 0.35),
      0,
      -MathUtils.clamp(side / 0.8, -0.25, 0.25),
      'XYZ',
    );
    const cos = Math.cos(this.yaw);
    const sin = Math.sin(this.yaw);
    let lift = 0;
    for (const shell of SHELLS) {
      for (const phi of SHELL_PHI) {
        const cp = Math.cos(phi);
        const sy = Math.sin(phi);
        for (let i = 0; i < SHELL_THETA; i++) {
          const theta = (i / SHELL_THETA) * Math.PI * 2;
          shellPoint.set(
            shell.c[0] + shell.r[0] * cp * Math.cos(theta),
            shell.c[1] + shell.r[1] * sy,
            shell.c[2] + shell.r[2] * cp * Math.sin(theta),
          );
          shellPoint.applyEuler(shellEuler);
          const wx = x + shellPoint.x * cos + shellPoint.z * sin;
          const wz = z - shellPoint.x * sin + shellPoint.z * cos;
          lift = Math.max(lift, this.#ground(wx, wz) - center - shellPoint.y);
        }
      }
    }
    this.#shellX = x;
    this.#shellZ = z;
    this.#shellYaw = this.yaw;
    // The shared contact skin, so a slope does not grow its own hover.
    this.#shellGround = center + (lift > 0 ? lift + CONTACT : 0);
    return this.#shellGround;
  }

  /** Tip the shell with the ground, on top of the gait's pitch and roll. */
  #applySlope(): void {
    // A floating body follows the water plane, not the unseen seabed.
    if (this.#swimming) return;
    const x = this.root.position.x;
    const z = this.root.position.z;
    const ahead = this.#ground(x + worldFwd.x * 0.8, z + worldFwd.z * 0.8) - this.#ground(x, z);
    const side = this.#ground(x + worldRight.x * 0.8, z + worldRight.z * 0.8) - this.#ground(x, z);
    this.chassis.rotation.x -= MathUtils.clamp(ahead / 0.8, -0.35, 0.35);
    this.chassis.rotation.z -= MathUtils.clamp(side / 0.8, -0.25, 0.25);
  }

  #stepGait(dt: number, throttle: number, turn: number, boost: number): void {
    // A full turn (the key, or a large correction) steps. The AI's final trim is a
    // small turn with almost no stride; treating that as walking makes the feet stamp.
    const walking = Math.abs(throttle) > 0.05 || Math.abs(this.speed) > 0.1;
    const hardTurn = Math.abs(turn) > 0.5 || Math.abs(this.yawRate) > 0.5;
    const settled =
      Math.abs(throttle) < 0.05 &&
      Math.abs(this.speed) < 0.05 &&
      Math.abs(turn) < 0.5 &&
      Math.abs(this.yawRate) < 0.25;
    if (walking || hardTurn) {
      this.#stepping = true;
      this.#stillFor = 0;
    } else if (settled) this.#stepping = false;

    const freq = this.#stepping ? (boost ? GAIT.freqBoost : GAIT.freq) : 0;
    const stride = freq > 0 ? this.speed * (GAIT.strideScale / freq) : 0;
    if (freq === 0) {
      this.#stillFor += dt;
      this.#breathe();
    } else {
      this.chassis.position.y = 0;
    }

    for (const leg of this.legs) {
      if (freq === 0) {
        this.#plant(leg);
        continue;
      }

      const phase = (this.time * freq + leg.spec.phase) % 1;
      const swing = phase < GAIT.swing;
      if (swing && !leg.lifted) {
        leg.swingFrom.copy(leg.plant);
        this.#idealFoot(leg.swingTo, leg, stride);
      }
      if (swing) {
        const u = phase / GAIT.swing;
        const e = u * u * (3 - 2 * u);
        leg.foot.lerpVectors(leg.swingFrom, leg.swingTo, e);
        const base = leg.swingFrom.y + (leg.swingTo.y - leg.swingFrom.y) * e;
        leg.foot.y = base + Math.sin(Math.PI * u) * GAIT.swingLift;
      } else if (leg.lifted) {
        leg.plant.copy(leg.swingTo);
        leg.foot.copy(leg.plant);
      } else {
        leg.foot.copy(leg.plant);
      }
      leg.lifted = swing;
    }
  }

  /** After a few still seconds the deck rises and settles. It never sinks below the cleared pose. */
  #breathe(): void {
    const blend = Math.min(1, Math.max(0, (this.#stillFor - 4) / 1.5));
    const wave = (1 - Math.cos(this.time * 0.8)) * 0.5;
    this.chassis.position.y = wave * 0.035 * blend;
  }

  #plant(leg: Leg): void {
    this.#idealFoot(leg.plant, leg, 0);
    leg.foot.copy(leg.plant);
    leg.swingFrom.copy(leg.plant);
    leg.swingTo.copy(leg.plant);
    leg.lifted = false;
  }

  #seedFeet(): void {
    for (const leg of this.legs) {
      this.#idealFoot(leg.plant, leg, 0);
      leg.foot.copy(leg.plant);
      leg.swingFrom.copy(leg.plant);
      leg.swingTo.copy(leg.plant);
      leg.lifted = false;
    }
    this.#seeded = true;
  }

  #idealFoot(out: Vector3, leg: Leg, stride: number): void {
    out.copy(this.root.position);
    out.addScaledVector(worldFwd, leg.spec.fore + stride);
    out.addScaledVector(worldRight, leg.spec.side * leg.spec.lateral);
    const water = this.#water(out.x, out.z);
    if (water.depth > 0 && floatHeight(water) > this.#ground(out.x, out.z)) {
      // Paddling feet trail just under the surface instead of reaching for a
      // seabed far below.
      out.y = water.surface - WATER.footDraft;
      return;
    }
    const airborne = this.root.position.y - this.#support() > GAIT.drop;
    const y = airborne
      ? this.root.position.y
      : supportY(out.x, out.z, this.#ground, this.#mound, this.#spheres);
    out.y = y + CONTACT;
  }

  #refreshLegs(): void {
    this.#fillLegs(this.#spheres);
  }

  #pose(): void {
    this.#refreshLegs();
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) this.#poseLeg(leg);
  }

  #poseLeg(leg: Leg): void {
    // The claw is parented to the tarsus, so its tip is not straight under the
    // anchor. Raise the planted foot until the posed claw meets the skin.
    this.#solveAndPlace(leg);
    const parts = footParts(leg);
    for (let pass = 0; pass < 2; pass++) {
      const floor =
        supportY(leg.foot.x, leg.foot.z, this.#ground, this.#mound, this.#spheres) + CONTACT;
      const low = Math.min(
        partLowest(leg.claw, parts.claw),
        partLowest(leg.bones[3], parts.tarsus),
      );
      if (low >= floor - 1e-4) break;
      leg.foot.y += floor - low;
      this.#solveAndPlace(leg);
    }
  }

  #solveAndPlace(leg: Leg): void {
    shoulderW.setFromMatrixPosition(leg.mount.matrixWorld);
    solveLeg(
      shoulderW,
      leg.foot,
      leg.spec.x,
      leg.spec.z,
      this.#ground,
      this.#mound,
      this.#spheres,
      this.#chain,
    );
    const chain = this.#chain;
    placeBone(leg.bones[0], chain[0], chain[1], BONES[0].radius, leg.spec.side);
    placeBone(leg.bones[1], chain[1], chain[2], BONES[1].radius, leg.spec.side);
    placeBone(leg.bones[2], chain[2], chain[3], BONES[2].radius, leg.spec.side);
    placeBone(leg.bones[3], chain[3], chain[4], BONES[3].radius, leg.spec.side);
    leg.joints[0].position.copy(chain[0]);
    leg.joints[1].position.copy(chain[1]);
    leg.joints[2].position.copy(chain[2]);
    leg.joints[3].position.copy(chain[3]);
    leg.claw.position.copy(chain[4]);
    leg.claw.quaternion.copy(leg.bones[3].quaternion);
  }
}

/**
 * One drawn geometry, in the space of the claw group or the tarsus group.
 * Baked once: walking these meshes on every planted foot blew the frame budget
 * once coverage instrumentation was on.
 */
type FootPart = {
  local: Matrix4;
  cx: number;
  cy: number;
  cz: number;
  hx: number;
  hy: number;
  hz: number;
};

let bakedFeet: { claw: FootPart[]; tarsus: FootPart[] } | undefined;

function footParts(leg: Leg): { claw: FootPart[]; tarsus: FootPart[] } {
  bakedFeet ??= { claw: collectParts(leg.claw), tarsus: collectParts(leg.bones[3]) };
  return bakedFeet;
}

function collectParts(root: Object3D): FootPart[] {
  root.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const parts: FootPart[] = [];
  root.traverse((node) => {
    const geometry = (node as Mesh).geometry as BufferGeometry | undefined;
    if (!geometry) return;
    geometry.computeBoundingBox();
    // computeBoundingBox always assigns the box, including an empty one.
    const box = geometry.boundingBox!;
    parts.push({
      local: new Matrix4().multiplyMatrices(inv, node.matrixWorld),
      cx: (box.min.x + box.max.x) * 0.5,
      cy: (box.min.y + box.max.y) * 0.5,
      cz: (box.min.z + box.max.z) * 0.5,
      hx: (box.max.x - box.min.x) * 0.5,
      hy: (box.max.y - box.min.y) * 0.5,
      hz: (box.max.z - box.min.z) * 0.5,
    });
  });
  return parts;
}

/** Lowest world Y of baked part boxes. The oriented box matches the old 8-corner walk. */
function partLowest(object: Object3D, parts: readonly FootPart[]): number {
  object.updateWorldMatrix(true, false);
  let lowest = Infinity;
  for (const part of parts) {
    partWorld.multiplyMatrices(object.matrixWorld, part.local);
    lowest = Math.min(lowest, orientedMinY(partWorld, part));
  }
  return lowest;
}

function orientedMinY(matrix: Matrix4, part: FootPart): number {
  const e = matrix.elements;
  const worldY = e[1] * part.cx + e[5] * part.cy + e[9] * part.cz + e[13];
  const half = Math.abs(e[1]) * part.hx + Math.abs(e[5]) * part.hy + Math.abs(e[9]) * part.hz;
  return worldY - half;
}

/** Keep a step inside the round island instead of the old square corners. */
function clampToRadius(x: number, z: number, limit: number): { x: number; z: number } {
  const radius = Math.hypot(x, z);
  if (radius <= limit) return { x, z };
  const scale = limit / radius;
  return { x: x * scale, z: z * scale };
}

function placeBone(group: Group, a: Vector3, b: Vector3, radius: number, side: number): void {
  reachW.subVectors(b, a);
  const dist = Math.max(0.02, reachW.length());
  reachW.multiplyScalar(1 / dist);
  axisZ.copy(reachW).negate();
  // Twist around the body's side, not world up. A near-vertical bone used to
  // flip the tube's edges every frame, which reads as a ghost.
  axisX.copy(worldRight).multiplyScalar(side);
  axisX.addScaledVector(axisZ, -axisX.dot(axisZ));
  if (axisX.lengthSq() < 1e-4) {
    axisX.copy(UP).addScaledVector(axisZ, -UP.dot(axisZ));
  }
  /* v8 ignore next */
  if (axisX.lengthSq() < 1e-6) axisX.set(1, 0, 0);
  axisX.normalize();
  axisY.crossVectors(axisZ, axisX).normalize();
  basisM.makeBasis(axisX, axisY, axisZ);
  group.position.copy(a);
  group.quaternion.setFromRotationMatrix(basisM);
  group.scale.set(radius, radius, dist);
}
