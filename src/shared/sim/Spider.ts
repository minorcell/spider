import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  LineSegments,
  MathUtils,
  Matrix4,
  Mesh,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import { BONES, DECK_Y, GAIT, MOUNTS } from '../config.js';
import { TERRAIN } from '../terrain.js';
import type { SpiderState } from '../state.js';
import { IDLE_CONTROLS, type Controls } from '../types.js';
import { Leg } from './Leg.js';
import { addSolid, ballEdges, ballGeo, inkMat, paperMat } from './parts.js';

// Mechanical spider: a cephalothorax on eight jointed legs, an abdomen hung
// behind it, and an alternating tetrapod gait.

const UP = new Vector3(0, 1, 0);

// Scratch vectors: posing must not allocate per frame.
const worldFwd = new Vector3();
const worldRight = new Vector3();
const shoulderW = new Vector3();
const dirW = new Vector3();
const coxaW = new Vector3();
const kneeW = new Vector3();
const ankleW = new Vector3();
const poleW = new Vector3();
const reachW = new Vector3();
const axisX = new Vector3();
const axisY = new Vector3();
const axisZ = new Vector3();
const basisM = new Matrix4();

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
  #limit = TERRAIN.half - 1;
  /** Stays on while the body is still turning or walking, so feet are not glued mid-settle. */
  #stepping = false;
  /** How long the body has been fully still, in seconds. */
  #stillFor = 0;

  constructor() {
    this.root.add(this.chassis);
    const mounts = this.#buildBody();
    this.legs = MOUNTS.map((spec, index) => new Leg(this.rig, spec, mounts[index], index));
    this.update(0, IDLE_CONTROLS);
  }

  /** The ground the feet plant on. Reseeds the stance for the new surface. */
  bindGround(ground: (x: number, z: number) => number, limit = TERRAIN.half - 1): void {
    this.#ground = ground;
    this.#limit = limit;
    this.fall = 0;
    this.#seeded = false;
    this.update(0, IDLE_CONTROLS);
  }

  /** Solids you cannot walk through. */
  bindBlocked(blocked: (x: number, z: number) => boolean): void {
    this.#blocked = blocked;
  }

  update(dt: number, input: Controls = IDLE_CONTROLS): void {
    const throttle = input.throttle || 0;
    const turn = input.turn || 0;
    const lift = input.lift || 0;
    const boost = input.boost ? 1 : 0;

    this.root.rotation.y = this.yaw;
    this.#readAxes();
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
    this.#pose();
  }

  #buildBody(): Mesh[] {
    const solid = (geo: BufferGeometry, x: number, y: number, z: number) =>
      addSolid(this.chassis, geo, x, y, z);
    const shell = (sx: number, sy: number, sz: number, x: number, y: number, z: number) => {
      const geo = new SphereGeometry(1, 12, 8);
      geo.scale(sx, sy, sz);
      return solid(geo, x, y, z);
    };

    // Small cephalothorax, gap, then the abdomen. They do not share a volume.
    shell(0.55, 0.18, 0.46, 0, DECK_Y, -0.12);
    solid(new BoxGeometry(0.36, 0.03, 0.55), 0, DECK_Y + 0.16, -0.14);
    const waist = new CylinderGeometry(0.1, 0.12, 0.22, 8);
    waist.rotateX(Math.PI / 2);
    solid(waist, 0, DECK_Y, 0.42);
    shell(0.46, 0.32, 0.62, 0, DECK_Y + 0.06, 1.2);

    const head = new Group();
    head.position.set(0, DECK_Y + 0.02, -0.52);
    this.chassis.add(head);
    const eye = (x: number, y: number, r: number) => {
      const geo = new CylinderGeometry(r, r, 0.05, 8);
      geo.rotateX(Math.PI / 2);
      return addSolid(head, geo, x, y, 0);
    };
    eye(-0.1, 0.05, 0.035);
    eye(0.1, 0.05, 0.035);
    eye(-0.05, -0.02, 0.022);
    eye(0.05, -0.02, 0.022);
    this.#head = head;

    return MOUNTS.map((spec) => {
      const ball = new Mesh(ballGeo, paperMat);
      ball.scale.setScalar(0.06);
      ball.position.set(spec.x, spec.y, spec.z);
      ball.add(new LineSegments(ballEdges, inkMat));
      this.chassis.add(ball);
      return ball;
    });
  }

  #readAxes(): void {
    worldFwd.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    worldRight.crossVectors(worldFwd, UP).normalize();
  }

  #steer(dt: number, turn: number, boost: number): void {
    const yawTarget = turn * (boost ? GAIT.yawBoost : GAIT.yaw);
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
    const cruise = boost ? GAIT.cruiseBoost : GAIT.cruise;
    this.speed += (throttle * cruise - this.speed) * (1 - Math.exp(-GAIT.speedEase * dt));
    this.#readAxes();
    const stepX = worldFwd.x * this.speed * dt;
    const stepZ = worldFwd.z * this.speed * dt;
    const run = Math.hypot(stepX, stepZ);
    if (run < 1e-6) return;
    const x = this.root.position.x;
    const z = this.root.position.z;
    const nextX = MathUtils.clamp(x + stepX, -this.#limit, this.#limit);
    const nextZ = MathUtils.clamp(z + stepZ, -this.#limit, this.#limit);
    const rise = this.#ground(nextX, nextZ) - this.#ground(x, z);
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

  /** Ease onto the commanded deck height. A real drop falls. */
  #vertical(dt: number): void {
    const support = this.#support();
    const gap = this.root.position.y - support;
    if (gap > GAIT.drop) {
      this.fall = Math.min(GAIT.fallMax, this.fall + GAIT.fallAccel * dt);
      this.root.position.y = Math.max(support, this.root.position.y - this.fall * dt);
      return;
    }
    this.fall = 0;
    this.root.position.y += (support - this.root.position.y) * Math.min(1, GAIT.liftEase * dt);
  }

  #support(): number {
    return this.#ground(this.root.position.x, this.root.position.z) + this.heightSet;
  }

  /** Tip the shell with the ground, on top of the gait's pitch and roll. */
  #applySlope(): void {
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
    if (freq === 0) this.#stillFor += dt;

    for (const leg of this.legs) {
      if (freq === 0) {
        this.#idle(leg);
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

  /** A slow weight shift after the body has been still for a few seconds. */
  #idle(leg: Leg): void {
    const blend = Math.min(1, Math.max(0, (this.#stillFor - 4) / 1.5));
    const sway = Math.sin(this.time * 0.55) * blend;
    this.chassis.rotation.z = sway * 0.07;
    this.chassis.rotation.x = Math.sin(this.time * 0.35) * 0.035 * blend;
    this.#head.rotation.y = this.headYaw + Math.sin(this.time * 0.3) * 0.22 * blend;

    this.#idealFoot(leg.plant, leg, 0);
    leg.foot.copy(leg.plant);
    leg.foot.y += Math.max(0, sway * leg.spec.side) * 0.07;
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
    const airborne = this.root.position.y - this.#support() > GAIT.drop;
    out.y = (airborne ? this.root.position.y : this.#ground(out.x, out.z)) + GAIT.footY;
  }

  #pose(): void {
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) this.#poseLeg(leg);
  }

  #poseLeg(leg: Leg): void {
    shoulderW.setFromMatrixPosition(leg.mount.matrixWorld);
    dirW.subVectors(leg.foot, shoulderW);
    dirW.y = 0;
    if (dirW.lengthSq() < 1e-6) dirW.set(leg.spec.x, 0, leg.spec.z);
    dirW.normalize();

    coxaW.copy(shoulderW).addScaledVector(dirW, BONES[0].len);
    ankleW.copy(leg.foot).addScaledVector(dirW, -BONES[3].len * 0.75);
    ankleW.y = leg.foot.y + 0.08;
    poleW.copy(UP).addScaledVector(dirW, 0.45);
    bendJoint(coxaW, ankleW, BONES[1].len, BONES[2].len, poleW, kneeW);

    placeBone(leg.bones[0], shoulderW, coxaW, BONES[0].radius, leg.spec.side);
    placeBone(leg.bones[1], coxaW, kneeW, BONES[1].radius, leg.spec.side);
    placeBone(leg.bones[2], kneeW, ankleW, BONES[2].radius, leg.spec.side);
    placeBone(leg.bones[3], ankleW, leg.foot, BONES[3].radius, leg.spec.side);
    leg.joints[0].position.copy(shoulderW);
    leg.joints[1].position.copy(coxaW);
    leg.joints[2].position.copy(kneeW);
    leg.joints[3].position.copy(ankleW);
    leg.claw.position.copy(leg.foot);
    leg.claw.quaternion.copy(leg.bones[3].quaternion);
  }
}

/** Two-bone IK: the knee sits at len1 along the reach, lifted toward the pole. */
function bendJoint(
  a: Vector3,
  b: Vector3,
  len1: number,
  len2: number,
  pole: Vector3,
  out: Vector3,
): void {
  reachW.subVectors(b, a);
  const raw = reachW.length();
  const dist = MathUtils.clamp(raw, Math.abs(len1 - len2) + 0.04, len1 + len2 - 0.04);
  if (raw > 1e-5) reachW.multiplyScalar(1 / raw);
  else reachW.set(0, 0, -1);
  const cosA = MathUtils.clamp(
    (len1 * len1 + dist * dist - len2 * len2) / (2 * len1 * dist),
    -1,
    1,
  );
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  axisX.copy(pole).addScaledVector(reachW, -pole.dot(reachW));
  if (axisX.lengthSq() < 1e-8) axisX.set(1, 0, 0);
  axisX.normalize();
  out
    .copy(a)
    .addScaledVector(reachW, cosA * len1)
    .addScaledVector(axisX, sinA * len1);
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
