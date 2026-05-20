import { CONFIG } from './config';

export type WavePhase = 'prep' | 'spawning' | 'mopUp' | 'victory';

export type WaveDef = (typeof CONFIG.WAVE_MODE.waves)[number];

export interface WaveSpawnRequest {
  lane: 0 | 1 | 2;
  tank: boolean;
  boss: boolean;
}

/**
 * Tower Defense wave-state-machine.
 *
 *   prep      → countdown før neste bølge. Spilleren kan bygge tårn / sende soldater.
 *               Hopp over via wave-ready-command.
 *   spawning  → kjører creep-spawns med fast intervall. Beste-praksis: distribuer
 *               creeps over lanes når wave.lane === 'all'.
 *   mopUp     → alle creeps spawnet; venter til AI-units er døde (eller har nådd basen).
 *   victory   → siste wave klar, ingen creeps igjen.
 *
 * GameScene driver state-maskinen via tick() og leverer creeps via spawnCallback.
 */
export class WaveManager {
  private phase: WavePhase = 'prep';
  private waveIndex = -1;             // -1 før første bølge starter
  private spawnQueue = 0;             // creeps igjen å spawne i nåværende bølge
  private spawnTimer = 0;             // ms til neste spawn
  private prepRemaining = 0;
  private nextLaneRR: 0 | 1 | 2 = 0;  // round-robin for 'all'-lane bølger

  private spawnCallback: (req: WaveSpawnRequest) => void;

  constructor(spawnCallback: (req: WaveSpawnRequest) => void) {
    this.spawnCallback = spawnCallback;
    this.prepRemaining = CONFIG.WAVE_PREP_MS;
  }

  get currentPhase(): WavePhase { return this.phase; }
  get currentWaveIndex(): number { return this.waveIndex; }
  /** 1-indeksert wave-nummer for HUD; 0 før første. */
  get displayWave(): number { return Math.max(0, this.waveIndex + 1); }
  get totalWaves(): number { return CONFIG.WAVE_MODE.waves.length; }
  get isPreparing(): boolean { return this.phase === 'prep'; }
  get prepRemainingMs(): number { return Math.max(0, this.prepRemaining); }
  get remainingInWave(): number { return this.spawnQueue; }

  /** Neste bølge sin definisjon (for HUD-preview), eller null hvis ingen flere. */
  get nextWaveDef(): WaveDef | null {
    const next = this.waveIndex + 1;
    if (next >= CONFIG.WAVE_MODE.waves.length) return null;
    return CONFIG.WAVE_MODE.waves[next];
  }

  /** Spilleren trykker "Klar" — hopp over resterende prep-tid. */
  skipPrep() {
    if (this.phase === 'prep') this.prepRemaining = 0;
  }

  /**
   * Kjør én tick av wave-loopen.
   *
   * @param dtMs    Delta i ms (allerede skalert med gameSpeed).
   * @param aiAlive Antall levende AI-enheter (creeps) i scenen.
   * @returns       True hvis spillet nådde victory denne tick-en (alle bølger klar + ingen creeps igjen).
   */
  tick(dtMs: number, aiAlive: number): boolean {
    switch (this.phase) {
      case 'prep': {
        this.prepRemaining -= dtMs;
        if (this.prepRemaining <= 0) this.beginNextWave();
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
          this.phase = 'prep';
          this.prepRemaining = CONFIG.WAVE_PREP_MS;
        }
        break;
      }
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
      lane = this.nextLaneRR;
      this.nextLaneRR = ((this.nextLaneRR + 1) % 3) as 0 | 1 | 2;
    } else {
      lane = wave.lane;
    }
    this.spawnCallback({ lane, tank: wave.tank, boss: wave.boss && this.spawnQueue === 1 });
    this.spawnQueue -= 1;
    this.spawnTimer = wave.spawnInterval;
  }
}
