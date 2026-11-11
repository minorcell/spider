export const PALETTE = {
  paper: 0xf3efe6,
  soil: 0xe8e1d4,
  ground: 0xe1e6d6,
  water: 0xcfe0e6,
  earth: 0xe7e1d3,
  grass: 0xd8dfc5,
  apple: 0xe6c9bb,
  leaf: 0xcfd9b8,
  stem: 0xd6c3a8,
  stone: 0xdcd9d1,
  bogStone: 0xc6c2b7,
  moss: 0xb5c19c,
  spider: 0xd7d1c7,
  eye: 0xb23a2e,
  ink: 0x1b1714,
  grid: 0xc8bfb2,
} as const;

export const SIMULATION_STEP_SECONDS = 1 / 60;

export const DECK_Y = 0.78;

export const CONTACT = 0.01;

export const MARK_LIMIT = 16;

export const MARK_NAME_MAX = 24;

export const MARK_NOTE_MAX = 120;

export const PHYSICS = {
  gravity: 9.8,
  damping: 2.4,
  sleepSlope: 0.08,
  sleepSpeed: 0.03,
  maxSpeed: 5,
} as const;

export const SPIDER_BODY = {
  mass: 1.2,
  volume: 2,
  center: 0.78,
  radius: 0.55,
} as const;

export interface MountSpec {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly side: number;
  readonly fore: number;
  readonly lateral: number;
  readonly phase: number;
}

export const MOUNTS: readonly MountSpec[] = [
  { x: -0.22, y: DECK_Y, z: -0.42, side: -1, fore: 1.55, lateral: 0.95, phase: 0 },
  { x: 0.22, y: DECK_Y, z: -0.42, side: 1, fore: 1.55, lateral: 0.95, phase: 0.5 },
  { x: -0.4, y: DECK_Y, z: -0.16, side: -1, fore: 0.55, lateral: 1.55, phase: 0.5 },
  { x: 0.4, y: DECK_Y, z: -0.16, side: 1, fore: 0.55, lateral: 1.55, phase: 0 },
  { x: -0.4, y: DECK_Y, z: 0.1, side: -1, fore: -0.25, lateral: 1.6, phase: 0 },
  { x: 0.4, y: DECK_Y, z: 0.1, side: 1, fore: -0.25, lateral: 1.6, phase: 0.5 },
  { x: -0.24, y: DECK_Y, z: 0.32, side: -1, fore: -1.05, lateral: 1.2, phase: 0.5 },
  { x: 0.24, y: DECK_Y, z: 0.32, side: 1, fore: -1.05, lateral: 1.2, phase: 0 },
];

export interface BoneSpec {
  readonly len: number;
  readonly radius: number;
  readonly profile: readonly number[];
  readonly curve: number;
}

export const BONES: readonly BoneSpec[] = [
  { len: 0.25, radius: 0.09, profile: [0.5, 0.72, 0.66, 0.5, 0.35], curve: -0.11 },
  { len: 0.88, radius: 0.098, profile: [0.38, 0.76, 0.72, 0.55, 0.32], curve: 0.2 },
  { len: 0.89, radius: 0.072, profile: [0.52, 0.62, 0.53, 0.35, 0.19], curve: -0.11 },
  { len: 0.51, radius: 0.042, profile: [0.46, 0.38, 0.28, 0.2, 0.14], curve: -0.11 },
];

export function boneRadius(section: number, t: number): number {
  const bone = BONES[section];
  const at = Math.min(3, Math.floor(t * 4));
  const f = t * 4 - at;
  return (
    bone.radius *
    (bone.profile[at] * (1 - f) +
      bone.profile[at + 1] * f +
      Math.abs(Math.sin(t * Math.PI) * bone.curve) +
      0.035)
  );
}

export const GAIT = {
  heightMin: -0.35,
  heightMax: 1,
  swing: 0.42,
  swingLift: 0.28,
  strideScale: 0.7,
  freq: 1.5,
  freqBoost: 2.5,
  cruise: 2.55,
  cruiseBoost: 5.1,
  speedEase: 4.8,
  yaw: 2.2,
  yawBoost: 3.15,
  yawAccel: 6,
  headYaw: 0.55,
  headEase: 8,
  pitch: 0.04,
  roll: 0.08,
  liftRate: 1.2,
  liftEase: 8,
  maxSlope: Math.tan((85 * Math.PI) / 180),
  stepHeight: 1.05,
  fallAccel: 14,
  fallMax: 8,
  drop: 0.2,
} as const;
