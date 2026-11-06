import {
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
  Vector3,
  type ColorRepresentation,
  type Object3D,
} from 'three';
import { PALETTE } from '../shared/config.js';
import { worldClock, type WorldClock } from '../shared/ecology.js';
import { setGroundLight } from './groundView.js';

const daySky = new Color(PALETTE.paper);
const nightSky = new Color(0x172235);
const sky = new Color();
const cloudDay = new Color(0xf3f1eb);
const cloudNight = new Color(0x536277);

/** Daylight is sun elevation; paper brightness should settle well before noon. */
function dayBrightness(clock: WorldClock): number {
  return MathUtils.smoothstep(clock.daylight, 0, 0.35);
}

const CLOUD_STYLES = [
  [
    { x: -6, y: 0, z: 0, scale: 0.72 },
    { x: -2, y: 1.6, z: 0, scale: 1.05 },
    { x: 3, y: 2.1, z: 0, scale: 1.15 },
    { x: 8, y: 0.4, z: 0, scale: 0.84 },
    { x: 0, y: -0.8, z: 1.2, scale: 0.95 },
  ],
  [
    { x: -9, y: 0, z: 0, scale: 0.58 },
    { x: -5, y: 0.5, z: 0.2, scale: 0.82 },
    { x: 0, y: 0.2, z: 0, scale: 0.95 },
    { x: 5, y: 0.6, z: -0.2, scale: 0.78 },
    { x: 10, y: 0, z: 0, scale: 0.62 },
    { x: 2, y: -0.7, z: 1.1, scale: 0.75 },
  ],
  [
    { x: -4, y: 0, z: 0, scale: 0.8 },
    { x: 0, y: 2.2, z: 0, scale: 0.9 },
    { x: 4, y: 0.8, z: 0.4, scale: 0.75 },
    { x: -1, y: 3.8, z: -0.2, scale: 0.62 },
    { x: 2, y: -0.9, z: 1.2, scale: 0.78 },
  ],
  [
    { x: -7, y: 0, z: 0, scale: 0.5 },
    { x: -3, y: 1, z: 0, scale: 0.78 },
    { x: 1, y: 1.8, z: 0, scale: 0.82 },
    { x: 5, y: 1.2, z: 0, scale: 0.68 },
    { x: 8, y: 0.2, z: 0, scale: 0.46 },
    { x: 0, y: -0.8, z: 1.5, scale: 0.72 },
    { x: -2, y: 0.2, z: -1.2, scale: 0.56 },
  ],
] as const;

interface CloudSeed {
  x: number;
  z: number;
  y: number;
  scale: number;
  stretch: number;
  style: number;
  speed: number;
  phase: number;
}

