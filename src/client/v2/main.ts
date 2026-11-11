import { island, islandItems } from '@/src/shared/v2/island';
import { STEP, type Point } from '@/src/shared/v2/physics';
import { World, type Action, type Result } from '@/src/shared/v2/world';
import { drawGround, models, render } from './render';

const directions = new Map<string, Point>([
  ['w', { x: 0, y: -1 }],
  ['a', { x: -1, y: 0 }],
  ['s', { x: 0, y: 1 }],
  ['d', { x: 1, y: 0 }],
  ['arrowup', { x: 0, y: -1 }],
  ['arrowleft', { x: -1, y: 0 }],
  ['arrowdown', { x: 0, y: 1 }],
  ['arrowright', { x: 1, y: 0 }],
]);

const messages: Record<Result, string> = {
  attached: '蛛丝已连接。走几步，看物品跟上来。',
  released: '蛛丝已松开，物品保留原来的速度。',
  bite: '吃了一口，进食进度已记录。',
  finished: '吃完了，世界移除了这个物品。',
  missing: '这个物品已离开场景。点选另一个物品。',
  'out-of-reach': '再靠近一点。',
  'not-carryable': '这个物品没有牵引能力。',
  'not-edible': '这个物品没有食物能力。',
};

export function mount(doc: Document): void {
  const win = doc.defaultView!;
  const canvas = doc.querySelector('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const ground = doc.createElement('canvas');
  ground.width = canvas.width = island.size.x;
  ground.height = canvas.height = island.size.y;
  drawGround(ground.getContext('2d')!, island.size);
  const world = new World(island, islandItems, Date.now());
  const target = doc.querySelector<HTMLElement>('#target')!;
  const status = doc.querySelector<HTMLElement>('#status')!;
  const tether = doc.querySelector<HTMLButtonElement>('#tether')!;
  const eat = doc.querySelector<HTMLButtonElement>('#eat')!;
  const pressed = new Set<Point>();
  let selected = island.items[0].id;
  let destination: Point | undefined;
  let view = world.view();

  function update(): void {
    view = world.view();
    const item = view.items.find((entry) => entry.id === selected);
    const label = item
      ? models[item.modelId].label + (item.type.food ? ' · 已吃 ' + item.bites + ' 口' : '')
      : '点选物品';
    const tetherLabel = view.tether === selected ? '松开蛛丝 · E' : '挂上蛛丝 · E';
    if (target.textContent !== label) target.textContent = label;
    if (tether.textContent !== tetherLabel) tether.textContent = tetherLabel;
    render(ctx, ground, view, selected);
  }

  function act(action: Action): void {
    status.textContent = messages[world.act(action, selected)];
    update();
  }

  function motion(): Point {
    if (destination) {
      const body = view.actor.body;
      const x = destination.x - body.x;
      const y = destination.y - body.y;
      if (Math.hypot(x, y) > 4) return { x, y };
      destination = undefined;
    }
    let x = 0;
    let y = 0;
    for (const direction of pressed) {
      x += direction.x;
      y += direction.y;
    }
    return { x, y };
  }

  canvas.addEventListener('click', (event) => {
    const box = canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left) * canvas.width) / box.width;
    const y = ((event.clientY - box.top) * canvas.height) / box.height;
    const item = view.items.find(
      ({ body }) => Math.hypot(body.x - x, body.y - y) <= body.radius + 6,
    );
    if (item) selected = item.id;
    destination = { x, y };
    update();
  });
  win.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    const direction = directions.get(key);
    if (direction) {
      event.preventDefault();
      destination = undefined;
      pressed.add(direction);
    }
    if (event.repeat) return;
    if (key === 'e') act('tether');
    if (key === 'f') act('eat');
  });
  win.addEventListener('keyup', (event) => {
    const direction = directions.get(event.key.toLowerCase());
    if (direction) pressed.delete(direction);
  });
  win.addEventListener('blur', () => pressed.clear());
  tether.addEventListener('click', () => act('tether'));
  eat.addEventListener('click', () => act('eat'));

  let last = win.performance.now();
  let pending = 0;
  function frame(now: number): void {
    pending = Math.min(pending + (now - last) / 1000, STEP * 3);
    last = now;
    if (pending >= STEP) {
      const move = motion();
      const wallNow = Date.now();
      while (pending >= STEP) {
        world.step(move, wallNow);
        pending -= STEP;
      }
      update();
    }
    win.requestAnimationFrame(frame);
  }
  update();
  win.requestAnimationFrame(frame);
}
