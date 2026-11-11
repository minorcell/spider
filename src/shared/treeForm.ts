import type { EntityState, Footprint } from '@/src/shared/state';

/** Content recipes, shared by the model and the registered trunk obstruction. */
export const TREE_FORMS = [
  { name: 'spreading', height: 1, girth: 1.35, spread: 1.15, foliage: 1, leaf: 0xa8b780 },
  { name: 'slender', height: 1.55, girth: 0.65, spread: 0.48, foliage: 0.75, leaf: 0xb4bf91 },
  { name: 'old', height: 0.86, girth: 2.1, spread: 1.2, foliage: 0.68, leaf: 0x8fa577 },
  { name: 'sparse', height: 1.2, girth: 0.85, spread: 0.88, foliage: 0.3, leaf: 0xb7b480 },
  { name: 'bare', height: 1.1, girth: 1.15, spread: 0.8, foliage: 0, leaf: 0xa8b780 },
] as const;

export function treeForm(id: string, footprint?: Footprint) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0;
  const recipe = TREE_FORMS[seed % TREE_FORMS.length];
  const radius =
    footprint == null
      ? 0.4
      : footprint.kind === 'circle'
        ? footprint.r
        : Math.min(footprint.hx, footprint.hz);
  const height = (2.55 + radius * 3.3) * recipe.height;
  const trunkRadius = (0.098 + height * 0.028) * recipe.girth;
  return { ...recipe, seed, height, trunkRadius, footprintRadius: radius };
}

export function treeBlock(entity: EntityState) {
  const form = treeForm(entity.id, entity.footprint);
  return {
    radius: (form.trunkRadius + form.height * 0.018) / form.footprintRadius,
    height: form.height * 0.68,
  };
}
