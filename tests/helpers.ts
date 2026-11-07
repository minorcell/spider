import type { Block } from '../src/shared/state.js';

export function block(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height = 2,
): Block {
  return { id, minX, maxX, minZ, maxZ, height };
}

export const flat = (): number => 0;

export function pump(session: { frame(dt: number): void }, steps: number, dt = 1 / 60): void {
  for (let i = 0; i < steps; i++) session.frame(dt);
}