function random(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function makeClouds(): CloudSeed[] {
  const next = random(0x51f15e);
  return Array.from({ length: 28 }, (_, index) => {
    const angle = next() * Math.PI * 2;
    const radius = Math.sqrt(next()) * 105;
    return {
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      y: 18 + next() * 16,
      scale: 0.75 + next() * 1.35,
      stretch: 0.75 + next() * 0.75,
      style: Math.floor(next() * CLOUD_STYLES.length),
      speed: 0.08 + next() * 0.2,
      phase: index * 1.73 + next() * Math.PI,
    };
  });
}

const CLOUDS = makeClouds();

/** Sky and unlit water follow the same clock as the directional light. */
export function applyEcologyLighting(
  renderer: { setClearColor(color: ColorRepresentation, alpha?: number): void },
  at = new Date(),
): WorldClock {
  const clock = worldClock(at);
  const brightness = dayBrightness(clock);
  sky.copy(nightSky).lerp(daySky, 0.18 + brightness * 0.82);
  renderer.setClearColor(sky, 1);
  const light = 0.42 + brightness * 0.58;
  setGroundLight(light * (0.84 + brightness * 0.16), light * (0.89 + brightness * 0.11), light);
  return clock;
}

/** Mark physical surfaces once, when added. Ink shells must not cast oversized shadows. */
export function enableWorldShadows(root: Object3D): void {
  root.traverse((node) => {
    if (node instanceof Mesh && node.material instanceof MeshLambertMaterial) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

/** One shadow map serves the sun by day and the opposite moon by night. */
export class EcologySky {
  readonly object = new Group();
  readonly clouds = new Group();
  readonly #cloudGeometry = new SphereGeometry(2.6, 10, 6);
  readonly #cloudMaterials = CLOUD_STYLES.map(
    (_, index) =>
      new MeshLambertMaterial({
        color: cloudDay,
        transparent: true,
        depthWrite: false,
        flatShading: true,
        opacity: 0.46 - index * 0.07,
      }),
  );
  readonly sun = new Mesh(
    new SphereGeometry(2.8, 24, 16),
    new MeshBasicMaterial({ color: 0xffd68a, fog: false, toneMapped: false }),
  );
  readonly moon = new Mesh(
    new SphereGeometry(2.1, 24, 16),
    new MeshBasicMaterial({ color: 0xe1eafa, fog: false, toneMapped: false }),
  );
  readonly light = new DirectionalLight();
  readonly ambient = new HemisphereLight(0xffffff, 0xe8e1d4, Math.PI * 0.8);
  readonly #sunDirection = new Vector3();
  readonly #lightDirection = new Vector3();
  #cloudTime = 0;

  constructor() {
    this.object.name = 'ecology-sky';
    this.clouds.name = 'clouds';
    this.sun.name = 'sun';
    this.moon.name = 'moon';
    this.light.castShadow = true;
    this.light.shadow.mapSize.set(2048, 2048);
    this.light.shadow.bias = -0.0002;
    this.light.shadow.normalBias = 0.025;
    this.light.shadow.camera.near = 0.1;
    this.light.shadow.camera.far = 220;
    for (const [index, seed] of CLOUDS.entries()) {
      const cloud = new Group();
      cloud.name = `cloud-${index + 1}`;
      cloud.position.set(seed.x, seed.y, seed.z);
      cloud.scale.set(seed.scale * seed.stretch, seed.scale, seed.scale);
      cloud.rotation.y = seed.phase * 0.35;
      for (const puff of CLOUD_STYLES[seed.style]) {
        const mesh = new Mesh(this.#cloudGeometry, this.#cloudMaterials[seed.style]);
        mesh.position.set(puff.x, puff.y, puff.z);
        mesh.scale.set(puff.scale, puff.scale * (0.58 + seed.stretch * 0.12), puff.scale * 0.82);
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        cloud.add(mesh);
      }
      this.clouds.add(cloud);
    }
    this.object.add(this.sun, this.moon, this.clouds, this.ambient, this.light, this.light.target);
  }

  /** Move the shadow window with the viewed ground; the sky has no nearby parallax. */
  update(clock: WorldClock, focus: Vector3, overlook: boolean, dt = 0): void {
    const brightness = dayBrightness(clock);
    const angle = clock.dayFraction * Math.PI * 2 - Math.PI / 2;
    this.#sunDirection.set(Math.cos(angle), Math.sin(angle), Math.cos(angle) * 0.35).normalize();
    const isDay = clock.period !== 'night';
    this.sun.visible = isDay;
    this.moon.visible = !isDay;
    this.sun.position.copy(focus).addScaledVector(this.#sunDirection, 90);
    this.moon.position.copy(focus).addScaledVector(this.#sunDirection, -90);
    this.#cloudTime += Math.max(0, dt);
    const drift = this.#cloudTime;
    for (const [index, cloud] of this.clouds.children.entries()) {
      const seed = CLOUDS[index];
      cloud.position.x = ((((seed.x + drift * seed.speed + 110) % 220) + 220) % 220) - 110;
      cloud.position.z = seed.z + Math.sin(this.#cloudTime * 0.025 + seed.phase) * 1.5;
    }
    for (const [index, material] of this.#cloudMaterials.entries()) {
      material.color.copy(cloudNight).lerp(cloudDay, 0.22 + brightness * 0.78);
      material.opacity = (0.18 + brightness * 0.4) * (1 - index * 0.12);
    }
    this.#lightDirection.copy(this.#sunDirection).multiplyScalar(isDay ? 1 : -1);
    // Fade at the horizon so a light switch cannot flip a long dark shadow.
    const altitude = Math.max(0, this.#lightDirection.y);
    // Lambert divides diffuse light by PI. Keep a bright neutral paper base,
    // with a smaller directional contribution for shape and cast shadows.
    this.light.intensity = (isDay ? Math.PI * 0.22 : 0.32) * Math.min(1, altitude * 5);
    this.light.color.setHex(isDay ? 0xfff6e8 : 0xaecbff);
    this.ambient.intensity = 0.5 + brightness * (Math.PI * 0.8 - 0.5);
    this.light.position.copy(focus).addScaledVector(this.#lightDirection, 100);
    this.light.target.position.copy(focus);
    const extent = overlook ? 60 : 24;
    const camera = this.light.shadow.camera;
    if (camera.right !== extent) {
      camera.left = camera.bottom = -extent;
      camera.right = camera.top = extent;
      camera.updateProjectionMatrix();
    }
  }

  /** Geometry is released with Stage's scene; these resources belong only to the sky. */
  dispose(): void {
    this.sun.material.dispose();
    this.moon.material.dispose();
    this.#cloudGeometry.dispose();
    for (const material of this.#cloudMaterials) material.dispose();
    this.light.shadow.dispose();
  }
}
