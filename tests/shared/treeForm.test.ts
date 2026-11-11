import { describe, expect, it } from 'vitest';
import { KINDS } from '@/src/shared/kinds';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import { TREE_FORMS, treeBlock, treeForm } from '@/src/shared/treeForm';
import { removeEntity } from '@/src/shared/world';

describe('registered tree forms', () => {
  it('chooses all forms by stable entity ID and scales the trunk with its footprint', () => {
    const ids = Array.from({ length: 32 }, (_, index) => `tree-${index + 1}`);
    const forms = ids.map((id) => treeForm(id));
    expect(new Set(forms.map(({ name }) => name))).toEqual(
      new Set(TREE_FORMS.map(({ name }) => name)),
    );
    expect(ids.map((id) => treeForm(id))).toEqual(forms);
    expect(treeForm('tree-1').seed).not.toBe(treeForm('shade-post-1').seed);

    const small = treeForm('tree-1', { kind: 'circle', r: 0.25 });
    const large = treeForm('tree-1', { kind: 'circle', r: 0.8 });
    expect(large.name).toBe(small.name);
    expect(large.height).toBeGreaterThan(small.height);
    expect(large.trunkRadius).toBeGreaterThan(small.trunkRadius);
    expect(treeForm('tree-1', { kind: 'box', hx: 1.2, hz: 0.8 })).toEqual(large);
  });

  it('reuses the trunk recipe for a new registered kind through placement, restore and removal', () => {
    const kind = 'shade-post';
    KINDS[kind] = {
      ...KINDS.tree,
      placement: { footprint: () => ({ kind: 'box', hx: 0.9, hz: 0.6 }) },
      block: treeBlock,
    };
    try {
      const wallTime = 1_800_000_000_000;
      const source = new SimSession(7, undefined, wallTime);
      const tree = source.addEntity('tree', 6, -4);
      const post = source.addEntity(kind, -6, -4);
      expect(post.footprint).toEqual({ kind: 'box', hx: 0.9, hz: 0.6 });
      const target = new SimSession(8, undefined, wallTime);
      applyBody(target, captureBody(source, null), undefined, wallTime);

      for (const entity of [tree, post]) {
        const form = treeForm(entity.id, entity.footprint);
        const original = source.world.blocks.find((block) => block.id === entity.id)!;
        const restored = target.world.entities.get(entity.id)!;
        expect(restored.footprint).toEqual(entity.footprint);
        expect(treeForm(restored.id, restored.footprint)).toEqual(form);
        expect(target.world.blocks.find((block) => block.id === entity.id)).toEqual(original);
        expect(original).toMatchObject({ kind: entity.kind });
        expect(original.maxX - entity.x).toBeCloseTo(form.trunkRadius + form.height * 0.018);
        expect(original.height - entity.y).toBeCloseTo(form.height * 0.68);
      }

      removeEntity(target.world, target.world.entities.get(post.id)!);
      expect(target.world.entities.has(post.id)).toBe(false);
      expect(target.world.blocks.some((block) => block.id === post.id)).toBe(false);
      expect(target.world.blocks.some((block) => block.id === tree.id)).toBe(true);
    } finally {
      delete KINDS[kind];
    }
  });
});
