import Phaser from 'phaser';
import { CONFIG, THEME } from '../config';
import { VFXManager } from '../vfx';
import { hudBridge, type HudState, type HudCommand, type HudUnit, type HudBuilding, type HudSelection, type HudBuildMode, type HudWaveState, type TowerKind, type BuildKind } from '../hudBridge';
import { pointInPolygon, segmentCrossesPolyline } from '../geom';
import { playSfx, LoopingSfx } from '../audio';

interface Vec2 { x: number; y: number; }

interface River {
  /** Senterlinje — units kan ikke krysse uten å være nær en levende bro. */
  centerLine: Vec2[];
  /** Lukket polygon som beskriver elv-flate. Brukt for point-in-polygon. */
  polygon: Vec2[];
  bridges: BuildingData[];
}

/** Impassabel terreng-bit (steinformasjon). Blokkerer bevegelse, kan ikke angripes. */
interface Obstacle {
  x: number; y: number;
  /** Sirkulær blokkering — units holdes utenfor denne radien. */
  radius: number;
}

/**
 * Forhøyet platå (SC-stil høyt land). Aksial rektangulær topp, omgitt av cliffs.
 * Ramper er åpninger i cliffs der units kan stige opp/ned.
 */
interface Ramp {
  side: 'top' | 'bottom' | 'left' | 'right';
  /** x for top/bottom, y for left/right — start på åpningen */
  from: number;
  /** x for top/bottom, y for left/right — slutt på åpningen */
  to: number;
}
interface Plateau {
  x: number; y: number; w: number; h: number;
  ramps: Ramp[];
}

interface UnitData {
  id: number;
  faction: 'player' | 'ai';
  type: 'worker' | 'soldier';
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number; damage: number;
  attackRange: number; attackInterval: number; lastAttackAt: number;
  state: 'idle' | 'moving' | 'attacking' | 'mining' | 'building';
  moveTarget: Vec2 | null;
  attackTarget: UnitData | BuildingData | null;
  mineTarget: MineData | null;
  /** Worker som er tildelt en bygning under konstruksjon — settes når plassering skjer
   *  eller når worker høyreklikker et byggested for å resume. */
  buildTarget: BuildingData | null;
  selected: boolean;
  dead: boolean;
  container: Phaser.GameObjects.Container;
  antBody: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Ellipse;
  segments: Phaser.GameObjects.Ellipse[];
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  selectionRing: Phaser.GameObjects.Arc;
  selectionGlow: Phaser.GameObjects.Arc;
  selectionTween: Phaser.Tweens.Tween | null;
  radius: number;
  lastDx: number; lastDy: number;
  /** M2.1 — webber-tower slow. ms-tidsstempel; speed halveres så lenge time < slowedUntil. */
  slowedUntil: number;
}

interface BuildingData {
  id: number;
  kind: 'base' | 'barracks' | 'mine' | 'bridge' | 'tower' | 'farm' | 'wall' | 'armory';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Ellipse;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  dead?: boolean;
  /** Hvis true tar bygningen ingen skade og kan ikke targetes. Brukes for broer (terreng). */
  invulnerable?: boolean;
  /** Klikkbar etikett over bygningen (skjules ved død). */
  label?: Phaser.GameObjects.Text;
  /** Kun for 'bridge'. Container med alle bro-visuals — skjules ved død. */
  bridgeContainer?: Phaser.GameObjects.Container;
  /** Kun for 'tower'. Skjuler hele tårn-visualet ved død. */
  towerContainer?: Phaser.GameObjects.Container;
  /** Kun for 'tower'. Type-spesifikke parametere. */
  tower?: {
    type: TowerKind;
    range: number;
    damage: number;
    fireRate: number;
    splash: number;
    slow: number;
    lastFireAt: number;
  };
  /** M3.1 — Visuell container for farm/wall/armory. Skjules ved død. */
  buildingContainer?: Phaser.GameObjects.Container;
  /** M3.2 — base defense state (kun på 'base' med Forsvar kjøpt). */
  defense?: {
    range: number;
    damage: number;
    fireRate: number;
    lastFireAt: number;
  };
  /** True mens en worker konstruerer bygningen. Bygningen er ikke funksjonell og
   *  vises med lav alpha + progress-bar. HP lerper fra 25 % → 100 % under bygging. */
  underConstruction?: boolean;
  /** Konstruksjonsprogress 0..1. Undefined når ferdig. */
  buildProgress?: number;
  /** Total konstruksjonstid (ms) for denne bygningen. */
  buildTimeMs?: number;
  /** Grafikk for HP/progress-bar under bygging. Skjules når ferdig. */
  buildProgressBg?: Phaser.GameObjects.Rectangle;
  buildProgressFg?: Phaser.GameObjects.Rectangle;
}

type MineControl = 'player' | 'ai' | 'contested' | null;
type MineData = BuildingData & {
  kind: 'mine'; faction: 'neutral';
  control: MineControl;
  controlRing: Phaser.GameObjects.Arc;
  /** V3 — antall ticks med kun-motstander-i-radius siden forrige reset. Brukes for sticky ownership. */
  flipPressurePlayer: number;
  flipPressureAi: number;
};

function isUnit(t: UnitData | BuildingData): t is UnitData {
  return 'container' in t;
}

/** HP-bar farge basert på prosent (M1.2). Grønn > 66 %, gul > 33 %, ellers rød. */
function hpBarColor(pct: number): number {
  if (pct > 0.66) return THEME.HP_BAR_HIGH;
  if (pct > 0.33) return THEME.HP_BAR_MED;
  return THEME.HP_BAR_LOW;
}

type GameState = 'running' | 'won' | 'lost';

export class GameScene extends Phaser.Scene {
  private units: UnitData[] = [];
  private buildings: BuildingData[] = [];
  private mines: MineData[] = [];
  private bridges: BuildingData[] = [];
  private rivers: River[] = [];
  private obstacles: Obstacle[] = [];
  private plateaus: Plateau[] = [];
  /** Half-tykkelse på cliff-blokkering rundt platåets perimeter. */
  private static readonly CLIFF_THICKNESS = 14;
  private playerBase!: BuildingData;
  private aiBase!: BuildingData;
  /** Barakke må bygges av en worker — null til den er plassert (og fortsatt under konstruksjon
   *  er tillatt; gate på `!underConstruction` der det matters). */
  private playerBarracks: BuildingData | null = null;
  private aiBarracks: BuildingData | null = null;

  private playerGold = 0;
  private aiGold = 0;
  private nextId = 1;

  private selectedUnits: UnitData[] = [];
  private selectedBuilding: BuildingData | null = null;
  private pointerIsDown = false;
  private dragStart: Vec2 = { x: 0, y: 0 };
  private isDragging = false;
  private dragRect!: Phaser.GameObjects.Rectangle;
  private rallyPoint: Vec2 | null = null;
  private rallyMarker: Phaser.GameObjects.Container | null = null;
  private rallyLine: Phaser.GameObjects.Graphics | null = null;
  private lastUnitClickAt = 0;
  private lastClickedUnit: UnitData | null = null;

  private hoverGfx!: Phaser.GameObjects.Graphics;
  private hudCommandUnsub: (() => void) | null = null;

  // Camera-scroll — WASD + piltaster (begge fungerer)
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyUp!: Phaser.Input.Keyboard.Key;
  private keyDown!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  /** True kun mens musa er fysisk over game-canvasen. Stopper edge-scroll når musa er over HUD. */
  private mouseOverCanvas = false;
  private canvasMouseEnter: (() => void) | null = null;
  private canvasMouseLeave: (() => void) | null = null;

  private gameState: GameState = 'running';
  private gameTime = 0;
  private metricsEl: HTMLElement | null = null;
  private vfx!: VFXManager;
  private lastBaseShakeAt = 0;
  private statsTrained = 0;
  private statsGoldEarned = 0;

  // M1.1 — pause/hastighet. 0 = pause; ellers en av CONFIG.TIME_SCALES.
  private gameSpeed: number = CONFIG.DEFAULT_TIME_SCALE;
  private prePauseSpeed: number = CONFIG.DEFAULT_TIME_SCALE;

  // M1.5 — enemy alert state
  private lastEnemyAlertAt = 0;
  /** V4 — tidsstempel for forrige *emitterte* alarm (separat fra check-intervallet). Brukes for debounce. */
  private lastAlertEmittedAt = 0;
  private currentAlert: { message: string; urgency: 'critical' | 'warn'; triggeredAt: number } | null = null;

  // M1.4 — looping base-alarm (under 50 % HP)
  private baseAlarmLoop: LoopingSfx | null = null;

  // M2.1 — Tower-bygging
  private towers: BuildingData[] = [];
  /** K5 — tidsstempel (ms) for forrige AI-tårn-bygg. Debounces AI tower-build. */
  private lastAiTowerBuildAt = 0;
  /** V7 — stats for game-over panel. */
  private statsSoldiersTrained = 0;
  private statsWorkersTrained = 0;
  private statsEnemyKills = 0;
  private statsUnitsLost = 0;
  /** V7 — peak mines kontrollert under runden. */
  private statsPeakMines = 0;
  /** M2.1 / M3.1 — generisk build-mode (tower eller building). */
  private buildMode: {
    kind: BuildKind;
    ghostBody: Phaser.GameObjects.Graphics;
    ghostRange: Phaser.GameObjects.Graphics;
    valid: boolean;
  } | null = null;
  private buildRadiusRing: Phaser.GameObjects.Graphics | null = null;
  /** M3.1 — farms gir +bonusGoldPerTick per tick i mineTick. */
  private farms: BuildingData[] = [];
  /** M3.1 — walls blokkerer unit-bevegelse. */
  private walls: BuildingData[] = [];

  // M2.2 — Wave Defence
  private waveActive: boolean = false;
  private currentWaveIndex: number = -1;   // -1 før første bølge
  private nextWaveAt: number = 0;          // ms-tidsstempel (this.time.now)
  private waveSpawnQueue: number = 0;      // antall AI-soldater igjen å spawne i denne bølgen
  private waveSpawnTimer: number = 0;      // ms til neste spawn i bølgen
  private wavesCleared: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Reset state that doesn't auto-clear on scene.restart()
    this.units = [];
    this.buildings = [];
    this.mines = [];
    this.bridges = [];
    this.rivers = [];
    this.obstacles = [];
    this.plateaus = [];
    this.playerBarracks = null;
    this.aiBarracks = null;
    this.selectedUnits = [];
    this.selectedBuilding = null;
    this.rallyPoint = null;
    this.rallyMarker = null;
    this.rallyLine = null;
    this.lastClickedUnit = null;
    this.lastUnitClickAt = 0;
    this.pointerIsDown = false;
    this.isDragging = false;
    this.gameState = 'running';
    this.gameTime = 0;
    this.playerGold = 0;
    this.aiGold = 0;
    this.nextId = 1;
    this.statsTrained = 0;
    this.statsGoldEarned = 0;
    this.gameSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.prePauseSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.lastEnemyAlertAt = 0;
    this.lastAlertEmittedAt = 0;
    this.currentAlert = null;
    this.towers = [];
    this.lastAiTowerBuildAt = 0;
    this.statsSoldiersTrained = 0;
    this.statsWorkersTrained = 0;
    this.statsEnemyKills = 0;
    this.statsUnitsLost = 0;
    this.statsPeakMines = 0;
    this.farms = [];
    this.walls = [];
    this.buildMode = null;
    this.buildRadiusRing = null;
    this.waveActive = false;
    this.currentWaveIndex = -1;
    this.nextWaveAt = 0;
    this.waveSpawnQueue = 0;
    this.waveSpawnTimer = 0;
    this.wavesCleared = false;
    if (this.hudCommandUnsub) { this.hudCommandUnsub(); this.hudCommandUnsub = null; }

    const W = CONFIG.MAP_WIDTH;
    const H = CONFIG.MAP_HEIGHT;

    // Background — grass gradient (top brighter, bottom darker)
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(
      THEME.GRASS_COLOR_TOP, THEME.GRASS_COLOR_TOP,
      THEME.GRASS_COLOR_BOTTOM, THEME.GRASS_COLOR_BOTTOM, 1,
    );
    bg.fillRect(0, 0, W, H);

    // Subtle dust/dried-grass speckles
    const noise = this.add.graphics().setDepth(0);
    for (let i = 0; i < 220; i++) {
      const nx = Phaser.Math.Between(0, W);
      const ny = Phaser.Math.Between(0, H);
      const nr = Phaser.Math.FloatBetween(0.5, 1.8);
      noise.fillStyle(THEME.NOISE_TINT, Phaser.Math.FloatBetween(0.04, 0.1));
      noise.fillCircle(nx, ny, nr);
    }

    // Pheromone trails — faint wavy lines drifting toward the center (very subtle)
    const trails = this.add.graphics().setDepth(0);
    trails.lineStyle(1, THEME.PHEROMONE_TRAIL_COLOR, 0.08);
    for (let i = 0; i < 6; i++) {
      const y0 = Phaser.Math.Between(60, H - 60);
      trails.beginPath();
      trails.moveTo(40, y0);
      for (let x = 40; x < W - 40; x += 30) {
        const yy = y0 + Math.sin((x + i * 70) * 0.018) * 18;
        trails.lineTo(x, yy);
      }
      trails.strokePath();
    }

    // Grass blades — scattered short vertical strokes
    const blades = this.add.graphics().setDepth(0);
    for (let i = 0; i < 220; i++) {
      const bx = Phaser.Math.Between(0, W);
      const by = Phaser.Math.Between(0, H);
      const len = Phaser.Math.Between(4, 9);
      const tilt = Phaser.Math.FloatBetween(-1.5, 1.5);
      const color = Math.random() < 0.5 ? THEME.GRASS_BLADE_COLOR : THEME.GRASS_BLADE_DARK;
      blades.lineStyle(1, color, Phaser.Math.FloatBetween(0.35, 0.7));
      blades.lineBetween(bx, by, bx + tilt, by - len);
    }

    // Pebbles — small ellipses with subtle shadow
    for (let i = 0; i < 18; i++) {
      const px = Phaser.Math.Between(30, W - 30);
      const py = Phaser.Math.Between(30, H - 30);
      const pw = Phaser.Math.Between(4, 7);
      const ph = Phaser.Math.Between(3, 5);
      const pc = THEME.PEBBLE_COLORS[i % THEME.PEBBLE_COLORS.length];
      this.add.ellipse(px + 1, py + 1.5, pw, ph, 0x000000, 0.35).setDepth(0);
      this.add.ellipse(px, py, pw, ph, pc).setDepth(0);
      this.add.ellipse(px - pw * 0.2, py - ph * 0.25, pw * 0.45, ph * 0.4, 0xffffff, 0.18).setDepth(0);
    }

