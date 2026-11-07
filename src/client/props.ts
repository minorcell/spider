import type { Group } from 'three';
import type { Footprint } from '../shared/state.js';
import { buildApple } from './appleMesh.js';
import { buildGrass, type GrassStyle } from './grassMesh.js';
import { buildStone } from './models/stone.js';
import { buildTree } from './models/tree.js';
import { buildNest } from './nest.js';

export { drapeGrass } from './grassMesh.js';

const STYLES: readonly GrassStyle[] = ['thin', 'seed', 'broad'];

/** The number at the end of an id, or zero for a hand-named one. */
function suffixOf(id: string): number {
  const suffix = id.includes('-') ? Number(id.slice(id.lastIndexOf('-') + 1)) : 0;
  return Number.isFinite(suffix) ? suffix : 0;
}

/** 草的编号决定它长成哪一种：细叶、抽穗、宽叶轮着来，岛上三种都能见到。 */
function grassStyle(id: string): { style: GrassStyle; seed: number } {
  const n = suffixOf(id);
  return { style: STYLES[n % 3], seed: (n * 977 + 13) >>> 0 };
}

/** 树、石、沼石也按编号取种子；同一份存档重开，形状不变。 */
function propSeed(id: string, salt: number): number {
  return (suffixOf(id) * 977 + salt) >>> 0;
}

/** 把散落时存下的圆脚换成可见的体量。 */
function circleRadius(footprint: Footprint | undefined, fallback: number): number {
  return footprint?.kind === 'circle' ? footprint.r : fallback;
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
  if (kind === 'tree') {
    // 根盘的半径同时决定挡路的树干和整棵树的高度。
    const radius = circleRadius(footprint, 0.4);
    return buildTree(propSeed(id, 13), 2.55 + radius * 3.3);
  }
  if (kind === 'stone' || kind === 'bog-stone') {
    const bog = kind === 'bog-stone';
    const radius = circleRadius(footprint, bog ? 0.75 : 0.8);
    // 石头的挡路半径是脚圈半径的 0.82，视觉体量按这个比例反推。
    return buildStone(propSeed(id, bog ? 41 : 29), radius / 0.82, bog);
  }
  return null;
}
