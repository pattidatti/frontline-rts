// Event bridge between the Phaser GameScene and the React HUD overlay.
// GameScene pushes state snapshots; the HUD sends commands back.

export type Faction = 'player' | 'ai' | 'neutral';

export interface HudUnit {
  x: number; y: number;
  faction: Exclude<Faction, 'neutral'>;
  type: 'worker' | 'soldier';
}

export interface HudBuilding {
  x: number; y: number; w: number; h: number;
  faction: Faction;
  kind: 'base' | 'barracks' | 'mine' | 'bridge' | 'tower' | 'farm' | 'wall' | 'armory';
  hp: number; maxHp: number;
  /** Kun for mines: hvilken faksjon kontrollerer (eller 'contested'). */
  control?: 'player' | 'ai' | 'contested' | null;
  /** Kun for towers: hvilken tower-type. */
  towerType?: TowerKind;
  /** M3.2 — settes på player-base når Forsvar er kjøpt. */
  hasDefense?: boolean;
  /** True hvis bygningen er under konstruksjon (worker bygger den fortsatt). */
  underConstruction?: boolean;
  /** Konstruksjonsprogress 0..1; udefinert for ferdige bygninger. */
  buildProgress?: number;
}

/** M2.1 — tower-typer */
export type TowerKind = 'stinger' | 'webber' | 'spitter';

/** M3.1 — bygg-typer (ikke-tower). */
export type BuildingKind = 'farm' | 'wall' | 'armory' | 'barracks';

/** M3.1 — alt som kan bygges via build-mode. */
export type BuildKind = TowerKind | BuildingKind;

/** M2.1 / M3.1 — aktiv build-mode (vises som ghost-preview + status i HUD). */
export interface HudBuildMode {
  kind: BuildKind;
  cost: number;
  canAfford: boolean;
}

/** M2.2 — wave-modus status */
export interface HudWaveState {
  current: number;       // 1-indeksert
  total: number;
  /** ms til neste bølge starter (0 = bølge pågår). */
  nextInMs: number;
  /** true når bølge er aktiv (units i spawnet pågår). */
  active: boolean;
}

export interface HudSelection {
  kind: 'units' | 'building' | 'none';
  // For 'units':
  workers?: number;
  soldiers?: number;
  // If exactly one unit:
  singleType?: 'worker' | 'soldier';
  singleHp?: number;
  singleMaxHp?: number;
  /** V5 — kun for single unit: hva enheten gjør akkurat nå (vises som progress / status-tekst). */
  currentAction?: {
    type: 'idle' | 'moving' | 'mining' | 'building' | 'attacking';
    label: string;
    /** 0..1 hvis aktiviteten har konkret framgang (building). */
    progress?: number;
  };
  // For 'building':
  building?: HudBuilding;
}

/** M1.5 — kortvarig HUD-varsel (banner) */
export interface HudAlert {
  message: string;
  /** 'critical' = blinkende rødt, 'warn' = gul */
  urgency: 'critical' | 'warn';
  /** Tidsstempel (ms) som idempotent-id for animasjon-trigger på HUD-siden. */
  triggeredAt: number;
}

export interface HudState {
  state: 'running' | 'won' | 'lost';
  time: number;
  player: {
    gold: number;
    workers: number;
    soldiers: number;
    baseHp: number; baseMaxHp: number;
    barracksHp: number; barracksMaxHp: number;
  };
  enemy: {
    gold: number;
    workers: number;
    soldiers: number;
    baseHp: number; baseMaxHp: number;
  };
  costs: { worker: number; soldier: number };
  selection: HudSelection;
  map: { width: number; height: number };
  camera: { x: number; y: number; width: number; height: number };
  minimap: { units: HudUnit[]; buildings: HudBuilding[] };
  stats: {
    trained: number;
    goldEarned: number;
    /** V7 — utvidet stats for game-over panel. */
    soldiersTrained: number;
    workersTrained: number;
    enemyKills: number;
    unitsLost: number;
    peakMines: number;
    aiTowers: number;
    playerTowers: number;
  };

  /** M1.1 — 0 = paused, ellers fra CONFIG.TIME_SCALES. */
  gameSpeed: number;
  /** M1.5 — siste varsel; HUD viser banneret i ~3 s etter triggeredAt. */
  alert: HudAlert | null;

  /** M2.1 — aktiv build-mode (null = ikke i build-modus). */
  buildMode: HudBuildMode | null;
  /** M2.2 — wave-modus state (null = klassisk modus). */
  waveMode: HudWaveState | null;
}

export type HudCommand =
  | { type: 'train'; unit: 'worker' | 'soldier' }
  | { type: 'select-all-soldiers' }
  | { type: 'select-all-workers' }
  | { type: 'clear-selection' }
  | { type: 'restart' }
  | { type: 'minimap-pan'; x: number; y: number }
  | { type: 'minimap-attack'; x: number; y: number }
  | { type: 'toggle-pause' }
  | { type: 'cycle-speed' }
  | { type: 'build-tower-start'; tower: TowerKind }
  | { type: 'build-start'; kind: BuildKind }
  | { type: 'build-cancel' }
  | { type: 'formation' }
  | { type: 'upgrade-base-defense' }
  /** V7 — tilbake til MenuScene fra game-over. */
  | { type: 'to-menu' };

type StateListener = (s: HudState) => void;
type CommandListener = (c: HudCommand) => void;

class HudBridge {
  private stateListeners = new Set<StateListener>();
  private commandListeners = new Set<CommandListener>();
  private latest: HudState | null = null;

  emitState(s: HudState) {
    this.latest = s;
    this.stateListeners.forEach((l) => l(s));
  }
  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    if (this.latest) fn(this.latest);
    return () => this.stateListeners.delete(fn);
  }

  sendCommand(c: HudCommand) {
    this.commandListeners.forEach((l) => l(c));
  }
  onCommand(fn: CommandListener): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }
}

export const hudBridge = new HudBridge();
