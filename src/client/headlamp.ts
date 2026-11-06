import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  type Object3D,
} from 'three';
import { DECK_Y } from '../shared/config.js';
import { FRONT_EYES } from '../shared/sim/spiderBody.js';
import { dayBrightness } from './ecologyView.js';
import type { WorldClock } from '../shared/ecology.js';

// Decay is 1, not the physical 2. Inverse-square either whites out the face
// or dies before it can light the ground around the feet.
const POOL = { color: 0xffc56a, distance: 6.5, decay: 1 } as const;
const EYE_LIGHT = 1.5;
const BACK_LIGHT = 1.8;

/** Eyes in front, a larger lantern on the back. The spider turns both on. */
export class Headlamp {
  readonly eyes = new Group();
  readonly back = new Group();
  readonly eyeLight: PointLight;
  readonly backLight: PointLight;
  readonly #eyeGeo = new SphereGeometry(0.045, 12, 8);
  readonly #capGeo = new CylinderGeometry(0.08, 0.1, 0.14, 10);
  readonly #bulbGeo = new SphereGeometry(0.075, 14, 10);
  readonly #cap: MeshBasicMaterial;
  readonly #glow: MeshBasicMaterial;

  constructor() {
    this.eyes.name = 'headlamp-eyes';
    this.back.name = 'headlamp-back';
    this.#cap = new MeshBasicMaterial({ color: 0x6b4a32 });
    this.#glow = new MeshBasicMaterial({ color: POOL.color, toneMapped: false });
    for (const [x, y, z] of FRONT_EYES) {
      const lens = new Mesh(this.#eyeGeo, this.#glow);
      lens.name = 'headlamp-eye';
      // Sit on the eye, a little proud of the face so the lens reads.
      lens.position.set(x, y, z - 0.02);
      this.eyes.add(lens);
    }
    this.eyeLight = new PointLight(POOL.color, 0, POOL.distance, POOL.decay);
    this.eyeLight.name = 'headlamp-eye-light';
    this.eyeLight.position.set(0, FRONT_EYES[0][1], FRONT_EYES[0][2] - 0.02);
    this.eyes.add(this.eyeLight);

    const cap = new Mesh(this.#capGeo, this.#cap);
    cap.name = 'headlamp-back-cap';
    const bulb = new Mesh(this.#bulbGeo, this.#glow);
    bulb.name = 'headlamp-back-bulb';
    bulb.position.y = 0.1;
    this.backLight = new PointLight(POOL.color, 0, POOL.distance, POOL.decay);
    this.backLight.name = 'headlamp-back-light';
    this.backLight.position.copy(bulb.position);
    this.back.add(cap, bulb, this.backLight);
    // Top of the abdomen, toward the spinnerets. +z is the back.
    this.back.position.set(0, DECK_Y + 0.46, 1.05);
    this.eyes.visible = false;
    this.back.visible = false;
  }

  /** The eyes yaw with the head. The back lantern stays on the abdomen. */
  attach(spider: { root: Object3D; chassis: Object3D }): void {
    const head = spider.root.getObjectByName('head');
    if (head) head.add(this.eyes);
    spider.chassis.add(this.back);
  }

  update(clock: WorldClock, on: boolean): void {
    const darkness = 1 - dayBrightness(clock);
    const lit = on && darkness > 0.04;
    this.eyes.visible = lit;
    this.back.visible = lit;
    const strength = lit ? darkness : 0;
    this.eyeLight.intensity = EYE_LIGHT * strength;
    this.backLight.intensity = BACK_LIGHT * strength;
    const glow = 0.25 + 0.75 * strength;
    this.#glow.color.setRGB(glow, glow * 0.82, glow * 0.45);
  }

  dispose(): void {
    this.eyes.removeFromParent();
    this.back.removeFromParent();
    this.#cap.dispose();
    this.#glow.dispose();
    this.#eyeGeo.dispose();
    this.#capGeo.dispose();
    this.#bulbGeo.dispose();
  }
}
