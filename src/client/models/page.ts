import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  Vector3,
  type Object3D,
} from 'three';
import { WebGPURenderer } from 'three/webgpu';
import { PALETTE } from '../../shared/config.js';
import { islandBuffers } from '../../shared/island.js';
import { groundMat } from '../../shared/sim/parts.js';
import { enableWorldShadows } from '../ecologyView.js';
import { buildProp, drapeGrass } from '../props.js';
import { buildStone } from './stone.js';
import { buildTree } from './tree.js';
import './models.css';

const HALF = 17;
const SEGMENTS = 96;
const WATER = -0.42;
const POND = { x: 5.1, z: 2.4, r: 4.1, depth: -1.18 };
const VIEW = { distance: 16.5, min: 9, max: 30, pitch: 0.4, yaw: 0.78, ease: 6 } as const;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function heightAt(x: number, z: number): number {
  let height =
    0.2 * Math.sin(x * 0.34 + 1.1) * Math.cos(z * 0.3 - 0.4) +
    0.09 * Math.sin(x * 0.72 + z * 0.51 + 2) +
    0.055 * Math.cos(x * 1.6 - z * 1.25);
  height += 0.58 * Math.exp(-((x + 4.6) ** 2 / 24 + (z + 1.3) ** 2 / 16));
  const basin = 1 - smoothstep(POND.r * 0.32, POND.r, Math.hypot(x - POND.x, z - POND.z));
  return height * (1 - basin) + POND.depth * basin;
}

interface Exhibit {
  readonly label: string;
  readonly group: Group;
  readonly top: number;
}

interface Spot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
}

function spot(x: number, z: number): Spot {
  return { x, z, y: heightAt(x, z) };
}

function pondSpot(angle: number): Spot {
  for (let r = POND.r * 0.92; r >= POND.r * 0.44; r -= 0.05) {
    const x = POND.x + Math.cos(angle) * r;
    const z = POND.z + Math.sin(angle) * r;
    const y = heightAt(x, z);
    if (y <= WATER - 0.1 && y >= WATER - 0.34) return { x, z, y };
  }
  const x = POND.x + Math.cos(angle) * POND.r * 0.68;
  const z = POND.z + Math.sin(angle) * POND.r * 0.68;
  return { x, z, y: heightAt(x, z) };
}

const stageQuery = document.querySelector<HTMLElement>('#models-stage');
const labelsQuery = document.querySelector<HTMLElement>('#models-labels');
const statsQuery = document.querySelector<HTMLElement>('#models-stats');
const turnQuery = document.querySelector<HTMLButtonElement>('#models-turn');
const rerollQuery = document.querySelector<HTMLButtonElement>('#models-reroll');
const labelQuery = document.querySelector<HTMLButtonElement>('#models-labels-toggle');
if (!stageQuery || !labelsQuery || !statsQuery || !turnQuery || !rerollQuery || !labelQuery) {
  throw new Error('Missing model page elements');
}
const host = stageQuery;
const labelLayer = labelsQuery;
const stats = statsQuery;
const turnButton = turnQuery;
const rerollButton = rerollQuery;
const labelButton = labelQuery;

const renderer = new WebGPURenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PCFShadowMap;
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setClearColor(PALETTE.paper, 1);
host.append(renderer.domElement);

const scene = new Scene();
const camera = new PerspectiveCamera(32, 1, 0.1, 120);

scene.add(new HemisphereLight(0xffffff, 0xe8e1d4, Math.PI * 0.8));
const sun = new DirectionalLight(0xfff6e8, Math.PI * 0.22);
sun.position.set(8, 14, 6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.025;
sun.shadow.camera.near = 0.1;
sun.shadow.camera.far = 70;
sun.shadow.camera.left = -HALF;
sun.shadow.camera.right = HALF;
sun.shadow.camera.bottom = -HALF;
sun.shadow.camera.top = HALF;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun, sun.target);

