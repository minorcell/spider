import { tetherAnchor } from '@/src/shared/sim/tether';
import type { Spider } from '@/src/shared/sim/Spider';
import type { EntityState, Observation, WorldState } from '@/src/shared/state';
import { insideLand, surfaceOf, TERRAIN } from '@/src/shared/terrain';
import { EYE_HEIGHT, sightOutline } from '@/src/shared/sight';
import { kindOf, STONE_PIXELS } from '@/src/shared/kinds';
import { REACH } from '@/src/shared/world';

export const PIXEL = 3;
const TILE = 0.5;
const MAP_SIZE = (2 * TERRAIN.half) / TILE;
const TEXELS = 2;
const SEA = '#21464c';
const LAND = ['#78845a', '#808759', '#4e744d', '#486c48', '#5e7e57', '#708958'];
const WATER = ['#28616c', '#2e7178', '#3b807d'];

export interface Projection {
  readonly x: number;
  readonly z: number;
  readonly scale: number;
  readonly width: number;
  readonly height: number;
}

interface Point {
  readonly x: number;
  readonly z: number;
}

export function project(view: Projection, point: Point): { x: number; y: number } {
  return {
    x: Math.round((point.x - view.x) * view.scale + view.width / 2),
    y: Math.round((point.z - view.z) * view.scale + view.height / 2),
  };
}

function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(
    Math.round(x),
    Math.round(y),
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
}

function ground(ctx: CanvasRenderingContext2D, terrain: WorldState['terrain']): void {
  rect(ctx, SEA, 0, 0, MAP_SIZE * TEXELS, MAP_SIZE * TEXELS);
  for (let row = 0; row < MAP_SIZE; row++) {
    const z = (row + 0.5) * TILE - TERRAIN.half;
    for (let col = 0; col < MAP_SIZE; col++) {
      const x = (col + 0.5) * TILE - TERRAIN.half;
      const salt = (row * 61 + col * 31 + row * col * 7) % 23;
      const px = col * TEXELS;
      const py = row * TEXELS;
      if (!insideLand(terrain, x, z)) {
        if (salt === 0) rect(ctx, '#2e5f65', px, py, TEXELS, 1);
        continue;
      }
      const h = terrain.height(x, z);
      const shade = (salt % 8) * 0.065;
      const palette =
        h < TERRAIN.water
          ? WATER[Math.min(2, Math.floor(Math.max(0, h - TERRAIN.water + 1.3 + shade) * 2.3))]
          : LAND[Math.min(LAND.length - 1, Math.floor(Math.max(0, h + 0.9 + shade) * 2))];
      rect(ctx, palette, px, py, TEXELS, TEXELS);
      if (salt % 7 === 0) {
        rect(ctx, h < TERRAIN.water ? '#4b8b8e' : '#779158', px + 1, py, 1, 1);
      }
    }
  }
}

