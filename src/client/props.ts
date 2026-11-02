import type { Group } from 'three';
import type { Footprint } from '../shared/state.js';
import { buildApple } from './appleMesh.js';
import { buildGrass, type GrassStyle } from './grassMesh.js';
import { buildNest } from './nest.js';

export { drapeGrass } from './grassMesh.js';

const STYLES: readonly GrassStyle[] = ['thin', 'seed', 'broad'];

/** 草的编号决定它长成哪一种：细叶、抽穗、宽叶轮着来，岛上三种都能见到。 */
function grassStyle(id: string): { style: GrassStyle; seed: number } {
  const suffix = id.includes('-') ? Number(id.slice(id.lastIndexOf('-') + 1)) : 0;
  const n = Number.isFinite(suffix) ? suffix : 0;
  return { style: STYLES[n % 3], seed: (n * 977 + 13) >>> 0 };
}

/** Curved paper prop. The apple's origin is its bottom. Nest and grass sit on the ground. */
export function buildProp(
  kind: string,
  stage: number,
  footprint?: Footprint,
  id = '',
): Group | null {
  if (kind === 'apple') return buildApple(stage);
  if (kind === 'nest') return buildNest();
  if (kind === 'grass') {
    const radius = footprint?.kind === 'circle' ? footprint.r : 1.7;
    const { style, seed } = grassStyle(id);
    return buildGrass(radius, seed, style);
  }
  return null;
}
