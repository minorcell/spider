import { GAIT } from './config.js';
import { blockAt, BODY_RADIUS } from './sight.js';
import type { Block } from './state.js';

const AHEAD = 8;
const STEP = 0.25;
const NEAR = 6;

export interface Ahead {
  open: number;
  by: 'clear' | 'wall' | 'slope' | 'edge';
  id: string | null;
  kind: 'nest' | 'solid' | null;
}

export interface NearbySolid {
  id: string;
  kind: 'nest' | 'solid';
  distance: number;
  bearing: number;
}

const round = (value: number, places = 2): number => {
  const scale = 10 ** places;
  const rounded = Math.round(value * scale) / scale;
  return rounded === 0 ? 0 : rounded;
};

function kindOfBlock(id: string): 'nest' | 'solid' {
  return id.startsWith('nest') ? 'nest' : 'solid';
}

interface Probe {
  open: number;
  by: 'clear' | 'wall' | 'slope' | 'edge';
  id: string | null;
  kind: 'nest' | 'solid' | null;
}

export function aheadAt(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  inside?: (x: number, z: number, margin?: number) => boolean,
): Ahead {
  const here = blockAt(x, z, blocks);
  if (here) return { open: 0, by: 'wall', id: here.id, kind: kindOfBlock(here.id) };
  return probe(x, z, heading, height, blocks, inside);
}

function headingStep(heading: number): { x: number; z: number } {
  const rad = (heading * Math.PI) / 180;
  return { x: Math.sin(rad), z: -Math.cos(rad) };
}

function probe(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  inside?: (x: number, z: number, margin?: number) => boolean,
): Probe {
  const step = headingStep(heading);
  let previous = height(x, z);
  for (let traveled = STEP; traveled <= AHEAD + 1e-6; traveled += STEP) {
    const nx = x + step.x * traveled;
    const nz = z + step.z * traveled;
    if (inside && !inside(nx, nz, BODY_RADIUS))
      return { open: round(traveled - STEP), by: 'edge', id: null, kind: null };
    const ground = height(nx, nz);
    const hit = blockAt(nx, nz, blocks);
    if (hit) return { open: round(traveled), by: 'wall', id: hit.id, kind: kindOfBlock(hit.id) };
    if (ground - previous > GAIT.maxSlope * STEP)
      return { open: round(traveled), by: 'slope', id: null, kind: null };
    previous = ground;
  }
  return { open: AHEAD, by: 'clear', id: null, kind: null };
}

function wrap(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 ? 180 : wrapped;
}

export interface Waypoint {
  x: number;
  z: number;
  open: number;
}

interface WaySample {
  absolute: number;
  bearing: number;
  open: number;
  clear: boolean;
}

function waypoint(x: number, z: number, sample: WaySample): Waypoint {
  const reach = sample.clear ? sample.open : Math.max(STEP, sample.open - 0.5);
  const step = headingStep(sample.absolute);
  return {
    x: round(x + step.x * reach),
    z: round(z + step.z * reach),
    open: round(reach, 1),
  };
}

export function waysAt(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  inside?: (x: number, z: number, margin?: number) => boolean,
): Waypoint[] {
  return waysFrom(x, z, heading, height, blocks, inside);
}

function waysFrom(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  inside?: (x: number, z: number, margin?: number) => boolean,
): Waypoint[] {
  const samples: WaySample[] = [];
  for (let step = 0; step < 24; step++) {
    const absolute = step * 15;
    const seen = probe(x, z, absolute, height, blocks, inside);
    samples.push({
      absolute,
      bearing: wrap(absolute - heading),
      open: seen.open,
      clear: seen.by === 'clear',
    });
  }
  const forward = samples.reduce((a, b) => (Math.abs(a.bearing) < Math.abs(b.bearing) ? a : b));
  const alternatives = samples
    .filter(
      (sample) =>
        sample.open >= Math.max(2.5, forward.open + 1.5) && Math.abs(sample.bearing) >= 40,
    )
    .toSorted((a, b) => b.open - a.open || Math.abs(a.bearing) - Math.abs(b.bearing));
  const picked: WaySample[] = [];
  for (const sample of alternatives) {
    if (picked.every((other) => Math.abs(wrap(sample.bearing - other.bearing)) >= 40))
      picked.push(sample);
    if (picked.length === 2) break;
  }
  const chosen =
    forward.open >= 2.5
      ? [forward, ...picked]
      : picked.length > 0
        ? picked
        : [samples.reduce((a, b) => (b.open > a.open ? b : a))];
  return chosen.map((sample) => waypoint(x, z, sample));
}

export function senseBody(
  x: number,
  z: number,
  _yaw: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
  inside?: (x: number, z: number, margin?: number) => boolean,
): { ahead: Ahead; nearby: NearbySolid[]; ways: Waypoint[] } {
  const ahead = aheadAt(x, z, heading, height, blocks, inside);

  const nearby: NearbySolid[] = [];
  for (const block of blocks) {
    const cx = Math.min(block.maxX, Math.max(block.minX, x));
    const cz = Math.min(block.maxZ, Math.max(block.minZ, z));
    const distance = Math.hypot(x - cx, z - cz);
    if (distance > NEAR) continue;
    const bearing = (((Math.atan2(cx - x, -(cz - z)) * 180) / Math.PI - heading + 540) % 360) - 180;
    nearby.push({
      id: block.id,
      kind: kindOfBlock(block.id),
      distance: round(distance),
      bearing: round(bearing, 1),
    });
  }
  nearby.sort((a, b) => a.distance - b.distance);

  return {
    ahead,
    nearby: nearby.slice(0, 8),
    ways: waysFrom(x, z, heading, height, blocks, inside),
  };
}