    // Småblomster og kløver-tuer — gir mer karakter til gressmarken.
    // Vi unngår sentrum (der enheter beveger seg) og nær basene.
    const flowerSpots: Vec2[] = [];
    for (let i = 0; i < 14; i++) {
      // Try a few times to avoid placing on top of base zones / map edge.
      let fx = 0, fy = 0, ok = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        fx = Phaser.Math.Between(60, W - 60);
        fy = Phaser.Math.Between(60, H - 60);
        // Hold avstand fra base-områder
        if (fx < 180 || fx > W - 180) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      flowerSpots.push({ x: fx, y: fy });
    }
    for (const sp of flowerSpots) {
      // Bunn-tue: 2-3 kløver-blader
      const cluster = Phaser.Math.Between(2, 3);
      for (let i = 0; i < cluster; i++) {
        const cx = sp.x + Phaser.Math.FloatBetween(-4, 4);
        const cy = sp.y + Phaser.Math.FloatBetween(-3, 3);
        this.add.ellipse(cx, cy, 5, 4, THEME.CLOVER_LEAF, 0.85).setDepth(0);
        this.add.ellipse(cx - 1, cy - 0.5, 2, 1.4, 0xffffff, 0.18).setDepth(0);
      }
      // Liten blomst på toppen av tuen
      if (Math.random() < 0.7) {
        const palette = [THEME.FLOWER_WHITE, THEME.FLOWER_YELLOW, THEME.FLOWER_PINK];
        const fc = palette[Phaser.Math.Between(0, palette.length - 1)];
        const px = sp.x + Phaser.Math.FloatBetween(-2, 2);
        const py = sp.y + Phaser.Math.FloatBetween(-2, 2);
        // 4-5 kronblad rundt et senter
        const petals = 5;
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2;
          this.add.ellipse(px + Math.cos(a) * 1.4, py + Math.sin(a) * 1.4, 2, 1.6, fc, 0.95).setDepth(0);
        }
        this.add.circle(px, py, 0.9, THEME.FLOWER_YELLOW, 1).setDepth(0);
      }
    }


    // Drag selection box — varm orange for synlighet
    this.dragRect = this.add.rectangle(0, 0, 1, 1, 0xff9d4a, 0.18)
      .setStrokeStyle(2, 0xffb878, 0.95)
      .setOrigin(0, 0)
      .setVisible(false)
      .setDepth(20);

    // Broer (T1-C) — plasseres på horisontal elv (y=720). Lages før elv-tegning
    // så elven kan referere til dem som krysspunkter for waypoint-routing.
    // Bro-orientering: bredde 100 × høyde 170 (krysser horisontal elv nord-sør).
    const bridgeA = this.createBridge(640, 720, 100, 170);   // Vest-bro
    const bridgeB = this.createBridge(1920, 720, 100, 170);  // Øst-bro

    // Elv (T1-B) — horisontal stripe midt på kartet, ~120px tykk. Skiller
    // player (sør) fra AI (nord) og gjør broene til reelle chokepoints.
    const RIVER_Y = 720;
    const RIVER_HALF = 60;
    const river: River = {
      centerLine: [{ x: 0, y: RIVER_Y }, { x: W, y: RIVER_Y }],
      polygon: [
        { x: 0, y: RIVER_Y - RIVER_HALF },
        { x: W, y: RIVER_Y - RIVER_HALF },
        { x: W, y: RIVER_Y + RIVER_HALF },
        { x: 0, y: RIVER_Y + RIVER_HALF },
      ],
      bridges: [bridgeA, bridgeB],
    };
    this.rivers.push(river);

    // Render elv-laget
    const rivGfx = this.add.graphics().setDepth(1);
    rivGfx.fillGradientStyle(0x2c4a7a, 0x2c4a7a, 0x1a3258, 0x1a3258, 0.95);
    rivGfx.fillRect(0, RIVER_Y - RIVER_HALF, W, RIVER_HALF * 2);
    // Mørk kant-linje nord/sør
    rivGfx.lineStyle(2, 0x14233e, 0.85);
    rivGfx.lineBetween(0, RIVER_Y - RIVER_HALF, W, RIVER_Y - RIVER_HALF);
    rivGfx.lineBetween(0, RIVER_Y + RIVER_HALF, W, RIVER_Y + RIVER_HALF);
    // Bølge-streker for tekstur (horisontale linjer med sinus-forskyvning på y)
    rivGfx.lineStyle(1, 0x6a8ec0, 0.35);
    for (let i = 0; i < 5; i++) {
      const yo = -RIVER_HALF + (i + 0.5) * (RIVER_HALF * 2 / 5);
      rivGfx.beginPath();
      rivGfx.moveTo(0, RIVER_Y + yo);
      for (let x = 0; x <= W; x += 40) {
        rivGfx.lineTo(x, RIVER_Y + yo + Math.sin((x + i * 30) * 0.025) * 4);
      }
      rivGfx.strokePath();
    }

    // Platåer (SC-stil høyt land) — én kompakt platå per side, ikke gigantisk.
    // Player platå sør, AI platå nord. 3 ramper hver: 1 base-side + 2 bro-side.
    // Contested mine på platået — high-ground = strategisk verdi.
    const playerPlateau: Plateau = {
      x: 1020, y: 930, w: 520, h: 260,
      ramps: [
        { side: 'bottom', from: 1240, to: 1340 },  // Base-side (mot sør)
        { side: 'top',    from: 1040, to: 1140 },  // Vest-bro tilgang
        { side: 'top',    from: 1420, to: 1520 },  // Øst-bro tilgang
      ],
    };
    const aiPlateau: Plateau = {
      x: 1020, y: 250, w: 520, h: 260,
      ramps: [
        { side: 'top',    from: 1240, to: 1340 },  // Base-side (mot nord)
        { side: 'bottom', from: 1040, to: 1140 },  // Vest-bro tilgang
        { side: 'bottom', from: 1420, to: 1520 },  // Øst-bro tilgang
      ],
    };
    this.plateaus.push(playerPlateau, aiPlateau);
    this.renderPlateaus();

    // Mines — 6 totalt: 2 trygge ved hver base + 2 omkjempete på platåene.
    // Trygge mines flankerer basene; contested mines er på høyt land.
    this.createMine(900, 1300);   // Player SW (trygg, sør)
    this.createMine(1660, 1300);  // Player SE (trygg, sør)
    this.createMine(900, 140);    // AI NW (trygg, nord)
    this.createMine(1660, 140);   // AI NE (trygg, nord)
    this.createMine(1280, 1060);  // Contested (player platå)
    this.createMine(1280, 380);   // Contested (AI platå)

    // Steinformasjoner — cover + flanker i lavlandet, speilet nord/sør.
    // Hjørne-stoner langt fra senterlinjen — gir karakter til kart-ytterkant
    this.createObstacle(260, 1280, 58);    // SW player-lavland
    this.createObstacle(2300, 1280, 58);   // SE player-lavland
    this.createObstacle(260, 160, 58);     // NW AI-lavland
    this.createObstacle(2300, 160, 58);    // NE AI-lavland
    // Mid-flank stones mellom platå og bro-tilgang (i smal lavlands-stripe ved elven)
    this.createObstacle(1280, 850, 38);    // Sør for elv, mellom plateau-toppen og elven (player-side)
    this.createObstacle(1280, 590, 38);    // Nord for elv (AI-side)
    // Cover INNE på platåene — beskytter contested mines
    this.createObstacle(1100, 1060, 28);   // Cover vest for player contested mine
    this.createObstacle(1460, 1060, 28);   // Cover øst for player contested mine
    this.createObstacle(1100, 380, 28);    // Cover vest for AI contested mine
    this.createObstacle(1460, 380, 28);    // Cover øst for AI contested mine

    // Jord/mose-flekker for visuell variasjon (rene dekorasjoner, blokkerer ikke)
    this.paintGroundPatches(W, H);

    // Buildings — kun maurtuene er pre-plassert. Barakker bygges av workers.
    // Player base i sør, AI base i nord.
    this.playerBase = this.createBuilding('base', 'player', W / 2, H - 80, 60, 80, CONFIG.BASE_HP);
    this.aiBase = this.createBuilding('base', 'ai', W / 2, 80, 60, 80, CONFIG.BASE_HP);

    // Starting economy
    this.playerGold = CONFIG.STARTING_GOLD;
    this.aiGold = CONFIG.STARTING_GOLD;

    // Initial units — 1 worker per side, spawnet rett foran egen base.
    this.spawnUnit('player', 'worker', W / 2, H - 160);
    this.spawnUnit('ai', 'worker', W / 2, 160);

    // HUD rendered by React overlay (see HudOverlay.tsx).
    // We just keep a hover-indicator graphics layer here.
    this.hoverGfx = this.add.graphics().setDepth(22);

    // Subscribe to commands from the HTML HUD
    this.hudCommandUnsub = hudBridge.onCommand((c) => this.handleHudCommand(c));

    // Input
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    // Tastatur
    this.input.keyboard?.on('keydown-Q', () => this.trainUnit('worker'));
    this.input.keyboard?.on('keydown-E', () => this.trainUnit('soldier'));
    // SPACE er nå pause-toggle (M1.1). Select-all-soldiers er fortsatt på Z og kommando-knapp.
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault();
      this.togglePause();
    });
    this.input.keyboard?.on('keydown-Z', () => this.selectAllOfType('soldier'));
    this.input.keyboard?.on('keydown-X', () => this.selectAllOfType('worker'));
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.buildMode) { this.cancelBuildMode(); return; }
      this.clearSelection();
      this.clearBuildingSelection();
    });
    // M1.1 — speed-cycling via +/- (samme tast med eller uten shift på US-layout, og numpad).
    this.input.keyboard?.on('keydown-PLUS', () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-NUMPAD_ADD', () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-EQUALS', () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-MINUS', () => this.cycleSpeed(-1));
    this.input.keyboard?.on('keydown-NUMPAD_SUBTRACT', () => this.cycleSpeed(-1));

    // M2.1 — tower-bygging. T toggler build-mode (default stinger).
    // M3.1 — B toggler bygg-modus (default barracks — viktigste tidligbygg).
    // I build-mode: 1/2/3 = towers, 4 = barakke, 5/6/7 = farm/wall/armory. Esc/høyreklikk avbryter.
    this.input.keyboard?.on('keydown-T', () => {
      if (this.buildMode) this.cancelBuildMode();
      else this.startBuildMode('stinger');
    });
    this.input.keyboard?.on('keydown-B', () => {
      if (this.buildMode) this.cancelBuildMode();
      else this.startBuildMode('barracks');
    });
    this.input.keyboard?.on('keydown-ONE',   () => { if (this.buildMode) this.startBuildMode('stinger');  });
    this.input.keyboard?.on('keydown-TWO',   () => { if (this.buildMode) this.startBuildMode('webber');   });
    this.input.keyboard?.on('keydown-THREE', () => { if (this.buildMode) this.startBuildMode('spitter');  });
    this.input.keyboard?.on('keydown-FOUR',  () => { if (this.buildMode) this.startBuildMode('barracks'); });
    this.input.keyboard?.on('keydown-FIVE',  () => { if (this.buildMode) this.startBuildMode('farm');     });
    this.input.keyboard?.on('keydown-SIX',   () => { if (this.buildMode) this.startBuildMode('wall');     });
    this.input.keyboard?.on('keydown-SEVEN', () => { if (this.buildMode) this.startBuildMode('armory');   });

    // M2.3 — choke-formasjon (F)
    this.input.keyboard?.on('keydown-F', () => this.formationLine());

    // WASD + piltaster for kamera-scroll. A-konflikten med select-all-soldiers er
    // løst ved å fjerne A-hotkeyen — SPACE er fortsatt select-all-soldiers.
    this.keyW     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyUp    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keyLeft  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);

    // DOM-tracking: edge-scroll skal kun fyre når musa er fysisk over canvas, ikke HUD.
    const canvas = this.game.canvas;
    this.mouseOverCanvas = false;
    this.canvasMouseEnter = () => { this.mouseOverCanvas = true; };
    this.canvasMouseLeave = () => { this.mouseOverCanvas = false; };
    canvas.addEventListener('mouseenter', this.canvasMouseEnter);
    canvas.addEventListener('mouseleave', this.canvasMouseLeave);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.canvasMouseEnter) canvas.removeEventListener('mouseenter', this.canvasMouseEnter);
      if (this.canvasMouseLeave) canvas.removeEventListener('mouseleave', this.canvasMouseLeave);
      this.canvasMouseEnter = null;
      this.canvasMouseLeave = null;
    });

    // Kamera-bounds matcher verden; viewport-størrelse styres av Phaser.Scale.FIT.
    this.cameras.main.setBounds(0, 0, CONFIG.MAP_WIDTH, CONFIG.MAP_HEIGHT);
    if (CONFIG.DEMO_MODE) {
      // Demo: sentrer på midten av elva — viser begge broer og handlingen i mid-zone.
      this.cameras.main.centerOn(CONFIG.MAP_WIDTH / 2, CONFIG.MAP_HEIGHT / 2);
    } else {
      // Spiller starter med kameraet på egen base (sør)
      this.cameras.main.centerOn(CONFIG.MAP_WIDTH / 2, CONFIG.MAP_HEIGHT - 100);
    }

    // Timers
    this.time.addEvent({ delay: CONFIG.MINE_TICK_INTERVAL, callback: this.mineTick, callbackScope: this, loop: true });
    this.time.addEvent({ delay: CONFIG.AI_DECISION_INTERVAL, callback: this.aiDecision, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 500, callback: this.updateMetrics, callbackScope: this, loop: true });
    if (CONFIG.DEMO_MODE) {
      this.time.addEvent({ delay: CONFIG.PLAYER_DECISION_INTERVAL, callback: this.playerDecision, callbackScope: this, loop: true });
    }

    // DOM metrics bridge
    this.metricsEl = document.getElementById('game-metrics');

    // M2.2 — Wave-modus: URL-param `?mode=wave` overstyrer CONFIG.WAVE_MODE.enabled
    if (typeof window !== 'undefined') {
      try {
        const url = new URL(window.location.href);
        const mode = url.searchParams.get('mode');
        if (mode === 'wave') (CONFIG.WAVE_MODE as { enabled: boolean }).enabled = true;
        if (mode === 'classic') (CONFIG.WAVE_MODE as { enabled: boolean }).enabled = false;
      } catch { /* noop */ }
    }
    if (CONFIG.WAVE_MODE.enabled) {
      // Wave-mode: skjul AI-base for spilleren — bare relevant at spilleren overlever
      // første bølge starter etter waves[0].delay
      this.nextWaveAt = this.time.now + CONFIG.WAVE_MODE.waves[0].delay;
    }

    // VFX manager (must be created after BootScene generated the spark texture)
    this.vfx = new VFXManager(this);

    // M1.4 — audio loop for base under attack
    this.baseAlarmLoop = new LoopingSfx(this, 'base-alarm', 0.55);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.baseAlarmLoop?.stop();
      this.baseAlarmLoop = null;
    });

    this.applyCameraFX();
  }

  private applyCameraFX() {
    // Skip postFX hvis renderer ikke er WebGL (Canvas-fallback har ingen filters).
    const cam = this.cameras.main;
    if (!this.renderer || this.renderer.type !== Phaser.WEBGL) return;

    // Clear eksisterende FX først — scene.restart() (f.eks. ved resize) ville ellers
    // stable opp bloom-effekter i det uendelige. (postFX-typen mangler i denne
    // Phaser-versjonens d.ts, men er på runtime under WebGL.)
    (cam as unknown as { postFX?: { clear: () => void } }).postFX?.clear();

    Phaser.Actions.AddEffectBloom(cam, {
      threshold: THEME.FX_BLOOM_THRESHOLD,
      blurRadius: THEME.FX_BLOOM_BLUR_RADIUS,
      blurSteps: THEME.FX_BLOOM_BLUR_STEPS,
      blurQuality: THEME.FX_BLOOM_BLUR_QUALITY,
      blendAmount: THEME.FX_BLOOM_BLEND_AMOUNT,
    });
  }

  // ── Factory methods ──────────────────────────────────────────────────────

  private createBuilding(
    kind: BuildingData['kind'], faction: BuildingData['faction'],
    x: number, y: number, w: number, h: number, hp: number,
  ): BuildingData {
    const color = faction === 'player' ? THEME.BASE_COLOR_PLAYER
      : faction === 'ai' ? THEME.BASE_COLOR_AI
      : 0x886600;
    const rim = faction === 'player' ? THEME.BASE_RIM_PLAYER : THEME.BASE_RIM_AI;
    const highlight = faction === 'player' ? THEME.BASE_HIGHLIGHT_PLAYER : THEME.BASE_HIGHLIGHT_AI;

    // Maurtue: tegnes som en SIRKULÆR jordhaug sett rett ovenfra — som toppen av en
    // halvkule. Vi bruker én radius (ikke ulike w/h) så formen ikke blir oval/squashed.
    // Lys-modell: lyset kommer fra øvre venstre, så toppen av "kulen" forskyves litt opp-venstre
    // og blir lysere, mens nedre høyre side er mørkere.
    const R = Math.max(w, h) * 0.7;                  // ytre radius på selve haugen
    const grainPalette = faction === 'player' ? THEME.SOIL_GRAIN_PLAYER : THEME.SOIL_GRAIN_AI;
    const disturbed = faction === 'player' ? THEME.DISTURBED_SOIL_PLAYER : THEME.DISTURBED_SOIL_AI;

    // Drop shadow — en flatklemt ellipse rett under (det er den ene gangen det er greit å være oval)
    this.add.ellipse(x + 3, y + R * 0.42, R * 2.15, R * 0.55, 0x000000, 0.45).setDepth(1);

    // Forstyrret jord-ring rundt tuen. Vi tegner små klumper i en sirkulær ring (ikke oval),
    // men varierer radius/størrelse så det ikke ser ut som en perfekt sirkel.
    const ringClumps = kind === 'base' ? 22 : 14;
    for (let i = 0; i < ringClumps; i++) {
      const a = (i / ringClumps) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const r = R * Phaser.Math.FloatBetween(1.02, 1.28);
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const cs = Phaser.Math.FloatBetween(4, 8);
      this.add.ellipse(cx, cy, cs * 1.4, cs, disturbed, Phaser.Math.FloatBetween(0.55, 0.85)).setDepth(1);
    }
    // Strødde jordkorn rundt ringen (skapt av maur-gravearbeid)
    for (let i = 0; i < ringClumps * 1.5; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const r = R * Phaser.Math.FloatBetween(1.05, 1.45);
      const gx = x + Math.cos(a) * r;
      const gy = y + Math.sin(a) * r;
      const gs = Phaser.Math.FloatBetween(0.9, 1.8);
      const gc = grainPalette[i % grainPalette.length];
      this.add.ellipse(gx, gy, gs, gs, gc, 0.65).setDepth(1);
    }

    // Konsentriske SIRKLER (ikke ellipser) — fra ytter-rand mot toppen, gradvis lysere
    // og litt forskjøvet opp-venstre for å antyde halvkule belyst fra øvre venstre.
    // Depth-stacking gir det "toppen av sirkel"-utseendet brukeren ba om.

    // Lag 0 — ytter-skygge/kantvoll
    this.add.circle(x, y, R * 1.02, rim, 1).setDepth(2);

    // Lag 1 — hovedkroppen (sporet for damage/tint). Phaser har ingen ren "Circle"-trackbar
    // for tint, men Ellipse med w===h fungerer som sirkel.
    const body = this.add.ellipse(x, y, R * 1.92, R * 1.92, color).setDepth(3);

    // Lag 2-4 — konsentriske, gradvis mindre, lysere og forskjøvet opp-venstre
    // (gir halvkule-følelse: lys treffer toppen, kanten faller bort)
    const offsets = [
      { r: R * 0.78, dx: -R * 0.05, dy: -R * 0.06, col: color,     a: 1.0 },
      { r: R * 0.58, dx: -R * 0.09, dy: -R * 0.11, col: highlight, a: 0.55 },
      { r: R * 0.38, dx: -R * 0.13, dy: -R * 0.16, col: highlight, a: 0.85 },
      { r: R * 0.20, dx: -R * 0.16, dy: -R * 0.20, col: 0xffffff,  a: 0.22 }, // spekulær topp
    ];
    for (const o of offsets) {
      this.add.circle(x + o.dx, y + o.dy, o.r, o.col, o.a).setDepth(4);
    }

    // Glatt, sparsom granulær tekstur — KUN nær kanten der det gir lesbarhet,
    // ikke en jevn prikkete sky over hele toppen (det var det som ga "death star"-følelsen).
    const grainCount = kind === 'base' ? 26 : 14;
    for (let i = 0; i < grainCount; i++) {
      const ga = Phaser.Math.FloatBetween(0, Math.PI * 2);
      // Hold prikker innenfor 0.55–0.92 av radius — altså ute på skråningen, ikke på toppen
      const gr = R * Phaser.Math.FloatBetween(0.55, 0.92);
      const gx = x + Math.cos(ga) * gr;
      const gy = y + Math.sin(ga) * gr;
      const gs = Phaser.Math.FloatBetween(0.8, 1.8);
      const gc = grainPalette[Phaser.Math.Between(0, grainPalette.length - 1)];
      this.add.ellipse(gx, gy, gs, gs, gc, 0.6).setDepth(5);
    }

    // Mørk skyggesigment langs nedre-høyre kant (forsterker halvkule-følelsen)
    const shadowArc = this.add.graphics().setDepth(5);
    shadowArc.fillStyle(rim, 0.35);
    shadowArc.slice(x, y, R * 0.96, Phaser.Math.DegToRad(15), Phaser.Math.DegToRad(155), false);
    shadowArc.fillPath();

    // Kvister og barnåler — bare på basene, og lagt langs skråningen (ikke flatt på toppen).
    if (kind === 'base') {
      // 2 kvister
      for (let i = 0; i < 2; i++) {
        const tg = this.add.graphics().setDepth(6);
        tg.lineStyle(1.3, THEME.TWIG_COLOR, 0.85);
        const tAngBase = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const tr = R * Phaser.Math.FloatBetween(0.4, 0.75);
        const tx = x + Math.cos(tAngBase) * tr;
        const ty = y + Math.sin(tAngBase) * tr;
        const tAng = Phaser.Math.FloatBetween(-1.2, 1.2);
        const tLen = Phaser.Math.FloatBetween(7, 12);
        tg.lineBetween(
          tx - Math.cos(tAng) * tLen * 0.5,
          ty - Math.sin(tAng) * tLen * 0.5,
          tx + Math.cos(tAng) * tLen * 0.5,
          ty + Math.sin(tAng) * tLen * 0.5,
        );
      }
      // 3 barnåler
      const ng = this.add.graphics().setDepth(6);
      for (let i = 0; i < 3; i++) {
        const nAngBase = Phaser.Math.FloatBetween(0, Math.PI * 2);
        const nr = R * Phaser.Math.FloatBetween(0.45, 0.85);
        const nx = x + Math.cos(nAngBase) * nr;
        const ny = y + Math.sin(nAngBase) * nr;
        const nAng = Phaser.Math.FloatBetween(0, Math.PI);
        const nLen = Phaser.Math.FloatBetween(5, 9);
        ng.lineStyle(0.9, i % 2 === 0 ? THEME.PINE_NEEDLE_COLOR : THEME.PINE_NEEDLE_LIGHT, 0.85);
        ng.lineBetween(nx, ny, nx + Math.cos(nAng) * nLen, ny + Math.sin(nAng) * nLen);
      }
    }

    // Inngangshull — peker mot midten av kartet (vertikal akse). Plassert på skråningen.
    const entranceDir = y < CONFIG.MAP_HEIGHT / 2 ? 1 : -1;
    const entranceX = x;
    const entranceY = y + entranceDir * R * 0.45;
    if (kind === 'base') {
      // Hovedinngang — opphøyd jordkrater + mørkt hull
      this.add.circle(entranceX, entranceY, R * 0.22, rim, 0.95).setDepth(6);
      this.add.circle(entranceX, entranceY, R * 0.15, THEME.BASE_ENTRANCE_COLOR, 1).setDepth(7);
      this.add.circle(entranceX - 1, entranceY - 1, R * 0.11, 0x000000, 0.7).setDepth(8);
    } else if (kind === 'barracks') {
      // Lite inngangshull
      this.add.circle(entranceX, entranceY, R * 0.18, rim, 0.95).setDepth(6);
      this.add.circle(entranceX, entranceY, R * 0.12, THEME.BASE_ENTRANCE_COLOR, 1).setDepth(7);
      // Egg-klynge i et åpent kammer på toppen av tuen — 4 hvite egg
      const chamberX = x - R * 0.15;
      const chamberY = y - R * 0.3;
      this.add.circle(chamberX, chamberY, R * 0.32, rim, 0.9).setDepth(6);
      this.add.circle(chamberX, chamberY, R * 0.26, 0x1a0e06, 0.55).setDepth(7);
      const eggSlots = [
        { dx: -R * 0.12, dy: 0, sc: 1.0 },
        { dx: 0, dy: -R * 0.06, sc: 1.05 },
        { dx: R * 0.11, dy: R * 0.02, sc: 0.95 },
        { dx: -R * 0.04, dy: R * 0.1, sc: 0.9 },
      ];
      for (const s of eggSlots) {
        const ex = chamberX + s.dx;
        const ey = chamberY + s.dy;
        this.add.ellipse(ex + 0.5, ey + 1.2, 6.8 * s.sc, 4.4 * s.sc, 0x000000, 0.45).setDepth(7);
        this.add.ellipse(ex, ey, 6.2 * s.sc, 3.8 * s.sc, THEME.BARRACKS_EGG_COLOR).setDepth(8);
        this.add.ellipse(ex - 1.2 * s.sc, ey - 0.6 * s.sc, 2.6 * s.sc, 1.4 * s.sc, 0xffffff, 0.55).setDepth(9);
      }
    }

    const hpBg = this.add.rectangle(x, y - R * 1.05 - 7, 44, 5, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 22, y - R * 1.05 - 7, 44, 5, 0x44ee44)
      .setOrigin(0, 0.5).setDepth(8).setVisible(false);

    const b: BuildingData = { id: this.nextId++, kind, faction, x, y, w, h, hp, maxHp: hp, body, bodyColor: color, hpBg, hpFg };
    this.attachBuildingLabel(b);
    this.buildings.push(b);
    return b;
  }

  /** Tegner en liten etikett over bygningen så spillere ser hva ting er ved første blikk. */
  private attachBuildingLabel(b: BuildingData) {
    const baseLabel = CONFIG.LABELS.base.toUpperCase();
    const barracksLabel = CONFIG.LABELS.barracks.toUpperCase();
    const mineLabel = CONFIG.LABELS.mine.toUpperCase();
    const text =
      b.kind === 'base'     ? (b.faction === 'player' ? baseLabel : `FIENDE-${baseLabel}`)
      : b.kind === 'barracks' ? (b.faction === 'player' ? barracksLabel : `FIENDE-${barracksLabel}`)
      : b.kind === 'mine'   ? mineLabel
      : b.kind === 'bridge' ? 'BRO'
      : b.kind === 'tower'  ? (b.tower?.type === 'webber' ? 'NETT-TÅRN' : b.tower?.type === 'spitter' ? 'SPYTT-TÅRN' : 'SPYDD-TÅRN')
      : b.kind === 'farm'   ? 'AVLSFARM'
      : b.kind === 'wall'   ? 'MUR'
      : b.kind === 'armory' ? 'SMIE'
      : '';
    if (!text) return;
    const color = b.faction === 'player' ? '#cfe3a3'
      : b.faction === 'ai' ? '#ffb088'
      : '#e6c45a';
    // Y-offset basert på bygningstype — over hovedsiluetten
    const yOffset = b.kind === 'base' ? -b.h * 0.95
      : b.kind === 'barracks' ? -b.h * 0.85
      : b.kind === 'mine' ? -b.h * 0.95
      : b.kind === 'tower' ? -b.h * 0.75
      : b.kind === 'farm' || b.kind === 'wall' || b.kind === 'armory' ? -b.h * 0.8
      : -b.h * 0.6; // bro
    const dpr = Math.max(2, Math.min(3, window.devicePixelRatio || 1));
    b.label = this.add.text(b.x, b.y + yOffset, text, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '14px',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 5,
      shadow: { offsetX: 0, offsetY: 2, color: '#000000', blur: 4, fill: true, stroke: true },
    })
      .setOrigin(0.5, 1)
      .setDepth(11)
      .setAlpha(1)
      .setResolution(dpr);
  }

  /** Bro = nøytral destroyable bygning. Tegnes som trebro, faller når HP når 0. */
  private createBridge(x: number, y: number, w: number, h: number): BuildingData {
    const planks: Phaser.GameObjects.GameObject[] = [];

    // Underliggende stein-fundament (mørk grå)
    planks.push(this.add.rectangle(0, 0, w + 8, h + 8, 0x3a2e22, 0.6));

    // Trebro-base
    planks.push(this.add.rectangle(0, 0, w, h, 0x7a5a32).setStrokeStyle(2, 0x3a2410, 0.85));

    // Planker — horisontale striper på tvers av bredden
    const plankCount = Math.max(3, Math.floor(h / 16));
    const plankH = h / plankCount;
    for (let i = 0; i < plankCount; i++) {
      const py = -h / 2 + i * plankH + plankH / 2;
      planks.push(this.add.rectangle(0, py, w - 4, plankH - 2, 0x8a6638, 0.85)
        .setStrokeStyle(1, 0x4a2c14, 0.6));
    }

    // Rekkverk (smale streker langs sidene)
    planks.push(this.add.rectangle(-w / 2 + 2, 0, 2, h, 0x5a3a1c));
    planks.push(this.add.rectangle( w / 2 - 2, 0, 2, h, 0x5a3a1c));

    const container = this.add.container(x, y, planks).setDepth(2);

    // Hit-body — invisible Ellipse for å reuse BuildingData-form (body brukes
    // bare som referanse; vi rendrer egen container).
    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(2);

    const hpBg = this.add.rectangle(x, y - h / 2 - 8, 44, 4, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 22, y - h / 2 - 8, 44, 4, 0xaa7744)
      .setOrigin(0, 0.5).setDepth(8).setVisible(false);

    const b: BuildingData = {
      id: this.nextId++, kind: 'bridge', faction: 'neutral',
      x, y, w, h,
      hp: CONFIG.BRIDGE_HP, maxHp: CONFIG.BRIDGE_HP,
      body, bodyColor: 0x7a5a32, hpBg, hpFg,
      bridgeContainer: container,
      invulnerable: true,
    };
    this.attachBuildingLabel(b);
    this.buildings.push(b);
    this.bridges.push(b);
    return b;
  }

  private createMine(x: number, y: number): MineData {
    // Bladlus-farm: et stort grønt blad med en sentral nerve, og 5 bladlus oppå.
    // Bladet er en ellipse vridd litt, med en mørk nerve langs midten.
    const leafW = 56;
    const leafH = 40;
    const tilt = Phaser.Math.FloatBetween(-0.25, 0.25);

    // Drop shadow
    this.add.ellipse(x + 3, y + leafH * 0.45, leafW * 0.95, leafH * 0.35, 0x000000, 0.4)
      .setDepth(1).setRotation(tilt);

    // Bladets underside (mørkere — ser tykkere ut)
    this.add.ellipse(x, y + 1.5, leafW, leafH, THEME.APHID_LEAF_VEIN).setDepth(2).setRotation(tilt);

    // Hovedbladet (body for hit-detection og tint)
    const body = this.add.ellipse(x, y, leafW, leafH, THEME.APHID_LEAF_COLOR).setDepth(3).setRotation(tilt);

    // Subtil highlight på bladet
    this.add.ellipse(x - leafW * 0.15, y - leafH * 0.2, leafW * 0.6, leafH * 0.45, THEME.APHID_LEAF_HIGHLIGHT, 0.6)
      .setDepth(4).setRotation(tilt);

    // Sentral bladnerve + sidenerver tegnet via Graphics
    const veins = this.add.graphics().setDepth(4);
    veins.lineStyle(1.2, THEME.APHID_LEAF_VEIN, 0.85);
    // Hovednerve (langs blad-aksen)
    const cosT = Math.cos(tilt); const sinT = Math.sin(tilt);
    const veinDx = leafW * 0.42;
    veins.lineBetween(x - veinDx * cosT, y - veinDx * sinT, x + veinDx * cosT, y + veinDx * sinT);
    // 3 sidenerver
    for (let i = -1; i <= 1; i++) {
      if (i === 0) continue;
      const px = x + (veinDx * 0.35 * i) * cosT;
      const py = y + (veinDx * 0.35 * i) * sinT;
      const perpDx = -sinT * leafH * 0.32;
      const perpDy = cosT * leafH * 0.32;
      veins.lineStyle(0.8, THEME.APHID_LEAF_VEIN, 0.6);
      veins.lineBetween(px, py, px + perpDx, py + perpDy);
      veins.lineBetween(px, py, px - perpDx, py - perpDy);
    }

    // Bladlus — 5 små grønne ovaler plassert på bladet
    const aphidPositions = [
      { dx: -leafW * 0.18, dy: -leafH * 0.05 },
      { dx: leafW * 0.08, dy: -leafH * 0.2 },
      { dx: leafW * 0.22, dy: leafH * 0.08 },
      { dx: -leafW * 0.05, dy: leafH * 0.22 },
      { dx: leafW * 0.12, dy: leafH * 0.28 },
    ];
    const aphidGroup: Phaser.GameObjects.GameObject[] = [];
    for (const p of aphidPositions) {
      const ax = x + p.dx * cosT - p.dy * sinT;
      const ay = y + p.dx * sinT + p.dy * cosT;
      // skygge
      this.add.ellipse(ax + 0.5, ay + 1, 6.5, 4.5, 0x000000, 0.35).setDepth(5);
      // kropp
      const aphid = this.add.ellipse(ax, ay, 6, 4.5, THEME.APHID_COLOR).setDepth(6);
      // highlight
      const sheen = this.add.ellipse(ax - 1, ay - 0.7, 2.5, 1.5, THEME.APHID_HIGHLIGHT, 0.85).setDepth(7);
      // 2 små følehorn
      const ant = this.add.graphics().setDepth(7);
      ant.lineStyle(0.7, THEME.APHID_LEAF_VEIN, 0.9);
      ant.lineBetween(ax + 2, ay - 1, ax + 4, ay - 2.5);
      ant.lineBetween(ax + 2, ay + 1, ax + 4, ay + 2.5);
      aphidGroup.push(aphid, sheen);
    }

    // Subtil puls på bladlusene
    this.tweens.add({
      targets: aphidGroup,
      scale: 1.12,
      yoyo: true,
      repeat: -1,
      duration: 1250,
      ease: 'Sine.easeInOut',
    });

    const hpBg = this.add.rectangle(x, y - leafH * 0.55, 38, 4, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 19, y - leafH * 0.55, 38, 4, 0xffcc00).setOrigin(0, 0.5).setDepth(8).setVisible(false);

    // Contested-ring: vises rundt minen og fargen reflekterer kontroll-status.
    // Stiplet effekt simuleres med lav alpha — Phaser Arc har ingen native dash.
    const controlRing = this.add.circle(x, y, CONFIG.MINE_CONTEST_RADIUS, 0x000000, 0)
      .setStrokeStyle(2, 0x888888, 0.35)
      .setDepth(2);

    const mine: MineData = {
      id: this.nextId++, kind: 'mine', faction: 'neutral',
      x, y, w: leafW, h: leafH,
      hp: 9999, maxHp: 9999, body, bodyColor: THEME.APHID_LEAF_COLOR, hpBg, hpFg,
      control: null, controlRing,
      flipPressurePlayer: 0, flipPressureAi: 0,
    };
    this.attachBuildingLabel(mine);
    this.buildings.push(mine);
    this.mines.push(mine);
    return mine;
  }

  /** M2.1 — bygg en tower for spilleren. Tegnes som steinsokkel + farget topp.  */
  private createTower(type: TowerKind, x: number, y: number, faction: 'player' | 'ai' = 'player'): BuildingData {
    const spec = CONFIG.TOWER_TYPES[type];
    const w = 36, h = 44;

    // Drop shadow
    const shadow = this.add.ellipse(2, h * 0.42, w * 1.1, h * 0.28, 0x000000, 0.45);

    // Steinsokkel
    const base = this.add.ellipse(0, h * 0.18, w, h * 0.45, 0x6a5a3a)
      .setStrokeStyle(1.5, 0x2a1f12, 0.85);

    // Skaft
    const shaft = this.add.rectangle(0, -h * 0.05, w * 0.55, h * 0.55, 0x8a7a52)
      .setStrokeStyle(1.2, 0x3a2a18, 0.85);

    // Topp-disk (faget farge etter tower-type)
    const top = this.add.circle(0, -h * 0.35, w * 0.42, spec.color)
      .setStrokeStyle(1.4, 0x1a1208, 1);

    // Liten "kanon"-spiss (peker oppover)
    const muzzle = this.add.triangle(0, -h * 0.55, -3, 0, 3, 0, 0, -7, spec.color)
      .setStrokeStyle(1, 0x1a1208, 0.85);

    const container = this.add.container(x, y, [shadow, base, shaft, top, muzzle]).setDepth(3);

    // Hit body (skjult — bare ref for BuildingData)
    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(3);

    const hpBg = this.add.rectangle(x, y - h / 2 - 6, 40, 4, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 20, y - h / 2 - 6, 40, 4, 0x66bb44).setOrigin(0, 0.5).setDepth(8).setVisible(false);

    const b: BuildingData = {
      id: this.nextId++, kind: 'tower', faction,
      x, y, w, h,
      hp: spec.hp, maxHp: spec.hp,
      body, bodyColor: spec.color, hpBg, hpFg,
      towerContainer: container,
      tower: {
        type,
        range: spec.range,
        damage: spec.damage,
        fireRate: spec.fireRate,
        splash: spec.splash,
        slow: spec.slow,
        lastFireAt: 0,
      },
    };
    this.attachBuildingLabel(b);
    this.buildings.push(b);
    this.towers.push(b);
    return b;
  }

  /** M3.1 — bygg farm/wall/armory for spilleren. Barakke håndteres separat via createBuilding. */
  private createPlaceableBuilding(kind: 'farm' | 'wall' | 'armory', x: number, y: number): BuildingData {
    const spec = CONFIG.BUILDING_TYPES[kind];
    const w = spec.w, h = spec.h;

    const shadow = this.add.ellipse(2, h * 0.42, w * 1.1, h * 0.32, 0x000000, 0.45);

    const parts: Phaser.GameObjects.GameObject[] = [shadow];
    if (kind === 'farm') {
      // Bladlus-farm: stort blad-form med 3 bladlus oppå
      const leaf = this.add.ellipse(0, 0, w, h, 0x4f8a3a).setStrokeStyle(1.4, 0x2a4a1c, 0.9);
      const vein = this.add.rectangle(0, 0, w * 0.85, 1.5, 0x2a4a1c, 0.85);
      const hl = this.add.ellipse(-w * 0.18, -h * 0.18, w * 0.45, h * 0.28, 0x6ba84a, 0.7);
      parts.push(leaf, vein, hl);
      // Bladlus
      for (let i = 0; i < 3; i++) {
        const lx = (i - 1) * 9;
        const ly = -2 + Math.abs(i - 1) * 2;
        parts.push(this.add.ellipse(lx, ly, 6, 4.5, 0x88dd66).setStrokeStyle(0.8, 0x356b22, 0.9));
        parts.push(this.add.ellipse(lx - 1, ly - 1, 2, 1.4, 0xccff99, 0.7));
      }
    } else if (kind === 'wall') {
      // Mursteinklump: solid stein med riller
      const stone = this.add.rectangle(0, 0, w, h, 0x6c5a3a).setStrokeStyle(1.5, 0x2a1f12, 0.95);
      const top = this.add.rectangle(0, -h * 0.32, w * 0.92, h * 0.22, 0x8a7a52, 0.85);
      const crack = this.add.rectangle(0, h * 0.1, w * 0.65, 1.2, 0x2a1f12, 0.7);
      const crack2 = this.add.rectangle(-w * 0.1, -h * 0.05, 1.2, h * 0.5, 0x2a1f12, 0.6);
      parts.push(stone, top, crack, crack2);
    } else { // armory
      // Smie/våpenkammer: stein-bygning med ambolt-silhuett
      const wallS = this.add.rectangle(0, h * 0.05, w, h * 0.85, 0x8a6a3a).setStrokeStyle(1.5, 0x3a2a18, 0.95);
      const roof = this.add.triangle(0, -h * 0.32, -w / 2, h * 0.1, w / 2, h * 0.1, 0, -h * 0.4, 0x6c4a26).setStrokeStyle(1.2, 0x2a1f12, 0.9);
      const door = this.add.rectangle(0, h * 0.22, w * 0.28, h * 0.32, 0x2a1f12);
      // Liten ambolt-marker
      const anvilTop = this.add.rectangle(0, -h * 0.06, w * 0.38, 2.4, 0x9aa0a8);
      const anvilStem = this.add.rectangle(0, 0, w * 0.16, 4, 0x5a606a);
      parts.push(wallS, roof, door, anvilTop, anvilStem);
    }

    const container = this.add.container(x, y, parts).setDepth(3);

    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(3);

    const hpBg = this.add.rectangle(x, y - h / 2 - 6, 40, 4, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 20, y - h / 2 - 6, 40, 4, 0x66bb44).setOrigin(0, 0.5).setDepth(8).setVisible(false);

    const b: BuildingData = {
      id: this.nextId++, kind, faction: 'player',
      x, y, w, h,
      hp: spec.hp, maxHp: spec.hp,
      body, bodyColor: spec.color, hpBg, hpFg,
      buildingContainer: container,
    };
    this.attachBuildingLabel(b);
    this.buildings.push(b);
    if (kind === 'farm') this.farms.push(b);
    if (kind === 'wall') this.walls.push(b);
    return b;
  }

  /** M3.1 — er kind en tower-type? */
  private isTowerKind(kind: BuildKind): kind is TowerKind {
    return kind === 'stinger' || kind === 'webber' || kind === 'spitter';
  }

  /** M3.1 — hent build-spec for en buildable (tower eller building). */
  private getBuildSpec(kind: BuildKind): { cost: number; hp: number; w: number; h: number; color: number; range: number } {
    if (this.isTowerKind(kind)) {
      const t = CONFIG.TOWER_TYPES[kind];
      return { cost: t.cost, hp: t.hp, w: 36, h: 44, color: t.color, range: t.range };
    }
    if (kind === 'barracks') {
      return { cost: CONFIG.BARRACKS_COST, hp: CONFIG.BARRACKS_HP, w: 50, h: 38, color: 0x6b4a2a, range: 0 };
    }
    const b = CONFIG.BUILDING_TYPES[kind];
    return { cost: b.cost, hp: b.hp, w: b.w, h: b.h, color: b.color, range: 0 };
  }

  /** Konstruksjonstid (ms) for en buildable. */
  private buildTimeFor(kind: BuildKind): number {
    if (this.isTowerKind(kind)) return CONFIG.TOWER_BUILD_TIME;
    if (kind === 'barracks') return CONFIG.BARRACKS_BUILD_TIME;
    if (kind === 'farm') return CONFIG.FARM_BUILD_TIME;
    if (kind === 'wall') return CONFIG.WALL_BUILD_TIME;
    if (kind === 'armory') return CONFIG.ARMORY_BUILD_TIME;
    return 5000;
  }

  /** Build-radius for en gitt buildable (towers og bygninger har ulik radius). */
  private buildRadiusFor(kind: BuildKind): number {
    return this.isTowerKind(kind) ? CONFIG.TOWER_BUILD_RADIUS : CONFIG.BUILD_RADIUS;
  }

  /** Klaring (min avstand til andre bygninger) for en gitt buildable. */
  private placeClearanceFor(kind: BuildKind): number {
    return this.isTowerKind(kind) ? CONFIG.TOWER_PLACE_CLEARANCE : CONFIG.BUILD_PLACE_CLEARANCE;
  }

  /** Velg en player-worker som passer best til en byggeoppgave (idle eller mining først). */
  private pickAutoBuildWorker(): UnitData | null {
    const workers = this.units.filter(u =>
      u.faction === 'player' && u.type === 'worker' && !u.dead && u.state !== 'building',
    );
    if (workers.length === 0) return null;
    const idle = workers.filter(u => u.state === 'idle');
    const pool = idle.length > 0 ? idle : workers;
    let best = pool[0];
    let bestDist = Phaser.Math.Distance.Between(best.x, best.y, this.playerBase.x, this.playerBase.y);
    for (let i = 1; i < pool.length; i++) {
      const d = Phaser.Math.Distance.Between(pool[i].x, pool[i].y, this.playerBase.x, this.playerBase.y);
      if (d < bestDist) { best = pool[i]; bestDist = d; }
    }
    return best;
  }

  /** Kan en buildable plasseres på (x,y)? Brukes for både towers og buildings. */
  private canPlaceBuildable(kind: BuildKind, x: number, y: number): boolean {
    if (!this.playerBase || this.playerBase.hp <= 0) return false;
    const radius = this.buildRadiusFor(kind);
    const dFromBase = Phaser.Math.Distance.Between(x, y, this.playerBase.x, this.playerBase.y);
    if (dFromBase > radius) return false;
    // Innenfor verden
    if (x < 40 || x > CONFIG.MAP_WIDTH - 40 || y < 40 || y > CONFIG.MAP_HEIGHT - 40) return false;
    // Ikke på elv
    if (this.riverStateAt(x, y) !== 'land') return false;
    // Ikke på steinformasjon
    if (this.isBlockedByObstacle(x, y)) return false;
    // Ikke på cliff-kant
    if (this.isBlockedByCliff(x, y)) return false;
    // Klaring til andre bygninger
    const c = this.placeClearanceFor(kind);
    for (const b of this.buildings) {
      if (b.dead || b.hp <= 0) continue;
      if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < c) return false;
    }
    return true;
  }

  /** M2.1 / M3.1 — start build-mode for valgt buildable.
   *  Worker er den eneste enheten som kan bygge — vi krever derfor at minst én
   *  player-worker er valgt. Hvis ingen worker er valgt, auto-velges nærmeste idle. */
  private startBuildMode(kind: BuildKind) {
    if (this.gameState !== 'running') return;
    if (this.playerBase.hp <= 0) return;

    const hasWorker = this.selectedUnits.some(u => u.faction === 'player' && u.type === 'worker' && !u.dead);
    if (!hasWorker) {
      const auto = this.pickAutoBuildWorker();
      if (!auto) {
        this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Trenger maur-arbeider', '#ee5544');
        return;
      }
      this.clearSelection();
      this.selectUnit(auto);
      this.vfx.floatText(auto.x, auto.y - 22, 'BYGGER', '#ddff88');
    }

    this.cancelBuildMode();
    const ghostBody = this.add.graphics().setDepth(24);
    const ghostRange = this.add.graphics().setDepth(23);
    this.buildMode = { kind, ghostBody, ghostRange, valid: false };
    // Tegn build-radius rundt basen
    if (!this.buildRadiusRing) {
      this.buildRadiusRing = this.add.graphics().setDepth(22);
    }
    const radius = this.buildRadiusFor(kind);
    this.buildRadiusRing.clear();
    this.buildRadiusRing.lineStyle(2, 0xddcc88, 0.55);
    this.buildRadiusRing.strokeCircle(this.playerBase.x, this.playerBase.y, radius);
    // Initiel ghost-tegning kommer i pointermove
  }

  private cancelBuildMode() {
    if (!this.buildMode) return;
    this.buildMode.ghostBody.destroy();
    this.buildMode.ghostRange.destroy();
    this.buildMode = null;
    if (this.buildRadiusRing) {
      this.buildRadiusRing.destroy();
      this.buildRadiusRing = null;
    }
  }

  private updateBuildGhost(w: Vec2) {
    if (!this.buildMode) return;
    const kind = this.buildMode.kind;
    const spec = this.getBuildSpec(kind);
    const ok = this.canPlaceBuildable(kind, w.x, w.y) && this.playerGold >= spec.cost;
    this.buildMode.valid = ok;
    const color = ok ? 0x66dd66 : 0xee5544;

    // Ghost body
    const g = this.buildMode.ghostBody;
    g.clear();
    g.lineStyle(2, color, 0.95);
    g.fillStyle(color, 0.18);
    const halfW = spec.w / 2;
    const halfH = spec.h / 2;
    g.fillRect(w.x - halfW, w.y - halfH, spec.w, spec.h);
    g.strokeRect(w.x - halfW, w.y - halfH, spec.w, spec.h);
    g.fillStyle(spec.color, 0.55);
    g.fillCircle(w.x, w.y - halfH * 0.3, Math.min(halfW, halfH) * 0.8);

    // Range-ring (kun tower)
    const rg = this.buildMode.ghostRange;
    rg.clear();
    if (spec.range > 0) {
      rg.lineStyle(1.5, color, 0.55);
      rg.strokeCircle(w.x, w.y, spec.range);
    }
  }

  /** Plasser buildable hvis posisjon er gyldig. Returnerer true ved suksess.
   *  Bygningen starter under konstruksjon — workeren walker dit og bygger den ferdig. */
  private placeBuildable(w: Vec2): boolean {
    if (!this.buildMode) return false;
    const kind = this.buildMode.kind;
    const spec = this.getBuildSpec(kind);
    if (!this.canPlaceBuildable(kind, w.x, w.y) || this.playerGold < spec.cost) return false;

    // Krever en levende player-worker (auto-select skjedde i startBuildMode hvis ingen var valgt)
    const workers = this.selectedUnits.filter(u => u.faction === 'player' && u.type === 'worker' && !u.dead);
    if (workers.length === 0) return false;

    this.playerGold -= spec.cost;
    let b: BuildingData;
    if (this.isTowerKind(kind)) {
      b = this.createTower(kind, w.x, w.y);
    } else if (kind === 'barracks') {
      b = this.createBuilding('barracks', 'player', w.x, w.y, spec.w, spec.h, spec.hp);
      this.playerBarracks = b;
    } else {
      b = this.createPlaceableBuilding(kind, w.x, w.y);
    }
    this.beginConstruction(b, kind);

    // Velg nærmeste worker som bygger; flytt dit
    let best = workers[0];
    let bestDist = Phaser.Math.Distance.Between(best.x, best.y, b.x, b.y);
    for (let i = 1; i < workers.length; i++) {
      const d = Phaser.Math.Distance.Between(workers[i].x, workers[i].y, b.x, b.y);
      if (d < bestDist) { best = workers[i]; bestDist = d; }
    }
    this.assignWorkerToBuild(best, b);

    this.spawnCommandRipple(w.x, w.y, 0xddff88);
    playSfx(this, 'train', { volume: 0.5 });
    return true;
  }

  /** Marker en bygning som under konstruksjon. Setter HP til 25 % av max,
   *  alpha til 0.55 og lager en progress-bar over bygningen. */
  private beginConstruction(b: BuildingData, kind: BuildKind) {
    b.underConstruction = true;
    b.buildProgress = 0;
    b.buildTimeMs = this.buildTimeFor(kind);
    b.hp = Math.max(1, Math.ceil(b.maxHp * 0.25));

    // Visuelt: senk alpha på alle container-/body-elementer
    const container = b.bridgeContainer ?? b.towerContainer ?? b.buildingContainer;
    if (container) container.setAlpha(0.55);
    else b.body.setAlpha(0.55);

    // Progress-bar over bygningen (gjenbruker hp-bar-stil, men i en egen farge)
    const barY = b.y - Math.max(b.w, b.h) * 0.65 - 14;
    b.buildProgressBg = this.add.rectangle(b.x, barY, 48, 5, 0x222222).setDepth(9);
    b.buildProgressFg = this.add.rectangle(b.x - 24, barY, 1, 5, 0xddcc88).setOrigin(0, 0.5).setDepth(10);
  }

  /** Avslutt konstruksjonen — fjern progress-bar, returner HP og alpha. */
  private finishConstruction(b: BuildingData) {
    b.underConstruction = false;
    b.buildProgress = 1;
    b.hp = b.maxHp;
    const container = b.bridgeContainer ?? b.towerContainer ?? b.buildingContainer;
    if (container) container.setAlpha(1);
    else b.body.setAlpha(1);
    b.buildProgressBg?.destroy();
    b.buildProgressFg?.destroy();
    b.buildProgressBg = undefined;
    b.buildProgressFg = undefined;
    // Liten celebrate-text + N3 build-dust burst
    this.vfx.floatText(b.x, b.y - 30, 'FERDIG!', '#ddff88');
    this.vfx.dust(b.x, b.y, 14);
    playSfx(this, 'train', { volume: 0.6 });
  }

  /** Send en worker til å bygge en bygning under konstruksjon. */
  private assignWorkerToBuild(worker: UnitData, site: BuildingData) {
    worker.mineTarget = null;
    worker.attackTarget = null;
    worker.buildTarget = site;
    worker.state = 'moving';
    worker.moveTarget = { x: site.x, y: site.y };
  }

  /** Auto-fire fra alle towers — kalt fra update(). */
  private updateTowers(time: number) {
    for (const tower of this.towers) {
      if (tower.dead || tower.hp <= 0 || !tower.tower || tower.underConstruction) continue;
      const t = tower.tower;
      if (time - t.lastFireAt < t.fireRate) continue;

      // K5 — tårn skyter på motsatt fraksjon. Player-tårn → AI-units; AI-tårn → player-units.
      const enemyFaction: 'player' | 'ai' = tower.faction === 'ai' ? 'player' : 'ai';

      // Finn nærmeste fiende-unit innenfor range
      let target: UnitData | null = null;
      let bestDist = t.range;
      for (const u of this.units) {
        if (u.dead || u.faction !== enemyFaction) continue;
        const d = Phaser.Math.Distance.Between(tower.x, tower.y, u.x, u.y);
        if (d < bestDist) { target = u; bestDist = d; }
      }
      if (!target) continue;

      t.lastFireAt = time;
      const projColor = t.type === 'spitter' ? 0x8acc6a
        : t.type === 'webber' ? 0xc8c8e8
        : (tower.faction === 'ai' ? THEME.ATTACK_PROJECTILE_AI : THEME.ATTACK_PROJECTILE_PLAYER);
      this.vfx.fireProjectile(tower.x, tower.y - 14, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);
      playSfx(this, 'attack', { volume: 0.15 });

      // Damage selve målet
      this.applyTowerHit(target, t.damage, t.slow, time);

      // Splash (spitter)
      if (t.splash > 0) {
        for (const u of this.units) {
          if (u === target || u.dead || u.faction !== enemyFaction) continue;
          const d = Phaser.Math.Distance.Between(target.x, target.y, u.x, u.y);
          if (d <= t.splash) this.applyTowerHit(u, Math.round(t.damage * 0.6), t.slow, time);
        }
      }
    }
  }

  /** M3.2 — Base auto-attack når Forsvar er kjøpt. */
  private updateBaseDefense(time: number) {
    const base = this.playerBase;
    if (!base || base.dead || base.hp <= 0 || !base.defense) return;
    const d = base.defense;
    if (time - d.lastFireAt < d.fireRate) return;

    let target: UnitData | null = null;
    let bestDist = d.range;
    for (const u of this.units) {
      if (u.dead || u.faction !== 'ai') continue;
      const dist = Phaser.Math.Distance.Between(base.x, base.y, u.x, u.y);
      if (dist < bestDist) { target = u; bestDist = dist; }
    }
    if (!target) return;

    d.lastFireAt = time;
    this.vfx.fireProjectile(base.x, base.y - 8, target.x, target.y, THEME.ATTACK_PROJECTILE_PLAYER);
    this.vfx.impact(target.x, target.y);
    playSfx(this, 'attack', { volume: 0.18 });
    this.applyTowerHit(target, d.damage, 0, time);
  }

  /** M3.2 — kjøp "Forsvar"-oppgradering på player-base. */
  private upgradeBaseDefense() {
    const base = this.playerBase;
    if (!base || base.dead || base.hp <= 0) return;
    if (base.defense) return; // allerede kjøpt
    if (this.playerGold < CONFIG.BASE_DEFENSE_COST) return;
    this.playerGold -= CONFIG.BASE_DEFENSE_COST;
    base.maxHp += CONFIG.BASE_DEFENSE_HP_BONUS;
    base.hp += CONFIG.BASE_DEFENSE_HP_BONUS;
    base.defense = {
      range: CONFIG.BASE_DEFENSE_RANGE,
      damage: CONFIG.BASE_DEFENSE_DAMAGE,
      fireRate: CONFIG.BASE_DEFENSE_FIRE_RATE,
      lastFireAt: 0,
    };
    this.vfx.floatText(base.x, base.y - 60, 'FORSVAR!', '#ddff88');
    playSfx(this, 'train', { volume: 0.75 });
  }

  private applyTowerHit(target: UnitData, damage: number, slow: number, time: number) {
    target.hp -= damage;
    if (slow > 0) target.slowedUntil = time + CONFIG.TOWER_SLOW_DURATION;
    // Flash white briefly
    for (const s of target.segments) s.setFillStyle(0xffffff);
    this.time.delayedCall(80, () => {
      if (!target.dead) for (const s of target.segments) s.setFillStyle(target.bodyColor);
    });
    if (target.hp <= 0) {
      playSfx(this, 'unit-die', { volume: 0.3 });
      this.removeUnit(target);
    }
  }

  private spawnUnit(faction: 'player' | 'ai', type: 'worker' | 'soldier', x: number, y: number): UnitData {
    const isSoldier = type === 'soldier';
    const isPlayer = faction === 'player';

    // Faction-baserte farger
    const bodyColor = isPlayer
      ? (isSoldier ? THEME.PLAYER_SOLDIER_COLOR : THEME.PLAYER_WORKER_COLOR)
      : (isSoldier ? THEME.AI_SOLDIER_COLOR : THEME.AI_WORKER_COLOR);
    const legColor = isPlayer ? THEME.ANT_LEG_COLOR_PLAYER : THEME.ANT_LEG_COLOR_AI;
    const headHighlight = isPlayer ? THEME.ANT_HEAD_HIGHLIGHT_PLAYER : THEME.ANT_HEAD_HIGHLIGHT_AI;
    const mandibleColor = isPlayer ? THEME.ANT_MANDIBLE_COLOR_PLAYER : THEME.ANT_MANDIBLE_COLOR_AI;

    // Maur-proporsjoner (ant lokal-koordinatsystem: +X = forover)
    const dims = isSoldier
      ? { abdW: 13, abdH: 9, abdX: -7, thW: 7, thH: 6, hdW: 9, hdH: 8, hdX: 7, legLen: 8, antLen: 7, mandLen: 5 }
      : { abdW: 9, abdH: 6.5, abdX: -4.5, thW: 5, thH: 4.5, hdW: 6, hdH: 5.5, hdX: 4.5, legLen: 5.5, antLen: 5, mandLen: 0 };
    const r = isSoldier ? 13 : 9;

    // Footprint og skygge (ground-plane, ikke roterende)
    const footprint = this.add.ellipse(0, r * 0.45, r * 2.0, r * 0.6, bodyColor, 0.22);
    const shadow = this.add.ellipse(2, r * 0.35, r * 1.7, r * 0.6, 0x000000, 0.42);

    // Ant-body sub-container (roterer med bevegelsesretning, holder alle kropps-deler)
    const antBody = this.add.container(0, 0);

    // Bein og følehorn/mandibler tegnes via Graphics (billig, en-shot)
    const legs = this.add.graphics();
    legs.lineStyle(1.4, legColor, 0.95);
    const drawLegPair = (rootX: number, tipX: number, sign: number) => {
      const rootY = sign * dims.thH * 0.4;
      const tipY = sign * (dims.thH * 0.4 + dims.legLen);
      // To-segments bein med en svak "kne"-knekk
      const kneeX = (rootX + tipX) / 2 + sign * 0.5;
      const kneeY = sign * (dims.thH * 0.4 + dims.legLen * 0.5);
      legs.beginPath();
      legs.moveTo(rootX, rootY);
      legs.lineTo(kneeX, kneeY);
      legs.lineTo(tipX, tipY);
      legs.strokePath();
    };
    // Tre par bein: front, midt, bak (langs X-akse)
    const legFrontX = dims.thW * 0.35;
    const legMidX = 0;
    const legRearX = -dims.thW * 0.35;
    drawLegPair(legFrontX, legFrontX + dims.legLen * 0.5, -1);
    drawLegPair(legMidX, legMidX, -1);
    drawLegPair(legRearX, legRearX - dims.legLen * 0.5, -1);
    drawLegPair(legFrontX, legFrontX + dims.legLen * 0.5, 1);
    drawLegPair(legMidX, legMidX, 1);
    drawLegPair(legRearX, legRearX - dims.legLen * 0.5, 1);

    // Kropps-segmenter (abdomen bak, thorax midt, hode forrest — som ellipser orientert langs X)
    const abdomen = this.add.ellipse(dims.abdX, 0, dims.abdW, dims.abdH, bodyColor);
    const thorax = this.add.ellipse(0, 0, dims.thW, dims.thH, bodyColor);
    const head = this.add.ellipse(dims.hdX, 0, dims.hdW, dims.hdH, bodyColor);
    // Subtil hode-highlight (gjør hodet litt lysere så det leses som hode)
    const headSheen = this.add.ellipse(dims.hdX - 0.5, -dims.hdH * 0.15, dims.hdW * 0.55, dims.hdH * 0.45, headHighlight, 0.7);

    // Svart outline-stroke på segmenter
    abdomen.setStrokeStyle(0.8, 0x000000, 0.7);
    thorax.setStrokeStyle(0.8, 0x000000, 0.7);
    head.setStrokeStyle(0.8, 0x000000, 0.7);

    // Følehorn og (for soldater) mandibler — tegnet på samme Graphics-objekt for ytelse
    const appendages = this.add.graphics();
    // Følehorn (V-formet fra hodets front, lett buet)
    appendages.lineStyle(1, legColor, 1);
    const antRootX = dims.hdX + dims.hdW * 0.35;
    const antRootYL = -dims.hdH * 0.2;
    const antRootYR = dims.hdH * 0.2;
    const antTipXL = antRootX + dims.antLen * 0.9;
    const antTipYL = antRootYL - dims.antLen * 0.7;
    const antTipXR = antRootX + dims.antLen * 0.9;
    const antTipYR = antRootYR + dims.antLen * 0.7;
    appendages.beginPath();
    appendages.moveTo(antRootX, antRootYL);
    appendages.lineTo(antRootX + dims.antLen * 0.45, antRootYL - dims.antLen * 0.3);
    appendages.lineTo(antTipXL, antTipYL);
    appendages.strokePath();
    appendages.beginPath();
    appendages.moveTo(antRootX, antRootYR);
    appendages.lineTo(antRootX + dims.antLen * 0.45, antRootYR + dims.antLen * 0.3);
    appendages.lineTo(antTipXR, antTipYR);
    appendages.strokePath();
    // Mandibler — kun soldater
    if (isSoldier) {
      appendages.lineStyle(1.6, mandibleColor, 1);
      const mRootX = dims.hdX + dims.hdW * 0.45;
      const mTipX = mRootX + dims.mandLen;
      const mTipYHalf = dims.hdH * 0.45;
      appendages.lineBetween(mRootX, -dims.hdH * 0.15, mTipX, -mTipYHalf);
      appendages.lineBetween(mRootX, dims.hdH * 0.15, mTipX, mTipYHalf);
    }

    // Rekkefølge i antBody: bein bak alt annet, så segmenter, så højdere
    antBody.add([legs, abdomen, thorax, head, headSheen, appendages]);

    // HP-bar og selection-ring lever på ytre container (roteres ikke)
    const hpBg = this.add.rectangle(0, -r - 7, r * 2 + 2, 6, 0x2a1810).setStrokeStyle(1, 0x000000, 0.95);
    const hpFg = this.add.rectangle(-r, -r - 7, r * 2, 4, 0x8cd95a).setOrigin(0, 0.5);
    const selGlow = this.add.arc(0, 0, r + 6, 0, 360, false, 0xff9d4a, 0)
      .setStrokeStyle(8, 0xff9d4a, 0.22).setVisible(false);
    const selRing = this.add.arc(0, 0, r + 6, 0, 360, false, 0xff9d4a, 0)
      .setStrokeStyle(3, 0xff9d4a, 0.95).setVisible(false);

    hpBg.setVisible(false);
    hpFg.setVisible(false);

    const container = this.add.container(x, y, [footprint, shadow, antBody, selGlow, hpBg, hpFg, selRing]).setDepth(5);

    const unit: UnitData = {
      id: this.nextId++, faction, type, x, y,
      hp: isSoldier ? CONFIG.SOLDIER_HP : 60,
      maxHp: isSoldier ? CONFIG.SOLDIER_HP : 60,
      speed: isSoldier ? CONFIG.SOLDIER_SPEED : CONFIG.WORKER_SPEED,
      damage: isSoldier ? CONFIG.SOLDIER_DAMAGE : 0,
      attackRange: isSoldier ? CONFIG.SOLDIER_ATTACK_RANGE : 0,
      attackInterval: CONFIG.SOLDIER_ATTACK_SPEED,
      lastAttackAt: 0,
      state: 'idle', moveTarget: null, attackTarget: null, mineTarget: null, buildTarget: null,
      selected: false, dead: false,
      container, antBody, body: thorax, segments: [abdomen, thorax, head],
      bodyColor, hpBg, hpFg, selectionRing: selRing, selectionGlow: selGlow,
      selectionTween: null, radius: r,
      lastDx: isPlayer ? 1 : -1, lastDy: 0,
      slowedUntil: 0,
    };

    this.units.push(unit);
    return unit;
  }

  private removeUnit(unit: UnitData) {
    unit.dead = true;
    // V7 — tell tapte/drepte enheter (player POV) for game-over stats.
    if (unit.faction === 'player') this.statsUnitsLost++;
    else if (unit.faction === 'ai') this.statsEnemyKills++;
    // Remove from logical lists BEFORE the tween so update/find don't touch a dying unit
    this.units = this.units.filter(u => u !== unit);
    this.selectedUnits = this.selectedUnits.filter(u => u !== unit);
    if (unit.selectionTween) { unit.selectionTween.stop(); unit.selectionTween = null; }

    this.vfx.dust(unit.x, unit.y, 8);
    this.tweens.add({
      targets: unit.container,
      scale: 0,
      alpha: 0,
      angle: 180,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () => unit.container.destroy(),
    });
  }

  // ── Main loop ────────────────────────────────────────────────────────────

  update(time: number, delta: number) {
    if (this.gameState !== 'running') return;

    // M1.1 — pause / time-scale. Kamera-scroll bruker UNSCALED dt så panorering
    // alltid føles responsivt selv på pause (du kan utforske kartet).
    const rawDt = delta / 1000;
    this.updateCameraScroll(rawDt);

    // Når spillet er pauset: emit HUD-state (så badge blir riktig) men kjør ikke spill-logikk.
    if (this.gameSpeed === 0) {
      this.checkEnemyNear(time);  // varsel oppdateres ikke, men decay alert er ok
      this.emitHudState();
      return;
    }

    const dt = rawDt * this.gameSpeed;
    this.gameTime += dt;

    for (const unit of [...this.units]) {
      if (!unit.dead) this.updateUnit(unit, time, dt);
    }

    // M2.1 — towers fyrer på fiende-units
    this.updateTowers(time);
    // M3.2 — base auto-attack (kun hvis Forsvar er kjøpt)
    this.updateBaseDefense(time);

    // M2.2 — wave-modus oppdaterer spawns og sjekker seier
    if (CONFIG.WAVE_MODE.enabled) {
      this.updateWaves(time, delta);
      if (this.playerBase.hp <= 0) { this.endGame('lost'); return; }
      if (this.wavesCleared && !this.waveActive && this.units.every(u => u.faction !== 'ai' || u.dead)) {
        this.endGame('won'); return;
      }
    } else {
      if (this.playerBase.hp <= 0) { this.endGame('lost'); return; }
      if (this.aiBase.hp <= 0) { this.endGame('won'); return; }
    }

    // M1.4 — base-alarm når egen base under 50 % HP
    if (this.baseAlarmLoop) {
      const pct = this.playerBase.hp / this.playerBase.maxHp;
      if (pct < 0.5) this.baseAlarmLoop.start();
      else this.baseAlarmLoop.stop();
    }

    // M1.5 — sjekk fiende nær base periodisk
    this.checkEnemyNear(time);

    // Building HP bars — only shown when damaged (and not neutral mines, not dead)
    for (const b of this.buildings) {
      const pct = Math.max(0, b.hp / b.maxHp);
      b.hpFg.setDisplaySize(44 * pct, 5);
      b.hpFg.setFillStyle(hpBarColor(pct));
      const showBar = b.kind !== 'mine' && b.hp < b.maxHp && b.hp > 0;
      b.hpBg.setVisible(showBar);
      b.hpFg.setVisible(showBar);
    }

    this.emitHudState();
  }

  // ── Unit behavior ────────────────────────────────────────────────────────

  private updateUnit(unit: UnitData, time: number, dt: number) {
    unit.container.setPosition(unit.x, unit.y);
    unit.selectionRing.setVisible(unit.selected);
    unit.selectionGlow.setVisible(unit.selected);

    // Idle-bob (bobber hele ant-body, ikke HP-bar/selection)
    const bob = Math.sin((time + unit.id * 137) * 0.004) * 1.0;
    unit.antBody.y = bob;

    // Rotér ant-body til å peke i bevegelsesretning (følehorn fremover)
    unit.antBody.rotation = Math.atan2(unit.lastDy, unit.lastDx);

    // HP bar — only shown when damaged
    const maxW = unit.type === 'soldier' ? 24 : 18;
    const hurt = unit.hp < unit.maxHp;
    unit.hpBg.setVisible(hurt);
    unit.hpFg.setVisible(hurt);
    const pct = unit.hp / unit.maxHp;
    unit.hpFg.setDisplaySize(Math.max(0, maxW * pct), 4);
    unit.hpFg.setFillStyle(hpBarColor(pct));

    // Clear stale attack targets
    if (unit.attackTarget) {
      const t = unit.attackTarget;
      if (('dead' in t && (t as UnitData).dead) || t.hp <= 0) {
        unit.attackTarget = null;
        if (unit.state === 'attacking') unit.state = 'idle';
      }
    }

    switch (unit.state) {
      case 'attacking':
        this.updateAttacking(unit, time, dt);
        break;

      case 'mining':
        if (unit.mineTarget) {
          const d = Phaser.Math.Distance.Between(unit.x, unit.y, unit.mineTarget.x, unit.mineTarget.y);
          if (d > 28) { unit.state = 'moving'; unit.moveTarget = { x: unit.mineTarget.x, y: unit.mineTarget.y }; }
        } else {
          unit.state = 'idle';
        }
        break;

      case 'moving':
        if (unit.moveTarget) {
          const arrived = this.moveToward(unit, unit.moveTarget, dt);
          if (arrived) {
            unit.moveTarget = null;
            // Worker som har et byggemål: flip til 'building' når vi har kommet fram
            if (unit.buildTarget && !unit.buildTarget.dead && unit.buildTarget.hp > 0
                && unit.buildTarget.underConstruction) {
              unit.state = 'building';
            } else if (unit.buildTarget) {
              // Byggesite er dødt eller ferdig — slipp og gå idle
              unit.buildTarget = null;
              unit.state = 'idle';
            } else {
              unit.state = unit.mineTarget ? 'mining' : 'idle';
            }
          }
        } else {
          unit.state = 'idle';
        }
        break;

      case 'building':
        this.updateBuildingUnit(unit, dt);
        break;

      case 'idle':
        if (unit.type === 'soldier') this.findAndEngage(unit);
        break;
    }

    // Light separation push
    this.separate(unit);
  }

  /** Worker konstruerer en bygning. Inkrementerer buildProgress, HP lerper opp,
   *  og workeren frigis når progress når 1. Hvis sitet dør eller forsvinner,
   *  flipper workeren til idle. */
  private updateBuildingUnit(unit: UnitData, dt: number) {
    const site = unit.buildTarget;
    if (!site || site.dead || site.hp <= 0 || !site.underConstruction) {
      unit.buildTarget = null;
      unit.state = 'idle';
      return;
    }
    // Hold workeren ved sitet (innen ~30px)
    const d = Phaser.Math.Distance.Between(unit.x, unit.y, site.x, site.y);
    if (d > 30) {
      unit.state = 'moving';
      unit.moveTarget = { x: site.x, y: site.y };
      return;
    }
    const tm = site.buildTimeMs ?? 5000;
    site.buildProgress = (site.buildProgress ?? 0) + (dt * 1000) / tm;
    // HP lerper fra 25 % → 100 % under konstruksjon
    const targetHp = site.maxHp * (0.25 + 0.75 * Math.min(1, site.buildProgress));
    site.hp = Math.min(site.maxHp, Math.max(site.hp, targetHp));

    // Oppdater progress-bar
    if (site.buildProgressFg) {
      site.buildProgressFg.setDisplaySize(48 * Math.min(1, site.buildProgress), 5);
    }

    if (site.buildProgress >= 1) {
      this.finishConstruction(site);
      unit.buildTarget = null;
      unit.state = 'idle';
    }
  }

  private updateAttacking(unit: UnitData, time: number, dt: number) {
    const target = unit.attackTarget!;
    const dist = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);

    if (dist > unit.attackRange) {
      this.moveToward(unit, { x: target.x, y: target.y }, dt);
    } else if (time - unit.lastAttackAt >= unit.attackInterval) {
      unit.lastAttackAt = time;

      // Face the target while attacking
      const fdx = target.x - unit.x; const fdy = target.y - unit.y; const fd = Math.hypot(fdx, fdy) || 1;
      unit.lastDx = fdx / fd; unit.lastDy = fdy / fd;

      // Projectile + impact (maursyre-sprut)
      const projColor = unit.faction === 'player'
        ? THEME.ATTACK_PROJECTILE_PLAYER
        : THEME.ATTACK_PROJECTILE_AI;
      this.vfx.fireProjectile(unit.x, unit.y, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);
      // M1.4 — attack-hit sfx (lavt volum så det ikke blir spammet av store kamper)
      playSfx(this, 'attack', { volume: 0.18 });

      // Broer (invulnerable) tar aldri skade. Forsvarsmekanisme hvis en target slipper
      // gjennom andre filtere — pluss avbryt angrepet så enheten finner nytt mål.
      if (!isUnit(target) && target.invulnerable) {
        unit.attackTarget = null;
        unit.state = 'idle';
        return;
      }

      target.hp -= unit.damage;

      // Damage tint — flash white briefly across all visible segments
      if (isUnit(target)) {
        for (const s of target.segments) s.setFillStyle(0xffffff);
        this.time.delayedCall(80, () => {
          if (!target.dead) for (const s of target.segments) s.setFillStyle(target.bodyColor);
        });
      } else {
        target.body.setFillStyle(0xffffff);
        const origColor = target.bodyColor;
        this.time.delayedCall(80, () => {
          if (target.hp > 0) target.body.setFillStyle(origColor);
        });
      }

      // Camera shake when a base takes damage (throttled)
      if (!isUnit(target) && (target === this.playerBase || target === this.aiBase)) {
        if (time - this.lastBaseShakeAt > 150) {
          this.cameras.main.shake(120, 0.003);
          this.lastBaseShakeAt = time;
        }
      }

      if (target.hp <= 0) {
        if (isUnit(target)) {
          playSfx(this, 'unit-die', { volume: 0.35 });
          this.removeUnit(target);
        } else {
          this.collapseBuilding(target);
        }
        unit.attackTarget = null;
        unit.state = 'idle';
      }
    }
  }

  private collapseBuilding(b: BuildingData) {
    if (b.dead) return;
    b.dead = true;
    b.hpFg.setVisible(false);
    b.hpBg.setVisible(false);
    b.label?.setVisible(false);
    b.buildProgressBg?.destroy();
    b.buildProgressFg?.destroy();
    b.buildProgressBg = undefined;
    b.buildProgressFg = undefined;
    // Nullstill barakke-refs så build-order kan bygge nye
    if (this.playerBarracks === b) this.playerBarracks = null;
    if (this.aiBarracks === b) this.aiBarracks = null;
    // Hvis det er en byggeplass: fri workere som bygde på den
    for (const u of this.units) {
      if (u.buildTarget === b) {
        u.buildTarget = null;
        if (u.state === 'building') u.state = 'idle';
      }
    }
    this.cameras.main.shake(220, 0.005);
    this.vfx.dust(b.x, b.y, 14);
    // Broer kollapser containeren (planker faller), basers body fader.
    // Towers (M2.1) faller på samme måte som broer.
    const target: Phaser.GameObjects.GameObject =
      b.kind === 'bridge' && b.bridgeContainer ? b.bridgeContainer
      : b.kind === 'tower' && b.towerContainer ? b.towerContainer
      : b.buildingContainer ? b.buildingContainer
      : b.body;
    this.tweens.add({
      targets: target,
      scaleY: 0.25,
      alpha: 0.35,
      duration: 420,
      ease: 'Bounce.easeOut',
    });
  }

  private findAndEngage(unit: UnitData) {
    const detectionRange = unit.attackRange * 6;
    let nearest: UnitData | BuildingData | null = null;
    let nearestDist = detectionRange;

    for (const e of this.units) {
      if (e.faction === unit.faction || e.dead) continue;
      const d = Phaser.Math.Distance.Between(unit.x, unit.y, e.x, e.y);
      if (d < nearestDist) { nearest = e; nearestDist = d; }
    }

    if (!nearest) {
      for (const b of this.buildings) {
        if (b.faction === unit.faction || b.faction === 'neutral' || b.hp <= 0) continue;
        const d = Phaser.Math.Distance.Between(unit.x, unit.y, b.x, b.y);
        if (d < nearestDist) { nearest = b; nearestDist = d; }
      }
    }

    if (nearest) {
      unit.attackTarget = nearest;
      unit.state = 'attacking';
    }
  }

  /** Effektivt bevegelsesmål med waypoint-routing via bro når elv blokkerer. */
  private resolveMoveTarget(unit: UnitData, dest: Vec2): Vec2 {
    if (this.rivers.length === 0) return dest;
    let crossingRiver: River | null = null;
    for (const r of this.rivers) {
      if (segmentCrossesPolyline(unit, dest, r.centerLine)) { crossingRiver = r; break; }
    }
    if (!crossingRiver) return dest;

    // Velg nærmeste levende bro som faktisk er på samme elv.
    const liveBridges = crossingRiver.bridges.filter(b => !b.dead && b.hp > 0);
    if (liveBridges.length === 0) return dest; // ingen vei over — la unit støte mot elv

    let best = liveBridges[0];
    let bestDist = Phaser.Math.Distance.Between(unit.x, unit.y, best.x, best.y);
    for (let i = 1; i < liveBridges.length; i++) {
      const b = liveBridges[i];
      const d = Phaser.Math.Distance.Between(unit.x, unit.y, b.x, b.y);
      if (d < bestDist) { best = b; bestDist = d; }
    }
    return { x: best.x, y: best.y };
  }

  /**
   * Terreng-status ved (x,y) for bevegelseslogikk:
   *  - 'land'              : normal bevegelse
   *  - 'bridge'            : inne i elv, men på en levende bro → normal bevegelse
   *  - 'blocked'           : inne i elv, ikke nær en bro → maur kan ikke svømme
   *
   * Sjekker om punktet er innenfor bro-fotavtrykket (bredde × høyde + margin).
   */
  private riverStateAt(x: number, y: number): 'land' | 'bridge' | 'blocked' {
    for (const r of this.rivers) {
      if (!pointInPolygon({ x, y }, r.polygon)) continue;
      const margin = 12;
      for (const b of r.bridges) {
        if (b.dead || b.hp <= 0) continue;
        if (Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(y - b.y) < b.h / 2 + margin) {
          return 'bridge';
        }
      }
      return 'blocked';
    }
    return 'land';
  }

  /** Bakoverkompatibel: brukes av separat-logikk som bare vil vite om vi skal unngå. */
  private isBlockedByRiver(x: number, y: number): boolean {
    return this.riverStateAt(x, y) === 'blocked';
  }

  /**
   * True hvis (x,y) er på en cliff-kant (innenfor CLIFF_THICKNESS av platåets perimeter)
   * OG ikke i en rampe. Cliff blokkerer bevegelse — ramper er passable åpninger.
   */
  /** True hvis (x,y) er innenfor platåets footprint (high-ground). Brukt av
   *  auto-mine-assign for å unngå at workers ramler inn på et platå og blir
   *  fanget av cliffs når de senere må krysse tilbake til lavlandet for å bygge. */
  private isPointOnPlateau(x: number, y: number): boolean {
    for (const p of this.plateaus) {
      if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return true;
    }
    return false;
  }

  private isBlockedByCliff(x: number, y: number): boolean {
    if (this.plateaus.length === 0) return false;
    const t = GameScene.CLIFF_THICKNESS;
    for (const p of this.plateaus) {
      if (x < p.x - t || x > p.x + p.w + t || y < p.y - t || y > p.y + p.h + t) continue;
      const onTop = Math.abs(y - p.y) <= t && x >= p.x - t && x <= p.x + p.w + t;
      const onBottom = Math.abs(y - (p.y + p.h)) <= t && x >= p.x - t && x <= p.x + p.w + t;
      const onLeft = Math.abs(x - p.x) <= t && y >= p.y - t && y <= p.y + p.h + t;
      const onRight = Math.abs(x - (p.x + p.w)) <= t && y >= p.y - t && y <= p.y + p.h + t;
      if (!onTop && !onBottom && !onLeft && !onRight) continue;
      const inRamp = p.ramps.some(r => {
        if (r.side === 'top' && onTop) return x >= r.from && x <= r.to;
        if (r.side === 'bottom' && onBottom) return x >= r.from && x <= r.to;
        if (r.side === 'left' && onLeft) return y >= r.from && y <= r.to;
        if (r.side === 'right' && onRight) return y >= r.from && y <= r.to;
        return false;
      });
      if (!inRamp) return true;
    }
    return false;
  }

  /**
   * Tegner platåene som lysere areal med drop-shadow på utsiden av cliffs,
   * mørke kant-linjer langs cliff-perimeter, og diagonale stripe-stier i ramper.
   */
  private renderPlateaus() {
    const t = GameScene.CLIFF_THICKNESS;
    const shadow = this.add.graphics().setDepth(0);
    for (const p of this.plateaus) {
      shadow.fillStyle(0x000000, 0.30);
      shadow.fillRoundedRect(p.x - t - 8, p.y - t - 6, p.w + (t + 8) * 2, p.h + (t + 6) * 2, 14);
    }

    const topG = this.add.graphics().setDepth(0);
    for (const p of this.plateaus) {
      topG.fillStyle(0x5e8848, 1);
      topG.fillRect(p.x, p.y, p.w, p.h);
      topG.fillStyle(0x6ba055, 0.5);
      topG.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h * 0.5);
    }

    const edge = this.add.graphics().setDepth(1);
    for (const p of this.plateaus) {
      this.drawCliffEdge(edge, p, 'top');
      this.drawCliffEdge(edge, p, 'bottom');
      this.drawCliffEdge(edge, p, 'left');
      this.drawCliffEdge(edge, p, 'right');
    }

    const rampGfx = this.add.graphics().setDepth(1);
    for (const p of this.plateaus) {
      for (const r of p.ramps) {
        this.drawRamp(rampGfx, p, r);
      }
    }

    const grassTop = this.add.graphics().setDepth(1);
    for (const p of this.plateaus) {
      for (let i = 0; i < 90; i++) {
        const bx = Phaser.Math.Between(p.x + t + 4, p.x + p.w - t - 4);
        const by = Phaser.Math.Between(p.y + t + 4, p.y + p.h - t - 4);
        const len = Phaser.Math.Between(3, 8);
        const tilt = Phaser.Math.FloatBetween(-1.5, 1.5);
        grassTop.lineStyle(1, THEME.GRASS_BLADE_COLOR, Phaser.Math.FloatBetween(0.4, 0.8));
        grassTop.lineBetween(bx, by, bx + tilt, by - len);
      }
    }
  }

  private drawCliffEdge(g: Phaser.GameObjects.Graphics, p: Plateau, side: Ramp['side']) {
    let axisStart: number, axisEnd: number, fixed: number;
    if (side === 'top') { axisStart = p.x; axisEnd = p.x + p.w; fixed = p.y; }
    else if (side === 'bottom') { axisStart = p.x; axisEnd = p.x + p.w; fixed = p.y + p.h; }
    else if (side === 'left') { axisStart = p.y; axisEnd = p.y + p.h; fixed = p.x; }
    else { axisStart = p.y; axisEnd = p.y + p.h; fixed = p.x + p.w; }

    const gaps = p.ramps
      .filter(r => r.side === side)
      .map(r => ({ from: Math.max(r.from, axisStart), to: Math.min(r.to, axisEnd) }))
      .sort((a, b) => a.from - b.from);

    let cursor = axisStart;
    for (const gap of gaps) {
      if (gap.from > cursor) this.strokeCliffSegment(g, side, cursor, gap.from, fixed);
      cursor = Math.max(cursor, gap.to);
    }
    if (cursor < axisEnd) this.strokeCliffSegment(g, side, cursor, axisEnd, fixed);
  }

  private strokeCliffSegment(g: Phaser.GameObjects.Graphics, side: Ramp['side'],
                              start: number, end: number, fixed: number) {
    const t = GameScene.CLIFF_THICKNESS;
    const DARK = 0x2a3a1a;
    const MID = 0x3a4a28;
    if (side === 'top' || side === 'bottom') {
      const yOuter = side === 'top' ? fixed - t : fixed;
      g.fillStyle(MID, 0.85);
      g.fillRect(start, yOuter, end - start, t);
      g.lineStyle(2.5, DARK, 0.95);
      g.lineBetween(start, fixed, end, fixed);
      g.lineStyle(1, 0x000000, 0.35);
      g.lineBetween(start, side === 'top' ? fixed - t : fixed + t, end, side === 'top' ? fixed - t : fixed + t);
    } else {
      const xOuter = side === 'left' ? fixed - t : fixed;
      g.fillStyle(MID, 0.85);
      g.fillRect(xOuter, start, t, end - start);
      g.lineStyle(2.5, DARK, 0.95);
      g.lineBetween(fixed, start, fixed, end);
      g.lineStyle(1, 0x000000, 0.35);
      g.lineBetween(side === 'left' ? fixed - t : fixed + t, start, side === 'left' ? fixed - t : fixed + t, end);
    }
  }

  private drawRamp(g: Phaser.GameObjects.Graphics, p: Plateau, r: Ramp) {
    const t = GameScene.CLIFF_THICKNESS;
    let rx = 0, ry = 0, rw = 0, rh = 0;
    if (r.side === 'top')    { rx = r.from; ry = p.y - t; rw = r.to - r.from; rh = t * 2; }
    if (r.side === 'bottom') { rx = r.from; ry = p.y + p.h - t; rw = r.to - r.from; rh = t * 2; }
    if (r.side === 'left')   { rx = p.x - t; ry = r.from; rw = t * 2; rh = r.to - r.from; }
    if (r.side === 'right')  { rx = p.x + p.w - t; ry = r.from; rw = t * 2; rh = r.to - r.from; }

    g.fillStyle(0x5e8842, 0.92);
    g.fillRect(rx, ry, rw, rh);

    const stripeSpacing = 6;
    g.lineStyle(1.5, 0x3a4a28, 0.5);
    const isHorizontal = r.side === 'left' || r.side === 'right';
    if (isHorizontal) {
      for (let yy = ry - rh; yy < ry + rh * 2; yy += stripeSpacing) {
        g.lineBetween(rx, yy, rx + rw, yy + rh);
      }
    } else {
      for (let xx = rx - rw; xx < rx + rw * 2; xx += stripeSpacing) {
        g.lineBetween(xx, ry, xx + rw, ry + rh);
      }
    }

    g.lineStyle(2, 0x2a3a1a, 0.85);
    if (isHorizontal) {
      g.lineBetween(rx, ry, rx + rw, ry);
      g.lineBetween(rx, ry + rh, rx + rw, ry + rh);
    } else {
      g.lineBetween(rx, ry, rx, ry + rh);
      g.lineBetween(rx + rw, ry, rx + rw, ry + rh);
    }
  }

  /** Impassabel steinformasjon — sirkulær blokk-radius. */
  private isBlockedByObstacle(x: number, y: number): boolean {
    if (this.obstacles.length === 0) return false;
    for (const o of this.obstacles) {
      const dx = x - o.x;
      const dy = y - o.y;
      if (dx * dx + dy * dy < o.radius * o.radius) return true;
    }
    return false;
  }

  /**
   * Steinformasjon — flere overlappende steiner som tegnes som en organisk klump.
   * Blokkerer bevegelse innenfor en sirkulær radius. Plasseres som faste hindere på kartet.
   */
  private createObstacle(x: number, y: number, radius: number) {
    this.obstacles.push({ x, y, radius });

    // Mørk skygge på bakken
    const shadowGfx = this.add.graphics().setDepth(0);
    shadowGfx.fillStyle(0x000000, 0.35);
    shadowGfx.fillEllipse(x + 2, y + radius * 0.4, radius * 2.2, radius * 0.9);

    // Stein-kropper — 3-5 overlappende ellipser i ulik grå/brun
    const stoneColors = [0x7a7066, 0x6a6056, 0x8a7e72, 0x5a5048, 0x968c80];
    const count = Phaser.Math.Between(3, 5);
    const seed = Math.random() * 1000;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + seed * 0.01;
      const off = radius * 0.45;
      const sx = x + Math.cos(angle) * off;
      const sy = y + Math.sin(angle) * off * 0.7;
      const sw = radius * Phaser.Math.FloatBetween(0.95, 1.4);
      const sh = radius * Phaser.Math.FloatBetween(0.7, 1.0);
      const col = stoneColors[(i + Math.floor(seed)) % stoneColors.length];
      // Underside-skygge
      this.add.ellipse(sx, sy + 2, sw, sh, 0x2a2620, 0.55).setDepth(1);
      // Stein
      this.add.ellipse(sx, sy, sw, sh, col).setDepth(2);
      // Highlight på toppen
      this.add.ellipse(sx - sw * 0.18, sy - sh * 0.25, sw * 0.5, sh * 0.35, 0xffffff, 0.18).setDepth(3);
    }

    // Sentral, høyere stein på toppen
    this.add.ellipse(x, y - radius * 0.15, radius * 1.5, radius * 1.1, stoneColors[0]).setDepth(3);
    this.add.ellipse(x - radius * 0.2, y - radius * 0.4, radius * 0.6, radius * 0.4, 0xffffff, 0.22).setDepth(4);

    // Litt mose-grønn på sidene
    if (Math.random() < 0.7) {
      const mossAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      this.add.ellipse(
        x + Math.cos(mossAngle) * radius * 0.7,
        y + Math.sin(mossAngle) * radius * 0.5,
        radius * 0.6, radius * 0.3, 0x3a5a28, 0.6,
      ).setDepth(4);
    }

    // Små steinflis rundt foten — bryter opp silhuett
    for (let i = 0; i < 4; i++) {
      const a = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const d = radius * Phaser.Math.FloatBetween(0.9, 1.15);
      const cx = x + Math.cos(a) * d;
      const cy = y + Math.sin(a) * d * 0.55;
      const cc = THEME.PEBBLE_COLORS[i % THEME.PEBBLE_COLORS.length];
      this.add.ellipse(cx + 0.5, cy + 0.8, 5, 3, 0x000000, 0.4).setDepth(0);
      this.add.ellipse(cx, cy, 5, 3, cc).setDepth(1);
    }
  }

  /**
   * Dekorative jord-/mose-flekker spredt over hele kartet for visuell variasjon.
   * Påvirker ikke gameplay — bare bryter opp den ensformige grasspekkete bakken.
   */
  private paintGroundPatches(W: number, H: number) {
    const dirtGfx = this.add.graphics().setDepth(0);
    const RIVER_X = 1280;
    const RIVER_HALF = 60;

    // 14 store jord-flekker — mørke ovale shaper
    for (let i = 0; i < 14; i++) {
      let px = 0, py = 0, ok = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        px = Phaser.Math.Between(80, W - 80);
        py = Phaser.Math.Between(80, H - 80);
        if (Math.abs(px - RIVER_X) < RIVER_HALF + 30) continue; // unngå elv
        if (this.isBlockedByObstacle(px, py)) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      const w = Phaser.Math.Between(90, 180);
      const h = Phaser.Math.Between(50, 120);
      const a = Phaser.Math.FloatBetween(0.18, 0.32);
      dirtGfx.fillStyle(0x4a3a22, a);
      dirtGfx.fillEllipse(px, py, w, h);
      // En lysere kant inni for tekstur-følelse
      dirtGfx.fillStyle(0x5a4828, a * 0.6);
      dirtGfx.fillEllipse(px - w * 0.1, py - h * 0.15, w * 0.6, h * 0.55);
    }

    // 10 mose-flekker — mørkegrønne
    for (let i = 0; i < 10; i++) {
      let px = 0, py = 0, ok = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        px = Phaser.Math.Between(80, W - 80);
        py = Phaser.Math.Between(80, H - 80);
        if (Math.abs(px - RIVER_X) < RIVER_HALF + 30) continue;
        if (this.isBlockedByObstacle(px, py)) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      const w = Phaser.Math.Between(60, 120);
      const h = Phaser.Math.Between(40, 80);
      dirtGfx.fillStyle(0x3a5a28, Phaser.Math.FloatBetween(0.22, 0.36));
      dirtGfx.fillEllipse(px, py, w, h);
      dirtGfx.fillStyle(0x4a7a38, Phaser.Math.FloatBetween(0.18, 0.28));
      dirtGfx.fillEllipse(px + 2, py - 2, w * 0.55, h * 0.5);
    }

    // 30 ekstra større kvist/pinne-streker (litt for å bryte ensformighet)
    const twigs = this.add.graphics().setDepth(0);
    for (let i = 0; i < 30; i++) {
      let tx = 0, ty = 0, ok = false;
      for (let attempt = 0; attempt < 6; attempt++) {
        tx = Phaser.Math.Between(60, W - 60);
        ty = Phaser.Math.Between(60, H - 60);
        if (Math.abs(tx - RIVER_X) < RIVER_HALF + 18) continue;
        if (this.isBlockedByObstacle(tx, ty)) continue;
        ok = true;
        break;
      }
      if (!ok) continue;
      const len = Phaser.Math.Between(12, 26);
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const dx = Math.cos(angle) * len;
      const dy = Math.sin(angle) * len;
      twigs.lineStyle(2, THEME.TWIG_COLOR, 0.65);
      twigs.lineBetween(tx, ty, tx + dx, ty + dy);
      // Liten sidegren
      if (Math.random() < 0.5) {
        const sx = tx + dx * 0.55;
        const sy = ty + dy * 0.55;
        const sa = angle + Phaser.Math.FloatBetween(0.5, 1.2) * (Math.random() < 0.5 ? -1 : 1);
        twigs.lineBetween(sx, sy, sx + Math.cos(sa) * 6, sy + Math.sin(sa) * 6);
      }
    }
  }

  /** M3.1 — er (x,y) inne i en levende wall (med blokk-radius)? */
  private isBlockedByWall(x: number, y: number): boolean {
    if (this.walls.length === 0) return false;
    const r = CONFIG.WALL_BLOCK_RADIUS;
    for (const w of this.walls) {
      if (w.dead || w.hp <= 0 || w.underConstruction) continue;
      // Rektangulær avstand: utvidet bbox med r
      if (x > w.x - w.w / 2 - r && x < w.x + w.w / 2 + r &&
          y > w.y - w.h / 2 - r && y < w.y + w.h / 2 + r) {
        return true;
      }
    }
    return false;
  }

  private moveToward(unit: UnitData, target: Vec2, dt: number): boolean {
    // Re-rut via bro hvis strålelinjen krysser en elv
    const effective = this.resolveMoveTarget(unit, target);

    const dx = effective.x - unit.x;
    const dy = effective.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 6) {
      // Hvis vi nådde et bro-waypoint, men ikke det egentlige målet, return false så
      // neste frame plukker en ny rute (kanskje direkte til target nå som vi er over elven).
      return effective === target;
    }
    const nx = dx / dist;
    const ny = dy / dist;
    unit.lastDx = nx; unit.lastDy = ny;
    // M2.1 — webber-slow halverer farten så lenge slowedUntil er i fremtiden
    const speedMul = unit.slowedUntil > this.time.now ? 0.5 : 1;
    let step = Math.min(unit.speed * speedMul * dt, dist);

    let newX = unit.x + nx * step;
    let newY = unit.y + ny * step;
    const newState = this.riverStateAt(newX, newY);
    const oldState = this.riverStateAt(unit.x, unit.y);

    if (newState === 'blocked' && oldState !== 'blocked') {
      // Maur kan ikke svømme. La routing finne broa neste frame.
      return false;
    }
    // V6 — Multi-angle slide. Hvis full bevegelse er blokkert, prøv vinkler ±30°, ±60°, ±90°.
    // Mye bedre enn ren akse-slide for å komme rundt obstacles og enheter.
    if (this.isBlockedByObstacle(newX, newY)) {
      const found = this.findSlideAngle(unit, nx, ny, step, (x, y) => this.isBlockedByObstacle(x, y));
      if (found) { newX = found.x; newY = found.y; }
      else return false;
    }
    // M3.6 — cliffs (platå-kanter) blokkerer bevegelse; ramper er passable åpninger.
    if (this.isBlockedByCliff(newX, newY)) {
      const found = this.findSlideAngle(unit, nx, ny, step, (x, y) => this.isBlockedByCliff(x, y));
      if (found) { newX = found.x; newY = found.y; }
      else return false;
    }
    // M3.1 — Walls blokkerer bevegelse. V6 — multi-angle slide.
    if (this.isBlockedByWall(newX, newY)) {
      const found = this.findSlideAngle(unit, nx, ny, step, (x, y) => this.isBlockedByWall(x, y));
      if (found) { newX = found.x; newY = found.y; }
      else return false;
    }
    unit.x = newX;
    unit.y = newY;
    return false;
  }

  /**
   * V6 — Multi-angle slide. Prøver perturberte bevegelses-vinkler (±30°, ±60°, ±90°)
   * for å komme rundt en blokade. Returnerer første gyldige (x,y), eller null.
   *
   * Mye bedre enn aksial slide for organiske obstacles: enhet glir rundt en sten
   * istedenfor å klikse mot den.
   */
  private findSlideAngle(
    unit: UnitData,
    nx: number,
    ny: number,
    step: number,
    isBlocked: (x: number, y: number) => boolean,
  ): Vec2 | null {
    // Vinkler i radianer: 30°, -30°, 60°, -60°, 90°, -90° (omtrent)
    const angles = [Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2];
    for (const a of angles) {
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const rotX = nx * cosA - ny * sinA;
      const rotY = nx * sinA + ny * cosA;
      const tryX = unit.x + rotX * step;
      const tryY = unit.y + rotY * step;
      if (!isBlocked(tryX, tryY)) return { x: tryX, y: tryY };
    }
    return null;
  }

  private separate(unit: UnitData) {
    const minDist = 20;
    for (const other of this.units) {
      if (other === unit || other.dead) continue;
      const dx = unit.x - other.x;
      const dy = unit.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 0 && dist < minDist) {
        const push = ((minDist - dist) / minDist) * 0.4;
        const newX = unit.x + (dx / dist) * push;
        const newY = unit.y + (dy / dist) * push;
        // Ikke push enheten inn i elv eller stein — la den heller forbli klemt
        const intoBlocker = this.isBlockedByRiver(newX, newY) || this.isBlockedByObstacle(newX, newY) || this.isBlockedByCliff(newX, newY);
        const alreadyInBlocker = this.isBlockedByRiver(unit.x, unit.y) || this.isBlockedByObstacle(unit.x, unit.y) || this.isBlockedByCliff(unit.x, unit.y);
        if (!intoBlocker || alreadyInBlocker) {
          unit.x = newX;
          unit.y = newY;
        }
      }
    }
    unit.x = Phaser.Math.Clamp(unit.x, 20, CONFIG.MAP_WIDTH - 20);
    unit.y = Phaser.Math.Clamp(unit.y, 20, CONFIG.MAP_HEIGHT - 20);
  }

  // ── Camera scroll ────────────────────────────────────────────────────────

  private updateCameraScroll(dt: number) {
    const cam = this.cameras.main;
    const speed = CONFIG.CAMERA_SCROLL_SPEED * dt;
    let dx = 0, dy = 0;

    // WASD + piltaster (begge fungerer)
    if (this.keyW?.isDown || this.keyUp?.isDown)       dy -= 1;
    if (this.keyS?.isDown || this.keyDown?.isDown)     dy += 1;
    if (this.keyA?.isDown || this.keyLeft?.isDown)     dx -= 1;
    if (this.keyD?.isDown || this.keyRight?.isDown)    dx += 1;

    // Edge-scroll — kun når musa er fysisk over game-canvas (ikke over HUD-paneler).
    if (this.mouseOverCanvas) {
      const p = this.input.activePointer;
      const vw = cam.width;
      const vh = cam.height;
      const edge = CONFIG.CAMERA_EDGE_THRESHOLD;
      if (p.x >= 0 && p.x <= vw && p.y >= 0 && p.y <= vh) {
        if (p.x < edge)        dx -= 1;
        else if (p.x > vw - edge) dx += 1;
        if (p.y < edge)        dy -= 1;
        else if (p.y > vh - edge) dy += 1;
      }
    }

    if (dx !== 0 || dy !== 0) {
      // Normaliser diagonal slik at fart blir lik horisontalt+diagonalt
      const len = Math.hypot(dx, dy);
      cam.scrollX += (dx / len) * speed;
      cam.scrollY += (dy / len) * speed;
    }
  }

  /** Verden-koord under peker — kameraet kan være panorert. */
  private wp(pointer: Phaser.Input.Pointer): Vec2 {
    const v = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: v.x, y: v.y };
  }

  // ── Input handling ───────────────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    // M2.1 — build-mode overstyrer all annen pointer-håndtering
    if (this.buildMode) {
      if (pointer.rightButtonDown()) {
        this.cancelBuildMode();
      } else {
        const placed = this.placeBuildable(this.wp(pointer));
        // Shift = behold build-mode for å plassere flere; ellers exit
        if (placed && !pointer.event.shiftKey) this.cancelBuildMode();
      }
      return;
    }

    if (pointer.rightButtonDown()) {
      this.handleCommandClick(pointer);
      return;
    }

    // Track for click-vs-drag decision in pointerup. dragStart lagres som verden-koord
    // så drag-rektangelet forblir forankret når kameraet panorerer under drag.
    this.pointerIsDown = true;
    this.dragStart = this.wp(pointer);
    this.isDragging = false;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.buildMode) {
      this.updateBuildGhost(this.wp(pointer));
      this.hoverGfx.clear();
      return;
    }
    if (this.pointerIsDown) {
      const w = this.wp(pointer);
      const dx = w.x - this.dragStart.x;
      const dy = w.y - this.dragStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.isDragging = true;
        const minX = Math.min(w.x, this.dragStart.x);
        const minY = Math.min(w.y, this.dragStart.y);
        this.dragRect.setPosition(minX, minY).setSize(Math.abs(dx), Math.abs(dy)).setVisible(true);
      }
      this.hoverGfx.clear();
      return;
    }
    this.updateHover(pointer);
  }

  private updateHover(pointer: Phaser.Input.Pointer) {
    this.hoverGfx.clear();
    const w = this.wp(pointer);

    // Egen enhet → varm-gul ring (select-hint) med glow
    const own = this.hitUnitAt(w, 'player');
    if (own) {
      this.hoverGfx.lineStyle(7, 0xffd76a, 0.2);
      this.hoverGfx.strokeCircle(own.x, own.y, own.radius + 5);
      this.hoverGfx.lineStyle(3, 0xffeaa0, 0.95);
      this.hoverGfx.strokeCircle(own.x, own.y, own.radius + 5);
      this.input.setDefaultCursor('pointer');
      return;
    }

    // Fiende-enhet → rød ring (attack-hint, krever utvalg) med glow
    const foe = this.hitUnitAt(w, 'ai');
    if (foe) {
      const color = this.selectedUnits.some(u => u.type === 'soldier') ? 0xff5544 : 0xaa6655;
      this.hoverGfx.lineStyle(7, color, 0.2);
      this.hoverGfx.strokeCircle(foe.x, foe.y, foe.radius + 5);
      this.hoverGfx.lineStyle(3, color, 0.95);
      this.hoverGfx.strokeCircle(foe.x, foe.y, foe.radius + 5);
      this.input.setDefaultCursor('crosshair');
      return;
    }

    // Bygninger / mine
    type CursorHint = 'pointer' | 'default';
    const buildings: { b: BuildingData; tint: number; cur: CursorHint }[] = [
      { b: this.playerBase, tint: 0x88c0ff, cur: 'pointer' },
      { b: this.aiBase, tint: 0xff5544, cur: 'pointer' },
    ];
    if (this.playerBarracks) buildings.push({ b: this.playerBarracks, tint: 0x88c0ff, cur: 'pointer' });
    if (this.aiBarracks) buildings.push({ b: this.aiBarracks, tint: 0xff5544, cur: 'pointer' });
    for (const { b, tint, cur } of buildings) {
      if (b.hp > 0 && this.hitBuildingAt(w, b)) {
        this.hoverGfx.lineStyle(7, tint, 0.2);
        this.hoverGfx.strokeRect(b.x - b.w / 2 - 5, b.y - b.h / 2 - 5, b.w + 10, b.h + 10);
        this.hoverGfx.lineStyle(3, tint, 0.95);
        this.hoverGfx.strokeRect(b.x - b.w / 2 - 5, b.y - b.h / 2 - 5, b.w + 10, b.h + 10);
        this.input.setDefaultCursor(cur === 'pointer' ? 'pointer' : 'default');
        return;
      }
    }
    for (const m of this.mines) {
      if (Math.abs(w.x - m.x) < m.w / 2 + 6 && Math.abs(w.y - m.y) < m.h / 2 + 6) {
        const tint = this.selectedUnits.some(u => u.type === 'worker') ? 0xddff88 : 0xaadd77;
        this.hoverGfx.lineStyle(7, tint, 0.2);
        this.hoverGfx.strokeRect(m.x - m.w / 2 - 5, m.y - m.h / 2 - 5, m.w + 10, m.h + 10);
        this.hoverGfx.lineStyle(3, tint, 0.95);
        this.hoverGfx.strokeRect(m.x - m.w / 2 - 5, m.y - m.h / 2 - 5, m.w + 10, m.h + 10);
        this.input.setDefaultCursor('pointer');
        return;
      }
    }

    this.input.setDefaultCursor('');
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    if (!this.pointerIsDown) return;
    this.pointerIsDown = false;

    if (this.isDragging) {
      const w = this.wp(pointer);
      const minX = Math.min(w.x, this.dragStart.x);
      const minY = Math.min(w.y, this.dragStart.y);
      const maxX = Math.max(w.x, this.dragStart.x);
      const maxY = Math.max(w.y, this.dragStart.y);
      if (!pointer.event.shiftKey) {
        this.clearSelection();
        this.clearBuildingSelection();
      }
      for (const u of this.units) {
        if (u.faction === 'player' && !u.dead && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
          this.selectUnit(u);
        }
      }
      this.dragRect.setVisible(false);
      this.isDragging = false;
      return;
    }

    this.dragRect.setVisible(false);
    this.isDragging = false;

    // Single click — selection or command
    this.handleLeftClick(pointer);
  }

  private handleLeftClick(pointer: Phaser.Input.Pointer) {
    const w = this.wp(pointer);
    // Click on player base (maurtue) → select for å trene workers
    if (this.playerBase.hp > 0 && !this.playerBase.underConstruction && this.hitBuildingAt(w, this.playerBase)) {
      this.selectPlayerBuilding(this.playerBase);
      return;
    }
    // Click on player barracks → select for å trene soldater (krever ferdig bygd)
    if (this.playerBarracks && this.playerBarracks.hp > 0 && !this.playerBarracks.underConstruction
        && this.hitBuildingAt(w, this.playerBarracks)) {
      this.selectPlayerBuilding(this.playerBarracks);
      return;
    }
    // Clicking elsewhere clears the building selection
    this.clearBuildingSelection();

    // Click on player unit → select (double-click → all of same type)
    const own = this.hitUnitAt(w, 'player');
    if (own) {
      const now = this.time.now;
      const isDouble = now - this.lastUnitClickAt < 320 && this.lastClickedUnit === own;
      if (isDouble) {
        this.selectAllOfType(own.type);
      } else {
        if (!pointer.event.shiftKey) this.clearSelection();
        this.selectUnit(own);
      }
      this.lastUnitClickAt = now;
      this.lastClickedUnit = own;
      return;
    }
    this.lastClickedUnit = null;

    // SC-stil: venstreklikk på tomt rom deselekterer alt. Kommandoer går via høyreklikk.
    this.clearSelection();
  }

  private handleCommandClick(pointer: Phaser.Input.Pointer) {
    const w = this.wp(pointer);
    // While the barracks is selected, right-click in the world manages the rally point
    if (this.playerBarracks && this.selectedBuilding === this.playerBarracks) {
      if (this.hitBuildingAt(w, this.playerBarracks)) {
        this.clearRallyPoint();
      } else {
        this.setRallyPoint(w.x, w.y);
      }
      return;
    }
    if (this.selectedUnits.length === 0) return;
    this.issueCommandAt(w);
  }

  private issueCommandAt(w: Vec2) {
    if (this.selectedUnits.length === 0) return;

    // Resume bygging — worker høyreklikker en under-construction-bygning av egen faction
    for (const b of this.buildings) {
      if (!b.underConstruction || b.dead || b.hp <= 0) continue;
      if (b.faction !== 'player') continue;
      if (Math.abs(w.x - b.x) < b.w / 2 + 6 && Math.abs(w.y - b.y) < b.h / 2 + 6) {
        const workers = this.selectedUnits.filter(u => u.type === 'worker');
        if (workers.length === 0) return;
        // Bare nærmeste worker tildeles bygget (én bygger per byggeplass)
        let best = workers[0];
        let bestDist = Phaser.Math.Distance.Between(best.x, best.y, b.x, b.y);
        for (let i = 1; i < workers.length; i++) {
          const d = Phaser.Math.Distance.Between(workers[i].x, workers[i].y, b.x, b.y);
          if (d < bestDist) { best = workers[i]; bestDist = d; }
        }
        this.assignWorkerToBuild(best, b);
        this.spawnCommandRipple(b.x, b.y, 0xddff88);
        return;
      }
    }

    // Assign workers to mine
    for (const mine of this.mines) {
      if (Math.abs(w.x - mine.x) < mine.w / 2 + 6 && Math.abs(w.y - mine.y) < mine.h / 2 + 6) {
        const workers = this.selectedUnits.filter(u => u.type === 'worker');
        if (workers.length === 0) return;
        for (const u of workers) {
          u.buildTarget = null;
          u.mineTarget = mine;
          u.state = 'moving';
          u.moveTarget = { x: mine.x, y: mine.y };
        }
        this.spawnCommandRipple(mine.x, mine.y, 0xddff88);
        return;
      }
    }

    // Attack enemy unit
    const enemyUnit = this.hitUnitAt(w, 'ai');
    if (enemyUnit) {
      const soldiers = this.selectedUnits.filter(u => u.type === 'soldier');
      if (soldiers.length === 0) return;
      for (const u of soldiers) {
        u.attackTarget = enemyUnit;
        u.state = 'attacking';
      }
      this.spawnCommandRipple(enemyUnit.x, enemyUnit.y, 0xff5544);
      return;
    }

    // Attack enemy building. Broer er udødelige terreng — ikke targetbare.
    const attackable: BuildingData[] = [this.aiBase];
    if (this.aiBarracks) attackable.push(this.aiBarracks);
    for (const b of attackable) {
      if (b.hp > 0 && Math.abs(w.x - b.x) < b.w / 2 + 6 && Math.abs(w.y - b.y) < b.h / 2 + 6) {
        const soldiers = this.selectedUnits.filter(u => u.type === 'soldier');
        if (soldiers.length === 0) return;
        for (const u of soldiers) {
          u.attackTarget = b;
          u.state = 'attacking';
        }
        this.spawnCommandRipple(b.x, b.y, 0xff5544);
        return;
      }
    }

    // Move command
    const n = this.selectedUnits.length;
    this.selectedUnits.forEach((u) => {
      const offset = n > 1 ? { x: Phaser.Math.Between(-18, 18), y: Phaser.Math.Between(-18, 18) } : { x: 0, y: 0 };
      u.mineTarget = null;
      u.attackTarget = null;
      u.buildTarget = null;
      u.state = 'moving';
      u.moveTarget = { x: w.x + offset.x, y: w.y + offset.y };
    });
    this.spawnCommandRipple(w.x, w.y, 0x88ddff);
  }

  private spawnCommandRipple(x: number, y: number, color: number) {
    const ring = this.add.arc(x, y, 8, 0, 360, false, 0x000000, 0)
      .setStrokeStyle(2.5, color, 1)
      .setDepth(24);
    this.tweens.add({
      targets: ring,
      scale: 3,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private hitUnitAt(w: Vec2, faction: 'player' | 'ai'): UnitData | null {
    // Generous hitbox for laptop trackpad usability — minimum 22px radius
    let best: UnitData | null = null;
    let bestDist = Infinity;
    for (const u of this.units) {
      if (u.faction !== faction || u.dead) continue;
      const d = Phaser.Math.Distance.Between(w.x, w.y, u.x, u.y);
      const hitRadius = Math.max(u.radius + 10, 22);
      if (d < hitRadius && d < bestDist) {
        best = u;
        bestDist = d;
      }
    }
    return best;
  }

  private selectAllOfType(type: 'worker' | 'soldier') {
    this.clearSelection();
    for (const u of this.units) {
      if (u.faction === 'player' && u.type === type && !u.dead) this.selectUnit(u);
    }
  }

  private setRallyPoint(x: number, y: number) {
    this.rallyPoint = { x, y };
    if (this.rallyMarker) this.rallyMarker.destroy();
    const gfx = this.add.graphics();
    gfx.fillStyle(0x000000, 0.4);
    gfx.fillEllipse(0, 11, 12, 4);
    gfx.fillStyle(0xddc888, 1);
    gfx.fillRect(-1, -16, 2, 27);
    gfx.lineStyle(1, 0x6a5a3a, 1);
    gfx.strokeRect(-1, -16, 2, 27);
    gfx.fillStyle(0xccff77, 1);
    gfx.fillTriangle(1, -16, 14, -11, 1, -6);
    gfx.lineStyle(1.2, 0x2a3a14, 1);
    gfx.strokeTriangle(1, -16, 14, -11, 1, -6);
    this.rallyMarker = this.add.container(x, y, [gfx]).setDepth(8);
    this.tweens.add({
      targets: gfx,
      scaleX: { from: 1, to: 1.15 }, scaleY: { from: 1, to: 1.15 },
      yoyo: true, repeat: -1, duration: 800, ease: 'Sine.easeInOut',
    });
    this.spawnCommandRipple(x, y, 0xccff77);
    this.redrawRallyLine();
  }

  /** M1.5 — stiplet pil fra barracks til rally-punkt så nye soldater sin destinasjon er synlig. */
  private redrawRallyLine() {
    if (this.rallyLine) { this.rallyLine.destroy(); this.rallyLine = null; }
    if (!this.rallyPoint || !this.playerBarracks || this.playerBarracks.hp <= 0) return;

    const sx = this.playerBarracks.x;
    const sy = this.playerBarracks.y;
    const ex = this.rallyPoint.x;
    const ey = this.rallyPoint.y;
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy);
    if (len < 1) return;

    const nx = dx / len;
    const ny = dy / len;
    // Trekk litt fra både start og slutt så streken ikke bores rett inn i bygningene
    const startInset = 18;
    const endInset = 14;
    const totalDash = len - startInset - endInset;
    if (totalDash <= 0) return;

    const g = this.add.graphics().setDepth(7);
    g.lineStyle(2, 0xccff77, 0.85);

    // Stiplet linje: 10 px segment, 8 px gap
    const dashLen = 10;
    const gapLen = 8;
    let d = 0;
    const x0 = sx + nx * startInset;
    const y0 = sy + ny * startInset;
    while (d < totalDash) {
      const segEnd = Math.min(d + dashLen, totalDash);
      g.beginPath();
      g.moveTo(x0 + nx * d, y0 + ny * d);
      g.lineTo(x0 + nx * segEnd, y0 + ny * segEnd);
      g.strokePath();
      d = segEnd + gapLen;
    }

    // Pilspiss på endepunktet
    const headLen = 9;
    const headHalf = 5;
    const ax = ex - nx * endInset;
    const ay = ey - ny * endInset;
    const perpX = -ny;
    const perpY = nx;
    g.fillStyle(0xccff77, 0.9);
    g.fillTriangle(
      ax, ay,
      ax - nx * headLen + perpX * headHalf, ay - ny * headLen + perpY * headHalf,
      ax - nx * headLen - perpX * headHalf, ay - ny * headLen - perpY * headHalf,
    );

    this.rallyLine = g;
  }

  private clearRallyPoint() {
    if (!this.rallyPoint) return;
    const px = this.playerBarracks?.x ?? this.playerBase.x;
    const py = this.playerBarracks?.y ?? this.playerBase.y;
    this.rallyPoint = null;
    this.rallyMarker?.destroy();
    this.rallyMarker = null;
    if (this.rallyLine) { this.rallyLine.destroy(); this.rallyLine = null; }
    this.spawnCommandRipple(px, py, 0xaaaaaa);
  }

  private assignSoldierInitialOrder(soldier: UnitData) {
    if (this.rallyPoint) {
      soldier.state = 'moving';
      soldier.moveTarget = {
        x: this.rallyPoint.x + Phaser.Math.Between(-12, 12),
        y: this.rallyPoint.y + Phaser.Math.Between(-12, 12),
      };
      return;
    }
    soldier.attackTarget = this.aiBase;
    soldier.state = 'attacking';
  }

  private hitBuildingAt(w: Vec2, b: BuildingData): boolean {
    return Math.abs(w.x - b.x) < b.w / 2 + 5 && Math.abs(w.y - b.y) < b.h / 2 + 5;
  }

  private selectUnit(unit: UnitData) {
    unit.selected = true;
    if (!this.selectedUnits.includes(unit)) this.selectedUnits.push(unit);
    if (!unit.selectionTween) {
      unit.selectionRing.setScale(1).setAlpha(0.95);
      unit.selectionGlow.setAlpha(0.22);
      unit.selectionTween = this.tweens.add({
        targets: [unit.selectionRing, unit.selectionGlow],
        alpha: { from: 0.95, to: 0.55 },
        yoyo: true, repeat: -1, duration: 850, ease: 'Sine.easeInOut',
      });
    }
  }

  private clearSelection() {
    for (const u of this.selectedUnits) {
      u.selected = false;
      if (u.selectionTween) {
        u.selectionTween.stop();
        u.selectionTween = null;
        u.selectionRing.setScale(1).setAlpha(0.95);
        u.selectionGlow.setAlpha(0.22);
      }
    }
    this.selectedUnits = [];
  }

  // ── Train panel ──────────────────────────────────────────────────────────

  private selectPlayerBuilding(b: BuildingData) {
    this.clearSelection();
    this.selectedBuilding = b;
  }

  private clearBuildingSelection() {
    this.selectedBuilding = null;
  }

  private trainUnit(type: 'worker' | 'soldier') {
    // Workers trenes fra maurtua. Soldater krever en ferdig barakke.
    let producer: BuildingData | null;
    if (type === 'worker') {
      producer = this.playerBase;
      if (!producer || producer.hp <= 0 || producer.underConstruction) return;
    } else {
      producer = this.playerBarracks;
      if (!producer || producer.hp <= 0 || producer.underConstruction) {
        this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Trenger ferdig barakke', '#ee5544');
        return;
      }
    }
    const cost = type === 'worker' ? CONFIG.WORKER_COST : CONFIG.SOLDIER_COST;
    if (this.playerGold < cost) return;
    this.playerGold -= cost;
    this.statsTrained += 1;
    if (type === 'worker') this.statsWorkersTrained += 1;
    else this.statsSoldiersTrained += 1;
    const { x, y } = producer;
    const unit = this.spawnUnit('player', type, x + Phaser.Math.Between(-22, 22), y + Phaser.Math.Between(-22, 22));
    if (type === 'worker') this.assignWorkerToMine(unit);
    else this.assignSoldierInitialOrder(unit);
    playSfx(this, 'train', { volume: 0.7 });
  }

  // ── HUD bridge ───────────────────────────────────────────────────────────

  private handleHudCommand(c: HudCommand) {
    // V7 — to-menu og restart må fungere i game-over.
    if (this.gameState !== 'running' && c.type !== 'restart' && c.type !== 'to-menu') return;
    switch (c.type) {
      case 'train': this.trainUnit(c.unit); break;
      case 'select-all-soldiers': this.selectAllOfType('soldier'); break;
      case 'select-all-workers': this.selectAllOfType('worker'); break;
      case 'clear-selection':
        this.clearSelection();
        this.clearBuildingSelection();
        break;
      case 'restart': this.scene.restart(); break;
      case 'minimap-pan':
        this.cameras.main.centerOn(c.x, c.y);
        break;
      case 'minimap-attack':
        if (this.selectedUnits.some((u) => u.type === 'soldier')) {
          for (const u of this.selectedUnits.filter((u) => u.type === 'soldier')) {
            u.attackTarget = null;
            u.mineTarget = null;
            u.state = 'moving';
            u.moveTarget = { x: c.x, y: c.y };
          }
          this.spawnCommandRipple(c.x, c.y, 0xff5544);
        }
        break;
      case 'toggle-pause': this.togglePause(); break;
      case 'cycle-speed': this.cycleSpeed(+1); break;
      case 'build-tower-start': this.startBuildMode(c.tower); break;
      case 'build-start': this.startBuildMode(c.kind); break;
      case 'build-cancel': this.cancelBuildMode(); break;
      case 'formation': this.formationLine(); break;
      case 'upgrade-base-defense': this.upgradeBaseDefense(); break;
      case 'to-menu': this.scene.start('MenuScene'); break;
    }
  }

  /** V5 — beskriv hva enheten gjør akkurat nå, vises i seleksjonspanelet. */
  private describeUnitAction(u: UnitData): HudSelection['currentAction'] {
    if (u.state === 'building' && u.buildTarget) {
      const b = u.buildTarget;
      const kind = b.kind === 'tower'
        ? (b.tower ? `${b.tower.type[0].toUpperCase()}${b.tower.type.slice(1)}-tårn` : 'tårn')
        : b.kind === 'barracks' ? 'barakke'
        : b.kind === 'farm' ? 'bladlusfarm'
        : b.kind === 'wall' ? 'mur'
        : b.kind === 'armory' ? 'våpenkammer'
        : b.kind;
      return { type: 'building', label: `Bygger ${kind}`, progress: b.buildProgress ?? 0 };
    }
    if (u.state === 'mining' && u.mineTarget) {
      return { type: 'mining', label: 'Miner mat fra bladlusfarm' };
    }
    if (u.state === 'attacking' && u.attackTarget) {
      return { type: 'attacking', label: 'Angriper' };
    }
    if (u.state === 'moving' && u.moveTarget) {
      return { type: 'moving', label: 'Beveger seg' };
    }
    return { type: 'idle', label: 'Venter på ordre' };
  }

  private emitHudState() {
    const players = this.units.filter((u) => u.faction === 'player' && !u.dead);
    const ais = this.units.filter((u) => u.faction === 'ai' && !u.dead);

    const minimapUnits: HudUnit[] = this.units
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.x, y: u.y, faction: u.faction, type: u.type }));
    const minimapBuildings: HudBuilding[] = this.buildings.map((b) => ({
      x: b.x, y: b.y, w: b.w, h: b.h, faction: b.faction, kind: b.kind, hp: b.hp, maxHp: b.maxHp,
      control: b.kind === 'mine' ? (b as MineData).control : undefined,
      towerType: b.kind === 'tower' && b.tower ? b.tower.type : undefined,
      hasDefense: b.kind === 'base' && b.defense ? true : undefined,
      underConstruction: b.underConstruction ? true : undefined,
      buildProgress: b.underConstruction ? (b.buildProgress ?? 0) : undefined,
    }));

    let selection: HudSelection;
    if (this.selectedBuilding) {
      const b = this.selectedBuilding;
      selection = {
        kind: 'building',
        building: {
          x: b.x, y: b.y, w: b.w, h: b.h, faction: b.faction, kind: b.kind, hp: b.hp, maxHp: b.maxHp,
          hasDefense: b.kind === 'base' && b.defense ? true : undefined,
          underConstruction: b.underConstruction ? true : undefined,
          buildProgress: b.underConstruction ? (b.buildProgress ?? 0) : undefined,
        },
      };
    } else if (this.selectedUnits.length === 0) {
      selection = { kind: 'none' };
    } else {
      const ws = this.selectedUnits.filter((u) => u.type === 'worker').length;
      const ss = this.selectedUnits.filter((u) => u.type === 'soldier').length;
      if (this.selectedUnits.length === 1) {
        const u = this.selectedUnits[0];
        selection = {
          kind: 'units', workers: ws, soldiers: ss,
          singleType: u.type, singleHp: Math.max(0, Math.round(u.hp)), singleMaxHp: u.maxHp,
          currentAction: this.describeUnitAction(u),
        };
      } else {
        selection = { kind: 'units', workers: ws, soldiers: ss };
      }
    }

    const s: HudState = {
      state: this.gameState,
      time: this.gameTime,
      player: {
        gold: this.playerGold,
        workers: players.filter((u) => u.type === 'worker').length,
        soldiers: players.filter((u) => u.type === 'soldier').length,
        baseHp: this.playerBase.hp, baseMaxHp: this.playerBase.maxHp,
        barracksHp: this.playerBarracks?.hp ?? 0,
        barracksMaxHp: this.playerBarracks?.maxHp ?? 0,
      },
      enemy: {
        gold: this.aiGold,
        workers: ais.filter((u) => u.type === 'worker').length,
        soldiers: ais.filter((u) => u.type === 'soldier').length,
        baseHp: this.aiBase.hp, baseMaxHp: this.aiBase.maxHp,
      },
      costs: { worker: CONFIG.WORKER_COST, soldier: CONFIG.SOLDIER_COST },
      selection,
      map: { width: CONFIG.MAP_WIDTH, height: CONFIG.MAP_HEIGHT },
      camera: {
        x: this.cameras.main.worldView.x,
        y: this.cameras.main.worldView.y,
        width: this.cameras.main.worldView.width,
        height: this.cameras.main.worldView.height,
      },
      minimap: { units: minimapUnits, buildings: minimapBuildings },
      stats: {
        trained: this.statsTrained,
        goldEarned: this.statsGoldEarned,
        soldiersTrained: this.statsSoldiersTrained,
        workersTrained: this.statsWorkersTrained,
        enemyKills: this.statsEnemyKills,
        unitsLost: this.statsUnitsLost,
        peakMines: this.statsPeakMines,
        aiTowers: this.towers.filter(t => t.faction === 'ai' && !t.dead && t.hp > 0).length,
        playerTowers: this.towers.filter(t => t.faction === 'player' && !t.dead && t.hp > 0).length,
      },
      gameSpeed: this.gameSpeed,
      alert: this.currentAlert ? { ...this.currentAlert } : null,
      buildMode: this.buildMode ? ({
        kind: this.buildMode.kind,
        cost: this.getBuildSpec(this.buildMode.kind).cost,
        canAfford: this.playerGold >= this.getBuildSpec(this.buildMode.kind).cost,
      } satisfies HudBuildMode) : null,
      waveMode: CONFIG.WAVE_MODE.enabled ? ({
        current: Math.max(0, this.currentWaveIndex + 1),
        total: CONFIG.WAVE_MODE.waves.length,
        nextInMs: this.waveActive ? 0 : Math.max(0, this.nextWaveAt - this.time.now),
        active: this.waveActive,
      } satisfies HudWaveState) : null,
    };
    hudBridge.emitState(s);
  }

  // ── AI ───────────────────────────────────────────────────────────────────

  // ── M2.2 — Wave-modus ────────────────────────────────────────────────────

  private updateWaves(time: number, delta: number) {
    if (!CONFIG.WAVE_MODE.enabled) return;
    if (this.gameState !== 'running') return;

    // Aktiv bølge: spawn ai-soldater jevnt (én per 700 ms)
    if (this.waveActive && this.waveSpawnQueue > 0) {
      this.waveSpawnTimer -= delta;
      if (this.waveSpawnTimer <= 0) {
        const spawnX = CONFIG.MAP_WIDTH - 40;
        const spawnY = Phaser.Math.Between(120, CONFIG.MAP_HEIGHT - 120);
        const s = this.spawnUnit('ai', 'soldier', spawnX, spawnY);
        s.attackTarget = this.playerBase;
        s.state = 'attacking';
        this.waveSpawnQueue -= 1;
        this.waveSpawnTimer = 700;
      }
    } else if (this.waveActive && this.waveSpawnQueue === 0) {
      // Bølgen er ferdig spawn-et; den er først "over" når alle ai-units er døde.
      const aliveAI = this.units.some(u => u.faction === 'ai' && !u.dead);
      if (!aliveAI) {
        this.waveActive = false;
        // Sett opp neste bølge
        const next = this.currentWaveIndex + 1;
        if (next >= CONFIG.WAVE_MODE.waves.length) {
          this.wavesCleared = true;
        } else {
          this.nextWaveAt = time + CONFIG.WAVE_MODE.waves[next].delay;
        }
      }
    }

    // Start neste bølge når timer utgår
    if (!this.waveActive && !this.wavesCleared && time >= this.nextWaveAt) {
      this.currentWaveIndex += 1;
      const wave = CONFIG.WAVE_MODE.waves[this.currentWaveIndex];
      this.waveActive = true;
      this.waveSpawnQueue = wave.soldiers;
      this.waveSpawnTimer = 0;
      this.currentAlert = {
        message: `BØLGE ${this.currentWaveIndex + 1} — ${wave.soldiers} fiender${wave.boss ? ' + BOSS' : ''}`,
        urgency: 'critical',
        triggeredAt: time,
      };
      playSfx(this, 'base-alarm', { volume: 0.45 });
    }
  }

  /** M2.3 — Arrange valgte soldater i en linje vinkelrett på snitt-bevegelsesretning. */
  private formationLine() {
    const soldiers = this.selectedUnits.filter(u => u.type === 'soldier' && !u.dead);
    if (soldiers.length < 2) return;

    // Snitt-posisjon og snitt-retning (lastDx/lastDy peker dit unitene beveger seg)
    let cx = 0, cy = 0, dx = 0, dy = 0;
    for (const s of soldiers) {
      cx += s.x; cy += s.y;
      dx += s.lastDx; dy += s.lastDy;
    }
    cx /= soldiers.length; cy /= soldiers.length;
    const dLen = Math.hypot(dx, dy);
    // Hvis ingen reell retning — bruk retning fra senter mot fiende-base
    if (dLen < 0.05) {
      dx = this.aiBase.x - cx; dy = this.aiBase.y - cy;
      const d2 = Math.hypot(dx, dy) || 1;
      dx /= d2; dy /= d2;
    } else {
      dx /= dLen; dy /= dLen;
    }
    // Perpendikulær (90°): (-dy, dx)
    const px = -dy, py = dx;

    // Sort enheter langs perpendikulær-aksen så de bytter minst plass
    const projected = soldiers.map(s => ({ s, proj: (s.x - cx) * px + (s.y - cy) * py }));
    projected.sort((a, b) => a.proj - b.proj);

    const spacing = CONFIG.FORMATION_SPACING;
    const n = projected.length;
    const offset0 = -((n - 1) / 2) * spacing;
    for (let i = 0; i < n; i++) {
      const t = offset0 + i * spacing;
      const tx = cx + px * t;
      const ty = cy + py * t;
      const u = projected[i].s;
      u.attackTarget = null;
      u.mineTarget = null;
      u.state = 'moving';
      u.moveTarget = { x: tx, y: ty };
    }
    this.spawnCommandRipple(cx, cy, 0xddff88);
  }

  private aiDecision() {
    if (this.gameState !== 'running') return;
    // M2.2 — wave-modus håndteres separat i updateWaves()
    if (CONFIG.WAVE_MODE.enabled) return;
    if (this.aiBase.hp <= 0) return;

    const aiAll = this.units.filter(u => u.faction === 'ai' && !u.dead);
    const aiSoldiers = aiAll.filter(u => u.type === 'soldier');
    const aiWorkers = aiAll.filter(u => u.type === 'worker');
    const playerSoldierCount = this.units.filter(u => u.faction === 'player' && u.type === 'soldier' && !u.dead).length;

    // Barakke-status. aiBarracks-feltet kan være null (aldri bygd) eller dead (rasert);
    // collapseBuilding nullstiller refen så vi alltid kan stole på .hp/.underConstruction her.
    const barracksLive = this.aiBarracks && !this.aiBarracks.dead && this.aiBarracks.hp > 0;
    const barracksReady = !!(this.aiBarracks && barracksLive && !this.aiBarracks.underConstruction);
    const barracksInProgress = !!(this.aiBarracks && barracksLive && this.aiBarracks.underConstruction);

    // 1) Hvis ingen barakke (verken bygd eller under bygging) og vi har råd og ≥2 workers:
    //    sett én worker til å bygge en barakke.
    if (!barracksLive && aiWorkers.length >= 2 && this.aiGold >= CONFIG.BARRACKS_COST) {
      // Plasser ved siden av maurtua, mot midten
      // AI base i nord (y lav) → barakke peker sør (positiv y, mot elva).
      const dirY = this.aiBase.y < CONFIG.MAP_HEIGHT / 2 ? 1 : -1;
      const spot = this.findAiBuildSpot(dirY);
      if (spot) {
        this.aiGold -= CONFIG.BARRACKS_COST;
        const spec = this.getBuildSpec('barracks');
        const b = this.createBuilding('barracks', 'ai', spot.x, spot.y, spec.w, spec.h, spec.hp);
        this.aiBarracks = b;
        this.beginConstruction(b, 'barracks');
        // Velg en idle worker, eller den nærmeste mine-worker
        const idle = aiWorkers.find(u => u.state === 'idle') ?? aiWorkers[0];
        this.assignWorkerToBuild(idle, b);
      }
    }

    // 2) Tren worker fra maurtua hvis under target og har råd
    if (aiWorkers.length < CONFIG.AI_WORKER_TARGET && this.aiGold >= CONFIG.WORKER_COST) {
      this.aiGold -= CONFIG.WORKER_COST;
      const w = this.spawnUnit('ai', 'worker',
        this.aiBase.x + Phaser.Math.Between(-22, 22),
        this.aiBase.y + Phaser.Math.Between(-22, 22));
      this.assignWorkerToMine(w);
    }
    // 3) Hvis barakka er klar — tren soldat
    else if (barracksReady && this.aiBarracks && this.aiGold >= CONFIG.SOLDIER_COST) {
      this.aiGold -= CONFIG.SOLDIER_COST;
      this.spawnUnit('ai', 'soldier',
        this.aiBarracks.x + Phaser.Math.Between(-22, 22),
        this.aiBarracks.y + Phaser.Math.Between(-22, 22));
    }

    // Re-assign idle workers til mining (men ikke de som bygger)
    for (const w of aiWorkers.filter(u => u.state === 'idle' && !u.buildTarget)) {
      this.assignWorkerToMine(w);
    }

    // K5 — AI bygger tårn gradvis når økonomien er stabil. Velger nærmeste tower-type
    // basert på trusselbildet; default stinger. Mindre frekvent enn unit-produksjon.
    this.maybeAiBuildTower(aiWorkers, playerSoldierCount);

    // V1 — score-basert aggression. Erstatter den binære terskelen:
    // AI angriper når den har ~jevnt antall soldater (eller bedre) med spilleren,
    // med en hard min på 2 og hard max på 8 (failsafe). Dette gjør avgjørelsen
    // adaptive — én ekstra fiende-soldat øker terskelen, ikke vice versa.
    // Broer er terreng — ikke targets.
    const effectiveThreshold = Math.max(
      2,
      Math.min(8, Math.floor(playerSoldierCount * 0.9) + 1),
    );
    if (aiSoldiers.length >= effectiveThreshold) {
      const attackTarget: BuildingData = this.playerBase;
      for (const s of aiSoldiers) {
        if (s.state !== 'attacking' || !s.attackTarget || s.attackTarget.hp <= 0) {
          s.attackTarget = attackTarget;
          s.state = 'attacking';
        }
      }
    }

    // Stille warning hvis vi har soldater men ingen barakke i sikte — kun til loop-debug
    void barracksInProgress;
  }

  /** K5 — AI tower-bygging. Plasseres direkte (uten worker-bygg-state) for å forenkle. */
  private maybeAiBuildTower(aiWorkers: UnitData[], playerSoldierCount: number) {
    const aiTowers = this.towers.filter(t => t.faction === 'ai' && !t.dead && t.hp > 0);
    if (aiTowers.length >= CONFIG.AI_TOWER_TARGET) return;
    if (aiWorkers.length < 2) return; // ikke ofre tidlig økonomi
    if (this.time.now - this.lastAiTowerBuildAt < CONFIG.AI_TOWER_BUILD_INTERVAL) return;

    // Velg tower-type basert på trusselbilde: spitter mot mange soldater, stinger ellers.
    const type: TowerKind = playerSoldierCount >= 5 ? 'spitter' : 'stinger';
    const spec = CONFIG.TOWER_TYPES[type];
    if (this.aiGold < spec.cost) return;

    // Plassering: peker mot midten av kartet (mot elv-grensen) som forsvarsperimeter.
    const dirY = this.aiBase.y < CONFIG.MAP_HEIGHT / 2 ? 1 : -1;
    const candidates: Vec2[] = [
      { x: this.aiBase.x - 180, y: this.aiBase.y + dirY * 120 },
      { x: this.aiBase.x + 180, y: this.aiBase.y + dirY * 120 },
      { x: this.aiBase.x - 100, y: this.aiBase.y + dirY * 160 },
      { x: this.aiBase.x + 100, y: this.aiBase.y + dirY * 160 },
      { x: this.aiBase.x,       y: this.aiBase.y + dirY * 200 },
    ];
    const c = CONFIG.TOWER_PLACE_CLEARANCE;
    let spot: Vec2 | null = null;
    for (const p of candidates) {
      if (p.x < 80 || p.x > CONFIG.MAP_WIDTH - 80) continue;
      if (p.y < 60 || p.y > CONFIG.MAP_HEIGHT - 60) continue;
      if (this.riverStateAt(p.x, p.y) !== 'land') continue;
      if (this.isBlockedByObstacle(p.x, p.y)) continue;
      if (this.isBlockedByCliff(p.x, p.y)) continue;
      let ok = true;
      for (const b of this.buildings) {
        if (b.dead || b.hp <= 0) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) < c) { ok = false; break; }
      }
      if (ok) { spot = p; break; }
    }
    if (!spot) return;

    this.aiGold -= spec.cost;
    this.lastAiTowerBuildAt = this.time.now;
    // AI tårn er ferdig umiddelbart — vi har ingen ai-build-state-modell og tårnet trenger
    // ikke en worker-construction-loop for å fungere.
    this.createTower(type, spot.x, spot.y, 'ai');
  }

  /** Speilet helper for DEMO_MODE player-side. dirY peker mot midten av kartet (mot elva). */
  private findPlayerBuildSpot(dirY: number): Vec2 | null {
    return this.findBuildSpotFor(this.playerBase, dirY);
  }

  /** Finn en plassering for AI sin barakke nær maurtua (mot midten av kartet). */
  private findAiBuildSpot(dirY: number): Vec2 | null {
    return this.findBuildSpotFor(this.aiBase, dirY);
  }

  /** Generisk byggested-helper: prøver punkter foran (mot elva) og litt til siden av basen. */
  private findBuildSpotFor(base: BuildingData, dirY: number): Vec2 | null {
    const cy = base.y + dirY * 95;
    const candidates: Vec2[] = [
      { x: base.x - 130, y: cy },
      { x: base.x + 130, y: cy },
      { x: base.x - 90,  y: base.y + dirY * 70 },
      { x: base.x + 90,  y: base.y + dirY * 70 },
      { x: base.x,       y: cy },
    ];
    const c = CONFIG.BUILD_PLACE_CLEARANCE;
    for (const p of candidates) {
      if (p.x < 60 || p.x > CONFIG.MAP_WIDTH - 60) continue;
      if (p.y < 60 || p.y > CONFIG.MAP_HEIGHT - 60) continue;
      if (this.riverStateAt(p.x, p.y) !== 'land') continue;
      if (this.isBlockedByObstacle(p.x, p.y)) continue;
      if (this.isBlockedByCliff(p.x, p.y)) continue;
      let ok = true;
      for (const b of this.buildings) {
        if (b.dead || b.hp <= 0) continue;
        if (Phaser.Math.Distance.Between(p.x, p.y, b.x, b.y) < c) { ok = false; break; }
      }
      if (ok) return p;
    }
    return null;
  }

  private assignWorkerToMine(worker: UnitData) {
    const mine = this.nearestMineForFaction(worker, worker.faction);
    if (!mine) return;
    worker.mineTarget = mine;
    worker.state = 'moving';
    worker.moveTarget = { x: mine.x, y: mine.y };
  }

  /** Foretrekker mines kontrollert av egen faction eller nøytrale; unngår motpartens og contested. */
  private nearestMineForFaction(pos: Vec2, faction: 'player' | 'ai'): MineData | null {
    const safe: MineData[] = [];
    const fallback: MineData[] = [];
    for (const m of this.mines) {
      if (m.control === faction || m.control === null) safe.push(m);
      else fallback.push(m); // fiende eller contested
    }
    // Auto-assign foretrekker lavlandsmines: mines på platået er ofte contested
    // og pathfinding kan låse workere fast oppe når de senere skal bygge i lavlandet.
    // Spilleren kan fortsatt manuelt høyreklikke en platå-mine.
    const safeOffPlateau = safe.filter(m => !this.isPointOnPlateau(m.x, m.y));
    const pool = safeOffPlateau.length > 0 ? safeOffPlateau
      : (safe.length > 0 ? safe : fallback);
    let best: MineData | null = null;
    let bestDist = Infinity;
    for (const m of pool) {
      const d = Phaser.Math.Distance.Between(pos.x, pos.y, m.x, m.y);
      if (d < bestDist) { best = m; bestDist = d; }
    }
    return best;
  }

  // ── Player AI (DEMO_MODE) ────────────────────────────────────────────────

  private playerDecision() {
    if (this.gameState !== 'running') return;
    if (this.playerBase.hp <= 0) return;

    const playerAll = this.units.filter(u => u.faction === 'player' && !u.dead);
    const playerSoldiers = playerAll.filter(u => u.type === 'soldier');
    const playerWorkers = playerAll.filter(u => u.type === 'worker');

    const barracksLive = this.playerBarracks && !this.playerBarracks.dead && this.playerBarracks.hp > 0;
    const barracksReady = !!(this.playerBarracks && barracksLive && !this.playerBarracks.underConstruction);

    // 1) Bygg barakke om vi mangler en og har råd + ≥2 workers
    if (!barracksLive && playerWorkers.length >= 2 && this.playerGold >= CONFIG.BARRACKS_COST) {
      // Player base i sør (y høy) → barakke peker nord (negativ y, mot elva).
      const dirY = this.playerBase.y < CONFIG.MAP_HEIGHT / 2 ? 1 : -1;
      const spot = this.findPlayerBuildSpot(dirY);
      if (spot) {
        this.playerGold -= CONFIG.BARRACKS_COST;
        const spec = this.getBuildSpec('barracks');
        const b = this.createBuilding('barracks', 'player', spot.x, spot.y, spec.w, spec.h, spec.hp);
        this.playerBarracks = b;
        this.beginConstruction(b, 'barracks');
        const idle = playerWorkers.find(u => u.state === 'idle') ?? playerWorkers[0];
        this.assignWorkerToBuild(idle, b);
      }
    }

    // 2) Tren worker fra maurtua hvis under target
    if (playerWorkers.length < CONFIG.PLAYER_WORKER_TARGET && this.playerGold >= CONFIG.WORKER_COST) {
      this.playerGold -= CONFIG.WORKER_COST;
      const w = this.spawnUnit('player', 'worker',
        this.playerBase.x + Phaser.Math.Between(-22, 22),
        this.playerBase.y + Phaser.Math.Between(-22, 22));
      this.assignWorkerToMine(w);
    }
    // 3) Tren soldat hvis barakke ferdig
    else if (barracksReady && this.playerBarracks && this.playerGold >= CONFIG.SOLDIER_COST) {
      this.playerGold -= CONFIG.SOLDIER_COST;
      const s = this.spawnUnit('player', 'soldier',
        this.playerBarracks.x + Phaser.Math.Between(-22, 22),
        this.playerBarracks.y + Phaser.Math.Between(-22, 22));
      this.assignSoldierInitialOrder(s);
    }

    for (const w of playerWorkers.filter(u => u.state === 'idle' && !u.buildTarget)) {
      this.assignWorkerToMine(w);
    }

    // Threat: AI soldiers within 350px of player base
    const threats = this.units.filter(u =>
      u.faction === 'ai' && u.type === 'soldier' && !u.dead &&
      Phaser.Math.Distance.Between(u.x, u.y, this.playerBase.x, this.playerBase.y) < 350
    );

    // V2 — score-basert aggression-terskel (symmetrisk med AI).
    // surplus angriper når vi har minst like mange (modulo en margin på 0.9) som fiendens
    // soldater. Hard min 2, hard max 8.
    const aiSoldierCount = this.units.filter(u =>
      u.faction === 'ai' && u.type === 'soldier' && !u.dead).length;
    const effectiveThreshold = Math.max(
      2,
      Math.min(8, Math.floor(aiSoldierCount * 0.9) + 1),
    );

    if (threats.length > 0) {
      // Defenders = soldiers closest to base; rest become surplus that can press the attack.
      const defendersNeeded = Math.min(playerSoldiers.length, threats.length * 2);
      const sortedByBaseDist = [...playerSoldiers].sort((a, b) =>
        Phaser.Math.Distance.Between(a.x, a.y, this.playerBase.x, this.playerBase.y) -
        Phaser.Math.Distance.Between(b.x, b.y, this.playerBase.x, this.playerBase.y),
      );
      const defenders = sortedByBaseDist.slice(0, defendersNeeded);
      const surplus = sortedByBaseDist.slice(defendersNeeded);
      for (const s of defenders) {
        let nearest: UnitData | null = null;
        let nearestDist = Infinity;
        for (const t of threats) {
          const d = Phaser.Math.Distance.Between(s.x, s.y, t.x, t.y);
          if (d < nearestDist) { nearest = t; nearestDist = d; }
        }
        if (nearest) { s.attackTarget = nearest; s.state = 'attacking'; }
      }
      if (surplus.length >= effectiveThreshold) {
        for (const s of surplus) {
          const t = s.attackTarget;
          const hasLiveTarget = t !== null && t.hp > 0 && !('dead' in t && (t as UnitData).dead);
          if (!hasLiveTarget) { s.attackTarget = this.aiBase; s.state = 'attacking'; }
        }
      }
    } else if (playerSoldiers.length >= effectiveThreshold) {
      // Offensive: don't interrupt soldiers already fighting a live target
      for (const s of playerSoldiers) {
        const t = s.attackTarget;
        const hasLiveTarget = t !== null && t.hp > 0 && !('dead' in t && (t as UnitData).dead);
        if (!hasLiveTarget) { s.attackTarget = this.aiBase; s.state = 'attacking'; }
      }
    }
  }

  // ── Timers & metrics ─────────────────────────────────────────────────────

  private mineTick() {
    if (this.gameState !== 'running') return;

    // M3.1 — Farms gir flat bonus-gull per tick (uavhengig av miner-coverage).
    let farmBonus = 0;
    for (const f of this.farms) {
      if (f.dead || f.hp <= 0 || f.underConstruction) continue;
      farmBonus += CONFIG.BUILDING_TYPES.farm.bonusGoldPerTick;
    }
    if (farmBonus > 0) {
      this.playerGold += farmBonus;
      this.statsGoldEarned += farmBonus;
      // Float-text på første farm så spilleren ser bidraget
      const firstAlive = this.farms.find(f => !f.dead && f.hp > 0);
      if (firstAlive) this.vfx.floatText(firstAlive.x, firstAlive.y - 28, `+${farmBonus}`, '#ccff99');
    }

    const R = CONFIG.MINE_CONTEST_RADIUS;
    const flipNeeded = CONFIG.MINE_FLIP_TICKS;
    for (const mine of this.mines) {
      // Beregn kontroll-status — gjøres uansett om noen miner aktivt, så ringen alltid er korrekt.
      let playerNear = false; let aiNear = false;
      for (const u of this.units) {
        if (u.dead) continue;
        if (Phaser.Math.Distance.Between(u.x, u.y, mine.x, mine.y) > R) continue;
        if (u.faction === 'player') playerNear = true;
        else aiNear = true;
        if (playerNear && aiNear) break;
      }
      const prevControl = mine.control;

      // V3 — Sticky control:
      // - Eierskap (mine.owner via 'player'|'ai') endres BARE etter `flipNeeded` ticks med kun
      //   den motsatte siden i radius. Det betyr at en raid må *holde* mina i 3 ticks (~4.5s)
      //   før den flipper. Dette løser "rock-paper-scissors"-følelsen der én soldat momentant
      //   stoppet produksjonen.
      // - Visuelt: `control === 'contested'` brukes kun som transient flag når begge er nær.
      const prevOwner: 'player' | 'ai' | null =
        prevControl === 'player' || prevControl === 'ai' ? prevControl : null;
      let nextOwner: 'player' | 'ai' | null = prevOwner;
      let contestedNow = false;

      if (playerNear && aiNear) {
        contestedNow = true;
        mine.flipPressurePlayer = 0;
        mine.flipPressureAi = 0;
      } else if (playerNear && !aiNear) {
        mine.flipPressureAi = 0;
        if (prevOwner === 'ai') {
          mine.flipPressurePlayer++;
          if (mine.flipPressurePlayer >= flipNeeded) {
            nextOwner = 'player';
            mine.flipPressurePlayer = 0;
          }
        } else {
          nextOwner = 'player';
          mine.flipPressurePlayer = 0;
        }
      } else if (aiNear && !playerNear) {
        mine.flipPressurePlayer = 0;
        if (prevOwner === 'player') {
          mine.flipPressureAi++;
          if (mine.flipPressureAi >= flipNeeded) {
            nextOwner = 'ai';
            mine.flipPressureAi = 0;
          }
        } else {
          nextOwner = 'ai';
          mine.flipPressureAi = 0;
        }
      }
      // ingen i radius → ingenting endres (sticky)

      mine.control = contestedNow ? 'contested' : nextOwner;

      // Oppdater ring-farge. Sticky-decay vises som blinking via alpha-modulering
      // hvis det er en kamp om eierskap (flipPressure > 0).
      const ringColor = mine.control === 'player' ? 0x6ec8ff
        : mine.control === 'ai' ? 0xff7c5a
        : mine.control === 'contested' ? 0xffaa33
        : 0x888888;
      const ringAlpha = mine.control === null ? 0.25 : 0.85;
      mine.controlRing.setStrokeStyle(2, ringColor, ringAlpha);

      const miners = this.units.filter(u => u.mineTarget === mine && u.state === 'mining' && !u.dead);
      if (miners.length === 0) continue;

      // Contested = ingen får gull. Vis BLOKKERT-text kun ved state-transition
      // (ikke hver 1.5s mens stillstand vedvarer).
      if (mine.control === 'contested') {
        if (prevControl !== 'contested') {
          this.vfx.floatText(mine.x, mine.y - 28, 'BLOKKERT', '#ff6655');
        }
        continue;
      }

      // Gull deles ut basert på faktiske miners (uendret atferd ellers).
      let playerGain = 0; let aiGain = 0;
      for (const w of miners) {
        if (w.faction === 'player') { this.playerGold += CONFIG.GOLD_PER_TICK; playerGain += CONFIG.GOLD_PER_TICK; this.statsGoldEarned += CONFIG.GOLD_PER_TICK; }
        else { this.aiGold += CONFIG.GOLD_PER_TICK; aiGain += CONFIG.GOLD_PER_TICK; }
      }
      if (playerGain > 0) this.vfx.floatText(mine.x - 8, mine.y - 28, `+${playerGain}`, '#ddff88');
      if (aiGain > 0) this.vfx.floatText(mine.x + 8, mine.y - 28, `+${aiGain}`, '#ffcc88');
    }
  }

  private updateMetrics() {
    if (!this.metricsEl) return;
    const ps = this.units.filter(u => u.faction === 'player' && u.type === 'soldier').length;
    const pw = this.units.filter(u => u.faction === 'player' && u.type === 'worker').length;
    const as_ = this.units.filter(u => u.faction === 'ai' && u.type === 'soldier').length;
    const playerTowers = this.towers.filter(t => t.faction === 'player' && !t.dead && t.hp > 0).length;
    const aiTowers = this.towers.filter(t => t.faction === 'ai' && !t.dead && t.hp > 0).length;
    const playerMines = this.mines.filter(m => m.control === 'player').length;
    if (playerMines > this.statsPeakMines) this.statsPeakMines = playerMines;
    this.metricsEl.setAttribute('data-state', this.gameState);
    this.metricsEl.setAttribute('data-player-gold', String(this.playerGold));
    this.metricsEl.setAttribute('data-player-soldiers', String(ps));
    this.metricsEl.setAttribute('data-player-workers', String(pw));
    this.metricsEl.setAttribute('data-player-base-hp', String(Math.max(0, this.playerBase.hp)));
    this.metricsEl.setAttribute('data-player-towers', String(playerTowers));
    this.metricsEl.setAttribute('data-ai-soldiers', String(as_));
    this.metricsEl.setAttribute('data-ai-base-hp', String(Math.max(0, this.aiBase.hp)));
    this.metricsEl.setAttribute('data-ai-towers', String(aiTowers));
    this.metricsEl.setAttribute('data-game-time', String(Math.floor(this.gameTime)));
  }

  private endGame(result: 'won' | 'lost') {
    this.gameState = result;
    // Reset hastighet så HUD ikke står på pause/2x etter game-over
    if (this.gameSpeed === 0) this.gameSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.applyGameSpeed();
    this.baseAlarmLoop?.stop();
    playSfx(this, result === 'won' ? 'victory' : 'defeat', { volume: 0.9 });
    this.updateMetrics();
    this.emitHudState();

    // Particle rain (the HTML overlay handles the title/stats/hint)
    const tints = result === 'won'
      ? [0xffd700, 0xffe680, 0xffaa22]
      : [0x444444, 0x222222, 0x665555];
    this.vfx.victoryRain(CONFIG.MAP_WIDTH, tints);

    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
    if (CONFIG.DEMO_MODE) {
      this.time.delayedCall(2000, () => this.scene.restart());
    }
  }

  // ── M1.1 — pause / hastighet ─────────────────────────────────────────────

  /** Bruk current `gameSpeed` på Phaser-klokke + tweens. 0 = pause. */
  private applyGameSpeed() {
    const s = this.gameSpeed;
    this.time.timeScale = s === 0 ? 0 : s;
    this.tweens.timeScale = s === 0 ? 0 : s;
    if (this.physics?.world) this.physics.world.timeScale = s === 0 ? 1 : s;
  }

  private togglePause() {
    if (this.gameState !== 'running') return;
    if (this.gameSpeed === 0) {
      this.gameSpeed = this.prePauseSpeed || CONFIG.DEFAULT_TIME_SCALE;
    } else {
      this.prePauseSpeed = this.gameSpeed;
      this.gameSpeed = 0;
    }
    this.applyGameSpeed();
  }

  /** Steg gjennom CONFIG.TIME_SCALES med ±1. Hopper ut av pause hvis aktiv. */
  private cycleSpeed(direction: 1 | -1) {
    if (this.gameState !== 'running') return;
    const scales = [...CONFIG.TIME_SCALES] as number[];
    const cur = this.gameSpeed === 0 ? this.prePauseSpeed : this.gameSpeed;
    const idx = scales.indexOf(cur);
    let nxt = idx + direction;
    if (nxt < 0) nxt = 0;                       // klamp — ingen wrap
    if (nxt >= scales.length) nxt = scales.length - 1;
    this.gameSpeed = scales[nxt];
    this.prePauseSpeed = this.gameSpeed;
    this.applyGameSpeed();
  }

  // ── M1.5 — fiende-varsel ─────────────────────────────────────────────────

  private checkEnemyNear(time: number) {
    if (time - this.lastEnemyAlertAt < CONFIG.ENEMY_ALERT_INTERVAL) {
      // Decay: skjul varselet etter 3 sekunder fra triggered.
      if (this.currentAlert && time - this.currentAlert.triggeredAt > 3000) {
        this.currentAlert = null;
      }
      return;
    }
    this.lastEnemyAlertAt = time;

    if (!this.playerBase || this.playerBase.hp <= 0) return;
    const bx = this.playerBase.x;
    const by = this.playerBase.y;
    const radius = CONFIG.ENEMY_NEAR_RADIUS;
    let nearestDist = Infinity;
    let count = 0;
    for (const u of this.units) {
      if (u.dead || u.faction !== 'ai' || u.type !== 'soldier') continue;
      const d = Phaser.Math.Distance.Between(u.x, u.y, bx, by);
      if (d < radius) count++;
      if (d < nearestDist) nearestDist = d;
    }
    if (nearestDist < radius) {
      // V4 — debounce: bare emitt en NY alarm hvis det har gått minst ENEMY_ALERT_COOLDOWN
      // siden forrige *emitterte* alarm. Soldater som "skvulper" rundt grensen
      // skal ikke produsere blinkende banner.
      const cooldownPassed = time - this.lastAlertEmittedAt >= CONFIG.ENEMY_ALERT_COOLDOWN;
      const recentlyTriggered = this.currentAlert && time - this.currentAlert.triggeredAt < 3000;
      if (cooldownPassed && !recentlyTriggered) {
        this.currentAlert = {
          message: count >= 2 ? `FIENDE NÆR! (${count} soldater)` : 'FIENDE NÆR!',
          urgency: 'critical',
          triggeredAt: time,
        };
        this.lastAlertEmittedAt = time;
      }
    } else if (this.currentAlert && time - this.currentAlert.triggeredAt > 3000) {
      this.currentAlert = null;
    }
  }

  // ── M1.5 — rally-pil tegnes som del av setRallyPoint ─────────────────────
}
