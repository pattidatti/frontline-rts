import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createGround } from './world/ground';
import { createRiver } from './world/river';
import { createMound } from './world/mound';
import { createBridge } from './world/bridge';
import { createTree } from './world/tree';
import { createAphidFarm } from './world/aphidFarm';
import { createTower } from './world/tower';
import type { TowerKind } from './world/tower';
import { createRock } from './world/rock';
import { createFireflies } from './world/fireflies';
import { AntSwarm } from './world/ants';
import { vignetteShader } from './shaders/vignette';
import { TIME_PRESETS, lerpPalette } from './palette';
import type { TimePreset, Palette } from './palette';

const canvas = document.getElementById('c') as HTMLCanvasElement;
const loadingEl = document.getElementById('loading')!;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();

// -------- camera (isometric orthographic) --------
const WORLD = { width: 360, depth: 260 };
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
const camState = {
  zoom: 1.0,
  yaw: Math.PI * 0.25, // 45°
  pitch: Math.atan(1 / Math.SQRT2), // classic isometric ≈ 35.264°
  target: new THREE.Vector3(0, 0, 0),
  mode: 'orbit' as 'static' | 'orbit' | 'fly',
  paused: false,
};

function resizeCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = 78 / camState.zoom;
  camera.left = -viewSize * aspect;
  camera.right = viewSize * aspect;
  camera.top = viewSize;
  camera.bottom = -viewSize;
  camera.updateProjectionMatrix();
}

function placeCamera() {
  const r = 220;
  const x = camState.target.x + Math.cos(camState.yaw) * Math.cos(camState.pitch) * r;
  const z = camState.target.z + Math.sin(camState.yaw) * Math.cos(camState.pitch) * r;
  const y = camState.target.y + Math.sin(camState.pitch) * r;
  camera.position.set(x, y, z);
  camera.lookAt(camState.target);
}

resizeCamera();
placeCamera();

// -------- lighting --------
const sun = new THREE.DirectionalLight(0xffd5a3, 2.4);
sun.position.set(80, 140, 60);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -140;
sun.shadow.camera.right = 140;
sun.shadow.camera.top = 100;
sun.shadow.camera.bottom = -100;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 400;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0x88aaff, 0x2a1a0a, 0.55);
scene.add(hemi);

const rim = new THREE.DirectionalLight(0x80a8ff, 0.45);
rim.position.set(-60, 40, -80);
scene.add(rim);

// fog for depth
scene.fog = new THREE.FogExp2(0x0c1014, 0.003);

// -------- world --------
const groundMat = createGround(WORLD.width, WORLD.depth);
scene.add(groundMat.mesh);

const river = createRiver(WORLD.width);
scene.add(river.mesh);

// player mound (south, dark)
const playerMound = createMound({ color: 0x2a1a10, accent: 0xf0a050, glow: 0xffa040 });
playerMound.group.position.set(0, 0, 56);
scene.add(playerMound.group);

// ai mound (north, red)
const aiMound = createMound({ color: 0x6e2a14, accent: 0xff7030, glow: 0xff5020, scale: 0.95 });
aiMound.group.position.set(0, 0, -56);
aiMound.group.rotation.y = Math.PI;
scene.add(aiMound.group);

// bridges over river (river at z = 0)
[-44, 44].forEach((x) => {
  const b = createBridge();
  b.position.set(x, 0, 0);
  scene.add(b);
});

// rocks scattered
const rockPositions: Array<[number, number]> = [
  [-70, -30], [-30, -36], [40, -28], [78, -10],
  [-78, 22], [-26, 30], [34, 28], [70, 36],
  [-12, 8], [16, -8],
];
rockPositions.forEach(([x, z]) => {
  const r = createRock(0.7 + Math.random() * 1.6);
  r.position.set(x, 0, z);
  r.rotation.y = Math.random() * Math.PI;
  scene.add(r);
});

// trees / pines around perimeter and clusters
const treeSpots: Array<[number, number, number]> = [];
for (let i = 0; i < 38; i++) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 70 + Math.random() * 60;
  const x = Math.cos(angle) * radius * 1.4;
  const z = Math.sin(angle) * radius * 0.9;
  if (Math.abs(z) < 12) continue; // skip river
  treeSpots.push([x, z, 0.7 + Math.random() * 0.8]);
}
// extra clusters near bases
for (let i = 0; i < 10; i++) {
  treeSpots.push([
    (-50 + Math.random() * 100),
    -70 + (Math.random() - 0.5) * 18,
    0.6 + Math.random() * 0.7,
  ]);
  treeSpots.push([
    (-50 + Math.random() * 100),
    70 + (Math.random() - 0.5) * 18,
    0.6 + Math.random() * 0.7,
  ]);
}
treeSpots.forEach(([x, z, s]) => {
  const t = createTree(s);
  t.position.set(x, 0, z);
  t.rotation.y = Math.random() * Math.PI;
  scene.add(t);
});

