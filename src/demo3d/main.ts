import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { createGround } from './world/ground';
import { createMound } from './world/mound';
import { createTree } from './world/tree';
import { createAphidFarm } from './world/aphidFarm';
import { createTower } from './world/tower';
import type { TowerKind } from './world/tower';
import { createRock } from './world/rock';
import { createFireflies } from './world/fireflies';
import { AntSwarm } from './world/ants';
import { buildLane, buildLaneMesh } from './world/lanes';
import type { LaneDef, Lane } from './world/lanes';
import { createArena } from './world/arena';
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

// -------- world dims mirror game (1920×1080) at scale 0.1875 --------
const SCALE = 0.1875;
const gx = (x: number) => (x - 960) * SCALE;
const gz = (y: number) => (y - 540) * SCALE;
const WORLD = { width: 360, depth: 220 };

// -------- camera (isometric orthographic) --------
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 2000);
const camState = {
  zoom: 1.0,
  yaw: Math.PI * 0.25,
  pitch: Math.atan(1 / Math.SQRT2),
  target: new THREE.Vector3(0, 0, 0),
  mode: 'orbit' as 'static' | 'orbit' | 'fly',
  paused: false,
};

function resizeCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const viewSize = 95 / camState.zoom;
  camera.left = -viewSize * aspect;
  camera.right = viewSize * aspect;
  camera.top = viewSize;
  camera.bottom = -viewSize;
  camera.updateProjectionMatrix();
}

function placeCamera() {
  const r = 240;
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
sun.shadow.camera.left = -180;
sun.shadow.camera.right = 180;
sun.shadow.camera.top = 110;
sun.shadow.camera.bottom = -110;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 420;
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.05;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0x88aaff, 0x2a1a0a, 0.55);
scene.add(hemi);

const rim = new THREE.DirectionalLight(0x80a8ff, 0.45);
rim.position.set(-60, 40, -80);
scene.add(rim);

scene.fog = new THREE.FogExp2(0x0c1014, 0.003);

// -------- world --------
const groundMat = createGround(WORLD.width, WORLD.depth);
scene.add(groundMat.mesh);

// ---- arenas (mirror game's westArena/eastArena around bases) ----
const ARENA_R = 110 * SCALE; // = 20.625
const playerArena = createArena(ARENA_R);
playerArena.group.position.set(gx(150), 0, gz(540));
scene.add(playerArena.group);

const enemyArena = createArena(ARENA_R);
enemyArena.group.position.set(gx(1770), 0, gz(540));
scene.add(enemyArena.group);

// ---- lanes (Nord/Midt/Sør) — mirror CONFIG.LANES exactly ----
const LANE_DEFS: LaneDef[] = [
  {
    id: 0,
    label: 'Nord',
    baseWidth: 56 * SCALE,
    waypoints: [
      { x: gx(220),  z: gz(500) }, { x: gx(380),  z: gz(380) },
      { x: gx(600),  z: gz(240) }, { x: gx(880),  z: gz(200) },
      { x: gx(1180), z: gz(260) }, { x: gx(1420), z: gz(360) },
      { x: gx(1620), z: gz(460) }, { x: gx(1700), z: gz(540) },
    ],
  },
  {
    id: 1,
    label: 'Midt',
    baseWidth: 60 * SCALE,
    waypoints: [
      { x: gx(220),  z: gz(540) }, { x: gx(440),  z: gz(580) },
      { x: gx(720),  z: gz(510) }, { x: gx(980),  z: gz(580) },
      { x: gx(1260), z: gz(500) }, { x: gx(1500), z: gz(560) },
      { x: gx(1700), z: gz(540) },
    ],
  },
  {
    id: 2,
    label: 'Sør',
    baseWidth: 56 * SCALE,
    waypoints: [
      { x: gx(220),  z: gz(580) }, { x: gx(380),  z: gz(700) },
      { x: gx(600),  z: gz(840) }, { x: gx(880),  z: gz(880) },
      { x: gx(1180), z: gz(820) }, { x: gx(1420), z: gz(720) },
      { x: gx(1620), z: gz(620) }, { x: gx(1700), z: gz(540) },
    ],
  },
];
const lanes: Lane[] = LANE_DEFS.map(buildLane);
const laneMeshes = lanes.map(buildLaneMesh);
laneMeshes.forEach((lm) => scene.add(lm.group));

