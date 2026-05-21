// Event bridge between the Phaser GameScene and the React HUD overlay.

import type { UnitKind } from './config';

export type Faction = 'player' | 'ai' | 'neutral';

export interface HudUnit {
  x: number; y: number;
  faction: Exclude<Faction, 'neutral'>;
  kind: UnitKind;
}

export interface HudBuilding {
  x: number; y: number; w: number; h: number;
  faction: Faction;
  kind: 'base' | 'tower';
  hp: number; maxHp: number;
  towerType?: TowerKind;
}

export type TowerKind = 'stinger' | 'webber' | 'spitter';

export type BuildKind = TowerKind;

export interface HudBuildMode {
  kind: BuildKind;
  cost: number;
  canAfford: boolean;
}

export interface HudWaveState {
  current: number;
  total: number;
  active: boolean;
  /** Sann mens spilleren venter på å starte neste bølge (sentrert start-meny vises). */
  idle?: boolean;
  /** Sann mens 3-2-1-countdown spiller. */
  inCountdown?: boolean;
  countdownRemainingMs?: number;
  nextWavePreview?: { soldiers: number; lane: 0 | 1 | 2 | 'all'; unitKind: UnitKind; boss: boolean };
  /** Nummer på den kommende bølgen (vises i start-meny / countdown). */
  upcomingWaveNumber?: number;
  remainingEnemies?: number;
  /** Sann mens upgrade-modal vises mellom bølgene. */
  choosingUpgrade?: boolean;
}

export type HudUpgradeRarity = 'common' | 'rare' | 'epic' | 'cursed' | 'silly';

export interface HudUpgradeOption {
  id: string;
  name: string;
  description: string;
  flavor: string;
  rarity: HudUpgradeRarity;
  icon: string;
}

export interface HudUpgradeChoice {
  options: HudUpgradeOption[];
  /** Bølgen som ble nettopp klar — vises i header. */
  clearedWave: number;
  /** Tatte upgrade-id-er, til en liten "tagsbar". */
  taken: { id: string; name: string; icon: string }[];
}

export interface HudActiveUpgrade {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: HudUpgradeRarity;
}


export interface HudAlert {
  message: string;
  urgency: 'critical' | 'warn';
  triggeredAt: number;
}

/** Lane-portal screen-koordinater for HUD å plassere lane-knappene over. */
export interface HudLanePortal {
  lane: 0 | 1 | 2;
  /** Verdens-koordinater for portal-senter. HUD projiserer til skjerm-koord. */
  worldX: number; worldY: number;
}

export interface HudState {
  state: 'running' | 'won' | 'lost';
  time: number;
  player: {
    gold: number;
    soldiers: number;
    baseHp: number; baseMaxHp: number;
  };
  enemy: {
    soldiers: number;
    baseHp: number; baseMaxHp: number;
  };
  costs: Record<UnitKind, number>;
  /** Unit-typer ut over standard light/medium/heavy som er låst opp via upgrades. */
  unlockedUnits: UnitKind[];
  towerCosts: { stinger: number; webber: number; spitter: number };
  map: { width: number; height: number };
  minimap: { units: HudUnit[]; buildings: HudBuilding[] };
  stats: {
    soldiersTrained: number;
    enemyKills: number;
    unitsLost: number;
    goldEarned: number;
    playerTowers: number;
  };
  lanePortals: HudLanePortal[];
  laneCounts: [number, number, number];

  gameSpeed: number;
  alert: HudAlert | null;
  buildMode: HudBuildMode | null;
  waveMode: HudWaveState | null;
  upgradeChoice: HudUpgradeChoice | null;
  activeUpgrades: HudActiveUpgrade[];
}

export type HudCommand =
  | { type: 'restart' }
  | { type: 'toggle-pause' }
  | { type: 'cycle-speed' }
  | { type: 'build-tower-start'; tower: TowerKind }
  | { type: 'build-start'; kind: BuildKind }
  | { type: 'build-cancel' }
  | { type: 'to-menu' }
  /** Spilleren bestiller en spesifikk unit-type i en gitt lane. */
  | { type: 'send-lane'; lane: 0 | 1 | 2; unitKind: UnitKind }
  /** Spilleren trykker "Start bølge" — trigger 3-2-1-countdown. */
  | { type: 'start-wave' }
  /** Spilleren har valgt én av de tre upgrade-kortene. */
  | { type: 'select-upgrade'; id: string };

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
