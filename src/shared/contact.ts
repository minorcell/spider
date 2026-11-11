import { CONTACT } from '@/src/shared/config';

const SLOPE = 0.6;

export function groundSupport(
  height: (x: number, z: number) => number,
  x: number,
  z: number,
  radius: number,
): number {
  const ground = height(x, z);
  if (radius <= 0) return ground;
  const gx = (height(x + SLOPE, z) - height(x - SLOPE, z)) / (2 * SLOPE);
  const gz = (height(x, z + SLOPE) - height(x, z - SLOPE)) / (2 * SLOPE);
  const lift = radius * (Math.sqrt(1 + gx * gx + gz * gz) - 1);
  return ground + lift + CONTACT;
}

import type { Block, Vec3 } from '@/src/shared/state';

/** Resolve a small spherical probe against registered static columns, in world space. */
export function pushFromBlocks(
  at: Vec3,
  radius: number,
  blocks: readonly Block[],
  out: Vec3,
  heightAt: (block: Block, x: number, z: number) => number = (block) => block.height,
): boolean {
  out.x = out.y = out.z = 0;
  for (const block of blocks) {
    const x = at.x + out.x,
      y = at.y + out.y,
      z = at.z + out.z;
    if (
      y - radius >= block.height ||
      x + radius <= block.minX ||
      x - radius >= block.maxX ||
      z + radius <= block.minZ ||
      z - radius >= block.maxZ
    )
      continue;
    const height = heightAt(block, x, z);
    if (y - radius >= height) continue;
    const faces = [
      { x: block.minX - radius - x, y: 0, z: 0 },
      { x: block.maxX + radius - x, y: 0, z: 0 },
      { x: 0, y: 0, z: block.minZ - radius - z },
      { x: 0, y: 0, z: block.maxZ + radius - z },
      { x: 0, y: height + radius - y, z: 0 },
    ];
    let best = faces[0],
      distance = Infinity;
    for (const face of faces) {
      const squared = face.x * face.x + face.y * face.y + face.z * face.z;
      if (squared < distance) {
        distance = squared;
        best = face;
      }
    }
    out.x += best.x;
    out.y += best.y;
    out.z += best.z;
  }
  return Math.abs(out.x) + Math.abs(out.y) + Math.abs(out.z) > 1e-8;
}
