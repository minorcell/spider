import { Color, Group, Mesh, MeshLambertMaterial, SphereGeometry } from 'three';
import { kindOf } from '@/src/shared/kinds';
import type { Footprint } from '@/src/shared/state';
import { buildApple } from '@/src/client/appleMesh';
import { buildGrass, drapeGrass, type GrassStyle } from '@/src/client/grassMesh';
import { buildStone } from '@/src/client/models/stone';
import { buildTree } from '@/src/client/models/tree';
import { buildNest } from '@/src/client/nest';

export { drapeGrass } from '@/src/client/grassMesh';

const roundMaterials = new Map<number, MeshLambertMaterial>();
const rottenMaterials = new WeakMap<MeshLambertMaterial, MeshLambertMaterial>();
const freshMaterials = new WeakMap<MeshLambertMaterial, MeshLambertMaterial>();
const rottenColor = new Color(0x756345);

/** Palette variants are shared assets; changing one item never recolors its neighbours. */
export function showFreshness(group: Group, rotten: boolean): void {
  group.traverse((node) => {
    if (!(node instanceof Mesh) || !(node.material instanceof MeshLambertMaterial)) return;
    const base = freshMaterials.get(node.material) ?? node.material;
    if (!rotten) {
      node.material = base;
      return;
    }
    let material = rottenMaterials.get(base);
    if (!material) {
      material = base.clone();
      material.color.lerp(rottenColor, 0.78);
      rottenMaterials.set(base, material);
      freshMaterials.set(material, base);
    }
    node.material = material;
  });
}

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
  const progress = spec.eat ? Math.max(0, Math.min(1, stage / spec.eat.bites)) : 0;
  if (typeof model === 'object') {
    const radius = spec.physics?.radius ?? 0.2;
    const size = radius * Math.cbrt(Math.max(0.15, 1 - progress));
    let material = roundMaterials.get(model.color);
    if (!material) {
      material = new MeshLambertMaterial({ color: model.color, flatShading: true });
      roundMaterials.set(model.color, material);
    }
    const mesh = new Mesh(new SphereGeometry(size, model.segments, 8), material);
    mesh.position.y = radius;
    const group = new Group().add(mesh);
    group.scale.setScalar(spec.modelScale ?? 1);
    return group;
  }
  const group = modelOf(model)?.build(progress, footprint, id);
  if (!group) return null;
  group.scale.multiplyScalar(spec.modelScale ?? 1);
  return group;
}

interface ModelSpec {
  build(stage: number, footprint: Footprint | undefined, id: string): Group;
  drape?: typeof drapeGrass;
}

/** Presentation assets are registered separately from gameplay capabilities. */
export const MODELS: Record<string, ModelSpec> = {
  apple: { build: (stage) => buildApple(stage) },
  nest: { build: () => buildNest() },
  grass: {
    build: (_stage, footprint, id) => {
      const { style, seed } = grassStyle(id);
      return buildGrass(circleRadius(footprint, 1.7), seed, style);
    },
    drape: drapeGrass,
  },
  tree: {
    build: (_stage, footprint, id) =>
      buildTree(propSeed(id, 13), 2.55 + circleRadius(footprint, 0.4) * 3.3),
  },
  stone: {
    build: (_stage, footprint, id) =>
      buildStone(propSeed(id, 29), circleRadius(footprint, 0.8) / 0.82, false),
  },
  'bog-stone': {
    build: (_stage, footprint, id) =>
      buildStone(propSeed(id, 41), circleRadius(footprint, 0.75) / 0.82, true),
  },
};

export function propDrape(kind: string): ModelSpec['drape'] {
  const model = kindOf(kind)?.model;
  return typeof model === 'string' ? modelOf(model)?.drape : undefined;
}

function modelOf(id: string): ModelSpec | undefined {
  return Object.hasOwn(MODELS, id) ? MODELS[id] : undefined;
}
