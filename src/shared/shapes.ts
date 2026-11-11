import type { Block } from '@/src/shared/state';

/** Local-space compound collision geometry, reusable by any registered kind. */
export function ringBoxes({
  segments,
  radius,
  half,
  thickness,
  door,
  gap,
  height,
}: {
  segments: number;
  radius: number;
  half: number;
  thickness: number;
  door: number;
  gap: number;
  height: number;
}): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const away = Math.abs(Math.atan2(Math.sin(angle - door), Math.cos(angle - door)));
    if (away < gap) continue;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const ex = Math.abs(Math.sin(angle) * half) + Math.abs(Math.cos(angle) * thickness);
    const ez = Math.abs(Math.cos(angle) * half) + Math.abs(Math.sin(angle) * thickness);
    blocks.push({
      id: String(i),
      minX: cx - ex,
      maxX: cx + ex,
      minZ: cz - ez,
      maxZ: cz + ez,
      height,
    });
  }
  return blocks;
}
