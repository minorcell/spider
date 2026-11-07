import { CylinderGeometry, Group, Mesh, MeshBasicMaterial, PointLight, type Object3D } from 'three';
import { DECK_Y } from '../shared/config.js';
import { dayBrightness } from './ecologyView.js';
import type { WorldClock } from '../shared/ecology.js';

const POOL = { color: 0xffc56a, intensity: 2.6, distance: 6.5, decay: 1 } as const;

export class Headlamp {
  readonly pack = new Group();
  readonly light: PointLight;
  readonly #plateGeo = new CylinderGeometry(0.15, 0.16, 0.03, 20);
  readonly #lensGeo = new CylinderGeometry(0.09, 0.09, 0.012, 20);
  readonly #plate: MeshBasicMaterial;
  readonly #glow: MeshBasicMaterial;

  constructor() {
    this.pack.name = 'headlamp';
    this.#plate = new MeshBasicMaterial({ color: 0x6b4a32 });
    this.#glow = new MeshBasicMaterial({ color: POOL.color, toneMapped: false });
    const plate = new Mesh(this.#plateGeo, this.#plate);
    plate.name = 'headlamp-plate';
    const lens = new Mesh(this.#lensGeo, this.#glow);
    lens.name = 'headlamp-lens';
    lens.position.y = 0.016;
    this.light = new PointLight(POOL.color, 0, POOL.distance, POOL.decay);
    this.light.name = 'headlamp-light';
    this.light.position.y = 0.05;
    this.pack.add(plate, lens, this.light);
    this.pack.position.set(0, DECK_Y + 0.2, -0.05);
    this.pack.visible = false;
  }

  attach(spider: { chassis: Object3D }): void {
    spider.chassis.add(this.pack);
  }

  update(clock: WorldClock, on: boolean): void {
    const darkness = 1 - dayBrightness(clock);
    const lit = on && darkness > 0.04;
    this.pack.visible = lit;
    const strength = lit ? darkness : 0;
    this.light.intensity = POOL.intensity * strength;
    const glow = 0.25 + 0.75 * strength;
    this.#glow.color.setRGB(glow, glow * 0.82, glow * 0.45);
  }

  dispose(): void {
    this.pack.removeFromParent();
    this.#plate.dispose();
    this.#glow.dispose();
    this.#plateGeo.dispose();
    this.#lensGeo.dispose();
  }
}