// aphid farms (6: 4 safe near bases, 2 contested in middle)
const farmSpots: Array<[number, number]> = [
  [-30, 50], [30, 50],   // player side
  [-30, -50], [30, -50], // ai side
  [-55, -4], [55, -4],   // contested at river
];
farmSpots.forEach(([x, z]) => {
  const f = createAphidFarm();
  f.position.set(x, 0, z);
  scene.add(f);
});

// towers — player side
const towerSpots: Array<[number, number, TowerKind, 'player' | 'ai']> = [
  [-22, 38, 'stinger', 'player'],
  [22, 38, 'webber', 'player'],
  [0, 46, 'spitter', 'player'],
  [-22, -38, 'stinger', 'ai'],
  [22, -38, 'spitter', 'ai'],
];
const towers = towerSpots.map(([x, z, kind, side]) => {
  const t = createTower(kind, side);
  t.group.position.set(x, 0, z);
  scene.add(t.group);
  return t;
});

// fireflies — atmospheric particles
const fireflies = createFireflies(160, WORLD);
scene.add(fireflies.points);

// ants — instanced swarm
const playerAnts = new AntSwarm({
  count: 70,
  baseColor: 0x141414,
  legColor: 0x444444,
  mandibleColor: 0xddccaa,
  homeZ: 56,
  enemyZ: -56,
  spread: 1.0,
});
scene.add(playerAnts.group);

const aiAnts = new AntSwarm({
  count: 70,
  baseColor: 0x6e2a14,
  legColor: 0x5a2010,
  mandibleColor: 0xeebb88,
  homeZ: -56,
  enemyZ: 56,
  spread: 1.0,
});
scene.add(aiAnts.group);

// -------- post-processing --------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);

const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85, // strength
  0.7,  // radius
  0.6,  // threshold
);
composer.addPass(bloomPass);

const vignettePass = new ShaderPass(vignetteShader);
composer.addPass(vignettePass);

const outputPass = new OutputPass();
composer.addPass(outputPass);

// -------- palette / day-night --------
const palette: { current: Palette; target: Exclude<TimePreset, 'auto'>; auto: boolean; t: number } = {
  current: { ...TIME_PRESETS.dusk },
  target: 'dusk',
  auto: false,
  t: 0,
};

function applyPalette(p: Palette) {
  scene.background = new THREE.Color(p.sky);
  (scene.fog as THREE.FogExp2).color.set(p.fog);
  (scene.fog as THREE.FogExp2).density = p.fogDensity;
  sun.color.set(p.sunColor);
  sun.intensity = p.sunIntensity;
  sun.position.set(...p.sunDir).multiplyScalar(160);
  hemi.color.set(p.hemiSky);
  hemi.groundColor.set(p.hemiGround);
  hemi.intensity = p.hemiIntensity;
  rim.color.set(p.rimColor);
  rim.intensity = p.rimIntensity;
  bloomPass.strength = p.bloom;
  renderer.toneMappingExposure = p.exposure;
  groundMat.setNightFactor(p.nightFactor);
  river.setNightFactor(p.nightFactor);
  fireflies.setIntensity(p.firefly);
  towers.forEach((t) => t.setGlow(p.nightFactor));
  playerMound.setGlow(p.nightFactor);
  aiMound.setGlow(p.nightFactor);
}

applyPalette(palette.current);

// -------- input --------
const input = {
  dragging: false,
  lastX: 0,
  lastY: 0,
};

canvas.addEventListener('pointerdown', (e) => {
  input.dragging = true;
  input.lastX = e.clientX;
  input.lastY = e.clientY;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointerup', (e) => {
  input.dragging = false;
  (e.target as HTMLElement).releasePointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!input.dragging) return;
  const dx = e.clientX - input.lastX;
  const dy = e.clientY - input.lastY;
  input.lastX = e.clientX;
  input.lastY = e.clientY;
  // pan target in world XZ based on yaw
  const panScale = 0.35 / camState.zoom;
  const sx = Math.sin(camState.yaw);
  const cx = Math.cos(camState.yaw);
  camState.target.x -= (dx * cx + dy * sx * 0.6) * panScale;
  camState.target.z -= (-dx * sx + dy * cx * 0.6) * panScale;
  camState.target.x = THREE.MathUtils.clamp(camState.target.x, -80, 80);
  camState.target.z = THREE.MathUtils.clamp(camState.target.z, -80, 80);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camState.zoom = THREE.MathUtils.clamp(camState.zoom * (1 - e.deltaY * 0.0012), 0.55, 2.2);
  resizeCamera();
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { camState.paused = !camState.paused; e.preventDefault(); }
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomPass.setSize(window.innerWidth, window.innerHeight);
  resizeCamera();
});

