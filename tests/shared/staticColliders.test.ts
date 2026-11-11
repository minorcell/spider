import { DoubleSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { buildProp } from '@/src/client/props';
import { BODY_RADIUS, moveCircle, sweepCircle } from '@/src/shared/collision';
import { KINDS } from '@/src/shared/kinds';
import { SimSession } from '@/src/shared/sim/session';
import { applyBody, captureBody } from '@/src/shared/sim/snapshot';
import type { EntityState } from '@/src/shared/state';
import { treeForm } from '@/src/shared/treeForm';
import { propBlocks, removeEntity } from '@/src/shared/world';

describe('registered static obstacles', () => {
  it.each([
    ['stone', 0.5],
    ['stone', 1.15],
    ['bog-stone', 0.55],
    ['bog-stone', 0.95],
  ])('stops movement before the rendered %s cluster at footprint %s', (kind, radius) => {
    const entity: EntityState = {
      id: `${kind}-1`,
      kind,
      x: 4,
      y: 0.5,
      z: -7,
      stage: 0,
      footprint: { kind: 'circle', r: radius },
    };
    const model = buildProp(kind, entity.stage, entity.footprint, entity.id)!;
    model.position.copy(entity);
    model.updateMatrixWorld(true);
    const material = new MeshBasicMaterial({ side: DoubleSide });
    const rocks: Mesh[] = [];
    for (const part of model.children) {
      for (const node of part.children) {
        if (!(node instanceof Mesh)) continue;
        node.traverse((mesh) => {
          if (!(mesh instanceof Mesh)) return;
          const solid = new Mesh(mesh.geometry, material);
          solid.matrixWorld.copy(mesh.matrixWorld);
          rocks.push(solid);
        });
      }
    }
    const ray = new Raycaster(new Vector3(), new Vector3(0, 0, 1));
    const blocks = propBlocks([entity]);
    const fromZ = entity.z - 4;
    let hits = 0;

    for (const offset of [-radius, -radius / 2, 0, radius / 2, radius]) {
      const x = entity.x + offset;
      ray.ray.origin.set(x, entity.y + radius * 0.25, fromZ);
      const hit = ray.intersectObjects(rocks, true)[0];
      if (!hit) continue;
      hits++;
      const impact = sweepCircle(x, fromZ, 0, 8, BODY_RADIUS, blocks);
      expect(impact, `offset ${offset}`).toBeDefined();
      expect(fromZ + impact!.time * 8 + BODY_RADIUS, `offset ${offset}`).toBeLessThanOrEqual(
        hit.point.z + 0.01,
      );
    }
    expect(hits).toBeGreaterThan(1);

    const support = KINDS[kind].support!;
    ray.ray.direction.set(0, -1, 0);
    let supportHits = 0;
    for (const offset of [-radius, -radius / 2, 0, radius / 2, radius]) {
      const x = entity.x + offset;
      ray.ray.origin.set(x, entity.y + 5, entity.z);
      const hit = ray.intersectObjects(rocks, true)[0];
      if (!hit) continue;
      supportHits++;
      expect(support(entity, x, entity.z)).toBeCloseTo(hit.point.y, 4);
    }
    expect(supportHits).toBeGreaterThan(1);

    const pass = moveCircle(entity.x + 3, fromZ, 0, 8, BODY_RADIUS, { blocks });
    expect(pass).toMatchObject({ halt: 'clear', z: fromZ + 8 });
    material.dispose();
  });

  it.each(['spreading', 'slender', 'old', 'sparse', 'bare'])(
    'sweeps against the rendered %s tree trunk',
    (form) => {
      const ids = Array.from({ length: 32 }, (_, index) => `tree-${index + 1}`);
      const entity: EntityState = {
        id: ids.find((id) => treeForm(id).name === form)!,
        kind: 'tree',
        x: 3,
        y: -0.05,
        z: 5,
        stage: 0,
        footprint: { kind: 'circle', r: 0.6 },
      };
      const model = buildProp(entity.kind, entity.stage, entity.footprint, entity.id)!;
      model.position.copy(entity);
      model.updateMatrixWorld(true);
      const trunk = model.getObjectByName('trunk')!;
      const fromZ = entity.z - 3;
      const ray = new Raycaster(
        new Vector3(entity.x, entity.y + 0.28, fromZ),
        new Vector3(0, 0, 1),
      );
      const hit = ray.intersectObject(trunk, true)[0];
      expect(hit).toBeDefined();
      const blocks = propBlocks([entity]);
      const impact = sweepCircle(entity.x, fromZ, 0, 6, BODY_RADIUS, blocks);
      expect(impact).toBeDefined();
      expect(fromZ + impact!.time * 6 + BODY_RADIUS).toBeLessThanOrEqual(hit.point.z + 0.01);
    },
  );

  it('gives a stone without an explicit footprint its registered default geometry', () => {
    const stone: EntityState = { id: 'stone-1', kind: 'stone', x: 2, y: 1, z: 3, stage: 0 };
    expect(propBlocks([stone])).toEqual(
      propBlocks([{ ...stone, footprint: { kind: 'circle', r: 0.8 } }]),
    );
  });

  it('uses an entity-specific collider factory through add, restore and removal', () => {
    const kind = 'test-gate';
    KINDS[kind] = {
      rest: 0,
      placement: { footprint: () => ({ kind: 'box', hx: 0.4, hz: 1.2 }) },
      boxes: (entity) => {
        const footprint = entity.footprint!;
        if (footprint.kind !== 'box') throw new Error('Expected gate dimensions');
        return [
          {
            id: 'panel',
            minX: -footprint.hx,
            maxX: footprint.hx,
            minZ: -footprint.hz,
            maxZ: footprint.hz,
            height: 1.5,
          },
        ];
      },
    };
    try {
      const wallTime = 1_800_000_000_000;
      const source = new SimSession(7, undefined, wallTime);
      const gate = source.addEntity(kind, 5, -6);
      const target = new SimSession(8, undefined, wallTime);
      applyBody(target, captureBody(source, null), undefined, wallTime);
      const ownBlocks = target.world.blocks.filter((block) => block.owner === gate.id);
      expect(ownBlocks).toEqual([
        {
          id: `${gate.id}/panel`,
          owner: gate.id,
          kind,
          minX: 4.6,
          maxX: 5.4,
          minZ: -7.2,
          maxZ: -4.8,
          height: gate.y + 1.5,
        },
      ]);
      expect(ownBlocks).toEqual(source.world.blocks.filter((block) => block.owner === gate.id));
      const collision = sweepCircle(2, -6, 6, 0, BODY_RADIUS, ownBlocks);
      expect(collision?.block.owner).toBe(gate.id);
      removeEntity(target.world, target.world.entities.get(gate.id)!);
      expect(target.world.blocks.some((block) => block.owner === gate.id)).toBe(false);
    } finally {
      delete KINDS[kind];
    }
  });
});
