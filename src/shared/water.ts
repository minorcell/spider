import { SPIDER_BODY } from './config.js';
import { nearestWater, TERRAIN } from './terrain.js';

export const WATER = {
  density: 1,
  wadeDepth: 0.34,
  footDraft: 0.06,
  wadePace: 0.62,
  swimPace: 0.42,
  turnPace: 0.68,
  spiderDrag: 4.2,
  drag: 3.4,
  buoyancyEase: 4.5,
} as const;

export interface Water {
  surface: number;
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

export function waterPace(depth: number): number {
  if (depth <= 0) return 1;
  const wade = Math.min(1, depth / WATER.wadeDepth);
  const wadePace = 1 + (WATER.wadePace - 1) * wade;
  if (depth <= WATER.wadeDepth) return wadePace;
  const swim = Math.min(1, (depth - WATER.wadeDepth) / WATER.wadeDepth);
  return wadePace + (WATER.swimPace - wadePace) * (swim * swim * (3 - 2 * swim));
}

export function sphereVolume(radius: number): number {
  return (4 / 3) * Math.PI * radius ** 3;
}

export function submergedFraction(bottom: number, surface: number, radius: number): number {
  if (radius <= 0) return 0;
  const height = Math.min(2 * radius, Math.max(0, surface - bottom));
  if (height <= 0) return 0;
  if (height >= 2 * radius) return 1;
  return (height * height * (3 * radius - height)) / (4 * radius ** 3);
}

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

export function floatHeight(water: Water): number {
  return equilibriumHeight(
    water,
    SPIDER_BODY.mass,
    SPIDER_BODY.volume,
    SPIDER_BODY.radius,
    SPIDER_BODY.center,
  );
}

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
  depth: number;
  span: number;
}

export interface WaterSurvey {
  span: number;
  deepest: number;
}

export interface ShoreReading {
  x: number;
  z: number;
  distance: number;
}

const SURVEY_DIRECTIONS = 24;
const SURVEY_STEP = 0.25;

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