function drawProp(ctx: CanvasRenderingContext2D, view: Projection, entity: EntityState): void {
  const spec = kindOf(entity.kind);
  const model = spec?.pixels ?? STONE_PIXELS;
  if (model === false) return;
  const at = project(view, entity);
  if (at.x < -16 || at.y < -16 || at.x > view.width + 16 || at.y > view.height + 16) return;
  const body = spec?.physics;
  const footprint = entity.footprint;
  const radius = footprint?.kind === 'circle' ? footprint.r : body?.radius || 0.42;
  const r = Math.max(1, Math.round(radius * view.scale));
  const { x, y } = at;
  if (model.shape === 'grass') {
    for (let i = -2; i <= 2; i++) {
      const dx = i * r * 0.34;
      const rise = r * (0.45 + 0.15 * Math.abs(i));
      rect(ctx, model.shade, x + dx, y - rise / 2, r * 0.3, rise);
      rect(ctx, model.base, x + dx + 1, y - rise, r * 0.15, rise);
      rect(ctx, model.top, x + dx + 1, y - rise, r * 0.15, 1);
    }
    return;
  }
  if (model.shape === 'tree') {
    rect(ctx, '#6d5944', x - r * 0.18, y - r, r * 0.36, r * 1.22);
    rect(ctx, model.shade, x - r, y - r * 1.4, r * 2, r);
    rect(ctx, model.base, x - r * 0.8, y - r * 2.05, r * 1.6, r * 1.4);
    rect(ctx, model.top, x - r * 0.54, y - r * 2.08, r * 1.08, r * 0.42);
    rect(ctx, model.top, x - r * 0.77, y - r * 1.4, r * 0.38, r * 0.22);
    return;
  }
  const height = Math.max(2, r + 1 - entity.stage);
  rect(ctx, '#263e32', x - r + 1, y, r * 2, Math.max(1, r / 2));
  rect(ctx, model.shade, x - r, y - height + 1, r * 2 + 1, height + 1);
  rect(ctx, model.base, x - r + 1, y - height + 1, r * 2 - 1, height - 1);
  rect(ctx, model.top, x - r + 2, y - height, r * 2 - 3, 1);
  if (model.shape === 'fruit') {
    rect(ctx, '#3d4f34', x, y - height - 2, 1, 2);
    rect(ctx, '#a3a65e', x + 1, y - height - 2, 2, 1);
  }
}

function drawSpider(ctx: CanvasRenderingContext2D, view: Projection, spider: Spider): void {
  const center = project(view, spider.root.position);
  const scale = view.scale;
  ctx.strokeStyle = '#322923';
  ctx.lineWidth = Math.max(1, scale * 0.3);
  for (const leg of spider.legs) {
    const foot = project(view, leg.foot);
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo((center.x + foot.x) / 2, (center.y + foot.y) / 2 - scale * 0.25);
    ctx.lineTo(foot.x, foot.y);
    ctx.stroke();
    rect(ctx, leg.lifted ? '#e7ab66' : '#b78555', foot.x, foot.y, scale * 0.23, scale * 0.23);
  }

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(-spider.yaw);
  const s = Math.max(2, scale);
  rect(ctx, '#302823', -s * 0.83, -s * 0.75, s * 1.66, s * 2.27);
  rect(ctx, '#b98051', -s * 0.66, s * 0.03, s * 1.32, s * 1.35);
  rect(ctx, '#ddaa6c', -s * 0.58, s * 0.05, s, s * 0.66);
  rect(ctx, '#efc581', -s * 0.58, -s * 0.8, s * 1.16, s * 0.86);
  rect(ctx, '#342829', -s * 0.4, -s * 0.67, 1, 1);
  rect(ctx, '#342829', s * 0.25, -s * 0.67, 1, 1);
  ctx.restore();
}

export function observeOutline(world: WorldState, observation: Observation): Point[] {
  const { x, z, height } = observation.self;
  return sightOutline(
    x,
    z,
    surfaceOf(world.terrain, x, z) + EYE_HEIGHT + height,
    observation.view,
    (px, pz) => world.terrain.height(px, pz),
    world.blocks,
    72,
  );
}

export class PixelIsland {
  readonly #ctx: CanvasRenderingContext2D;
  readonly #ground: HTMLCanvasElement;
  readonly #groundCtx: CanvasRenderingContext2D;
  #terrain: WorldState['terrain'] | undefined;

  constructor(canvas: HTMLCanvasElement) {
    this.#ctx = canvas.getContext('2d', { alpha: false })!;
    this.#ground = canvas.ownerDocument.createElement('canvas');
    this.#ground.width = this.#ground.height = MAP_SIZE * TEXELS;
    this.#groundCtx = this.#ground.getContext('2d', { alpha: false })!;
  }

