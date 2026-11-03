/** Single source of truth for the spider's palette and proportions. */

export const PALETTE = {
  paper: 0xf3efe6,
  /** 巢穴翻出来的土，比纸稍微暗一点。 */
  soil: 0xe8e1d4,
  /** 地面只分几种淡色：低处水蓝、缓坡草绿、土、石头。 */
  ground: 0xe1e6d6,
  water: 0xcfe0e6,
  earth: 0xe7e1d3,
  /** 草叶的淡绿。 */
  grass: 0xd8dfc5,
  /** 苹果的淡胭脂、叶子和梗。 */
  apple: 0xe6c9bb,
  leaf: 0xcfd9b8,
  stem: 0xd6c3a8,
  /** 石子和蜘蛛的淡灰，蜘蛛再深半档。 */
  stone: 0xdcd9d1,
  spider: 0xd7d1c7,
  /** 蜘蛛的复眼。 */
  eye: 0xb23a2e,
  ink: 0x1b1714,
  grid: 0xc8bfb2,
} as const;

export const DECK_Y = 0.78;

/** How many things can sit on the spider's back at once. */
export const CARRY_LIMIT = 7;

/** How many places the spider can remember at once. */
export const MARK_LIMIT = 16;

/** Longest name a place can have. */
export const MARK_NAME_MAX = 24;

/** Longest note a place can have. */
export const MARK_NOTE_MAX = 120;

/** The island's physical rules. Everything that moves reads these numbers. */
export const PHYSICS = {
  gravity: 9.8,
  /** 1/s, rolling friction. */
  damping: 2.4,
  sleepSlope: 0.08,
  sleepSpeed: 0.03,
  maxSpeed: 5,
} as const;

/**
 * The spider body as a buoyant rigid body. `center` and `radius` describe the
 * sphere the water solver uses; `mass / volume` is its density relative to
 * water. Legs add drag but barely change displacement.
 */
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
  /** -1 for the left side, 1 for the right. */
  readonly side: number;
  readonly fore: number;
  readonly lateral: number;
  /** 0 or 0.5, so one tetrapod lifts while the other plants. */
  readonly phase: number;
}

/** Eight legs on the cephalothorax. Same phase lifts one tetrapod. */
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
}

/** Four segments per leg, from the shoulder out to the claw. `radius` is the drawn thickness. */
export const BONES: readonly BoneSpec[] = [
  { len: 0.34, radius: 0.048 },
  { len: 0.86, radius: 0.036 },
  { len: 0.98, radius: 0.026 },
  { len: 0.46, radius: 0.024 },
];

export const GAIT = {
  footY: 0.16,
  heightMin: -0.35,
  /** A spider can rear up almost its leg length to look over a bank. */
  heightMax: 1.6,
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
  liftRate: 0.5,
  liftEase: 5,
  /** Rise over run at 85 degrees. The body sticks to slopes and stops only on a near-vertical face. */
  maxSlope: Math.tan((85 * Math.PI) / 180),
  fallAccel: 14,
  fallMax: 8,
  /** Gap above the support before the body falls instead of easing down. */
  drop: 0.2,
} as const;