function buildGround(): Group {
  const buffers = islandBuffers(heightAt, HALF, SEGMENTS);
  const group = new Group();
  group.name = 'ground';

  const ground = new BufferGeometry();
  ground.setAttribute('position', new Float32BufferAttribute(buffers.groundPosition, 3));
  ground.setAttribute('color', new Float32BufferAttribute(buffers.groundColor, 3));
  ground.setIndex(new BufferAttribute(buffers.groundIndex, 1));
  ground.computeVertexNormals();
  const mesh = new Mesh(ground, groundMat);
  mesh.receiveShadow = true;
  group.add(mesh);

  const water = new Mesh(
    new PlaneGeometry(HALF * 2 + 12, HALF * 2 + 12),
    new MeshBasicMaterial({
      color: new Color(PALETTE.water),
      transparent: true,
      opacity: 0.84,
      depthWrite: false,
    }),
  );
  water.name = 'water';
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER + 0.008;
  water.renderOrder = 1;
  group.add(water);
  return group;
}

scene.add(buildGround());

const reference = new Group();
reference.name = 'reference';
const apple = buildProp('apple', 0);
if (apple) {
  const at = spot(1.35, -1.7);
  apple.position.set(at.x, at.y, at.z);
  reference.add(apple);
}
const grass = buildProp('grass', 0, { kind: 'circle', r: 2 }, 'grass-1');
if (grass) {
  drapeGrass(grass, -1.7, -2.8, heightAt);
  reference.add(grass);
}
enableWorldShadows(reference);
scene.add(reference);

let generation = 0;

function createExhibits(round: number): Exhibit[] {
  const exhibits: Exhibit[] = [];
  const seedBase = round * 97;

  const trees: readonly { at: readonly [number, number]; height: number }[] = [
    { at: [-5.1, -1.5], height: 3.7 },
    { at: [-7.9, 3.7], height: 3.0 },
    { at: [2.1, -5.9], height: 3.35 },
  ];
  trees.forEach((item, index) => {
    const at = spot(item.at[0], item.at[1]);
    const group = buildTree(11 + index * 13 + seedBase, item.height);
    group.position.set(at.x, at.y - 0.06, at.z);
    group.rotation.y = index * 1.7 + round * 0.3;
    exhibits.push({
      label: `树 · ${(group.userData.height as number).toFixed(1)} m`,
      group,
      top: group.userData.height as number,
    });
  });

  const stones: readonly { at: readonly [number, number]; size: number }[] = [
    { at: [0.5, 0.6], size: 1.15 },
    { at: [-2.6, 3.1], size: 0.7 },
    { at: [3.3, -2.9], size: 0.9 },
  ];
  stones.forEach((item, index) => {
    const at = spot(item.at[0], item.at[1]);
    const group = buildStone(5 + index * 14 + seedBase, item.size, false);
    group.position.set(at.x, at.y, at.z);
    group.rotation.y = index * 2.1 + round * 0.4;
    exhibits.push({
      label: `石 · ${(group.userData.height as number).toFixed(1)} m`,
      group,
      top: group.userData.height as number,
    });
  });

  const bogs: readonly { angle: number; size: number }[] = [
    { angle: 0.7, size: 0.95 },
    { angle: 2.6, size: 0.8 },
    { angle: 4.5, size: 1.05 },
  ];
  bogs.forEach((item, index) => {
    const at = pondSpot(item.angle);
    const group = buildStone(41 + index * 16 + seedBase, item.size, true);
    group.position.set(at.x, at.y + 0.12, at.z);
    group.rotation.y = index * 1.3 + round * 0.5;
    exhibits.push({
      label: `沼石 · ${(group.userData.height as number).toFixed(1)} m`,
      group,
      top: group.userData.height as number,
    });
  });

  return exhibits;
}

function trianglesIn(root: Object3D): number {
  let total = 0;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const geometry = node.geometry;
    total += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  });
  return total;
}

function disposeGeometries(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  root.traverse((node) => {
    const geometry = (node as Object3D & { geometry?: BufferGeometry }).geometry;
    if (geometry) geometries.add(geometry);
  });
  for (const geometry of geometries) geometry.dispose();
}

let exhibits: Exhibit[] = [];
let labels: HTMLSpanElement[] = [];

