import { pull, solve, STEP, type Body, type Point } from './physics';

export interface ItemType {
  readonly modelId: string;
  readonly radius: number;
  readonly mass: number;
  readonly tetherable: boolean;
  readonly food?: Readonly<{ bites: number; nutrition: number }>;
  readonly lifetime?: Readonly<{ clock: 'simulation' | 'wall'; seconds: number }>;
}

interface Entity {
  readonly id: string;
  readonly body: Body;
  readonly modelId: string;
}

interface Item extends Entity {
  readonly type: ItemType;
  bites: number;
}

interface Tether {
  readonly target: Item;
  readonly length: number;
}

export interface Scene {
  readonly size: Point;
  readonly actor: Point;
  readonly obstacles: readonly (Point & { radius: number; modelId: string })[];
  readonly items: readonly (Point & { id: string; typeId: string })[];
}

export type Action = 'tether' | 'eat';
export type Result =
  | 'attached'
  | 'released'
  | 'bite'
  | 'finished'
  | 'missing'
  | 'out-of-reach'
  | 'not-carryable'
  | 'not-edible';

const REACH = 38;
const SPEED = 92;

function makeBody(point: Point, radius: number, inverseMass: number, drag: number): Body {
  return { x: point.x, y: point.y, vx: 0, vy: 0, radius, inverseMass, drag };
}

export class World {
  readonly size: Point;
  readonly #actor: Entity;
  readonly #obstacles: readonly Entity[];
  readonly #items = new Map<string, Item>();
  readonly #bodies: Body[];
  readonly #startedAt: number;
  #tether?: Tether;
  #tick = 0;
  #hunger = 25;

  constructor(scene: Scene, types: ReadonlyMap<string, ItemType>, wallNow: number) {
    this.size = scene.size;
    this.#startedAt = wallNow;
    this.#actor = { id: 'spider', body: makeBody(scene.actor, 9, 0.3, 0), modelId: 'spider' };
    this.#obstacles = scene.obstacles.map((entry, index) => ({
      id: 'obstacle-' + index,
      body: makeBody(entry, entry.radius, 0, 0),
      modelId: entry.modelId,
    }));
    this.#bodies = [this.#actor.body, ...this.#obstacles.map((entry) => entry.body)];
    for (const spawn of scene.items) {
      const type = types.get(spawn.typeId);
      if (!type) throw new Error('Unregistered item type: ' + spawn.typeId);
      if (this.#items.has(spawn.id)) throw new Error('Duplicate item: ' + spawn.id);
      const body = makeBody(spawn, type.radius, 1 / type.mass, 3);
      this.#bodies.push(body);
      this.#items.set(spawn.id, {
        id: spawn.id,
        type,
        modelId: type.modelId,
        body,
        bites: 0,
      });
    }
  }

  step(move: Point, wallNow: number): void {
    this.#tick++;
    for (const item of this.#items.values()) {
      const life = item.type.lifetime;
      if (!life) continue;
      const age = life.clock === 'wall' ? (wallNow - this.#startedAt) / 1000 : this.#tick * STEP;
      if (age >= life.seconds) this.#remove(item);
    }

    const actor = this.#actor.body;
    const magnitude = Math.max(1, Math.hypot(move.x, move.y));
    actor.vx = (move.x * SPEED) / magnitude;
    actor.vy = (move.y * SPEED) / magnitude;
    if (this.#tether) pull(actor, this.#tether.target.body, this.#tether.length);

    solve(this.#bodies, this.size);
  }

  act(action: Action, id: string): Result {
    const item = this.#items.get(id);
    if (!item) return 'missing';

    const attached = this.#tether?.target === item;
    if (action === 'tether' && attached) {
      this.#tether = undefined;
      return 'released';
    }

    const distance = Math.hypot(this.#actor.body.x - item.body.x, this.#actor.body.y - item.body.y);
    if (!attached && distance > REACH) return 'out-of-reach';
    if (action === 'tether') {
      if (!item.type.tetherable) return 'not-carryable';
      this.#tether = { target: item, length: Math.max(24, distance) };
      return 'attached';
    }

    const food = item.type.food;
    if (!food) return 'not-edible';
    item.bites++;
    this.#hunger = Math.max(0, this.#hunger - food.nutrition);
    if (item.bites < food.bites) return 'bite';
    this.#remove(item);
    return 'finished';
  }

  #remove(item: Item): void {
    if (this.#tether?.target === item) this.#tether = undefined;
    this.#items.delete(item.id);
    this.#bodies.splice(this.#bodies.indexOf(item.body), 1);
  }

  view() {
    return {
      actor: { ...this.#actor, body: { ...this.#actor.body } },
      obstacles: this.#obstacles.map((obstacle) => ({ ...obstacle, body: { ...obstacle.body } })),
      items: Array.from(this.#items.values(), (item) => ({ ...item, body: { ...item.body } })),
      tether: this.#tether?.target.id,
      hunger: this.#hunger,
    };
  }
}

export type WorldView = ReturnType<World['view']>;
