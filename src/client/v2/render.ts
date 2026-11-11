import type { WorldView } from '@/src/shared/v2/world';
import type { Point } from '@/src/shared/v2/physics';

interface Model {
  readonly label: string;
  readonly color: string;
  readonly light: string;
  readonly details: readonly (readonly [
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ])[];
}

export const models: Record<string, Model> = {
  apple: {
    label: '苹果',
    color: '#d7735b',
    light: '#ffa887',
    details: [
      ['#564133', 0, -12, 2, 5],
      ['#a6b35a', 2, -11, 5, 2],
    ],
  },
  pebble: { label: '石子', color: '#809892', light: '#c5d1c7', details: [] },
  berry: {
    label: '浆果',
    color: '#a56bce',
    light: '#e5b4ee',
    details: [['#a6b35a', 0, -8, 4, 3]],
  },
  wall: { label: '石墙', color: '#6b7b73', light: '#a8b5a4', details: [] },
  nest: {
    label: '巢穴',
    color: '#8d7052',
    light: '#c2a87b',
    details: [
      ['#67513e', -14, -4, 28, 3],
      ['#564333', -8, 5, 16, 12],
      ['#2e2c28', -5, 7, 10, 10],
    ],
  },
};

function rect(
  ctx: CanvasRenderingContext2D,
  color: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), w, h);
}

export function drawGround(ctx: CanvasRenderingContext2D, size: Point): void {
  const grass = ['#315646', '#355a48', '#3a604c'];
  const tile = 8;
  for (let y = 0; y < size.y; y += tile) {
    for (let x = 0; x < size.x; x += tile) {
      const hash = (x * 17 + y * 43 + x * y * 7) % 29;
      const shore = 45 + Math.round(13 * Math.cos(y / 28));
      if (x < shore) {
        rect(ctx, hash % 3 ? '#245b60' : '#2b6468', x, y, tile, tile);
        if (hash % 5 === 0) rect(ctx, '#488588', x + 1, y + 4, 5, 1);
      } else if (x < 310 && Math.abs(y - 116) < 21) {
        rect(ctx, hash % 3 ? '#7b7750' : '#817e55', x, y, tile, tile);
        if (hash % 4 === 0) rect(ctx, '#969166', x + 2, y + 2, 3, 1);
      } else {
        rect(ctx, grass[hash % grass.length], x, y, tile, tile);
        if (hash % 5 === 0) {
          rect(ctx, '#597653', x + 3, y + 3, 2, 3);
          rect(ctx, '#6a875b', x + 5, y + 5, 1, 2);
        }
      }
    }
  }
}

function drawSpider(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  rect(ctx, '#4d4c33', x - 15, y + 7, 30, 4);
  for (const side of [-1, 1]) {
    for (let leg = 0; leg < 4; leg++) {
      const offset = (leg - 2) * 5;
      const stride = Math.round(Math.sin((x + y) / 4 + (leg + side) * Math.PI) * 1.5);
      rect(ctx, '#3c2e28', x + offset + stride, y + side * 9 - 2, 4, 6);
      rect(ctx, '#c89563', x + offset + stride, y + side * 10, 3, 3);
    }
  }
  rect(ctx, '#392d26', x - 11, y - 6, 22, 14);
  rect(ctx, '#c18853', x - 10, y - 7, 13, 13);
  rect(ctx, '#e7ad6c', x - 9, y - 5, 8, 5);
  rect(ctx, '#f0c383', x + 1, y - 5, 10, 11);
  rect(ctx, '#362927', x + 8, y - 3, 2, 2);
  rect(ctx, '#362927', x + 8, y + 2, 2, 2);
}

export function render(
  ctx: CanvasRenderingContext2D,
  ground: HTMLCanvasElement,
  view: WorldView,
  selected: string,
): void {
  ctx.drawImage(ground, 0, 0);
  const spider = view.actor.body;
  const cargo = view.items.find((item) => item.id === view.tether);
  if (cargo) {
    ctx.beginPath();
    ctx.moveTo(spider.x, spider.y);
    ctx.lineTo(cargo.body.x, cargo.body.y);
    ctx.strokeStyle = '#eff5bb';
    ctx.stroke();
  }

  for (const entity of [...view.obstacles, ...view.items]) {
    const { x, y, radius: r } = entity.body;
    const model = models[entity.modelId];
    rect(ctx, '#293c35', x - r, y + r - 3, 2 * r + 2, 5);
    rect(ctx, model.color, x - r + 3, y - r, 2 * r - 6, 2 * r);
    rect(ctx, model.color, x - r + 1, y - r + 2, 2 * r - 2, 2 * r - 4);
    rect(ctx, model.light, x - r + 3, y - r + 2, 2 * r - 6, 3);
    for (const [color, dx, dy, width, height] of model.details) {
      rect(ctx, color, x + dx, y + dy, width, height);
    }
    if (entity.id === selected) {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = '#e4f8a2';
      ctx.strokeRect(Math.round(x) - r - 4, Math.round(y) - r - 4, 2 * r + 8, 2 * r + 8);
      ctx.setLineDash([]);
    }
  }
  drawSpider(ctx, spider.x, spider.y);
}