function rebuild(): void {
  generation += 1;
  for (const exhibit of exhibits) {
    scene.remove(exhibit.group);
    disposeGeometries(exhibit.group);
  }
  labelLayer.textContent = '';
  exhibits = createExhibits(generation);
  labels = [];
  for (const exhibit of exhibits) {
    enableWorldShadows(exhibit.group);
    scene.add(exhibit.group);
    const label = document.createElement('span');
    label.className = 'models-label';
    label.textContent = exhibit.label;
    label.title = `${trianglesIn(exhibit.group).toLocaleString('zh-CN')} 个三角面`;
    labelLayer.append(label);
    labels.push(label);
  }
  const total = exhibits.reduce((sum, exhibit) => sum + trianglesIn(exhibit.group), 0);
  const families = `${exhibits.length} 件 · 苹果与草为参照`;
  stats.textContent = `${families} · ${total.toLocaleString('zh-CN')} 三角面`;
}

rebuild();

let yaw: number = VIEW.yaw;
let pitch: number = VIEW.pitch;
let distance: number = VIEW.distance;
let viewYaw = yaw;
let viewPitch = pitch;
let viewDistance = distance;
let turning = true;
let labelsOn = true;
let dragging = false;
let pointerX = 0;
let pointerY = 0;
let width = 1;
let height = 1;
const target = new Vector3(0.6, 0.75, 0.6);
const desired = new Vector3();
const sizes = { left: 0, top: 0, width: 1, height: 1 };

function resize(): void {
  width = host.clientWidth || window.innerWidth;
  height = host.clientHeight || window.innerHeight;
  if (width < 2 || height < 2) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  const rect = renderer.domElement.getBoundingClientRect();
  sizes.left = rect.left;
  sizes.top = rect.top;
  sizes.width = rect.width;
  sizes.height = rect.height;
}

new ResizeObserver(resize).observe(host);
resize();

function toggleTurn(): void {
  turning = !turning;
  turnButton!.setAttribute('aria-pressed', String(turning));
}

function toggleLabels(): void {
  labelsOn = !labelsOn;
  labelLayer!.hidden = !labelsOn;
  labelButton!.setAttribute('aria-pressed', String(labelsOn));
}

turnButton.addEventListener('click', toggleTurn);
rerollButton.addEventListener('click', rebuild);
labelButton.addEventListener('click', toggleLabels);
window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') rebuild();
  if (event.key === 't' || event.key === 'T') toggleTurn();
  if (event.key === 'l' || event.key === 'L') toggleLabels();
});

const canvas = renderer.domElement;
canvas.style.touchAction = 'none';
canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  pointerX = event.clientX;
  pointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', (event) => {
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.clientX - pointerX;
  const dy = event.clientY - pointerY;
  pointerX = event.clientX;
  pointerY = event.clientY;
  yaw -= dx * 0.005;
  pitch = MathUtils.clamp(pitch + dy * 0.004, 0.12, 1.2);
});
canvas.addEventListener(
  'wheel',
  (event) => {
    distance = MathUtils.clamp(distance * (1 + event.deltaY * 0.001), VIEW.min, VIEW.max);
    event.preventDefault();
  },
  { passive: false },
);

function updateLabels(): void {
  if (!labelsOn) return;
  for (let i = 0; i < exhibits.length; i++) {
    const exhibit = exhibits[i];
    const label = labels[i];
    if (!label) continue;
    desired.set(
      exhibit.group.position.x,
      exhibit.group.position.y + exhibit.top,
      exhibit.group.position.z,
    );
    desired.project(camera);
    if (desired.z > 1) {
      label.style.display = 'none';
      continue;
    }
    label.style.display = 'block';
    label.style.left = `${sizes.left + (desired.x * 0.5 + 0.5) * sizes.width}px`;
    label.style.top = `${sizes.top + (-desired.y * 0.5 + 0.5) * sizes.height}px`;
  }
}

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (turning && !dragging) yaw += dt * 0.08;
  const blend = 1 - Math.exp(-VIEW.ease * Math.max(dt, 0.001));
  viewYaw += (yaw - viewYaw) * blend;
  viewPitch += (pitch - viewPitch) * blend;
  viewDistance += (distance - viewDistance) * blend;
  const cos = Math.cos(viewPitch);
  camera.position.set(
    target.x + Math.sin(viewYaw) * cos * viewDistance,
    target.y + Math.sin(viewPitch) * viewDistance,
    target.z + Math.cos(viewYaw) * cos * viewDistance,
  );
  camera.lookAt(target);
  renderer.render(scene, camera);
  updateLabels();
}

renderer.setAnimationLoop(frame);