// ---- mounds ----
const playerMound = createMound({ color: 0x2a1a10, accent: 0xf0a050, glow: 0xffa040 });
playerMound.group.position.set(gx(150), 0, gz(540));
playerMound.group.rotation.y = -Math.PI / 2; // entrance facing east (toward enemy)
scene.add(playerMound.group);

const aiMound = createMound({ color: 0x6e2a14, accent: 0xff7030, glow: 0xff5020, scale: 0.95 });
aiMound.group.position.set(gx(1770), 0, gz(540));
aiMound.group.rotation.y = Math.PI / 2; // entrance facing west
scene.add(aiMound.group);

// ---- towers — placed in grass between/outside lanes ----
const towerSpots: Array<[number, number, TowerKind, 'player' | 'ai']> = [
  // player side (west)
  [gx(420), gz(440), 'stinger', 'player'],
  [gx(420), gz(640), 'webber',  'player'],
  [gx(600), gz(540), 'spitter', 'player'],
  [gx(820), gz(360), 'stinger', 'player'],
  [gx(820), gz(720), 'webber',  'player'],
  // ai side (east)
  [gx(1380), gz(440), 'stinger', 'ai'],
  [gx(1380), gz(640), 'spitter', 'ai'],
  [gx(1180), gz(380), 'stinger', 'ai'],
];
const towers = towerSpots.map(([x, z, kind, side]) => {
  const t = createTower(kind, side);
  t.group.position.set(x, 0, z);
  scene.add(t.group);
  return t;
});

// ---- pebble rocks — scattered in non-lane grass ----
const rockSpots: Array<[number, number, number]> = [
  [gx(560),  gz(380), 0.9], [gx(750),  gz(660), 1.1],
  [gx(940),  gz(440), 0.8], [gx(1080), gz(720), 1.0],
  [gx(1280), gz(620), 1.2], [gx(380),  gz(800), 0.7],
  [gx(1480), gz(360), 0.9], [gx(640),  gz(880), 0.8],
  [gx(960),  gz(140), 1.3], [gx(1320), gz(880), 0.9],
];
rockSpots.forEach(([x, z, s]) => {
  const r = createRock(s);
  r.position.set(x, 0, z);
  r.rotation.y = Math.random() * Math.PI;
  scene.add(r);
});

// ---- aphid plants — decorative greenery in grass pockets ----
const farmSpots: Array<[number, number]> = [
  [gx(560),  gz(440)], [gx(820),  gz(680)],
  [gx(1180), gz(380)], [gx(1380), gz(720)],
  [gx(380),  gz(720)], [gx(1500), gz(440)],
];
farmSpots.forEach(([x, z]) => {
  const f = createAphidFarm();
  f.position.set(x, 0, z);
  scene.add(f);
});

// ---- trees — perimeter + clusters that respect lanes ----
// Skip if within ~12 units of any lane sample or arena
function nearAnyLane(x: number, z: number, margin: number): boolean {
  for (const lane of lanes) {
    for (const s of lane.samples) {
      const dx = s.x - x, dz = s.z - z;
      if (dx * dx + dz * dz < margin * margin) return true;
    }
  }
  // arenas
  const dwx = x - gx(150),  dwz = z - gz(540);
  if (dwx * dwx + dwz * dwz < (ARENA_R + 6) * (ARENA_R + 6)) return true;
  const dex = x - gx(1770), dez = z - gz(540);
  if (dex * dex + dez * dez < (ARENA_R + 6) * (ARENA_R + 6)) return true;
  return false;
}

