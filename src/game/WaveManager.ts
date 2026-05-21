import { CONFIG, type UnitKind } from './config';

export type WavePhase = 'idle' | 'countdown' | 'spawning' | 'mopUp' | 'upgradeChoice' | 'victory';

export type WaveDef = (typeof CONFIG.WAVE_MODE.waves)[number];

export interface WaveSpawnRequest {
  lane: 0 | 1 | 2;
  unitKind: UnitKind;
  boss: boolean;
}

/**
 * Tower Defense wave-state-machine.
 *
 *   idle           → venter på at spilleren trykker "Start bølge".
 *   countdown      → 3-2-1-tikker før bølgen starter (likt for spiller og fiende).
 *   spawning       → kjører creep-spawns med fast intervall. Spiller kan bygge og sende units.
 *   mopUp          → alle creeps spawnet; venter til AI-units er døde.
 *   upgradeChoice  → mellom bølgene; tilbake til idle etter valg.
 *   victory        → alle bølger klar.
 */
export class WaveManager {
  private phase: WavePhase = 'idle';
  private waveIndex = -1;
  private spawnQueue = 0;
  private spawnTimer = 0;
  private countdownRemaining = 0;
  private nextLaneRR: 0 | 1 | 2 = 0;

  private spawnCallback: (req: WaveSpawnRequest) => void;
  /** Hvilke laner som er åpne akkurat nå. Settes av GameScene ved stage-skift. */
  private activeLanes: ReadonlyArray<0 | 1 | 2> = [0, 1, 2];

  constructor(spawnCallback: (req: WaveSpawnRequest) => void) {
    this.spawnCallback = spawnCallback;
  }

  setActiveLanes(lanes: ReadonlyArray<0 | 1 | 2>) {
    if (lanes.length === 0) {
      this.activeLanes = [0, 1, 2];
      return;
    }
    this.activeLanes = lanes.slice();
    if (!this.activeLanes.includes(this.nextLaneRR)) {
      this.nextLaneRR = this.activeLanes[0];
    }
  }

  get currentPhase(): WavePhase { return this.phase; }
  get currentWaveIndex(): number { return this.waveIndex; }
  get displayWave(): number { return Math.max(0, this.waveIndex + 1); }
  get totalWaves(): number { return CONFIG.WAVE_MODE.waves.length; }
  get isIdle(): boolean { return this.phase === 'idle'; }
  get isCountdown(): boolean { return this.phase === 'countdown'; }
  get isActive(): boolean { return this.phase === 'spawning' || this.phase === 'mopUp'; }
  get isChoosingUpgrade(): boolean { return this.phase === 'upgradeChoice'; }
  get countdownRemainingMs(): number { return Math.max(0, this.countdownRemaining); }
  get remainingInWave(): number { return this.spawnQueue; }
  /** Nummeret på bølgen som vises i countdown (1-indeksert). */
  get nextWaveNumber(): number { return this.waveIndex + 2; }

  /** Forlat upgradeChoice-fasen og gå til idle, så spilleren kan starte neste bølge. */
  resolveUpgradeChoice() {
    if (this.phase === 'upgradeChoice') {
      this.phase = 'idle';
    }
  }

  get nextWaveDef(): WaveDef | null {
    const next = this.waveIndex + 1;
    if (next >= CONFIG.WAVE_MODE.waves.length) return null;
    return CONFIG.WAVE_MODE.waves[next];
  }

  /** Spilleren trykker "Start bølge" — kun gyldig når idle. Trigger 3-2-1-countdown. */
  startNextWave(): boolean {
    if (this.phase !== 'idle') return false;
    if (this.waveIndex + 1 >= CONFIG.WAVE_MODE.waves.length) return false;
    this.phase = 'countdown';
    this.countdownRemaining = CONFIG.WAVE_COUNTDOWN_MS;
    return true;
  }

  tick(dtMs: number, aiAlive: number): boolean {
    switch (this.phase) {
      case 'idle':
        // Venter på spilleren — ingen tikking.
        break;
      case 'countdown': {
        this.countdownRemaining -= dtMs;
        if (this.countdownRemaining <= 0) this.beginNextWave();
        break;
      }
      case 'spawning': {
        this.spawnTimer -= dtMs;
        if (this.spawnTimer <= 0 && this.spawnQueue > 0) {
          this.emitSpawn();
        }
        if (this.spawnQueue <= 0) this.phase = 'mopUp';
        break;
      }
      case 'mopUp': {
        if (aiAlive === 0) {
          if (this.waveIndex + 1 >= CONFIG.WAVE_MODE.waves.length) {
            this.phase = 'victory';
            return true;
          }
          this.phase = 'upgradeChoice';
        }
        break;
      }
      case 'upgradeChoice':
        // Vent på at GameScene/HUD løser valget via resolveUpgradeChoice().
        break;
      case 'victory':
        return true;
    }
    return false;
  }

  private beginNextWave() {
    this.waveIndex += 1;
    const wave = CONFIG.WAVE_MODE.waves[this.waveIndex];
    this.spawnQueue = wave.soldiers;
    this.spawnTimer = 0;
    this.phase = 'spawning';
  }

  private emitSpawn() {
    const wave = CONFIG.WAVE_MODE.waves[this.waveIndex];
    let lane: 0 | 1 | 2;
    if (wave.lane === 'all') {
      // Round-robin gjennom kun de åpne lanene.
      const idx = this.activeLanes.indexOf(this.nextLaneRR);
      const nextIdx = idx < 0 ? 0 : (idx + 1) % this.activeLanes.length;
      lane = this.nextLaneRR;
      this.nextLaneRR = this.activeLanes[nextIdx];
    } else {
      // Eksplisitt lane fra wave-config. Hvis den ikke er åpen (skal ikke skje med
      // riktig konfigurert STAGES + waves), fall tilbake til første åpne lane.
      lane = this.activeLanes.includes(wave.lane) ? wave.lane : this.activeLanes[0];
    }
    this.spawnCallback({ lane, unitKind: wave.unitKind, boss: wave.boss && this.spawnQueue === 1 });
    this.spawnQueue -= 1;
    this.spawnTimer = wave.spawnInterval;
  }
}
