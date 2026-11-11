/** Plain simulation state owned by a controlled entity, independent of its model. */
export interface ControlState {
  time: number;
  yaw: number;
  yawRate: number;
  speed: number;
  height: number;
  fall: number;
  stuckFor: number;
  halt: 'clear' | 'solid' | 'steep';
  lamp: boolean;
}

export interface ControlSpec {
  cruise: number;
  cruiseBoost: number;
  speedEase: number;
  yaw: number;
  yawBoost: number;
  yawAccel: number;
  heightMin: number;
  heightMax: number;
  liftRate: number;
  liftEase: number;
  maxSlope: number;
  fallAccel: number;
  fallMax: number;
  drop: number;
  /** Local clearance ellipsoids; support queries do not depend on rendered meshes. */
  clearance: readonly {
    c: readonly [number, number, number];
    r: readonly [number, number, number];
  }[];
}

export function initialControl(): ControlState {
  return {
    time: 0,
    yaw: 0,
    yawRate: 0,
    speed: 0,
    height: 0,
    fall: 0,
    stuckFor: 0,
    halt: 'clear',
    lamp: false,
  };
}
