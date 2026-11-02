import { GAIT } from './config.js';
import { blockAt } from './sight.js';
import type { Block } from './state.js';

/** How far a look along the heading bothers to check. */
const AHEAD = 8;
const STEP = 0.25;
/** Solids reported around the body. */
const NEAR = 6;

export interface Ahead {
  /** Meters you can still walk along your heading. 0 means you are against it. */
  open: number;
  /** clear: nothing in that stretch. wall: a solid. slope: the ground rises too fast. */
  by: 'clear' | 'wall' | 'slope';
  /** The solid's id, when by is wall. */
  id: string | null;
  kind: 'nest' | 'solid' | null;
}

export interface NearbySolid {
  id: string;
  kind: 'nest' | 'solid';
  /** Distance from you to the nearest point of it. */
  distance: number;
  /** Degrees off your heading, clockwise positive. 0 is straight ahead. */
  bearing: number;
}

const round = (value: number, places = 2): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

function kindOfBlock(id: string): 'nest' | 'solid' {
  return id.startsWith('nest') ? 'nest' : 'solid';
}

interface Probe {
  open: number;
  by: 'clear' | 'wall' | 'slope';
  id: string | null;
  kind: 'nest' | 'solid' | null;
}

/**
 * What the heading runs into. One probe, without the nearby list or the
 * turn-by-turn sentences: an action that only reports the body does not need
 * to scan 24 headings.
 */
export function aheadAt(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
): Ahead {
  const here = blockAt(x, z, blocks);
  if (here) return { open: 0, by: 'wall', id: here.id, kind: kindOfBlock(here.id) };
  return probe(x, z, heading, height, blocks);
}

/** Heading 0 faces world -Z. Clockwise is positive, matching the body's turn. */
function probe(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
): Probe {
  const rad = (heading * Math.PI) / 180;
  const fx = Math.sin(rad);
  const fz = -Math.cos(rad);
  let previous = height(x, z);
  for (let traveled = STEP; traveled <= AHEAD + 1e-6; traveled += STEP) {
    const nx = x + fx * traveled;
    const nz = z + fz * traveled;
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

function meters(value: number): string {
  const text = round(value, 1).toFixed(1);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

function lineOf(sample: { bearing: number; open: number }): string {
  return Math.abs(sample.bearing) < 12
    ? `正前方可以走 ${meters(sample.open)} 米。`
    : `相对朝向转 ${Math.round(sample.bearing)} 度（正数顺时针）后，可以走 ${meters(sample.open)} 米。`;
}

/** Turn sentences for the current heading. Used when a walk is blocked. */
export function waysAt(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
): string[] {
  return waysFrom(x, z, heading, height, blocks);
}

/** Sentences the agent can follow: which way is walkable, and how far. */
function waysFrom(
  x: number,
  z: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
): string[] {
  const samples = [];
  for (let step = 0; step < 24; step++) {
    const absolute = step * 15;
    const seen = probe(x, z, absolute, height, blocks);
    samples.push({ bearing: wrap(absolute - heading), open: seen.open });
  }
  const forward = samples.reduce((a, b) => (Math.abs(a.bearing) < Math.abs(b.bearing) ? a : b));
  const alternatives = samples
    .filter(
      (sample) =>
        sample.open >= Math.max(2.5, forward.open + 1.5) && Math.abs(sample.bearing) >= 40,
    )
    .toSorted((a, b) => b.open - a.open || Math.abs(a.bearing) - Math.abs(b.bearing));
  const picked: { bearing: number; open: number }[] = [];
  for (const sample of alternatives) {
    if (picked.every((other) => Math.abs(wrap(sample.bearing - other.bearing)) >= 40))
      picked.push(sample);
    if (picked.length === 2) break;
  }
  if (forward.open >= 2.5) return [lineOf(forward), ...picked.map(lineOf)];
  if (picked.length > 0) return picked.map(lineOf);
  const best = samples.reduce((a, b) => (b.open > a.open ? b : a));
  return [`周围都不远。${lineOf(best)}`];
}

/**
 * What is in front of the body, which solids stand nearby, and which
 * headings are walkable. The same probe covers every solid. Forward matches
 * the spider: yaw 0 faces world -Z.
 */
export function senseBody(
  x: number,
  z: number,
  _yaw: number,
  heading: number,
  height: (x: number, z: number) => number,
  blocks: readonly Block[],
): { ahead: Ahead; nearby: NearbySolid[]; ways: string[] } {
  const ahead = aheadAt(x, z, heading, height, blocks);

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

  return { ahead, nearby: nearby.slice(0, 8), ways: waysFrom(x, z, heading, height, blocks) };
}
