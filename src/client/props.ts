import type { Group } from 'three';
import type { Footprint } from '@/src/shared/state';
import { buildApple } from '@/src/client/appleMesh';
import { buildGrass, type GrassStyle } from '@/src/client/grassMesh';
import { buildStone } from '@/src/client/models/stone';
import { buildTree } from '@/src/client/models/tree';
import { buildNest } from '@/src/client/nest';

export { drapeGrass } from '@/src/client/grassMesh';

const STYLES: readonly GrassStyle[] = ['thin', 'seed', 'broad'];

function suffixOf(id: string): number {
  const suffix = id.includes('-') ? Number(id.slice(id.lastIndexOf('-') + 1)) : 0;
  return Number.isFinite(suffix) ? suffix : 0;
}

function grassStyle(id: string): { style: GrassStyle; seed: number } {
  const n = suffixOf(id);
  return { style: STYLES[n % 3], seed: (n * 977 + 13) >>> 0 };
}

function propSeed(id: string, salt: number): number {
  return (suffixOf(id) * 977 + salt) >>> 0;
}

function circleRadius(footprint: Footprint | undefined, fallback: number): number {
  return footprint?.kind === 'circle' ? footprint.r : fallback;
}

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
    const radius = circleRadius(footprint, 0.4);
    return buildTree(propSeed(id, 13), 2.55 + radius * 3.3);
  }
  if (kind === 'stone' || kind === 'bog-stone') {
    const bog = kind === 'bog-stone';
    const radius = circleRadius(footprint, bog ? 0.75 : 0.8);
    return buildStone(propSeed(id, bog ? 41 : 29), radius / 0.82, bog);
  }
  return null;
}
