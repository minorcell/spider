import type { Controller } from '@/src/shared/sim/controller';
import { BufferGeometry, Group, MathUtils, Matrix4, Mesh, Object3D, Vector3 } from 'three';
import { BONES, CONTACT, GAIT, MOUNTS } from '@/src/shared/config';
import type { ActorState, Block, Vec3 } from '@/src/shared/state';
import { IDLE_CONTROLS, type Controls } from '@/src/shared/types';
import { floatHeight, WATER, type Water } from '@/src/shared/water';
import { Leg } from '@/src/client/rig/Leg';
import { solveLeg, supportY, type LegSphere } from '@/src/client/rig/legPose';
import { ballGeo, ballShell, inkSolidMat, spiderMat } from '@/src/client/rig/parts';
import { buildSpiderBody } from '@/src/client/rig/spiderBody';

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

export interface SpiderPose extends ActorState {
  chassisPitch: number;
  chassisRoll: number;
  headYaw: number;
  feet: Vec3[];
}

type RigSource = Pick<
  Controller,
  | 'position'
  | 'yaw'
  | 'yawRate'
  | 'lamp'
  | 'heightSet'
  | 'speed'
  | 'time'
  | 'halt'
  | 'swimming'
  | 'water'
  | 'support'
  | 'capture'
>;

export class Spider {
  readonly root = new Group();
  /** The legs are solved and placed in world space, so rig is a sibling of root. */
  readonly rig = new Group();
  readonly chassis = new Group();

  readonly legs: Leg[];
  readonly source: RigSource;
  headYaw = 0;
  get position(): Readonly<Vec3> {
    return this.source.position;
  }
  get yaw(): number {
    return this.source.yaw;
  }
  get yawRate(): number {
    return this.source.yawRate;
  }
  get lamp(): boolean {
    return this.source.lamp;
  }
  get heightSet(): number {
    return this.source.heightSet;
  }
  get speed(): number {
    return this.source.speed;
  }
  get time(): number {
    return this.source.time;
  }
  get halt(): 'clear' | 'solid' | 'steep' {
    return this.source.halt;
  }
  /** Temporary reach posture used while handling a nearby object. */
  interaction: { target: Vector3; phase: 'reach' | 'drag' | 'release' } | null = null;

