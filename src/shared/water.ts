import { SPIDER_BODY } from './config.js';
import { nearestWater, TERRAIN } from './terrain.js';

/**
 * Water is a volume with density. Every rigid body gets the same treatment:
 * its weight is `mass * gravity`, the water pushes back with the weight of the
 * displaced volume, and drag grows with how much of the body is submerged.
 */
export const WATER = {
  /** Density of water. Every mass and volume below is in these same units. */
  density: 1,
  /** Depth where wading pace starts blending into the slower swimming pace. */
  wadeDepth: 0.34,
  /** Feet stay just under the surface while the body swims. */
  footDraft: 0.06,
  /** Fraction of the land cruise speed while wading, then while swimming. */
  wadePace: 0.62,
  swimPace: 0.42,
  /** Fraction of the land turn rate in water. */
  turnPace: 0.68,
  /** Extra speed easing while in water, 1/s. */
  spiderDrag: 4.2,
  /** Fluid drag on a loose prop, 1/s at full submersion. */
  drag: 3.4,
  /** How quickly the floating body settles onto its buoyancy equilibrium. */
  buoyancyEase: 4.5,
} as const;

export interface Water {
  /** Flat water line. Only meaningful when `depth` is positive. */
  surface: number;
  /** How much water sits above the solid ground at this point. */
  depth: number;
}

const DRY: Water = Object.freeze({ surface: Number.NEGATIVE_INFINITY, depth: 0 });

function depthAt(
  ground: { height(x: number, z: number): number; surface?: (x: number, z: number) => number },
  x: number,
  z: number,
): number {
  const height = ground.height(x, z);
  const surface = ground.surface ? ground.surface(x, z) : TERRAIN.water;
  return surface - height;
}

/** The water column at a point. `depth` is zero on dry ground. */
export function waterAt(
  ground: { height(x: number, z: number): number; surface?: (x: number, z: number) => number },
  x: number,
  z: number,
): Water {
  const height = ground.height(x, z);
  const surface = ground.surface ? ground.surface(x, z) : TERRAIN.water;
  const depth = surface - height;
  return depth > 0 ? { surface, depth } : DRY;
}

/**
 * How much of the land pace remains at this depth. Wading loses some speed;
 * floating loses more. The transition is smooth so a shoreline does not snap
 * the body between two speeds.
 */
export function waterPace(depth: number): number {
  if (depth <= 0) return 1;
  const wade = Math.min(1, depth / WATER.wadeDepth);
  const wadePace = 1 + (WATER.wadePace - 1) * wade;
  if (depth <= WATER.wadeDepth) return wadePace;
  const swim = Math.min(1, (depth - WATER.wadeDepth) / WATER.wadeDepth);
  return wadePace + (WATER.swimPace - wadePace) * (swim * swim * (3 - 2 * swim));
}

/** Volume of a sphere with this radius. */
export function sphereVolume(radius: number): number {
  return (4 / 3) * Math.PI * radius ** 3;
}

/**
 * Fraction of a sphere that sits below `surface` when its lowest point is
 * `bottom`. This is the displaced-volume ratio the buoyancy force uses.
 */
export function submergedFraction(bottom: number, surface: number, radius: number): number {
  if (radius <= 0) return 0;
  const height = Math.min(2 * radius, Math.max(0, surface - bottom));
  if (height <= 0) return 0;
  if (height >= 2 * radius) return 1;
  return (height * height * (3 * radius - height)) / (4 * radius ** 3);
}

/** Sphere cap height needed to displace `fraction` of the sphere. */
export function capHeight(fraction: number, radius: number): number {
  const target = Math.min(1, Math.max(0, fraction)) * 4 * radius ** 3;
  let low = 0;
  let high = 2 * radius;
  for (let i = 0; i < 24; i++) {
    const mid = (low + high) / 2;
    const volume = mid * mid * (3 * radius - mid);
    if (volume < target) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Root height where a spherical body with this mass, volume, centre offset and
 * radius floats in equilibrium. The same displacement rule applies to every
 * body; only these physical values differ.
 */
export function equilibriumHeight(
  water: Water,
  mass: number,
  volume: number,
  radius: number,
  center: number,
): number {
  const fraction = mass / Math.max(1e-9, volume * WATER.density);
  return water.surface - (center - radius + capHeight(fraction, radius));
}

/** Height of the spider's origin while floating in this water column. */
export function floatHeight(water: Water): number {
  return equilibriumHeight(
    water,
    SPIDER_BODY.mass,
    SPIDER_BODY.volume,
    SPIDER_BODY.radius,
    SPIDER_BODY.center,
  );
}

/** True when the water is deep enough to hold the spider off the bottom. */
export function floatsAt(
  ground: { height(x: number, z: number): number; surface?: (x: number, z: number) => number },
  x: number,
  z: number,
): boolean {
  const water = waterAt(ground, x, z);
  return water.depth > 0 && floatHeight(water) > ground.height(x, z);
}

export interface WaterReading {
  x: number;
  z: number;
  distance: number;
  /** Deepest connected water found from the reported point. */
  depth: number;
  /** Farthest connected water from that point, capped at the sense range. */
  span: number;
}

export interface WaterSurvey {
  /** Farthest connected water from the point, capped at the sense range. */
  span: number;
  /** Deepest water found on the way. */
  deepest: number;
}

export interface ShoreReading {
  x: number;
  z: number;
  distance: number;
}

const SURVEY_DIRECTIONS = 24;
const SURVEY_STEP = 0.25;

/** The nearest water and how big/deep the body of water is there. */
export function readWater(
  ground: { height(x: number, z: number): number },
  x: number,
  z: number,
  reach: number,
): WaterReading | null {
  const spot = nearestWater(ground, x, z, reach);
  if (!spot) return null;
  const survey = surveyWater(ground, spot.x, spot.z, reach);
  return { ...spot, depth: survey.deepest, span: survey.span };
}

/** How far and how deep the connected water runs from a wet point. */
export function surveyWater(
  ground: { height(x: number, z: number): number; surface?: (x: number, z: number) => number },
  x: number,
  z: number,
  reach: number,
): WaterSurvey {
  if (depthAt(ground, x, z) <= 0) return { span: 0, deepest: 0 };
  let span = 0;
  let deepest = 0;
  for (let i = 0; i < SURVEY_DIRECTIONS; i++) {
    const angle = (i / SURVEY_DIRECTIONS) * Math.PI * 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    for (let distance = SURVEY_STEP; distance <= reach + 1e-9; distance += SURVEY_STEP) {
      const px = x + dx * distance;
      const pz = z + dz * distance;
      const depth = depthAt(ground, px, pz);
      if (depth <= 0) break;
      span = Math.max(span, distance);
      deepest = Math.max(deepest, depth);
    }
  }
  return { span, deepest };
}

/** The nearest dry ground from a wet body, or null when already dry. */
export function nearestShore(
  ground: { height(x: number, z: number): number; surface?: (x: number, z: number) => number },
  x: number,
  z: number,
  reach: number,
): ShoreReading | null {
  if (depthAt(ground, x, z) <= 0) return null;
  for (let distance = SURVEY_STEP; distance <= reach + 1e-9; distance += SURVEY_STEP) {
    for (let i = 0; i < SURVEY_DIRECTIONS; i++) {
      const angle = (i / SURVEY_DIRECTIONS) * Math.PI * 2;
      const px = x + Math.cos(angle) * distance;
      const pz = z + Math.sin(angle) * distance;
      if (depthAt(ground, px, pz) <= 0) return { x: px, z: pz, distance };
    }
  }
  return null;
}
