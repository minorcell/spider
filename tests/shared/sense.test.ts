import { describe, expect, it } from 'vitest';
import { senseBody } from '../../src/shared/sense.js';
import { block, flat } from '../helpers.js';

describe('senseBody', () => {
  it('looks straight down a clear field', () => {
    const felt = senseBody(0, 0, 0, 0, flat, []);
    expect(felt.ahead).toEqual({ open: 8, by: 'clear', id: null, kind: null });
    expect(felt.nearby).toEqual([]);
    expect(felt.ways).toEqual(['正前方可以走 8 米。']);
  });

  it('reports the wall it faces and the turns that clear it', () => {
    const wall = block('nest-n', -1, 1, -4, -2);
    const felt = senseBody(0, 0, 0, 0, flat, [wall]);
    expect(felt.ahead.by).toBe('wall');
    expect(felt.ahead.id).toBe('nest-n');
    expect(felt.ahead.kind).toBe('nest');
    expect(felt.ahead.open).toBe(1.75);
    expect(felt.ways.length).toBe(2);
    expect(felt.ways[0]).toBe('相对朝向转 45 度（正数顺时针）后，可以走 8 米。');
    expect(felt.ways[1]).toBe('相对朝向转 -45 度（正数顺时针）后，可以走 8 米。');
  });

  it('rounds bearings through 180 without a -180', () => {
    const felt = senseBody(0, 0, 0, 180, flat, []);
    expect(felt.ways).toEqual(['正前方可以走 8 米。']);
  });

  it('reports a slope that cannot be climbed', () => {
    const steep = (x: number, z: number): number => (z < -1 ? 10 + x : 0);
    const felt = senseBody(0, 0, 0, 0, steep, []);
    expect(felt.ahead.by).toBe('slope');
    expect(felt.ahead.kind).toBeNull();
  });

  it('overrides everything when the body stands inside a solid', () => {
    const wall = block('nest-n', -1, 1, -1, 1);
    const felt = senseBody(0, 0, 0, 0, flat, [wall]);
    expect(felt.ahead).toEqual({ open: 0, by: 'wall', id: 'nest-n', kind: 'nest' });
  });

  it('lists nearby solids nearest first and caps the list', () => {
    const blocks = [
      block('building-1', 2, 3, -1, 1),
      block('nest-2', -4, -3, -1, 1),
      block('building-3', -1, 1, 3, 4),
      block('building-4', -1, 1, -4, -3),
      block('building-5', 3, 4, 3, 4),
      block('building-6', -4, -3, 3, 4),
      block('building-7', -4, -3, -4, -3),
      block('building-8', 3, 4, -4, -3),
      block('building-9', 8, 9, -1, 1),
    ];
    const felt = senseBody(0, 0, 0, 0, flat, blocks);
    expect(felt.nearby.length).toBe(8);
    expect(felt.nearby[0].distance).toBeLessThanOrEqual(felt.nearby[1].distance);
    expect(felt.nearby.some((solid) => solid.kind === 'nest')).toBe(true);
    expect(felt.nearby.every((solid) => solid.distance <= 6)).toBe(true);
  });

  it('uses absolute turn lines when nothing ahead is open', () => {
    const blocks = [
      block('n', -1, 1, 1.5, 2.5),
      block('s', -1, 1, -2.5, -1.5),
      block('w', -2.5, -1.5, -1, 1),
      block('e', 1.5, 2.5, -1, 1),
    ];
    const felt = senseBody(0, 0, 0, 0, flat, blocks);
    expect(felt.ahead.open).toBeLessThan(2.5);
    expect(felt.ways[0].startsWith('周围都不远。')).toBe(true);
  });

  it('uses only the side lines when the front is short but a turn is open', () => {
    const blocks = [
      block('nest-n', -1, 1, -4, -2),
      block('building-w', -4, -2.2, -6, 6),
      block('building-e', 2.2, 4, -6, 6),
    ];
    const felt = senseBody(0, 0, 0, 0, flat, blocks);
    expect(felt.ahead.open).toBeLessThan(2.5);
    expect(felt.ways.length).toBeGreaterThan(0);
    expect(felt.ways[0]).toContain('相对朝向转');
  });

  it('measures nearby solids at their nearest corner', () => {
    const wall = block('building-1', 4, 5, 4, 5);
    const felt = senseBody(0, 0, 0, 0, flat, [wall]);
    expect(felt.nearby[0].distance).toBe(5.66);
    expect(felt.nearby[0].bearing).toBe(135);
  });
});
