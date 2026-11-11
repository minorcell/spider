import { barkGrain, mineralGrain, paintMineral } from '@/src/client/models/surface';
import { createNoise, mulberry32 } from '@/src/shared/noise';
import { PALETTE } from '@/src/shared/config';
import { meshGeometry } from '@/src/client/meshGeometry';
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshLambertMaterial,
  LineBasicMaterial,
  DoubleSide,
  Color,
  Vector3,
} from 'three';
import {
  NEST_DETAILS,
  NEST_PEBBLE_SKIN,
  NEST_ROOT_SKIN,
  nestPebbleMesh,
  nestRootMesh,
} from '@/src/shared/nestDetails';
import {
  NEST_RI,
  NEST_RO,
  NEST_SCALE_XZ,
  NEST_SCALE_Y,
  nestLocalHeight,
} from '@/src/shared/nestShape';
import { growShell, inkSolidMat } from '@/src/client/rig/parts';
import { buildGrass } from '@/src/client/grassMesh';
import { lineFrom, pushLine } from '@/src/client/models/geometry';

const TAU = Math.PI * 2;
const nestStoneMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
  bumpMap: mineralGrain,
  bumpScale: 0.025,
});
const chamberMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  map: mineralGrain,
  bumpMap: mineralGrain,
  bumpScale: 0.018,
  side: DoubleSide,
  alphaHash: true,
});
const soilNoise = createNoise(1907);
const rootMat = new MeshLambertMaterial({
  color: 0xb7a080,
  map: barkGrain,
  bumpMap: barkGrain,
  bumpScale: 0.04,
});
const nestSilkMat = new LineBasicMaterial({ color: 0xc9c4b4, transparent: true, opacity: 0.48 });
const litterMat = new MeshLambertMaterial({
  color: 0xffffff,
  vertexColors: true,
  side: DoubleSide,
});

