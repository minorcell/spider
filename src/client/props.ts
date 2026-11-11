import { Group, Mesh, MeshLambertMaterial, SphereGeometry } from 'three';
import { kindOf } from '@/src/shared/kinds';
import type { Footprint } from '@/src/shared/state';
import { buildApple } from '@/src/client/appleMesh';
import { buildGrass, type GrassStyle } from '@/src/client/grassMesh';
import { buildStone } from '@/src/client/models/stone';
import { buildTree } from '@/src/client/models/tree';
import { buildNest } from '@/src/client/nest';

export { drapeGrass } from '@/src/client/grassMesh';

const roundMaterials = new Map<number, MeshLambertMaterial>();

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
  const spec = kindOf(kind);
  const model = spec?.model;
  if (!model) return null;
  if (typeof model === 'object') {
    const radius = spec.physics?.radius ?? 0.2;
    const size = radius / (1 + Math.max(0, stage) * 0.25);
    let material = roundMaterials.get(model.color);
    if (!material) {
      material = new MeshLambertMaterial({ color: model.color, flatShading: true });
      roundMaterials.set(model.color, material);
    }
    const mesh = new Mesh(new SphereGeometry(size, model.segments, 8), material);
    mesh.position.y = radius;
    return new Group().add(mesh);
  }
  if (model === 'apple') return buildApple(stage);
  if (model === 'nest') return buildNest();
  if (model === 'grass') {
    const radius = footprint?.kind === 'circle' ? footprint.r : 1.7;
    const { style, seed } = grassStyle(id);
    return buildGrass(radius, seed, style);
  }
  if (model === 'tree') {
    const radius = circleRadius(footprint, 0.4);
    return buildTree(propSeed(id, 13), 2.55 + radius * 3.3);
  }
  const bog = model === 'bog-stone';
  const radius = circleRadius(footprint, bog ? 0.75 : 0.8);
  return buildStone(propSeed(id, bog ? 41 : 29), radius / 0.82, bog);
}
