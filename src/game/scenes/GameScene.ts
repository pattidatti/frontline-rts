import Phaser from 'phaser';
import { CONFIG, THEME } from '../config';
import { VFXManager } from '../vfx';
import { hudBridge, type HudState, type HudCommand, type HudUnit, type HudBuilding, type HudSelection, type HudBuildMode, type HudWaveState, type TowerKind } from '../hudBridge';
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

interface UnitData {
  id: number;
  faction: 'player' | 'ai';
  type: 'worker' | 'soldier';
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number; damage: number;
  attackRange: number; attackInterval: number; lastAttackAt: number;
  state: 'idle' | 'moving' | 'attacking' | 'mining';
  moveTarget: Vec2 | null;
  attackTarget: UnitData | BuildingData | null;
  mineTarget: MineData | null;
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
  selectionTween: Phaser.Tweens.Tween | null;
  radius: number;
  lastDx: number; lastDy: number;
  /** M2.1 — webber-tower slow. ms-tidsstempel; speed halveres så lenge time < slowedUntil. */
  slowedUntil: number;
}

interface BuildingData {
  id: number;
  kind: 'base' | 'barracks' | 'mine' | 'bridge' | 'tower';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Ellipse;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  dead?: boolean;
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
}

type MineControl = 'player' | 'ai' | 'contested' | null;
type MineData = BuildingData & {
  kind: 'mine'; faction: 'neutral';
  control: MineControl;
  controlRing: Phaser.GameObjects.Arc;
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
  private playerBase!: BuildingData;
  private aiBase!: BuildingData;
  private playerBarracks!: BuildingData;
  private aiBarracks!: BuildingData;

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
  private currentAlert: { message: string; urgency: 'critical' | 'warn'; triggeredAt: number } | null = null;

  // M1.4 — looping base-alarm (under 50 % HP)
  private baseAlarmLoop: LoopingSfx | null = null;

  // M2.1 — Tower-bygging
  private towers: BuildingData[] = [];
  private buildMode: {
    towerType: TowerKind;
    ghostBody: Phaser.GameObjects.Graphics;
    ghostRange: Phaser.GameObjects.Graphics;
    valid: boolean;
  } | null = null;
  private buildRadiusRing: Phaser.GameObjects.Graphics | null = null;

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
    this.currentAlert = null;
    this.towers = [];
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


    // Drag selection box (tan/sand for ant theme)
    this.dragRect = this.add.rectangle(0, 0, 1, 1, 0xddcc88, 0.15)
      .setStrokeStyle(1, 0xddcc88, 0.85)
      .setOrigin(0, 0)
      .setVisible(false)
      .setDepth(20);

    // Broer (T1-C) — plasseres på elv-tverring (x=1280). Lages før elv-tegning
    // så elven kan referere til dem som krysspunkter for waypoint-routing.
    // Bredde 170 × høyde 100 (horisontal orientering — krysser vertikal elv).
    const bridgeA = this.createBridge(1280, 480, 170, 100);
    const bridgeB = this.createBridge(1280, 960, 170, 100);

    // Elv (T1-B) — vertikal stripe midt på kartet, ~120px bred. Skiller
    // player (vest) fra AI (øst) og gjør broene til reelle chokepoints.
    // Tegnet under bro-laget (depth 1 → broer på depth 2 ligger over).
    const RIVER_X = 1280;
    const RIVER_HALF = 60;
    const river: River = {
      centerLine: [{ x: RIVER_X, y: 0 }, { x: RIVER_X, y: H }],
      polygon: [
        { x: RIVER_X - RIVER_HALF, y: 0 },
        { x: RIVER_X + RIVER_HALF, y: 0 },
        { x: RIVER_X + RIVER_HALF, y: H },
        { x: RIVER_X - RIVER_HALF, y: H },
      ],
      bridges: [bridgeA, bridgeB],
    };
    this.rivers.push(river);

    // Render elv-laget
    const rivGfx = this.add.graphics().setDepth(1);
    rivGfx.fillGradientStyle(0x2c4a7a, 0x1a3258, 0x2c4a7a, 0x1a3258, 0.95);
    rivGfx.fillRect(RIVER_X - RIVER_HALF, 0, RIVER_HALF * 2, H);
    // Mørk kant-linje vest/øst
    rivGfx.lineStyle(2, 0x14233e, 0.85);
    rivGfx.lineBetween(RIVER_X - RIVER_HALF, 0, RIVER_X - RIVER_HALF, H);
    rivGfx.lineBetween(RIVER_X + RIVER_HALF, 0, RIVER_X + RIVER_HALF, H);
    // Bølge-streker for tekstur (vertikale linjer med sinus-forskyvning på x)
    rivGfx.lineStyle(1, 0x6a8ec0, 0.35);
    for (let i = 0; i < 5; i++) {
      const xo = -RIVER_HALF + (i + 0.5) * (RIVER_HALF * 2 / 5);
      rivGfx.beginPath();
      rivGfx.moveTo(RIVER_X + xo, 0);
      for (let y = 0; y <= H; y += 40) {
        rivGfx.lineTo(RIVER_X + xo + Math.sin((y + i * 30) * 0.025) * 4, y);
      }
      rivGfx.strokePath();
    }

    // Mines — 6 totalt: 2 trygge ved hver base + 2 omkjempete ved elven.
    // Trygge mines gir stabil hjemme-økonomi (~4s pendling for workers),
    // contested-mines i sentrum belønner taktisk fremrykk.
    this.createMine(300, 500);    // Player NW (trygg)
    this.createMine(300, 940);    // Player SW (trygg)
    this.createMine(2260, 500);   // AI NE (trygg)
    this.createMine(2260, 940);   // AI SE (trygg)
    this.createMine(900, 720);    // Contested (player-side, ved elv)
    this.createMine(1660, 720);   // Contested (AI-side, ved elv)

    // Buildings
    this.playerBase = this.createBuilding('base', 'player', 80, H / 2, 60, 80, CONFIG.BASE_HP);
    this.aiBase = this.createBuilding('base', 'ai', W - 80, H / 2, 60, 80, CONFIG.BASE_HP);
    this.playerBarracks = this.createBuilding('barracks', 'player', 175, H / 2 + 130, 50, 38, 200);
    this.aiBarracks = this.createBuilding('barracks', 'ai', W - 175, H / 2 - 130, 50, 38, 200);

    // Starting economy
    this.playerGold = CONFIG.STARTING_GOLD;
    this.aiGold = CONFIG.STARTING_GOLD;

    // Initial units
    this.spawnUnit('player', 'worker', 160, H / 2);
    this.spawnUnit('ai', 'worker', W - 160, H / 2);

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
    // I build-mode: 1/2/3 bytter tower-type, Esc/høyreklikk avbryter.
    this.input.keyboard?.on('keydown-T', () => {
      if (this.buildMode) this.cancelBuildMode();
      else this.startBuildMode('stinger');
    });
    this.input.keyboard?.on('keydown-ONE', () => {
      if (this.buildMode) this.startBuildMode('stinger');
    });
    this.input.keyboard?.on('keydown-TWO', () => {
      if (this.buildMode) this.startBuildMode('webber');
    });
    this.input.keyboard?.on('keydown-THREE', () => {
      if (this.buildMode) this.startBuildMode('spitter');
    });

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
      // Demo: sentrer på nordbroa — viser elva, broa og sentrum-handling uten å stirre rett i vannet.
      this.cameras.main.centerOn(CONFIG.MAP_WIDTH / 2, 480);
    } else {
      // Spiller starter med kameraet på sin egen base
      this.cameras.main.centerOn(80, CONFIG.MAP_HEIGHT / 2);
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

    // Inngangshull — peker mot midten av kartet. Plassert på skråningen (ikke på toppen).
    const entranceDir = x < CONFIG.MAP_WIDTH / 2 ? 1 : -1;
    const entranceX = x + entranceDir * R * 0.45;
    const entranceY = y + R * 0.2;
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
    const text =
      b.kind === 'base'     ? (b.faction === 'player' ? 'BASE' : 'FIENDE-BASE')
      : b.kind === 'barracks' ? (b.faction === 'player' ? 'BARAKKE' : 'FIENDE-BARAKKE')
      : b.kind === 'mine'   ? 'BLADLUSFARM'
      : b.kind === 'bridge' ? 'BRO'
      : b.kind === 'tower'  ? (b.tower?.type === 'webber' ? 'NETT-TÅRN' : b.tower?.type === 'spitter' ? 'SPYTT-TÅRN' : 'SPYDD-TÅRN')
      : '';
    if (!text) return;
    const color = b.faction === 'player' ? '#cfe3a3'
      : b.faction === 'ai' ? '#ffb088'
      : '#e6c45a';
    // Y-offset basert på bygningstype — over hovedsiluetten
    const yOffset = b.kind === 'base' ? -b.h * 0.95
      : b.kind === 'barracks' ? -b.h * 0.85
      : b.kind === 'mine' ? -b.h * 0.95
      : -b.h * 0.6; // bro
    b.label = this.add.text(b.x, b.y + yOffset, text, {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '11px',
      color,
      fontStyle: 'bold',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5, 1).setDepth(9).setAlpha(0.85);
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
    };
    this.attachBuildingLabel(mine);
    this.buildings.push(mine);
    this.mines.push(mine);
    return mine;
  }

  /** M2.1 — bygg en tower for spilleren. Tegnes som steinsokkel + farget topp.  */
  private createTower(type: TowerKind, x: number, y: number): BuildingData {
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
      id: this.nextId++, kind: 'tower', faction: 'player',
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

  /** Kan en tower plasseres på (x,y)? */
  private canPlaceTower(x: number, y: number): boolean {
    if (!this.playerBase || this.playerBase.hp <= 0) return false;
    const dFromBase = Phaser.Math.Distance.Between(x, y, this.playerBase.x, this.playerBase.y);
    if (dFromBase > CONFIG.TOWER_BUILD_RADIUS) return false;
    // Innenfor verden
    if (x < 40 || x > CONFIG.MAP_WIDTH - 40 || y < 40 || y > CONFIG.MAP_HEIGHT - 40) return false;
    // Ikke på elv
    if (this.riverStateAt(x, y) !== 'land') return false;
    // Klaring til andre bygninger
    const c = CONFIG.TOWER_PLACE_CLEARANCE;
    for (const b of this.buildings) {
      if (b.dead || b.hp <= 0) continue;
      if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < c) return false;
    }
    return true;
  }

  /** M2.1 — start build-mode for valgt tower-type. */
  private startBuildMode(type: TowerKind) {
    if (this.gameState !== 'running') return;
    if (this.playerBase.hp <= 0) return;
    this.cancelBuildMode();
    const ghostBody = this.add.graphics().setDepth(24);
    const ghostRange = this.add.graphics().setDepth(23);
    this.buildMode = { towerType: type, ghostBody, ghostRange, valid: false };
    // Tegn build-radius rundt basen
    if (!this.buildRadiusRing) {
      this.buildRadiusRing = this.add.graphics().setDepth(22);
    }
    this.buildRadiusRing.clear();
    this.buildRadiusRing.lineStyle(2, 0xddcc88, 0.55);
    this.buildRadiusRing.strokeCircle(this.playerBase.x, this.playerBase.y, CONFIG.TOWER_BUILD_RADIUS);
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
    const spec = CONFIG.TOWER_TYPES[this.buildMode.towerType];
    const ok = this.canPlaceTower(w.x, w.y) && this.playerGold >= spec.cost;
    this.buildMode.valid = ok;
    const color = ok ? 0x66dd66 : 0xee5544;

    // Ghost body — kvadrat med diamant-overlegg
    const g = this.buildMode.ghostBody;
    g.clear();
    g.lineStyle(2, color, 0.95);
    g.fillStyle(color, 0.18);
    g.fillRect(w.x - 18, w.y - 22, 36, 44);
    g.strokeRect(w.x - 18, w.y - 22, 36, 44);
    g.fillStyle(spec.color, 0.55);
    g.fillCircle(w.x, w.y - 14, 14);

    // Range-ring
    const rg = this.buildMode.ghostRange;
    rg.clear();
    rg.lineStyle(1.5, color, 0.55);
    rg.strokeCircle(w.x, w.y, spec.range);
  }

  /** Plasser tower hvis posisjon er gyldig. Returnerer true ved suksess. */
  private placeTower(w: Vec2): boolean {
    if (!this.buildMode) return false;
    const spec = CONFIG.TOWER_TYPES[this.buildMode.towerType];
    if (!this.canPlaceTower(w.x, w.y) || this.playerGold < spec.cost) return false;
    this.playerGold -= spec.cost;
    this.createTower(this.buildMode.towerType, w.x, w.y);
    this.spawnCommandRipple(w.x, w.y, 0xddff88);
    playSfx(this, 'train', { volume: 0.5 });
    return true;
  }

  /** Auto-fire fra alle towers — kalt fra update(). */
  private updateTowers(time: number) {
    for (const tower of this.towers) {
      if (tower.dead || tower.hp <= 0 || !tower.tower) continue;
      const t = tower.tower;
      if (time - t.lastFireAt < t.fireRate) continue;

      // Finn nærmeste fiende-unit innenfor range
      let target: UnitData | null = null;
      let bestDist = t.range;
      for (const u of this.units) {
        if (u.dead || u.faction !== 'ai') continue;
        const d = Phaser.Math.Distance.Between(tower.x, tower.y, u.x, u.y);
        if (d < bestDist) { target = u; bestDist = d; }
      }
      if (!target) continue;

      t.lastFireAt = time;
      this.vfx.fireProjectile(tower.x, tower.y - 14, target.x, target.y, t.type === 'spitter' ? 0x8acc6a : t.type === 'webber' ? 0xc8c8e8 : THEME.ATTACK_PROJECTILE_PLAYER);
      this.vfx.impact(target.x, target.y);
      playSfx(this, 'attack', { volume: 0.15 });

      // Damage selve målet
      this.applyTowerHit(target, t.damage, t.slow, time);

      // Splash (spitter)
      if (t.splash > 0) {
        for (const u of this.units) {
          if (u === target || u.dead || u.faction !== 'ai') continue;
          const d = Phaser.Math.Distance.Between(target.x, target.y, u.x, u.y);
          if (d <= t.splash) this.applyTowerHit(u, Math.round(t.damage * 0.6), t.slow, time);
        }
      }
    }
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
    const hpBg = this.add.rectangle(0, -r - 6, r * 2, 4, 0x111111).setStrokeStyle(1, 0x000000, 0.5);
    const hpFg = this.add.rectangle(-r, -r - 6, r * 2, 4, 0x44ee44).setOrigin(0, 0.5);
    const selRing = this.add.arc(0, 0, r + 5, 0, 360, false, 0xffffff, 0)
      .setStrokeStyle(2, 0xffffff, 1).setVisible(false);

    hpBg.setVisible(false);
    hpFg.setVisible(false);

    const container = this.add.container(x, y, [footprint, shadow, antBody, hpBg, hpFg, selRing]).setDepth(5);

    const unit: UnitData = {
      id: this.nextId++, faction, type, x, y,
      hp: isSoldier ? CONFIG.SOLDIER_HP : 60,
      maxHp: isSoldier ? CONFIG.SOLDIER_HP : 60,
      speed: isSoldier ? CONFIG.SOLDIER_SPEED : CONFIG.WORKER_SPEED,
      damage: isSoldier ? CONFIG.SOLDIER_DAMAGE : 0,
      attackRange: isSoldier ? CONFIG.SOLDIER_ATTACK_RANGE : 0,
      attackInterval: CONFIG.SOLDIER_ATTACK_SPEED,
      lastAttackAt: 0,
      state: 'idle', moveTarget: null, attackTarget: null, mineTarget: null,
      selected: false, dead: false,
      container, antBody, body: thorax, segments: [abdomen, thorax, head],
      bodyColor, hpBg, hpFg, selectionRing: selRing,
      selectionTween: null, radius: r,
      lastDx: isPlayer ? 1 : -1, lastDy: 0,
      slowedUntil: 0,
    };

    this.units.push(unit);
    return unit;
  }

  private removeUnit(unit: UnitData) {
    unit.dead = true;
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
            unit.state = unit.mineTarget ? 'mining' : 'idle';
          }
        } else {
          unit.state = 'idle';
        }
        break;

      case 'idle':
        if (unit.type === 'soldier') this.findAndEngage(unit);
        break;
    }

    // Light separation push
    this.separate(unit);
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
    this.cameras.main.shake(220, 0.005);
    this.vfx.dust(b.x, b.y, 14);
    // Broer kollapser containeren (planker faller), basers body fader.
    // Towers (M2.1) faller på samme måte som broer.
    const target: Phaser.GameObjects.GameObject =
      b.kind === 'bridge' && b.bridgeContainer ? b.bridgeContainer
      : b.kind === 'tower' && b.towerContainer ? b.towerContainer
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
   *  - 'land'             : normal bevegelse
   *  - 'bridge'            : inne i elv, men på en levende bro → normal bevegelse
   *  - 'swim'              : inne i elv, ingen levende bro i denne elven → tillatt, men sakte
   *  - 'blocked'           : inne i elv, broer lever men ikke nær nok → blokker
   *
   * Rektangulær pass-zone rundt broa (matcher faktisk bro-størrelse + liten margin).
   */
  private riverStateAt(x: number, y: number): 'land' | 'bridge' | 'swim' | 'blocked' {
    for (const r of this.rivers) {
      if (!pointInPolygon({ x, y }, r.polygon)) continue;
      // Broen krysser elven på sin LANGE akse. For vertikal elv (høyere enn bredt
      // polygon) er det x-aksen. Det betyr: så lenge unit er innenfor bro.x ± w/2
      // er den på broa, uansett y-posisjon innenfor elv-stripen. Det hindrer at
      // separasjon eller drift dytter units av broa midt i kryssingen.
      const polyW = r.polygon[1].x - r.polygon[0].x;
      const polyH = r.polygon[2].y - r.polygon[1].y;
      const verticalRiver = polyH > polyW;
      const margin = 12;
      for (const b of r.bridges) {
        if (b.dead || b.hp <= 0) continue;
        if (verticalRiver) {
          if (Math.abs(x - b.x) < b.w / 2 + margin) return 'bridge';
        } else {
          if (Math.abs(y - b.y) < b.h / 2 + margin) return 'bridge';
        }
      }
      // Ingen pass-zone funnet — er det noen levende bro overhodet?
      const anyLive = r.bridges.some(b => !b.dead && b.hp > 0);
      return anyLive ? 'blocked' : 'swim';
    }
    return 'land';
  }

  /** Bakoverkompatibel: brukes av separat-logikk som bare vil vite om vi skal unngå. */
  private isBlockedByRiver(x: number, y: number): boolean {
    return this.riverStateAt(x, y) === 'blocked';
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

    if (newState === 'blocked' && oldState !== 'blocked' && oldState !== 'swim') {
      // Levende bro finnes men vi treffer ikke pass-zonen → la routing finne broa neste frame.
      return false;
    }
    if (newState === 'swim') {
      // Ingen bro krysser denne elven — vading tillatt med 30% fart.
      step *= 0.3;
      newX = unit.x + nx * step;
      newY = unit.y + ny * step;
    }
    unit.x = newX;
    unit.y = newY;
    return false;
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
        // Ikke push enheten inn i elv — la den heller forbli klemt
        if (!this.isBlockedByRiver(newX, newY) || this.isBlockedByRiver(unit.x, unit.y)) {
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
        const placed = this.placeTower(this.wp(pointer));
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

    // Egen enhet → hvit ring (select-hint)
    const own = this.hitUnitAt(w, 'player');
    if (own) {
      this.hoverGfx.lineStyle(2, 0xffffff, 0.9);
      this.hoverGfx.strokeCircle(own.x, own.y, own.radius + 4);
      this.input.setDefaultCursor('pointer');
      return;
    }

    // Fiende-enhet → rød ring (attack-hint, krever utvalg)
    const foe = this.hitUnitAt(w, 'ai');
    if (foe) {
      const color = this.selectedUnits.some(u => u.type === 'soldier') ? 0xff5544 : 0xaa6655;
      this.hoverGfx.lineStyle(2, color, 0.9);
      this.hoverGfx.strokeCircle(foe.x, foe.y, foe.radius + 4);
      this.input.setDefaultCursor('crosshair');
      return;
    }

    // Bygninger / mine
    type CursorHint = 'pointer' | 'default';
    const buildings: { b: BuildingData; tint: number; cur: CursorHint }[] = [
      { b: this.playerBarracks, tint: 0x88c0ff, cur: 'pointer' },
      { b: this.aiBase, tint: 0xff5544, cur: 'pointer' },
      { b: this.aiBarracks, tint: 0xff5544, cur: 'pointer' },
    ];
    for (const { b, tint, cur } of buildings) {
      if (b.hp > 0 && this.hitBuildingAt(w, b)) {
        this.hoverGfx.lineStyle(2, tint, 0.9);
        this.hoverGfx.strokeRect(b.x - b.w / 2 - 4, b.y - b.h / 2 - 4, b.w + 8, b.h + 8);
        this.input.setDefaultCursor(cur === 'pointer' ? 'pointer' : 'default');
        return;
      }
    }
    for (const m of this.mines) {
      if (Math.abs(w.x - m.x) < m.w / 2 + 6 && Math.abs(w.y - m.y) < m.h / 2 + 6) {
        const tint = this.selectedUnits.some(u => u.type === 'worker') ? 0xddff88 : 0xaadd77;
        this.hoverGfx.lineStyle(2, tint, 0.9);
        this.hoverGfx.strokeRect(m.x - m.w / 2 - 4, m.y - m.h / 2 - 4, m.w + 8, m.h + 8);
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
      if (!pointer.event.shiftKey) this.clearSelection();
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
    // Click on player barracks → select it (HTML command card shows train buttons)
    if (this.hitBuildingAt(w, this.playerBarracks) && this.playerBarracks.hp > 0) {
      this.selectPlayerBarracks();
      return;
    }
    // Clicking a non-barracks empty spot clears the building selection
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

    // Units selected → left-click issues command
    if (this.selectedUnits.length > 0) {
      this.issueCommandAt(w);
    }
  }

  private handleCommandClick(pointer: Phaser.Input.Pointer) {
    const w = this.wp(pointer);
    // While the barracks is selected, right-click in the world manages the rally point
    if (this.selectedBuilding === this.playerBarracks) {
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

    // Assign workers to mine
    for (const mine of this.mines) {
      if (Math.abs(w.x - mine.x) < mine.w / 2 + 6 && Math.abs(w.y - mine.y) < mine.h / 2 + 6) {
        const workers = this.selectedUnits.filter(u => u.type === 'worker');
        if (workers.length === 0) return;
        for (const u of workers) {
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

    // Attack enemy building (eller bro — spillere kan rive broer som taktikk)
    const attackable: BuildingData[] = [this.aiBase, this.aiBarracks, ...this.bridges];
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
    this.rallyPoint = null;
    this.rallyMarker?.destroy();
    this.rallyMarker = null;
    if (this.rallyLine) { this.rallyLine.destroy(); this.rallyLine = null; }
    this.spawnCommandRipple(this.playerBarracks.x, this.playerBarracks.y, 0xaaaaaa);
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
      unit.selectionRing.setScale(1).setAlpha(1);
      unit.selectionTween = this.tweens.add({
        targets: unit.selectionRing,
        scaleX: 1.25, scaleY: 1.25, alpha: 0.45,
        yoyo: true, repeat: -1, duration: 600, ease: 'Sine.easeInOut',
      });
    }
  }

  private clearSelection() {
    for (const u of this.selectedUnits) {
      u.selected = false;
      if (u.selectionTween) {
        u.selectionTween.stop();
        u.selectionTween = null;
        u.selectionRing.setScale(1).setAlpha(1);
      }
    }
    this.selectedUnits = [];
  }

  // ── Train panel ──────────────────────────────────────────────────────────

  private selectPlayerBarracks() {
    this.clearSelection();
    this.selectedBuilding = this.playerBarracks;
  }

  private clearBuildingSelection() {
    this.selectedBuilding = null;
  }

  private trainUnit(type: 'worker' | 'soldier') {
    if (this.playerBarracks.hp <= 0) return;
    const cost = type === 'worker' ? CONFIG.WORKER_COST : CONFIG.SOLDIER_COST;
    if (this.playerGold < cost) return;
    this.playerGold -= cost;
    this.statsTrained += 1;
    const { x, y } = this.playerBarracks;
    const unit = this.spawnUnit('player', type, x + Phaser.Math.Between(-22, 22), y + Phaser.Math.Between(-22, 22));
    if (type === 'worker') this.assignWorkerToMine(unit);
    else this.assignSoldierInitialOrder(unit);
    playSfx(this, 'train', { volume: 0.7 });
  }

  // ── HUD bridge ───────────────────────────────────────────────────────────

  private handleHudCommand(c: HudCommand) {
    if (this.gameState !== 'running' && c.type !== 'restart') return;
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
      case 'build-cancel': this.cancelBuildMode(); break;
      case 'formation': this.formationLine(); break;
    }
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
    }));

    let selection: HudSelection;
    if (this.selectedBuilding) {
      const b = this.selectedBuilding;
      selection = {
        kind: 'building',
        building: { x: b.x, y: b.y, w: b.w, h: b.h, faction: b.faction, kind: b.kind, hp: b.hp, maxHp: b.maxHp },
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
        barracksHp: this.playerBarracks.hp, barracksMaxHp: this.playerBarracks.maxHp,
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
      stats: { trained: this.statsTrained, goldEarned: this.statsGoldEarned },
      gameSpeed: this.gameSpeed,
      alert: this.currentAlert ? { ...this.currentAlert } : null,
      buildMode: this.buildMode ? ({
        towerType: this.buildMode.towerType,
        cost: CONFIG.TOWER_TYPES[this.buildMode.towerType].cost,
        canAfford: this.playerGold >= CONFIG.TOWER_TYPES[this.buildMode.towerType].cost,
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

    const aiAll = this.units.filter(u => u.faction === 'ai' && !u.dead);
    const aiSoldiers = aiAll.filter(u => u.type === 'soldier');
    const aiWorkers = aiAll.filter(u => u.type === 'worker');
    const canTrain = this.aiBarracks.hp > 0;

    if (canTrain) {
      if (aiWorkers.length < CONFIG.AI_WORKER_TARGET && this.aiGold >= CONFIG.WORKER_COST) {
        this.aiGold -= CONFIG.WORKER_COST;
        const w = this.spawnUnit('ai', 'worker',
          this.aiBarracks.x + Phaser.Math.Between(-22, 22),
          this.aiBarracks.y + Phaser.Math.Between(-22, 22));
        this.assignWorkerToMine(w);
      } else if (this.aiGold >= CONFIG.SOLDIER_COST) {
        this.aiGold -= CONFIG.SOLDIER_COST;
        this.spawnUnit('ai', 'soldier',
          this.aiBarracks.x + Phaser.Math.Between(-22, 22),
          this.aiBarracks.y + Phaser.Math.Between(-22, 22));
      }
    }

    // Re-assign idle workers
    for (const w of aiWorkers.filter(u => u.state === 'idle')) {
      this.assignWorkerToMine(w);
    }

    // Attack når threshold nås. Av og til (15%) målretter AI en spillerside-bro
    // for å rive den og isolere spilleren. Gir AI samme strategiske valg som spilleren.
    if (aiSoldiers.length >= CONFIG.AI_AGGRESSION_THRESHOLD) {
      let attackTarget: BuildingData = this.playerBase;
      const liveBridges = this.bridges.filter(b => !b.dead && b.hp > 0);
      if (liveBridges.length > 0 && Math.random() < 0.15) {
        // Velg broen nærmest spillerens base (mest strategisk å ødelegge)
        let bestBridge = liveBridges[0];
        let bestDist = Phaser.Math.Distance.Between(bestBridge.x, bestBridge.y, this.playerBase.x, this.playerBase.y);
        for (let i = 1; i < liveBridges.length; i++) {
          const d = Phaser.Math.Distance.Between(liveBridges[i].x, liveBridges[i].y, this.playerBase.x, this.playerBase.y);
          if (d < bestDist) { bestBridge = liveBridges[i]; bestDist = d; }
        }
        attackTarget = bestBridge;
      }
      for (const s of aiSoldiers) {
        if (s.state !== 'attacking' || !s.attackTarget || s.attackTarget.hp <= 0) {
          s.attackTarget = attackTarget;
          s.state = 'attacking';
        }
      }
    }
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
    const pool = safe.length > 0 ? safe : fallback;
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

    const playerAll = this.units.filter(u => u.faction === 'player' && !u.dead);
    const playerSoldiers = playerAll.filter(u => u.type === 'soldier');
    const playerWorkers = playerAll.filter(u => u.type === 'worker');
    const canTrain = this.playerBarracks.hp > 0;

    if (canTrain) {
      if (playerWorkers.length < CONFIG.PLAYER_WORKER_TARGET && this.playerGold >= CONFIG.WORKER_COST) {
        this.playerGold -= CONFIG.WORKER_COST;
        const w = this.spawnUnit('player', 'worker',
          this.playerBarracks.x + Phaser.Math.Between(-22, 22),
          this.playerBarracks.y + Phaser.Math.Between(-22, 22));
        this.assignWorkerToMine(w);
      } else if (this.playerGold >= CONFIG.SOLDIER_COST) {
        this.playerGold -= CONFIG.SOLDIER_COST;
        const s = this.spawnUnit('player', 'soldier',
          this.playerBarracks.x + Phaser.Math.Between(-22, 22),
          this.playerBarracks.y + Phaser.Math.Between(-22, 22));
        this.assignSoldierInitialOrder(s);
      }
    }

    for (const w of playerWorkers.filter(u => u.state === 'idle')) {
      this.assignWorkerToMine(w);
    }

    // Threat: AI soldiers within 350px of player base
    const threats = this.units.filter(u =>
      u.faction === 'ai' && u.type === 'soldier' && !u.dead &&
      Phaser.Math.Distance.Between(u.x, u.y, this.playerBase.x, this.playerBase.y) < 350
    );

    if (threats.length > 0) {
      // Defenders = soldiers closest to base; rest become surplus that can press the attack
      // when we have ≥2× the threat count and at least the aggression threshold above defense need.
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
      if (surplus.length >= CONFIG.PLAYER_AGGRESSION_THRESHOLD) {
        for (const s of surplus) {
          const t = s.attackTarget;
          const hasLiveTarget = t !== null && t.hp > 0 && !('dead' in t && (t as UnitData).dead);
          if (!hasLiveTarget) { s.attackTarget = this.aiBase; s.state = 'attacking'; }
        }
      }
    } else if (playerSoldiers.length >= CONFIG.PLAYER_AGGRESSION_THRESHOLD) {
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
    const R = CONFIG.MINE_CONTEST_RADIUS;
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
      mine.control = playerNear && aiNear ? 'contested'
        : playerNear ? 'player'
        : aiNear ? 'ai'
        : null;

      // Oppdater ring-farge
      const ringColor = mine.control === 'player' ? 0x6ec8ff
        : mine.control === 'ai' ? 0xff7c5a
        : mine.control === 'contested' ? 0xff3333
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
    this.metricsEl.setAttribute('data-state', this.gameState);
    this.metricsEl.setAttribute('data-player-gold', String(this.playerGold));
    this.metricsEl.setAttribute('data-player-soldiers', String(ps));
    this.metricsEl.setAttribute('data-player-workers', String(pw));
    this.metricsEl.setAttribute('data-player-base-hp', String(Math.max(0, this.playerBase.hp)));
    this.metricsEl.setAttribute('data-ai-soldiers', String(as_));
    this.metricsEl.setAttribute('data-ai-base-hp', String(Math.max(0, this.aiBase.hp)));
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
    for (const u of this.units) {
      if (u.dead || u.faction !== 'ai' || u.type !== 'soldier') continue;
      const d = Phaser.Math.Distance.Between(u.x, u.y, bx, by);
      if (d < nearestDist) nearestDist = d;
    }
    if (nearestDist < radius) {
      // Trigger en gang (idempotent — bare ny triggeredAt hvis forrige er gått ut)
      const recentlyTriggered = this.currentAlert && time - this.currentAlert.triggeredAt < 3000;
      if (!recentlyTriggered) {
        this.currentAlert = {
          message: 'FIENDE NÆR!',
          urgency: 'critical',
          triggeredAt: time,
        };
      }
    } else if (this.currentAlert && time - this.currentAlert.triggeredAt > 3000) {
      this.currentAlert = null;
    }
  }

  // ── M1.5 — rally-pil tegnes som del av setRallyPoint ─────────────────────
}
