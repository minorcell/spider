import { expect, test, vi } from 'vitest';
import { mount } from '@/src/client/v2/main';

const label = () => document.getElementById('target')!.textContent;
const status = () => document.getElementById('status')!.textContent;
const dispatchKey = (type: string, key: string, repeat = false) =>
  window.dispatchEvent(new KeyboardEvent(type, { key, repeat }));
const button = (id: string) => document.querySelector<HTMLButtonElement>('#' + id)!;

test('plays the island with keyboard movement, pointer selection and both action controls', () => {
  const context = {
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    strokeRect: vi.fn(),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
  document.body.innerHTML =
    '<canvas></canvas><strong id="target"></strong><div id="status"></div>' +
    '<button id="tether"></button><button id="eat"></button>';
  const canvas = document.querySelector('canvas')!;
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 224));
  let advance!: FrameRequestCallback;
  vi.spyOn(window.performance, 'now').mockReturnValue(0);
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    advance = callback;
    return 1;
  });

  const click = (x: number, y: number) =>
    canvas.dispatchEvent(new MouseEvent('click', { clientX: x, clientY: y }));

  mount(document);
  expect(label()).toBe('苹果 · 已吃 0 口');
  advance(5);
  button('tether').click();
  expect(status()).toContain('蛛丝已连接');
  expect(context.stroke).toHaveBeenCalled();
  dispatchKey('keydown', 'f', true);
  expect(label()).toBe('苹果 · 已吃 0 口');
  dispatchKey('keydown', 'f');
  dispatchKey('keyup', 'f');
  expect(label()).toBe('苹果 · 已吃 1 口');
  dispatchKey('keydown', 'e');
  expect(status()).toContain('蛛丝已松开');

  click(119, 116);
  advance(40);
  dispatchKey('keydown', 'ArrowRight');
  advance(80);
  dispatchKey('keyup', 'ArrowRight');
  dispatchKey('keydown', 'w');
  window.dispatchEvent(new Event('blur'));
  click(207, 91);
  expect(label()).toBe('石子');
  for (let ms = 100; ms <= 1350; ms += 20) advance(ms);
  button('eat').click();
  expect(status()).toBe('这个物品没有食物能力。');

  click(218, 151);
  for (let ms = 1370; ms <= 2200; ms += 20) advance(ms);
  expect(label()).toBe('浆果 · 已吃 0 口');
  button('tether').click();
  expect(status()).toBe('这个物品没有牵引能力。');
  button('eat').click();
  button('eat').click();
  expect(label()).toBe('点选物品');
});