const treeSpots: Array<[number, number, number]> = [];
let attempts = 0;
while (treeSpots.length < 70 && attempts < 800) {
  attempts++;
  const x = (Math.random() - 0.5) * 340;
  const z = (Math.random() - 0.5) * 200;
  if (nearAnyLane(x, z, 12)) continue;
  // also keep towers happy — small margin
  let tooCloseTower = false;
  for (const [tx, tz] of towerSpots) {
    const dx = tx - x, dz = tz - z;
    if (dx * dx + dz * dz < 9 * 9) { tooCloseTower = true; break; }
  }
  if (tooCloseTower) continue;
  treeSpots.push([x, z, 0.65 + Math.random() * 0.7]);
}
// dense perimeter ring
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  const x = Math.cos(a) * 165;
  const z = Math.sin(a) * 105;
  treeSpots.push([x, z, 0.8 + Math.random() * 0.6]);
}
treeSpots.forEach(([x, z, s]) => {
  const t = createTree(s);
  t.position.set(x, 0, z);
  t.rotation.y = Math.random() * Math.PI;
  scene.add(t);
});

// ---- fireflies ----
const fireflies = createFireflies(180, WORLD);
scene.add(fireflies.points);

// ---- ant swarms ----
const playerAnts = new AntSwarm({
  count: 70,
  baseColor: 0x141414,
  legColor: 0x444444,
  mandibleColor: 0xddccaa,
  lanes,
  side: 'player',
  homePos: { x: gx(150), z: gz(540) },
  arenaRadius: ARENA_R,
});
scene.add(playerAnts.group);

const aiAnts = new AntSwarm({
  count: 70,
  baseColor: 0x6e2a14,
  legColor: 0x5a2010,
  mandibleColor: 0xeebb88,
  lanes,
  side: 'ai',
  homePos: { x: gx(1770), z: gz(540) },
  arenaRadius: ARENA_R,
});
scene.add(aiAnts.group);

// -------- post-processing --------
const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.85, 0.7, 0.6,
);
composer.addPass(bloomPass);
composer.addPass(new ShaderPass(vignetteShader));
composer.addPass(new OutputPass());

// -------- palette --------
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
  laneMeshes.forEach((lm) => lm.setNightFactor(p.nightFactor));
  playerArena.setNightFactor(p.nightFactor);
  enemyArena.setNightFactor(p.nightFactor);
  fireflies.setIntensity(p.firefly);
  towers.forEach((t) => t.setGlow(p.nightFactor));
  playerMound.setGlow(p.nightFactor);
  aiMound.setGlow(p.nightFactor);
}

applyPalette(palette.current);

// -------- input --------
const input = { dragging: false, lastX: 0, lastY: 0 };

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
  const panScale = 0.35 / camState.zoom;
  const sx = Math.sin(camState.yaw);
  const cx = Math.cos(camState.yaw);
  camState.target.x -= (dx * cx + dy * sx * 0.6) * panScale;
  camState.target.z -= (-dx * sx + dy * cx * 0.6) * panScale;
  camState.target.x = THREE.MathUtils.clamp(camState.target.x, -140, 140);
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

// -------- HUD --------
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

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (!camState.paused) {
    if (camState.mode === 'orbit') {
      camState.yaw += dt * 0.08;
    } else if (camState.mode === 'fly') {
      camState.yaw += dt * 0.04;
      camState.target.x = Math.sin(time * 0.15) * 60;
      camState.target.z = Math.cos(time * 0.11) * 30;
    }
  }
  placeCamera();
  sun.target.position.copy(camState.target);

  if (palette.auto) {
    palette.t += dt * 0.05;
    const cycle = (Math.sin(palette.t) + 1) / 2;
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

  groundMat.update(time);
  laneMeshes.forEach((lm) => lm.update(time));
  fireflies.update(time, dt);
  playerAnts.update(time, dt);
  aiAnts.update(time, dt);
  towers.forEach((t) => t.update(time, dt));
  playerMound.update(time);
  aiMound.update(time);

  composer.render();

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
