import { kindOf, type CoverSpec, type CoverVolume } from '@/src/shared/kinds';
import type { Block, EntityState } from '@/src/shared/state';

export { BODY_RADIUS, blockAt, blockedAt } from '@/src/shared/collision';

export function homeAt(x: number, z: number, entities: Iterable<EntityState>): EntityState | null {
  for (const entity of entities) {
    const home = kindOf(entity.kind)?.home;
    if (
      home &&
      x >= entity.x - home.half &&
      x <= entity.x + home.half &&
      z >= entity.z - home.half &&
      z <= entity.z + home.half
    )
      return entity;
  }
  return null;
}

export function occluded(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  blocks: readonly Block[],
  ignoreId: string,
  eye: number,
): boolean {
  for (const block of blocks) {
    if ((block.owner ?? block.id) === ignoreId || block.height < eye) continue;
    if (segmentHits(x0, z0, x1, z1, block)) return true;
  }
  return false;
}

export const EYE_HEIGHT = 0.85;

export const SIGHT_TOP = 0.35;

export const GROUND_CLEARANCE = 0.2;

export function groundOccluded(
  x0: number,
  z0: number,
  y0: number,
  x1: number,
  y1: number,
  z1: number,
  height: (x: number, z: number) => number,
  clearance = GROUND_CLEARANCE,
): boolean {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const length = Math.hypot(dx, dz);
  if (length < 1e-6) return false;
  const steps = Math.max(2, Math.ceil(length / 0.5));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ground = height(x0 + dx * t, z0 + dz * t);
    if (ground > y0 + (y1 - y0) * t + clearance) return true;
  }
  return false;
}

const coverShapes = new WeakMap<
  EntityState,
  { id: string; radius: number; spec: CoverSpec; volumes: readonly CoverVolume[] }
>();

function coverShape(entity: EntityState, radius: number, spec: CoverSpec): readonly CoverVolume[] {
  const cached = coverShapes.get(entity);
  if (cached && cached.id === entity.id && cached.radius === radius && cached.spec === spec)
    return cached.volumes;
  const volumes = spec.volumes(entity.id, radius);
  coverShapes.set(entity, { id: entity.id, radius, spec, volumes });
  return volumes;
}

/** The strongest containing cover determines perception, independent of the kind name. */
export function coverAt(
  x: number,
  z: number,
  entities: Iterable<EntityState>,
  eye = Number.NEGATIVE_INFINITY,
): { kind: string; range: number } | null {
  let cover: { kind: string; range: number } | null = null;
  for (const entity of entities) {
    const spec = kindOf(entity.kind)?.cover;
    if (
      spec &&
      entity.footprint?.kind === 'circle' &&
      Math.abs(entity.x - x) <= entity.footprint.r &&
      Math.abs(entity.z - z) <= entity.footprint.r &&
      coverShape(entity, entity.footprint.r, spec).some(
        (volume) =>
          Math.hypot(entity.x + volume.x - x, entity.z + volume.z - z) <= volume.radius &&
          eye < entity.y + volume.height,
      ) &&
      (!cover || spec.range < cover.range)
    )
      cover = { kind: entity.kind, range: spec.range };
  }
  return cover;
}

function segmentHits(x0: number, z0: number, x1: number, z1: number, block: Block): boolean {
  return segmentEntry(x0, z0, x1, z1, block) !== null;
}

function segmentEntry(x0: number, z0: number, x1: number, z1: number, block: Block): number | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const p = [-dx, dx, -dz, dz];
  const q = [x0 - block.minX, block.maxX - x0, z0 - block.minZ, block.maxZ - z0];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return null;
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return t0 < 0.98 ? t0 : null;
}
