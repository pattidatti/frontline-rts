// M1.4 — Audio-laget. Phaser-native sound, mute + volume i localStorage.
//
// Lyd-filer skal ligge i public/sfx/<name>.mp3. Hvis en fil mangler logges
// kun en advarsel — play() er en no-op. Det lar oss bygge ut hooks før
// noen CC0-asset er lastet ned (se public/sfx/CREDITS.md).

import Phaser from 'phaser';
import { CONFIG } from './config';

export type SfxKey =
  | 'click'
  | 'train'
  | 'attack'
  | 'unit-die'
  | 'base-alarm'
  | 'victory'
  | 'defeat';

const SFX_FILES: Record<SfxKey, string> = {
  'click':       'sfx/click.mp3',
  'train':       'sfx/train.mp3',
  'attack':      'sfx/attack.mp3',
  'unit-die':    'sfx/unit-die.mp3',
  'base-alarm':  'sfx/base-alarm.mp3',
  'victory':     'sfx/victory.mp3',
  'defeat':      'sfx/defeat.mp3',
};

const STORAGE_KEY = 'frontline_volume';

let cachedVolume: number | null = null;

export function getVolume(): number {
  if (cachedVolume != null) return cachedVolume;
  if (typeof window === 'undefined') return CONFIG.AUDIO_DEFAULT_VOLUME;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  const parsed = raw != null ? Number(raw) : NaN;
  cachedVolume = Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : CONFIG.AUDIO_DEFAULT_VOLUME;
  return cachedVolume;
}

const volumeListeners = new Set<(v: number) => void>();

export function onVolumeChange(fn: (v: number) => void): () => void {
  volumeListeners.add(fn);
  return () => volumeListeners.delete(fn);
}

export function setVolume(v: number) {
  cachedVolume = Math.max(0, Math.min(1, v));
  try { window.localStorage.setItem(STORAGE_KEY, String(cachedVolume)); } catch { /* private mode */ }
  volumeListeners.forEach((l) => l(cachedVolume!));
}

/**
 * Last alle SFX som faktisk eksisterer.
 *
 * Probing er nødvendig fordi Vite dev-serveren (og statiske hostere generelt)
 * gjerne serverer index.html på 404 i stedet for å returnere 404 — Phaser
 * får da "200 OK med HTML" og logger spammy decode-feil. Vi sjekker derfor
 * Content-Type med HEAD før vi kø-legger filen i loader-en.
 *
 * Probing kjøres asynkront og scenen startes umiddelbart; lyder dukker bare
 * opp etter at probingen er ferdig (typisk under en sekund). Det er greit
 * fordi spillet er funksjonelt uten lyd.
 */
export function loadAllSfx(scene: Phaser.Scene) {
  void probeAndLoadSfx(scene);
}

async function probeAndLoadSfx(scene: Phaser.Scene) {
  const baseUrl = (import.meta.env?.BASE_URL ?? '/') as string;
  const entries = Object.entries(SFX_FILES) as [SfxKey, string][];
  const toLoad: Array<[SfxKey, string]> = [];

  await Promise.all(entries.map(async ([key, relPath]) => {
    const url = baseUrl.replace(/\/$/, '') + '/' + relPath;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      if (!res.ok) return;
      const ct = res.headers.get('content-type') ?? '';
      if (!ct.startsWith('audio/')) return;
      toLoad.push([key, url]);
    } catch {
      // network feil — ignorer (no-op for denne keyen)
    }
  }));

  if (toLoad.length === 0) return;
  for (const [key, url] of toLoad) scene.load.audio(key, url);
  scene.load.start();
}

/** Spill en SFX hvis filen er lastet, ellers no-op. */
export function playSfx(scene: Phaser.Scene, key: SfxKey, opts?: { volume?: number; loop?: boolean }) {
  if (!scene?.sound) return;
  if (!scene.cache.audio.exists(key)) return;
  const base = getVolume();
  if (base <= 0) return;
  const finalVol = base * (opts?.volume ?? 1);
  scene.sound.play(key, { volume: finalVol, loop: opts?.loop ?? false });
}

/**
 * Hold en looping-lyd kjørende mens en betingelse er true (idempotent — kan kalles
 * hver tick uten å lage flere instanser). Returnerer stop()-handle.
 *
 * Brukes for base-alarm når HP under 50%.
 */
export class LoopingSfx {
  private sound: Phaser.Sound.BaseSound | null = null;
  private active = false;
  private readonly scene: Phaser.Scene;
  private readonly key: SfxKey;
  private readonly volume: number;
  constructor(scene: Phaser.Scene, key: SfxKey, volume = 1) {
    this.scene = scene;
    this.key = key;
    this.volume = volume;
  }

  start() {
    if (this.active) return;
    if (!this.scene.cache.audio.exists(this.key)) return;
    if (getVolume() <= 0) return;
    this.sound = this.scene.sound.add(this.key, { loop: true, volume: getVolume() * this.volume });
    this.sound.play();
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    this.sound?.stop();
    this.sound?.destroy();
    this.sound = null;
    this.active = false;
  }

  /** Oppdater volum hvis getVolume() har endret seg utenfra. */
  refreshVolume() {
    if (!this.active || !this.sound) return;
    (this.sound as Phaser.Sound.WebAudioSound).setVolume?.(getVolume() * this.volume);
  }
}
