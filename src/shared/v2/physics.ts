export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Body extends Point {
  x: number;
  y: number;
  vx: number;
  vy: number;
  readonly radius: number;
  readonly inverseMass: number;
  readonly drag: number;
}

export const STEP = 1 / 60;

function separate(a: Body, b: Body): void {
  const weight = a.inverseMass + b.inverseMass;
  if (weight === 0) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy);
  const overlap = a.radius + b.radius - distance;
  if (overlap <= 0) return;

  // A stable normal also separates bodies that start at the same position.
  const nx = distance === 0 ? 1 : dx / distance;
  const ny = distance === 0 ? 0 : dy / distance;
  const correction = overlap / weight;
  a.x -= nx * correction * a.inverseMass;
  a.y -= ny * correction * a.inverseMass;
  b.x += nx * correction * b.inverseMass;
  b.y += ny * correction * b.inverseMass;

  const relativeSpeed = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
  const impulse = Math.max(0, -relativeSpeed) / weight;
  a.vx -= nx * impulse * a.inverseMass;
  a.vy -= ny * impulse * a.inverseMass;
  b.vx += nx * impulse * b.inverseMass;
  b.vy += ny * impulse * b.inverseMass;
}

function contain(body: Body, size: Point): void {
  const x = Math.min(size.x - body.radius, Math.max(body.radius, body.x));
  const y = Math.min(size.y - body.radius, Math.max(body.radius, body.y));
  if (x !== body.x) body.vx = 0;
  if (y !== body.y) body.vy = 0;
  body.x = x;
  body.y = y;
}

export function solve(bodies: readonly Body[], size: Point): void {
  for (const body of bodies) {
    if (body.inverseMass === 0) continue;
    const damping = Math.exp(-body.drag * STEP);
    body.vx *= damping;
    body.vy *= damping;
    body.x += body.vx * STEP;
    body.y += body.vy * STEP;
  }
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) separate(bodies[a], bodies[b]);
  }
  for (const body of bodies) {
    if (body.inverseMass > 0) contain(body, size);
  }
}

export function pull(anchor: Point, target: Body, length: number): void {
  const dx = anchor.x - target.x;
  const dy = anchor.y - target.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= length) return;
  const stretch = (distance - length) / distance;
  target.vx += dx * stretch * 28 * STEP * target.inverseMass;
  target.vy += dy * stretch * 28 * STEP * target.inverseMass;
}