  draw(
    view: Projection,
    world: WorldState,
    spider: Spider,
    darkness: number,
    observation: Observation | undefined,
    outline: readonly Point[],
  ): void {
    const ctx = this.#ctx;
    if (this.#terrain !== world.terrain) {
      ground(this.#groundCtx, world.terrain);
      this.#terrain = world.terrain;
    }
    ctx.imageSmoothingEnabled = false;
    rect(ctx, SEA, 0, 0, view.width, view.height);
    const edge = project(view, { x: -TERRAIN.half, z: -TERRAIN.half });
    const span = 2 * TERRAIN.half * view.scale;
    ctx.drawImage(this.#ground, edge.x, edge.y, span, span);

    for (const block of world.blocks) {
      if (!block.id.startsWith('nest-ring-')) continue;
      const at = project(view, { x: block.minX, z: block.minZ });
      const width = (block.maxX - block.minX) * view.scale;
      const height = (block.maxZ - block.minZ) * view.scale;
      rect(ctx, '#594d3b', at.x, at.y + 1, width + 1, height + 1);
      rect(ctx, '#ac9065', at.x, at.y, width, height);
      rect(ctx, '#c4a87b', at.x, at.y, width, 1);
    }
    const position = spider.root.position;
    const at = project(view, position);
    const spinneret = project(view, tetherAnchor(position, spider.yaw));
    for (const entity of world.entities.values()) {
      if (!world.tethers.has(entity.id)) continue;
      const end = project(view, entity);
      ctx.beginPath();
      ctx.moveTo(spinneret.x, spinneret.y);
      ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = '#e6efc3';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    for (const entity of world.entities.values()) drawProp(ctx, view, entity);
    if (spider.waterDepth > 0) {
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, 1.65 * view.scale, 1.3 * view.scale, 0, 0, Math.PI * 2);
      ctx.strokeStyle = '#89c4ba';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    drawSpider(ctx, view, spider);

    if (darkness > 0) {
      const shade = 'rgba(9, 19, 38, ' + darkness + ')';
      if (spider.lamp) {
        const lamp = ctx.createRadialGradient(
          at.x,
          at.y,
          0,
          at.x,
          at.y,
          Math.max(1, 5 * view.scale),
        );
        lamp.addColorStop(0, 'rgba(9, 19, 38, 0)');
        lamp.addColorStop(1, shade);
        ctx.fillStyle = lamp;
        ctx.fillRect(0, 0, view.width, view.height);
      } else {
        rect(ctx, shade, 0, 0, view.width, view.height);
      }
    }

    ctx.font = '6px monospace';
    if (observation) {
      ctx.beginPath();
      for (const point of outline) {
        const vertex = project(view, point);
        ctx.lineTo(vertex.x, vertex.y);
      }
      ctx.closePath();
      ctx.strokeStyle = '#e1f68d';
      ctx.fillStyle = '#a9d67922';
      ctx.lineWidth = 1;
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(at.x, at.y, REACH * view.scale, 0, 2 * Math.PI);
      ctx.stroke();
      for (const item of observation.entities) {
        const pin = project(view, item);
        const ink = item.inReach ? '#f9c483' : '#d4ec95';
        rect(ctx, ink, pin.x - 1, pin.y + 2, 3, 1);
        ctx.strokeStyle = '#23372f';
        ctx.lineWidth = 2;
        ctx.strokeText(item.id, pin.x + 3, pin.y - 3);
        ctx.fillStyle = ink;
        ctx.fillText(item.id, pin.x + 3, pin.y - 3);
      }
    }
    for (const mark of world.marks) {
      const pin = project(view, mark);
      rect(ctx, '#e8bb7b', pin.x - 1, pin.y - 1, 3, 3);
      ctx.strokeStyle = '#23372f';
      ctx.lineWidth = 2;
      ctx.strokeText(mark.name, pin.x + 3, pin.y + 2);
      ctx.fillStyle = '#fff4ce';
      ctx.fillText(mark.name, pin.x + 3, pin.y + 2);
    }
  }
}