  #head!: Group;
  #seeded = false;
  #ground: (x: number, z: number) => number = () => 0;
  #water: (x: number, z: number) => Water = () => NO_WATER;
  /** Stays on while the body is still turning or walking, so feet are not glued mid-settle. */
  #stepping = false;
  /** How long the body has been fully still, in seconds. */
  #stillFor = 0;
  /** Loose bodies the legs must not pass through. Filled once per pose. */
  #spheres: LegSphere[] = [];
  #blocks: () => readonly Block[] = () => [];
  #blockHeight?: (block: Block, x: number, z: number) => number;
  /** Last inputs that produced the current leg pose. Idle frames reuse it. */
  #held: {
    x: number;
    y: number;
    z: number;
    yaw: number;
    pitch: number;
    roll: number;
    deck: number;
    feet: number[];
    spheres: number[];
  } | null = null;
  #fillLegs: (into: LegSphere[]) => void = (into) => {
    into.length = 0;
  };
  #mound: (x: number, z: number) => number = () => Number.NEGATIVE_INFINITY;
  readonly #chain = [0, 1, 2, 3, 4].map(() => new Vector3());

  constructor(source: RigSource) {
    this.source = source;
    this.root.add(this.chassis);
    const mounts = this.#buildBody();
    this.legs = MOUNTS.map((spec, index) => new Leg(this.rig, spec, mounts[index], index));
    this.present(0, IDLE_CONTROLS);
  }

  /** The ground the feet plant on. Reseeds the stance for the new surface. */
  bindGround(ground: (x: number, z: number) => number): void {
    this.#ground = ground;
    this.#seeded = false;
    this.present(0, IDLE_CONTROLS);
  }

  /**
   * What a leg may not pass through. `fill` lists registered sphere centers.
   * `mound` is registered support geometry, or −∞ where there is none.
   */
  bindLegs(
    fill: (into: LegSphere[]) => void,
    mound: (x: number, z: number) => number,
    blocks: () => readonly Block[] = () => [],
    blockHeight?: (block: Block, x: number, z: number) => number,
  ): void {
    this.#blockHeight = blockHeight;
    this.#blocks = blocks;
    this.#fillLegs = fill;
    this.#mound = mound;
    this.#held = null;
  }

  /** The water column the body floats or wades through. */
  bindWater(water: (x: number, z: number) => Water): void {
    this.#water = water;
  }

  /** True while buoyancy, not the ground, is holding the body up. */
  get swimming(): boolean {
    return this.source.swimming;
  }

  /** Water depth under the body right now. Zero on dry ground. */
  get waterDepth(): number {
    return this.source.water.depth;
  }

  /** Render the current entity pose; movement is resolved by its world capability. */
  present(dt = 0, input: Controls = IDLE_CONTROLS): void {
    const throttle = input.throttle || 0;
    const turn = input.turn || 0;
    const boost = input.boost ? 1 : 0;
    this.root.position.copy(this.position);
    // Interpolated quaternions can decompose into XYZ angles with X/Z = π.
    // Rebuild the complete authoritative rotation; never retain that decomposition.
    this.root.rotation.set(0, this.yaw, 0);
    this.#readAxes();
    this.#refreshLegs();
    if (!this.#seeded) this.#seedFeet();
    if (dt <= 0) {
      this.#pose(true);
      return;
    }
    this.headYaw += (-turn * GAIT.headYaw - this.headYaw) * (1 - Math.exp(-GAIT.headEase * dt));
    this.#head.rotation.set(0, this.headYaw, 0);
    this.chassis.rotation.set(-throttle * GAIT.pitch, 0, this.yawRate * GAIT.roll);
    this.#stepGait(dt, throttle, turn, boost);
    this.#applySlope();
    this.#applyInteraction();
    const reuse =
      Math.abs(throttle) < 0.05 &&
      Math.abs(turn) < 0.5 &&
      Math.abs(this.speed) < 0.05 &&
      Math.abs(this.yawRate) < 0.25;
    this.#pose(reuse);
  }

  setInteraction(
    target: { x: number; y?: number; z: number } | null,
    phase: 'reach' | 'drag' | 'release' = 'reach',
  ): void {
    this.interaction = target
      ? { target: new Vector3(target.x, target.y ?? 0.2, target.z), phase }
      : null;
  }

  #applyInteraction(): void {
    const action = this.interaction;
    if (!action) return;
    // 保持正常步态，只把身体轻轻压低。把四只前腿瞬间钉到目标点会
    // 让蜘蛛像失去生命一样僵住；前腿应继续由步态求解器自然摆动。
    const crouch = action.phase === 'release' ? 0.45 : 1;
    this.chassis.position.y = -0.045 * crouch;
    this.chassis.rotation.x = 0.045 * crouch;
  }

  /** Visual diagnostics. These fields are not part of the world snapshot. */
  capture(): SpiderPose {
    return {
      time: this.time,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      yaw: this.yaw,
      speed: this.speed,
      height: this.heightSet,
      chassisPitch: this.chassis.rotation.x,
      chassisRoll: this.chassis.rotation.z,
      headYaw: this.headYaw,
      lamp: this.lamp,
      feet: this.legs.map((leg) => ({ x: leg.foot.x, y: leg.foot.y, z: leg.foot.z })),
    };
  }

  /** Mutable presentation transforms, excluding immutable model meshes. */
  poseNodes(): Object3D[] {
    return [
      this.root,
      this.chassis,
      this.#head,
      ...this.legs.flatMap((leg) => [...leg.bones, ...leg.joints, leg.claw]),
    ];
  }

  #buildBody(): Mesh[] {
    this.#head = buildSpiderBody(this.chassis);
    return MOUNTS.map((spec) => {
      const ball = new Mesh(ballGeo, spiderMat);
      ball.name = 'coxa';
      ball.scale.setScalar(BONES[0].radius * 0.52);
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

  /** Tip the shell with the ground, on top of the gait's pitch and roll. */
  #applySlope(): void {
    // A floating body follows the water plane, not the unseen seabed.
    if (this.swimming) return;
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
    const airborne = this.root.position.y - this.source.support() > GAIT.drop;
    const y = airborne
      ? this.root.position.y
      : supportY(out.x, out.z, this.#ground, this.#mound, this.#spheres);
    out.y = y + CONTACT;
  }

  #refreshLegs(): void {
    this.#fillLegs(this.#spheres);
  }

  #pose(reuse: boolean): void {
    this.#refreshLegs();
    if (reuse && this.#poseHeld()) return;
    this.root.updateMatrixWorld(true);
    for (const leg of this.legs) this.#poseLeg(leg);
    if (reuse) this.#holdPose();
    else this.#held = null;
  }

  /** True when the body, feet, and nearby loose bodies match the pose already drawn. */
  #poseHeld(): boolean {
    const held = this.#held;
    if (!held) return false;
    if (
      held.x !== this.root.position.x ||
      held.y !== this.root.position.y ||
      held.z !== this.root.position.z ||
      held.yaw !== this.yaw ||
      held.pitch !== this.chassis.rotation.x ||
      held.roll !== this.chassis.rotation.z ||
      held.deck !== this.chassis.position.y
    ) {
      return false;
    }
    const feet = held.feet;
    for (let i = 0; i < this.legs.length; i++) {
      const foot = this.legs[i].foot;
      const offset = i * 3;
      if (feet[offset] !== foot.x || feet[offset + 1] !== foot.y || feet[offset + 2] !== foot.z) {
        return false;
      }
    }
    const spheres = this.#spheres;
    const stamp = held.spheres;
    if (stamp.length !== spheres.length * 4) return false;
    for (let i = 0; i < spheres.length; i++) {
      const sphere = spheres[i];
      const offset = i * 4;
      if (
        stamp[offset] !== sphere.x ||
        stamp[offset + 1] !== sphere.y ||
        stamp[offset + 2] !== sphere.z ||
        stamp[offset + 3] !== sphere.radius
      ) {
        return false;
      }
    }
    return true;
  }

  #holdPose(): void {
    const held = (this.#held ??= {
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      deck: 0,
      feet: [],
      spheres: [],
    });
    held.x = this.root.position.x;
    held.y = this.root.position.y;
    held.z = this.root.position.z;
    held.yaw = this.yaw;
    held.pitch = this.chassis.rotation.x;
    held.roll = this.chassis.rotation.z;
    held.deck = this.chassis.position.y;
    const feet = held.feet;
    feet.length = this.legs.length * 3;
    for (let i = 0; i < this.legs.length; i++) {
      const foot = this.legs[i].foot;
      const offset = i * 3;
      feet[offset] = foot.x;
      feet[offset + 1] = foot.y;
      feet[offset + 2] = foot.z;
    }
    const stamp = held.spheres;
    const spheres = this.#spheres;
    stamp.length = spheres.length * 4;
    for (let i = 0; i < spheres.length; i++) {
      const sphere = spheres[i];
      const offset = i * 4;
      stamp[offset] = sphere.x;
      stamp[offset + 1] = sphere.y;
      stamp[offset + 2] = sphere.z;
      stamp[offset + 3] = sphere.radius;
    }
  }

  #poseLeg(leg: Leg): void {
    // The claw is parented to the tarsus, so its tip is not straight under the
    // anchor. Raise the planted foot until the posed claw meets the skin.
    this.#solveAndPlace(leg);
    const parts = footParts(leg);
    for (let pass = 0; pass < 2; pass++) {
      const floor =
        supportY(
          leg.claw.position.x,
          leg.claw.position.z,
          this.#ground,
          this.#mound,
          this.#spheres,
        ) + CONTACT;
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
      this.#blocks(),
      this.#blockHeight,
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

/** Exact baked foot vertices avoid lifting a tapered toe by the empty corners of its box. */
let bakedFeet: { claw: Float32Array; tarsus: Float32Array } | undefined;

function footParts(leg: Leg): { claw: Float32Array; tarsus: Float32Array } {
  bakedFeet ??= { claw: collectParts(leg.claw), tarsus: collectParts(leg.bones[3]) };
  return bakedFeet;
}

function collectParts(root: Object3D): Float32Array {
  root.updateWorldMatrix(true, true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const local = new Matrix4();
  const point = new Vector3();
  const vertices: number[] = [];
  root.traverse((node) => {
    const geometry = (node as Mesh).geometry as BufferGeometry | undefined;
    if (!geometry) return;
    local.multiplyMatrices(inv, node.matrixWorld);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(local);
      vertices.push(point.x, point.y, point.z);
    }
  });
  return Float32Array.from(vertices);
}

function partLowest(object: Object3D, vertices: Float32Array): number {
  object.updateWorldMatrix(true, false);
  const e = object.matrixWorld.elements;
  let lowest = Infinity;
  for (let i = 0; i < vertices.length; i += 3) {
    lowest = Math.min(
      lowest,
      e[1] * vertices[i] + e[5] * vertices[i + 1] + e[9] * vertices[i + 2] + e[13],
    );
  }
  return lowest;
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
