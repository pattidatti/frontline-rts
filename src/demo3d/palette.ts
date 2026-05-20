import * as THREE from 'three';

export type TimePreset = 'dawn' | 'dusk' | 'night' | 'auto';

export interface Palette {
  sky: number;
  fog: number;
  fogDensity: number;
  sunColor: number;
  sunIntensity: number;
  sunDir: [number, number, number];
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  rimColor: number;
  rimIntensity: number;
  bloom: number;
  exposure: number;
  nightFactor: number; // 0 day, 1 night — drives emissives
  firefly: number;
}

export const TIME_PRESETS: Record<Exclude<TimePreset, 'auto'>, Palette> = {
  dawn: {
    sky: 0x6a5078,
    fog: 0x806a78,
    fogDensity: 0.0028,
    sunColor: 0xffc888,
    sunIntensity: 2.4,
    sunDir: [0.4, 0.6, 0.8],
    hemiSky: 0xffd0a8,
    hemiGround: 0x2a1a18,
    hemiIntensity: 0.85,
    rimColor: 0x8090ff,
    rimIntensity: 0.45,
    bloom: 0.7,
    exposure: 1.15,
    nightFactor: 0.25,
    firefly: 0.25,
  },
  dusk: {
    sky: 0x2a1820,
    fog: 0x281820,
    fogDensity: 0.0042,
    sunColor: 0xff8048,
    sunIntensity: 1.6,
    sunDir: [-0.6, 0.55, 0.5],
    hemiSky: 0x6a4060,
    hemiGround: 0x1a1008,
    hemiIntensity: 0.5,
    rimColor: 0x6060ff,
    rimIntensity: 0.65,
    bloom: 0.95,
    exposure: 1.1,
    nightFactor: 0.7,
    firefly: 0.85,
  },
  night: {
    sky: 0x06090e,
    fog: 0x080a14,
    fogDensity: 0.006,
    sunColor: 0x5060a0,
    sunIntensity: 0.7,
    sunDir: [-0.3, 0.75, 0.55],
    hemiSky: 0x202858,
    hemiGround: 0x050608,
    hemiIntensity: 0.3,
    rimColor: 0x4060ff,
    rimIntensity: 0.5,
    bloom: 1.25,
    exposure: 0.95,
    nightFactor: 1.0,
    firefly: 1.0,
  },
};

const _ca = new THREE.Color();
const _cb = new THREE.Color();
function lerpHex(a: number, b: number, t: number): number {
  _ca.setHex(a);
  _cb.setHex(b);
  _ca.lerp(_cb, t);
  return _ca.getHex();
}

export function lerpPalette(a: Palette, b: Palette, t: number): Palette {
  const k = THREE.MathUtils.clamp(t, 0, 1);
  return {
    sky: lerpHex(a.sky, b.sky, k),
    fog: lerpHex(a.fog, b.fog, k),
    fogDensity: THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, k),
    sunColor: lerpHex(a.sunColor, b.sunColor, k),
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, k),
    sunDir: [
      THREE.MathUtils.lerp(a.sunDir[0], b.sunDir[0], k),
      THREE.MathUtils.lerp(a.sunDir[1], b.sunDir[1], k),
      THREE.MathUtils.lerp(a.sunDir[2], b.sunDir[2], k),
    ],
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, k),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, k),
    hemiIntensity: THREE.MathUtils.lerp(a.hemiIntensity, b.hemiIntensity, k),
    rimColor: lerpHex(a.rimColor, b.rimColor, k),
    rimIntensity: THREE.MathUtils.lerp(a.rimIntensity, b.rimIntensity, k),
    bloom: THREE.MathUtils.lerp(a.bloom, b.bloom, k),
    exposure: THREE.MathUtils.lerp(a.exposure, b.exposure, k),
    nightFactor: THREE.MathUtils.lerp(a.nightFactor, b.nightFactor, k),
    firefly: THREE.MathUtils.lerp(a.firefly, b.firefly, k),
  };
}
