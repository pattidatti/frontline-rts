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
  kind: 'base' | 'barracks' | 'mine' | 'bridge';
  hp: number; maxHp: number;
  /** Kun for mines: hvilken faksjon kontrollerer (eller 'contested'). */
  control?: 'player' | 'ai' | 'contested' | null;
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
  stats: { trained: number; goldEarned: number };

  /** M1.1 — 0 = paused, ellers fra CONFIG.TIME_SCALES. */
  gameSpeed: number;
  /** M1.5 — siste varsel; HUD viser banneret i ~3 s etter triggeredAt. */
  alert: HudAlert | null;
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
  | { type: 'cycle-speed' };

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