export function buildNest(): Group {
  const group = new Group();
  group.name = 'nest';
  const silk: number[] = [];
  const positions: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const uv: number[] = [];
  const earth = new Color(0xd6c5a9);
  const moss = new Color(0x879878);
  const meadow = new Color(0xa9b68f);
  const tint = new Color();
  const radii = [...Array.from({ length: 97 }, (_, i) => (i / 96) * NEST_RO), NEST_RI].sort(
    (a, b) => a - b,
  );
  const rings = radii.length - 1;
  const angles = 128;

  for (let i = 0; i <= rings; i++) {
    const radius = radii[i];
    for (let j = 0; j < angles; j++) {
      const angle = (j / angles) * TAU;
      const x = Math.cos(angle) * radius,
        z = Math.sin(angle) * radius;
      const grain = soilNoise(x * 2.5, z * 2.5);
      tint.copy(earth).multiplyScalar(0.92 + grain * 0.12);
      tint.lerp(
        moss,
        Math.max(0, (radius - 1.8) / 1.3) *
          Math.max(0, soilNoise(x * 1.2 + 10, z * 1.2) + 0.3) *
          0.7,
      );
      const edge = Math.min(1, Math.max(0, (radius - 2.3 + grain * 0.3) / 0.7));
      tint.lerp(meadow, edge * edge * (3 - 2 * edge));
      const fade = Math.min(1, Math.max(0, (radius - 2.48 + grain * 0.16) / (NEST_RO - 2.48)));
      const lowSoil = 1 - Math.min(1, nestLocalHeight(radius, angle) / 0.18);
      colors.push(tint.r, tint.g, tint.b, 1 - fade * fade * (3 - 2 * fade) * lowSoil);
      uv.push(x * 1.4, z * 1.4);
      positions.push(
        Math.cos(angle) * radius,
        nestLocalHeight(radius, angle),
        Math.sin(angle) * radius,
      );
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < angles; j++) {
      const a = i * angles + j;
      const b = (i + 1) * angles + j;
      const c = i * angles + ((j + 1) % angles);
      const d = (i + 1) * angles + ((j + 1) % angles);
      indices.push(a, c, b, c, d, b);
    }
  }
  const ground = new BufferGeometry();
  ground.setAttribute('position', new Float32BufferAttribute(positions, 3));
  ground.setIndex(indices);
  ground.setAttribute('color', new Float32BufferAttribute(colors, 4));
  ground.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  ground.computeVertexNormals();
  const floor = new Mesh(ground, chamberMat);
  floor.name = 'chamber-floor';
  group.add(floor);

  for (const pebble of NEST_DETAILS.pebbles) {
    const geometry = meshGeometry(nestPebbleMesh());
    paintMineral(geometry, PALETTE.stone, 0.55);
    const stone = new Mesh(geometry, nestStoneMat);
    stone.name = 'pebble';
    stone.scale.copy(pebble.scale);
    stone.position.copy(pebble.position);
    stone.rotation.set(pebble.rotation.x, pebble.rotation.y, pebble.rotation.z);
    stone.add(new Mesh(growShell(geometry, NEST_PEBBLE_SKIN), inkSolidMat));
    group.add(stone);
  }

  for (const spine of NEST_DETAILS.roots) {
    const geometry = meshGeometry(nestRootMesh(spine));
    const rootUV: number[] = [];
    const count = geometry.getAttribute('position').count;
    for (let i = 0; i < count; i++) rootUV.push(((i % 10) / 10) * 3, Math.floor(i / 10) * 0.18);
    geometry.setAttribute('uv', new Float32BufferAttribute(rootUV, 2));
    const root = new Mesh(geometry, rootMat);
    root.name = 'bank-root';
    root.add(new Mesh(growShell(geometry, NEST_ROOT_SKIN), inkSolidMat));
    group.add(root);
  }

  const rand = mulberry32(937);
  // The silk is an irregular woven sheet tethered to the banks, not a drawn floor grid.
  for (let strand = 0; strand < 19; strand++) {
    const radius = 0.11 + strand * 0.062;
    const thread: Vector3[] = [];
    for (let k = 0; k <= 72; k++) {
      const angle = (k / 72) * TAU;
      const r = radius * (1 + 0.055 * Math.sin(angle * 5 + strand * 0.4));
      const x = Math.cos(angle) * r * 1.12;
      const z = Math.sin(angle) * r - 0.08;
      thread.push(new Vector3(x, nestLocalHeight(Math.hypot(x, z), Math.atan2(z, x)) + 0.014, z));
    }
    pushLine(silk, thread);
  }
  for (let strand = 0; strand < 25; strand++) {
    const angle = (strand / 25) * TAU + rand() * 0.07;
    const thread: Vector3[] = [];
    for (let k = 0; k <= 12; k++) {
      const r = (k / 12) * (1.45 + rand() * 0.045);
      const x = Math.cos(angle) * r,
        z = Math.sin(angle) * r - 0.08;
      thread.push(new Vector3(x, nestLocalHeight(Math.hypot(x, z), Math.atan2(z, x)) + 0.018, z));
    }
    pushLine(silk, thread);
  }
  const litter: number[] = [];
  const litterColors: number[] = [];
  for (let leaf = 0; leaf < 43; leaf++) {
    const angle = rand() * TAU;
    const r = 1.65 + rand() * 1.3;
    const x = Math.cos(angle) * r,
      z = Math.sin(angle) * r;
    const phi = rand() * TAU;
    const long = 0.09 + rand() * 0.12,
      wide = long * 0.42;
    const tone = new Color([0xa99571, 0xb8a17c, 0x8a9671][leaf % 3]);
    const points = [
      [-long, 0],
      [-long * 0.2, wide],
      [long, 0],
      [-long * 0.2, -wide],
      [0, 0],
    ];
    for (const at of [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]) {
      const [along, across] = points[at];
      const px = x + Math.cos(phi) * along - Math.sin(phi) * across;
      const pz = z + Math.sin(phi) * along + Math.cos(phi) * across;
      litter.push(
        px,
        nestLocalHeight(Math.hypot(px, pz), Math.atan2(pz, px)) + (at === 4 ? 0.035 : 0.009),
        pz,
      );
      litterColors.push(tone.r, tone.g, tone.b);
    }
  }
  const litterGeometry = new BufferGeometry();
  litterGeometry.setAttribute('position', new Float32BufferAttribute(litter, 3));
  litterGeometry.setAttribute('color', new Float32BufferAttribute(litterColors, 3));
  litterGeometry.computeVertexNormals();
  const scattered = new Mesh(litterGeometry, litterMat);
  scattered.name = 'leaf-litter';
  group.add(scattered);

  const styles = ['thin', 'seed', 'broad'] as const;
  for (const { index: k, x, z } of NEST_DETAILS.tufts) {
    const tuft = buildGrass(0.42, 200 + k, styles[k % 3]);
    tuft.scale.y = 0.55;
    tuft.position.set(x, nestLocalHeight(Math.hypot(x, z), Math.atan2(z, x)) + 0.012, z);
    group.add(tuft);
  }
  group.add(lineFrom(silk, nestSilkMat));
  group.scale.set(NEST_SCALE_XZ, NEST_SCALE_Y, NEST_SCALE_XZ);
  return group;
}
