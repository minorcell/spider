import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
} from 'three';
import {
  abs,
  clamp,
  cos,
  exp,
  float,
  length,
  max,
  mix,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { PALETTE } from '../shared/config.js';
import { groundAttributes, islandBuffers, type IslandBuffers } from '../shared/island.js';
import { groundMat } from '../shared/sim/parts.js';
import { TERRAIN } from '../shared/terrain.js';
import {
  applyWaterMotion,
  WAKE_COUNT,
  waterBodyX,
  waterBodyZ,
  waterDirX,
  waterDirZ,
  waterPush,
  waterWake,
  type WaterContact,
} from './waterMotion.js';

const waterTime = uniform(0);
const waterShallow = uniform(new Color(PALETTE.water));
const waterDeep = uniform(new Color(PALETTE.water).multiplyScalar(0.78));
const waterOpacity = uniform(0.74);

const TAU = 6.283185307179586;

interface Swell {
  readonly dirX: number;
  readonly dirZ: number;
  readonly amplitude: number;
  readonly wavelength: number;
  readonly steepness: number;
}

const SWELLS: readonly Swell[] = [
  { dirX: 1, dirZ: 0.15, amplitude: 0.016, wavelength: 16, steepness: 0.32 },
  { dirX: -0.2, dirZ: 1, amplitude: 0.011, wavelength: 9, steepness: 0.34 },
  { dirX: 0.85, dirZ: -0.7, amplitude: 0.007, wavelength: 5.5, steepness: 0.36 },
];

type FloatNode = Node<'float'>;

function gerstner(x: FloatNode, z: FloatNode, time: FloatNode) {
  let dx: FloatNode = float(0);
  let dy: FloatNode = float(0);
  let dz: FloatNode = float(0);
  const count = SWELLS.length;
  for (const swell of SWELLS) {
    const len = Math.hypot(swell.dirX, swell.dirZ);
    const dirX = swell.dirX / len;
    const dirZ = swell.dirZ / len;
    const frequency = TAU / swell.wavelength;
    const speed = Math.sqrt(9.8 * frequency) * 0.65;
    const steep = swell.steepness / (swell.amplitude * frequency * count);
    const phase = x
      .mul(dirX * frequency)
      .add(z.mul(dirZ * frequency))
      .add(time.mul(speed));
    const sine = sin(phase);
    const cosine = cos(phase);
    dx = dx.add(cosine.mul(steep * swell.amplitude * dirX));
    dz = dz.add(cosine.mul(steep * swell.amplitude * dirZ));
    dy = dy.add(sine.mul(swell.amplitude));
  }
  return { dx, dy, dz };
}

function radialWakes(x: FloatNode, z: FloatNode, time: FloatNode) {
  let sum: FloatNode = float(0);
  for (let i = 0; i < WAKE_COUNT; i++) {
    const slot = waterWake.element(i);
    const age = max(time.sub(slot.z), 0);
    const dist = length(vec2(x.sub(slot.x), z.sub(slot.y)));
    sum = sum.add(
      sin(dist.mul(3.2).sub(age.mul(8)))
        .mul(exp(age.mul(-1.15)))
        .mul(exp(dist.mul(-0.4)))
        .mul(slot.w),
    );
  }
  return sum;
}

function bow(x: FloatNode, z: FloatNode, time: FloatNode) {
  const dx = x.sub(waterBodyX);
  const dz = z.sub(waterBodyZ);
  const dist = length(vec2(dx, dz));
  const sink = exp(dist.mul(-1.6)).mul(waterPush).mul(-0.04);
  const along = dx.mul(waterDirX).add(dz.mul(waterDirZ));
  const side = dx.mul(waterDirZ).sub(dz.mul(waterDirX));
  const behind = along.mul(-1);
  const trail = sin(behind.mul(2.2).sub(time.mul(6)))
    .mul(exp(behind.mul(-0.48)))
    .mul(exp(abs(side).mul(-1.7)))
    .mul(smoothstep(0, 0.2, behind))
    .mul(waterPush)
    .mul(0.032);
  return sink.add(trail);
}

const sheetX = positionLocal.x;
const sheetZ = positionLocal.y.mul(-1);
const sheetSwell = gerstner(sheetX, sheetZ, waterTime);
const sheetLift = sheetSwell.dy
  .add(bow(sheetX, sheetZ, waterTime))
  .add(radialWakes(sheetX, sheetZ, waterTime).mul(0.018));

const paintedX = positionWorld.x;
const paintedZ = positionWorld.z;
const painted = gerstner(paintedX, paintedZ, waterTime);
const ripples = radialWakes(paintedX, paintedZ, waterTime);
const crest = smoothstep(0.008, 0.018, painted.dy);
const shade = clamp(painted.dy.mul(7).add(0.42).add(ripples.mul(0.28)), 0, 1);

const waterMaterial = new MeshBasicNodeMaterial({
  transparent: true,
  depthWrite: false,
  fog: false,
  side: DoubleSide,
  colorNode: mix(mix(waterDeep, waterShallow, shade), waterShallow, crest.mul(0.8)),
  opacityNode: clamp(waterOpacity.add(crest.mul(0.1)).add(ripples.mul(0.04)), 0.4, 0.92),
});
waterMaterial.positionNode = vec3(
  sheetX.add(sheetSwell.dx),
  positionLocal.y.sub(sheetSwell.dz),
  positionLocal.z.add(sheetLift),
);
waterMaterial.userData.uTime = waterTime;

const waterBase = new Color(PALETTE.water);
const coverMaterial = new MeshLambertMaterial({ vertexColors: true, side: DoubleSide });

export function setGroundLight(red: number, green: number, blue: number): void {
  waterShallow.value
    .copy(waterBase)
    .setRGB(waterBase.r * red, waterBase.g * green, waterBase.b * blue);
  waterDeep.value
    .copy(waterBase)
    .setRGB(waterBase.r * red * 0.78, waterBase.g * green * 0.78, waterBase.b * blue * 0.78);
}

let waterClock = Number.NaN;

export function tickWater(seconds: number, contact?: WaterContact): void {
  const dt =
    Number.isNaN(waterClock) || seconds < waterClock ? 0 : Math.min(0.05, seconds - waterClock);
  waterClock = seconds;
  waterTime.value = seconds;
  applyWaterMotion(seconds, dt, contact);
}

export function buildIsland(height: (x: number, z: number) => number): Group {
  return islandGroup(islandBuffers(height));
}

export function islandGroup(buffers: IslandBuffers): Group {
  const group = new Group();
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(buffers.groundPosition, 3));
  geo.setAttribute('color', new Float32BufferAttribute(buffers.groundColor, 3));
  geo.setIndex(new BufferAttribute(buffers.groundIndex, 1));
  geo.computeVertexNormals();
  group.add(new Mesh(geo, groundMat));

  const cover = new BufferGeometry();
  cover.setAttribute('position', new Float32BufferAttribute(buffers.coverPosition, 3));
  cover.setAttribute('color', new Float32BufferAttribute(buffers.coverColor, 3));
  cover.computeVertexNormals();
  const vegetation = new Mesh(cover, coverMaterial);
  vegetation.name = 'ground-cover';
  group.add(vegetation);

  const water = new Mesh(
    new PlaneGeometry(TERRAIN.half * 2, TERRAIN.half * 2, 112, 112),
    waterMaterial,
  );
  water.name = 'water';
  water.renderOrder = 1;
  water.rotation.x = -Math.PI / 2;
  water.position.y = TERRAIN.water + 0.01;
  group.add(water);
  return group;
}

export function groundGeometry(
  height: (x: number, z: number) => number,
  half: number,
  segments: number,
): BufferGeometry {
  const baked = groundAttributes(height, half, segments);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(baked.groundPosition, 3));
  geo.setAttribute('color', new Float32BufferAttribute(baked.groundColor, 3));
  geo.setIndex(new BufferAttribute(baked.groundIndex, 1));
  geo.computeVertexNormals();
  return geo;
}
