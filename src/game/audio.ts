// M1.4 — Audio-laget. Phaser-native sound, mute + volume i localStorage.
//
// To-tier lyd: prøv først å laste lyd-filer fra public/sfx/<name>.mp3
// (probet med HEAD). Hvis ingen filer eksisterer, falle tilbake til
// prosedural WebAudio-syntese så spillet alltid har feedback.
//
// Manuell nedlasting av CC0-filer er beskrevet i public/sfx/CREDITS.md.

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

// ── File-based loader (preferred when CC0 .mp3 files are present) ────────

const loadedKeys = new Set<SfxKey>();

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
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    for (const [key] of toLoad) loadedKeys.add(key);
  });
  scene.load.start();
}

// ── Procedural fallback (WebAudio) ───────────────────────────────────────

let audioCtx: AudioContext | null = null;
let unlocked = false;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctor) return null;
  try {
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function ensureUnlocked() {
  // Browsers krever brukerinteraksjon før AudioContext kan brukes.
  // Phaser kaller playSfx etter klikk/keydown, så contextet er typisk allerede unlocked.
  if (unlocked) return;
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume();
  unlocked = true;
}

interface ProceduralSpec {
  type: OscillatorType;
  /** Hz */
  freq: number;
  /** semitones — om != 0 sveiper frekvensen */
  glide?: number;
  /** ms */
  duration: number;
  /** 0..1 — relativt volum innen denne lyden */
  gain: number;
  /** Antall hurtige repeats (klikk-ish) */
  repeats?: number;
  repeatGap?: number;
  /** Sekundær oscillator for harmonics */
  harmonic?: { freq: number; type: OscillatorType; gain: number };
}

const PROCEDURAL: Record<SfxKey, ProceduralSpec> = {
  'click':      { type: 'square',   freq: 880,  duration: 60,  gain: 0.18 },
  'train':      { type: 'sine',     freq: 520,  glide: 7,  duration: 180, gain: 0.22, harmonic: { freq: 780, type: 'triangle', gain: 0.12 } },
  'attack':     { type: 'square',   freq: 220,  glide: -5, duration: 80,  gain: 0.20 },
  'unit-die':   { type: 'sawtooth', freq: 320,  glide: -12, duration: 220, gain: 0.20 },
  'base-alarm': { type: 'sawtooth', freq: 440,  glide: 5,  duration: 420, gain: 0.15, harmonic: { freq: 330, type: 'square', gain: 0.10 } },
  'victory':    { type: 'triangle', freq: 523,  duration: 260, gain: 0.28, repeats: 3, repeatGap: 130, harmonic: { freq: 659, type: 'sine', gain: 0.18 } },
  'defeat':     { type: 'sawtooth', freq: 220,  glide: -10, duration: 600, gain: 0.26, harmonic: { freq: 110, type: 'sine', gain: 0.18 } },
};

function playProcedural(key: SfxKey, volMult: number) {
  ensureUnlocked();
  const ctx = getCtx();
  if (!ctx) return;
  const spec = PROCEDURAL[key];
  if (!spec) return;

  const baseVol = getVolume();
  const finalVol = Math.max(0, Math.min(1, baseVol * volMult * spec.gain));
  if (finalVol <= 0) return;

  const repeats = spec.repeats ?? 1;
  const gap = spec.repeatGap ?? 0;
  for (let i = 0; i < repeats; i++) {
    const start = ctx.currentTime + (i * gap) / 1000;
    playSingleTone(ctx, spec, start, finalVol);
    if (spec.harmonic) {
      playSingleTone(
        ctx,
        { ...spec, type: spec.harmonic.type, freq: spec.harmonic.freq },
        start,
        finalVol * (spec.harmonic.gain / spec.gain),
      );
    }
  }
}

function playSingleTone(ctx: AudioContext, spec: ProceduralSpec, startAt: number, vol: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, startAt);
  if (spec.glide) {
    const target = spec.freq * Math.pow(2, spec.glide / 12);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, target), startAt + spec.duration / 1000);
  }
  // ADSR — kort attack, eksponentiell decay
  gain.gain.setValueAtTime(0, startAt);
  gain.gain.linearRampToValueAtTime(vol, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + spec.duration / 1000);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + spec.duration / 1000 + 0.05);
}

// ── Public play API ─────────────────────────────────────────────────────

/** Spill en SFX — bruker fil hvis lastet, ellers prosedural fallback. */
export function playSfx(scene: Phaser.Scene, key: SfxKey, opts?: { volume?: number; loop?: boolean }) {
  if (!scene?.sound) return;
  const base = getVolume();
  if (base <= 0) return;
  const volMult = opts?.volume ?? 1;

  if (loadedKeys.has(key) && scene.cache.audio.exists(key)) {
    scene.sound.play(key, { volume: base * volMult, loop: opts?.loop ?? false });
    return;
  }

  // Looping er ikke trivielt å mappe til prosedural — vi spiller en kort syntese
  // og lar LoopingSfx-klassen håndtere repetisjon via egen timer.
  playProcedural(key, volMult);
}

/**
 * Hold en looping-lyd kjørende mens en betingelse er true (idempotent — kan kalles
 * hver tick uten å lage flere instanser). Returnerer stop()-handle.
 *
 * Brukes for base-alarm når HP under 50%. Hvis fil mangler, repeates prosedural
 * lyd manuelt på et intervall.
 */
export class LoopingSfx {
  private sound: Phaser.Sound.BaseSound | null = null;
  private active = false;
  private proceduralTimer: ReturnType<typeof setInterval> | null = null;
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
    if (getVolume() <= 0) return;

    if (loadedKeys.has(this.key) && this.scene.cache.audio.exists(this.key)) {
      this.sound = this.scene.sound.add(this.key, { loop: true, volume: getVolume() * this.volume });
      this.sound.play();
    } else {
      // Prosedural fallback — gjenta lyden hvert ~600ms
      const tick = () => playProcedural(this.key, this.volume);
      tick();
      this.proceduralTimer = setInterval(tick, 600);
    }
    this.active = true;
  }

  stop() {
    if (!this.active) return;
    this.sound?.stop();
    this.sound?.destroy();
    this.sound = null;
    if (this.proceduralTimer != null) {
      clearInterval(this.proceduralTimer);
      this.proceduralTimer = null;
    }
    this.active = false;
  }

  /** Oppdater volum hvis getVolume() har endret seg utenfra. */
  refreshVolume() {
    if (!this.active || !this.sound) return;
    (this.sound as Phaser.Sound.WebAudioSound).setVolume?.(getVolume() * this.volume);
  }
}
