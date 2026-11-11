import { sphereMesh, meshNormals, meshSurface, type MeshPlacement } from '@/src/shared/mesh';
import { mulberry32 } from '@/src/shared/noise';
import type { Block, EntityState, Footprint } from '@/src/shared/state';

export interface RockPart extends MeshPlacement {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  size: number;
}

export function stoneParts(id: string, footprint: Footprint | undefined, bog: boolean): RockPart[] {
  const suffix = Number(id.slice(id.lastIndexOf('-') + 1)) || 0;
  const rand = mulberry32((suffix * 977 + (bog ? 41 : 29)) >>> 0);
  const radius =
    footprint == null
      ? 0.8
      : footprint.kind === 'circle'
        ? footprint.r
        : Math.min(footprint.hx, footprint.hz);
  const size = radius / 0.82;
  function rock(size: number, x: number, z: number): RockPart {
    const sx = size * (0.85 + rand() * 0.3);
    const sy = size * (bog ? 0.42 + rand() * 0.08 : 0.55 + rand() * 0.12);
    const sz = size * (0.78 + rand() * 0.28);
    const phase = rand() * 6.283;
    const mesh = sphereMesh(32, 22);
    for (let i = 0; i < mesh.position.length; i += 3) {
      const x = mesh.position[i],
        y = mesh.position[i + 1],
        z = mesh.position[i + 2];
      const swell =
        1 +
        0.1 * Math.sin(x * 4.7 + phase) +
        0.06 * Math.cos(y * 5.3 - phase * 1.7) +
        0.05 * Math.sin((x + z) * 6.1 + phase * 0.7) +
        0.03 * Math.cos(z * 9.2 + x * 3.1);
      mesh.position.set([x * swell * sx, y * swell * sy, z * swell * sz], i);
    }
    mesh.normal = meshNormals(mesh.position, mesh.index);
    return {
      mesh,
      skin: 0.004 * size + 0.003,
      size,
      position: { x, y: sy * (bog ? 0.62 : 0.74), z },
      rotation: { x: 0, y: rand() * Math.PI * 2, z: 0 },
    };
  }
  const parts = [rock(size, 0, 0)];
  const satellites = 1 + Math.floor(rand() * 2);
  for (let k = 0; k < satellites; k++) {
    const angle = rand() * Math.PI * 2,
      reach = size * (0.75 + rand() * 0.35);
    parts.push(
      rock(size * (0.28 + rand() * 0.18), Math.cos(angle) * reach, Math.sin(angle) * reach),
    );
  }
  return parts;
}

const cache = new WeakMap<
  EntityState,
  {
    bog: boolean;
    footprint: Footprint | undefined;
    blocks: Block[];
    surface: (x: number, z: number) => number;
  }
>();
function collision(entity: EntityState, bog: boolean) {
  const old = cache.get(entity);
  if (old && old.bog === bog && old.footprint === entity.footprint) return old;
  const parts = stoneParts(entity.id, entity.footprint, bog);
  const blocks = parts.map((part, index): Block => {
    let minX = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxZ = -Infinity,
      height = -Infinity;
    const c = Math.cos(part.rotation.y),
      s = Math.sin(part.rotation.y);
    const { position, normal } = part.mesh;
    for (let i = 0; i < position.length; i += 3) {
      const x = position[i] + normal[i] * part.skin,
        y = position[i + 1] + normal[i + 1] * part.skin,
        z = position[i + 2] + normal[i + 2] * part.skin;
      const wx = part.position.x + x * c + z * s,
        wz = part.position.z - x * s + z * c;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
      height = Math.max(height, part.position.y + y);
    }
    return { id: `rock-${index}`, minX, minZ, maxX, maxZ, height };
  });
  const value = {
    bog,
    footprint: entity.footprint,
    blocks,
    surface: meshSurface(parts.flatMap((part) => [part, { ...part, skin: 0 }])),
  };
  cache.set(entity, value);
  return value;
}
export function stoneBoxes(entity: EntityState, bog = false): readonly Block[] {
  return collision(entity, bog).blocks;
}
export function stoneSupport(entity: EntityState, x: number, z: number, bog = false): number {
  const shape = collision(entity, bog);
  const lx = x - entity.x,
    lz = z - entity.z;
  if (
    !shape.blocks.some(
      (block) => lx >= block.minX && lx <= block.maxX && lz >= block.minZ && lz <= block.maxZ,
    )
  )
    return Number.NEGATIVE_INFINITY;
  return entity.y + shape.surface(lx, lz);
}
