import { Spider as Model } from '@/src/client/rig/Spider';
import { Controller } from '@/src/shared/sim/controller';
import type { Block, EntityState } from '@/src/shared/state';
import type { Controls } from '@/src/shared/types';
import { IDLE_CONTROLS } from '@/src/shared/types';
import type { MotionSolver } from '@/src/shared/collision';
import type { Water } from '@/src/shared/water';
import type { LegSphere } from '@/src/client/rig/legPose';

/** Integration fixture: advance the real controller, then project it into a browser model. */
export class AnimatedActor extends Model {
  readonly controller: Controller;
  constructor(entity: EntityState = { id: 'preview', kind: 'spider', x: 0, y: 0, z: 0, stage: 0 }) {
    const controller = new Controller(entity);
    super(controller);
    this.controller = controller;
  }
  override get yaw() {
    return this.source.yaw;
  }
  override set yaw(value: number) {
    this.controller.state.yaw = value;
  }
  override get yawRate() {
    return this.source.yawRate;
  }
  override set yawRate(value: number) {
    this.controller.state.yawRate = value;
  }
  override get heightSet() {
    return this.source.heightSet;
  }
  override set heightSet(value: number) {
    this.controller.state.height = value;
  }
  override get speed() {
    return this.source.speed;
  }
  override set speed(value: number) {
    this.controller.state.speed = value;
  }
  override get time() {
    return this.source.time;
  }
  override set time(value: number) {
    this.controller.state.time = value;
  }
  override get lamp() {
    return this.source.lamp;
  }
  override set lamp(value: boolean) {
    this.controller.state.lamp = value;
  }
  get fall() {
    return this.controller.state.fall;
  }
  set fall(value: number) {
    this.controller.state.fall = value;
  }
  get stuckFor() {
    return this.controller.state.stuckFor;
  }
  override get halt() {
    return this.controller.state.halt;
  }
  override set halt(value: 'clear' | 'solid' | 'steep') {
    this.controller.state.halt = value;
  }
  override bindGround(ground: (x: number, z: number) => number, limit?: number) {
    this.controller.bindGround(ground, limit);
    super.bindGround(ground);
  }
  bindMotion(move: MotionSolver) {
    this.controller.bindMotion(move);
  }
  override bindWater(water: (x: number, z: number) => Water) {
    this.controller.bindWater(water);
    super.bindWater(water);
  }
  override bindLegs(
    fill: (into: LegSphere[]) => void,
    mound: (x: number, z: number) => number,
    blocks?: () => readonly Block[],
    blockHeight?: (block: Block, x: number, z: number) => number,
  ) {
    this.controller.bindSupport(mound);
    super.bindLegs(fill, mound, blocks, blockHeight);
  }
  update(dt: number, input: Controls = IDLE_CONTROLS) {
    this.controller.update(dt, input);
    this.present(dt, input);
  }
  place(x: number, y: number, z: number) {
    Object.assign(this.controller.position, { x, y, z });
    this.present();
  }
}