// -------- HUD wiring --------
const timeLabel = document.getElementById('time-label')!;
const camLabel = document.getElementById('cam-label')!;
const bloomLabel = document.getElementById('bloom-label')!;
const statUnits = document.getElementById('stat-units')!;
const statFps = document.getElementById('stat-fps')!;

const TIME_LABELS: Record<TimePreset, string> = {
  dawn: 'Daggry',
  dusk: 'Skumring',
  night: 'Natt',
  auto: 'Auto',
};

document.querySelectorAll('button.b[data-time]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = (btn as HTMLElement).dataset.time as TimePreset;
    document.querySelectorAll('button.b[data-time]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    timeLabel.textContent = TIME_LABELS[t];
    if (t === 'auto') {
      palette.auto = true;
    } else {
      palette.auto = false;
      palette.target = t;
    }
  });
});
document.querySelectorAll('button.b[data-cam]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const m = (btn as HTMLElement).dataset.cam as 'static' | 'orbit' | 'fly';
    document.querySelectorAll('button.b[data-cam]').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    camState.mode = m;
    camLabel.textContent = m === 'static' ? 'Fast' : m === 'orbit' ? 'Roterer' : 'Fly-over';
  });
});
let bloomOn = true;
let fogOn = true;
let grassOn = true;
document.querySelectorAll('button.b[data-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = (btn as HTMLElement).dataset.toggle;
    if (t === 'bloom') {
      bloomOn = !bloomOn;
      bloomPass.enabled = bloomOn;
      bloomLabel.textContent = bloomOn ? 'På' : 'Av';
      btn.classList.toggle('active', bloomOn);
    } else if (t === 'fog') {
      fogOn = !fogOn;
      (scene.fog as THREE.FogExp2).density = fogOn ? palette.current.fogDensity : 0;
      btn.classList.toggle('active', fogOn);
    } else if (t === 'grass') {
      grassOn = !grassOn;
      groundMat.setGrassEnabled(grassOn);
      btn.classList.toggle('active', grassOn);
    }
  });
});

// -------- main loop --------
const clock = new THREE.Clock();
let fpsAccum = 0, fpsFrames = 0, fpsTimer = 0;
let frame = 0;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;
  frame++;

  // camera animation
  if (!camState.paused) {
    if (camState.mode === 'orbit') {
      camState.yaw += dt * 0.08;
    } else if (camState.mode === 'fly') {
      camState.yaw += dt * 0.04;
      camState.target.x = Math.sin(time * 0.15) * 40;
      camState.target.z = Math.cos(time * 0.11) * 20;
    }
  }
  placeCamera();
  sun.target.position.copy(camState.target);

  // palette interpolation
  if (palette.auto) {
    palette.t += dt * 0.05;
    const cycle = (Math.sin(palette.t) + 1) / 2; // 0..1
    const a = cycle < 0.5 ? TIME_PRESETS.night : TIME_PRESETS.dawn;
    const b = cycle < 0.5 ? TIME_PRESETS.dawn : TIME_PRESETS.dusk;
    const k = cycle < 0.5 ? cycle * 2 : (cycle - 0.5) * 2;
    const mixed = lerpPalette(a, b, k);
    applyPalette(mixed);
    palette.current = mixed;
  } else {
    const target = TIME_PRESETS[palette.target];
    const next = lerpPalette(palette.current, target, Math.min(1, dt * 1.5));
    applyPalette(next);
    palette.current = next;
  }

  // world updates
  groundMat.update(time);
  river.update(time);
  fireflies.update(time, dt);
  playerAnts.update(time, dt);
  aiAnts.update(time, dt);
  towers.forEach((t) => t.update(time, dt));
  playerMound.update(time);
  aiMound.update(time);

  composer.render();

  // fps + stats
  fpsAccum += dt; fpsFrames++; fpsTimer += dt;
  if (fpsTimer > 0.5) {
    const fps = fpsFrames / fpsAccum;
    statFps.innerHTML = `FPS: <b>${fps.toFixed(0)}</b>`;
    statUnits.innerHTML = `Maur: <b>${playerAnts.count + aiAnts.count}</b>`;
    fpsAccum = 0; fpsFrames = 0; fpsTimer = 0;
  }

  requestAnimationFrame(animate);
}

requestAnimationFrame(() => {
  loadingEl.classList.add('hidden');
  animate();
});
