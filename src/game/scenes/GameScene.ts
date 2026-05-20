import Phaser from 'phaser';
import { CONFIG, THEME } from '../config';
import { VFXManager } from '../vfx';
import { hudBridge, type HudState, type HudCommand, type HudUnit, type HudBuilding, type HudSelection, type HudBuildMode, type HudWaveState, type TowerKind, type BuildKind } from '../hudBridge';
import { playSfx, LoopingSfx } from '../audio';
import { WaveManager } from '../WaveManager';

interface Vec2 { x: number; y: number; }

/** Lane som unit-instanser er bundet til. id = index i CONFIG.LANES. */
interface Lane {
  id: 0 | 1 | 2;
  y: number;
  halfHeight: number;
  label: string;
}

interface UnitData {
  id: number;
  faction: 'player' | 'ai';
  /** Beholdt som type-felt selv om kun 'soldier' brukes — gjør HUD-mapping enklere. */
  type: 'soldier';
  lane: 0 | 1 | 2;
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number; damage: number;
  attackRange: number; attackInterval: number; lastAttackAt: number;
  state: 'moving' | 'attacking' | 'idle';
  /** Mål-punkt (alltid på lane.y, motsatt ende av kartet) når soldat marsjerer. */
  moveTarget: Vec2 | null;
  attackTarget: UnitData | BuildingData | null;
  dead: boolean;
  /** Modifier-felt for boss/tank: 1.0 normalt, høyere = mer HP/damage. */
  tank: boolean;
  boss: boolean;
  container: Phaser.GameObjects.Container;
  antBody: Phaser.GameObjects.Container;
  segments: Phaser.GameObjects.Ellipse[];
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  radius: number;
  lastDx: number; lastDy: number;
  /** Webber-tower slow: time-skala halveres så lenge time < slowedUntil. */
  slowedUntil: number;
}

interface BuildingData {
  id: number;
  kind: 'base' | 'tower' | 'spawner';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Ellipse;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  dead?: boolean;
  invulnerable?: boolean;
  towerContainer?: Phaser.GameObjects.Container;
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

function isUnit(t: UnitData | BuildingData): t is UnitData {
  return 'container' in t;
}

function hpBarColor(pct: number): number {
  if (pct > 0.66) return THEME.HP_BAR_HIGH;
  if (pct > 0.33) return THEME.HP_BAR_MED;
  return THEME.HP_BAR_LOW;
}

type GameState = 'running' | 'won' | 'lost';

export class GameScene extends Phaser.Scene {
  private units: UnitData[] = [];
  private buildings: BuildingData[] = [];
  private towers: BuildingData[] = [];
  private playerBase!: BuildingData;
  private enemySpawners: BuildingData[] = [];   // 3 stk, én per lane
  private lanes: Lane[] = [];

  private playerGold = 0;
  private nextId = 1;

  private hudCommandUnsub: (() => void) | null = null;

  // Kamera-scroll
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyUp!: Phaser.Input.Keyboard.Key;
  private keyDown!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private mouseOverCanvas = false;
  private canvasMouseEnter: (() => void) | null = null;
  private canvasMouseLeave: (() => void) | null = null;

  private gameState: GameState = 'running';
  private gameTime = 0;
  private metricsEl: HTMLElement | null = null;
  private vfx!: VFXManager;
  private lastBaseShakeAt = 0;

  private gameSpeed: number = CONFIG.DEFAULT_TIME_SCALE;
  private prePauseSpeed: number = CONFIG.DEFAULT_TIME_SCALE;

  private currentAlert: { message: string; urgency: 'critical' | 'warn'; triggeredAt: number } | null = null;
  private baseAlarmLoop: LoopingSfx | null = null;

  private buildMode: {
    kind: TowerKind;
    ghostBody: Phaser.GameObjects.Graphics;
    ghostRange: Phaser.GameObjects.Graphics;
    valid: boolean;
  } | null = null;

  // Stats for game-over panel
  private statsSoldiersTrained = 0;
  private statsEnemyKills = 0;
  private statsUnitsLost = 0;
  private statsGoldEarned = 0;

  private waveManager!: WaveManager;
  private wavesCleared = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Reset all per-scene state
    this.units = [];
    this.buildings = [];
    this.towers = [];
    this.enemySpawners = [];
    this.lanes = [];
    this.playerGold = CONFIG.STARTING_GOLD;
    this.nextId = 1;
    this.gameState = 'running';
    this.gameTime = 0;
    this.gameSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.prePauseSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.currentAlert = null;
    this.buildMode = null;
    this.statsSoldiersTrained = 0;
    this.statsEnemyKills = 0;
    this.statsUnitsLost = 0;
    this.statsGoldEarned = 0;
    this.wavesCleared = false;
    if (this.hudCommandUnsub) { this.hudCommandUnsub(); this.hudCommandUnsub = null; }

    const W = CONFIG.MAP_WIDTH;
    const H = CONFIG.MAP_HEIGHT;

    // ── Bakgrunn (gress + dekor) ─────────────────────────────────────────
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(
      THEME.GRASS_COLOR_TOP, THEME.GRASS_COLOR_TOP,
      THEME.GRASS_COLOR_BOTTOM, THEME.GRASS_COLOR_BOTTOM, 1,
    );
    bg.fillRect(0, 0, W, H);

    const noise = this.add.graphics().setDepth(0);
    for (let i = 0; i < 260; i++) {
      const nx = Phaser.Math.Between(0, W);
      const ny = Phaser.Math.Between(0, H);
      const nr = Phaser.Math.FloatBetween(0.5, 1.8);
      noise.fillStyle(THEME.NOISE_TINT, Phaser.Math.FloatBetween(0.04, 0.1));
      noise.fillCircle(nx, ny, nr);
    }

    const blades = this.add.graphics().setDepth(0);
    for (let i = 0; i < 320; i++) {
      const bx = Phaser.Math.Between(0, W);
      const by = Phaser.Math.Between(0, H);
      const len = Phaser.Math.Between(4, 9);
      const tilt = Phaser.Math.FloatBetween(-1.5, 1.5);
      const color = Math.random() < 0.5 ? THEME.GRASS_BLADE_COLOR : THEME.GRASS_BLADE_DARK;
      blades.lineStyle(1, color, Phaser.Math.FloatBetween(0.35, 0.7));
      blades.lineBetween(bx, by, bx + tilt, by - len);
    }

    for (let i = 0; i < 28; i++) {
      const px = Phaser.Math.Between(30, W - 30);
      const py = Phaser.Math.Between(30, H - 30);
      const pw = Phaser.Math.Between(4, 7);
      const ph = Phaser.Math.Between(3, 5);
      const pc = THEME.PEBBLE_COLORS[i % THEME.PEBBLE_COLORS.length];
      this.add.ellipse(px + 1, py + 1.5, pw, ph, 0x000000, 0.35).setDepth(0);
      this.add.ellipse(px, py, pw, ph, pc).setDepth(0);
      this.add.ellipse(px - pw * 0.2, py - ph * 0.25, pw * 0.45, ph * 0.4, 0xffffff, 0.18).setDepth(0);
    }

    // ── Lanes ────────────────────────────────────────────────────────────
    this.lanes = CONFIG.LANES.map(l => ({ id: l.id, y: l.y, halfHeight: l.halfHeight, label: l.label }));
    this.renderLanes();

    // ── Player-base (vest) ───────────────────────────────────────────────
    this.playerBase = this.createBase('player', CONFIG.PLAYER_BASE_X, H / 2);

    // ── Fiende-spawnere (øst, én per lane) ──────────────────────────────
    for (const lane of this.lanes) {
      const sp = this.createSpawner('ai', CONFIG.ENEMY_SPAWN_X, lane.y);
      this.enemySpawners.push(sp);
    }

    // ── Input ────────────────────────────────────────────────────────────
    this.hudCommandUnsub = hudBridge.onCommand((c) => this.handleHudCommand(c));

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);

    // Svelg den aller første SPACE som når GameScene. MenuScene starter spillet
    // via SPACE/Enter; hvis spilleren trykker Space-Space (start + vane), ville
    // andre Space ellers umiddelbart pause det nyoppstartede spillet. Bruker en
    // tidsterskel på 1500ms i tillegg så bare det første "vane-trykket" svelges,
    // ikke et bevisst pause-trykk gjort senere.
    let firstSpaceSwallowed = false;
    const sceneStartWall = Date.now();
    this.input.keyboard?.on('keydown-SPACE', (e: KeyboardEvent) => {
      e.preventDefault();
      if (!firstSpaceSwallowed && Date.now() - sceneStartWall < 1500) {
        firstSpaceSwallowed = true;
        return;
      }
      firstSpaceSwallowed = true;
      this.togglePause();
    });
    this.input.keyboard?.on('keydown-ESC', () => {
      if (this.buildMode) this.cancelBuildMode();
    });
    this.input.keyboard?.on('keydown-PLUS',          () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-NUMPAD_ADD',    () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-EQUALS',        () => this.cycleSpeed(+1));
    this.input.keyboard?.on('keydown-MINUS',         () => this.cycleSpeed(-1));
    this.input.keyboard?.on('keydown-NUMPAD_SUBTRACT', () => this.cycleSpeed(-1));

    // Tårn-bygg og lane-soldater eies nå av HUD-en (LaneCommandStack).
    // Scene har bare Esc=cancel-build (registrert lenger opp) som backup.

    // Klar-knapp (skip prep)
    this.input.keyboard?.on('keydown-G', () => this.waveManager.skipPrep());

    // WASD + piltaster
    this.keyW     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyA     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyS     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyD     = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyUp    = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.UP);
    this.keyDown  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN);
    this.keyLeft  = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);

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

    this.cameras.main.setBounds(0, 0, W, H);
    // Sentrér på player-base og litt østover — viewport viser basen og det første
    // angreps-vinduet før spilleren må panorere mot fiende-spawnere i øst.
    this.cameras.main.centerOn(CONFIG.PLAYER_BASE_X + 480, H / 2);

    // Timers — passiv income + metrics
    this.time.addEvent({ delay: CONFIG.MINE_TICK_INTERVAL, callback: this.passiveIncomeTick, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 500, callback: this.updateMetrics, callbackScope: this, loop: true });

    this.metricsEl = document.getElementById('game-metrics');

    this.vfx = new VFXManager(this);

    this.baseAlarmLoop = new LoopingSfx(this, 'base-alarm', 0.55);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.baseAlarmLoop?.stop();
      this.baseAlarmLoop = null;
    });

    // WaveManager — leverer spawn-requests; vi mapper det til spawnCreep()
    this.waveManager = new WaveManager((req) => this.spawnCreep(req.lane, req.tank, req.boss));

    this.applyCameraFX();
  }

  // ── Lane rendering ─────────────────────────────────────────────────────

  private renderLanes() {
    const W = CONFIG.MAP_WIDTH;
    const g = this.add.graphics().setDepth(1);
    for (const lane of this.lanes) {
      // Jordveg-bånd langs lanen — kraftigere kontrast mot gresset så lanen leses som "vei".
      g.fillStyle(0x5a4226, 0.7);
      g.fillRect(0, lane.y - lane.halfHeight, W, lane.halfHeight * 2);
      // Lysere kant inn mot midten av lanen (gradient-illusjon i to lag)
      g.fillStyle(0x6b5230, 0.35);
      g.fillRect(0, lane.y - lane.halfHeight * 0.85, W, lane.halfHeight * 1.7);
      // Lane-grenser — markante mørke kanter
      g.lineStyle(3, 0x1a0f06, 0.85);
      g.lineBetween(0, lane.y - lane.halfHeight, W, lane.y - lane.halfHeight);
      g.lineBetween(0, lane.y + lane.halfHeight, W, lane.y + lane.halfHeight);
      // Indre highlight-linje langs lane-kanten (subtilt lys ovenfra)
      g.lineStyle(1, 0xddcc88, 0.25);
      g.lineBetween(0, lane.y - lane.halfHeight + 2, W, lane.y - lane.halfHeight + 2);
      // Senterlinje — stiplet, tydeligere
      g.lineStyle(1.5, 0xeed588, 0.32);
      for (let x = 20; x < W; x += 50) {
        g.lineBetween(x, lane.y, x + 24, lane.y);
      }

      // Retnings-piler langs lanen — peker fra player-base (vest) mot fiende-spawner (øst).
      // Plasseres mellom basen og spawneren med jevne mellomrom så spilleren leser
      // "soldater går denne veien".
      const arrowStartX = CONFIG.PLAYER_BASE_X + 280;
      const arrowEndX = CONFIG.ENEMY_SPAWN_X - 280;
      const arrowSpacing = 320;
      for (let ax = arrowStartX; ax < arrowEndX; ax += arrowSpacing) {
        this.drawLaneArrow(g, ax, lane.y, 1);   // grønn pil — player-retning
      }
      // Speil: røde piler fra øst peker mot vest (creep-retning) — tegnet litt forskjøvet
      // så de ikke overlapper de grønne.
      for (let ax = arrowStartX + arrowSpacing / 2; ax < arrowEndX; ax += arrowSpacing) {
        this.drawLaneArrow(g, ax, lane.y, -1);   // rød pil — creep-retning
      }

      // Lane-etikett — i vest-kanten, vertikalt sentrert i lane-bandet, slik at den
      // ikke overlapper med player-basen midt i lanen.
      this.add.text(28, lane.y, lane.label, {
        fontFamily: 'sans-serif',
        fontSize: '22px',
        color: '#ffeaa0',
        fontStyle: 'bold',
      }).setOrigin(0, 0.5).setDepth(2).setAlpha(0.9).setShadow(0, 2, '#000', 4, true, true);
    }
  }

  /** Tegner en chevron-pil på lane-senterlinje. dir=1 peker øst, dir=-1 peker vest. */
  private drawLaneArrow(g: Phaser.GameObjects.Graphics, x: number, y: number, dir: 1 | -1) {
    const len = 22;
    const wing = 12;
    const color = dir === 1 ? 0x88dd66 : 0xee6644;
    g.lineStyle(3, color, 0.45);
    // Chevron: to streker som møtes i tuppen (x + dir*len/2)
    g.beginPath();
    g.moveTo(x - dir * len / 2, y - wing);
    g.lineTo(x + dir * len / 2, y);
    g.lineTo(x - dir * len / 2, y + wing);
    g.strokePath();
  }

  private applyCameraFX() {
    const cam = this.cameras.main;
    if (!this.renderer || this.renderer.type !== Phaser.WEBGL) return;
    (cam as unknown as { postFX?: { clear: () => void } }).postFX?.clear();
    Phaser.Actions.AddEffectBloom(cam, {
      threshold: THEME.FX_BLOOM_THRESHOLD,
      blurRadius: THEME.FX_BLOOM_BLUR_RADIUS,
      blurSteps: THEME.FX_BLOOM_BLUR_STEPS,
      blurQuality: THEME.FX_BLOOM_BLUR_QUALITY,
      blendAmount: THEME.FX_BLOOM_BLEND_AMOUNT,
    });
  }

  // ── Factories ──────────────────────────────────────────────────────────

  private createBase(faction: 'player', x: number, y: number): BuildingData {
    const w = 90, h = 110;
    const R = Math.max(w, h) * 0.65;
    const color = THEME.BASE_COLOR_PLAYER;
    const rim = THEME.BASE_RIM_PLAYER;
    const highlight = THEME.BASE_HIGHLIGHT_PLAYER;
    const grainPalette = THEME.SOIL_GRAIN_PLAYER;

    // Shadow
    this.add.ellipse(x + 3, y + R * 0.42, R * 2.15, R * 0.55, 0x000000, 0.45).setDepth(2);

    // Forstyrret jord-ring
    const ringClumps = 22;
    for (let i = 0; i < ringClumps; i++) {
      const a = (i / ringClumps) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const r = R * Phaser.Math.FloatBetween(1.02, 1.28);
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const cs = Phaser.Math.FloatBetween(4, 8);
      this.add.ellipse(cx, cy, cs * 1.4, cs, THEME.DISTURBED_SOIL_PLAYER, 0.85).setDepth(2);
    }

    // Hovedhaug (konsentriske sirkler for 3D-effekt)
    this.add.circle(x, y, R, rim).setDepth(3);
    this.add.circle(x - 2, y - 2, R * 0.94, color).setDepth(3);
    this.add.circle(x - R * 0.18, y - R * 0.22, R * 0.55, highlight, 0.55).setDepth(3);

    // Granulat
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 0.88;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const gc = grainPalette[Phaser.Math.Between(0, grainPalette.length - 1)];
      this.add.circle(cx, cy, Phaser.Math.FloatBetween(0.8, 1.6), gc, 0.85).setDepth(3);
    }

    // Entré-hull (svart)
    this.add.ellipse(x, y + R * 0.05, R * 0.42, R * 0.32, THEME.BASE_ENTRANCE_COLOR).setDepth(4);
    this.add.ellipse(x, y - R * 0.04, R * 0.4, R * 0.16, 0x000000, 0.85).setDepth(4);

    // Hit-test ellipse + HP-bar
    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(3);
    const hpBg = this.add.rectangle(x, y - h / 2 - 10, 60, 6, 0x222222).setDepth(8);
    const hpFg = this.add.rectangle(x - 30, y - h / 2 - 10, 60, 6, 0x66bb44).setOrigin(0, 0.5).setDepth(8);

    const b: BuildingData = {
      id: this.nextId++, kind: 'base', faction,
      x, y, w, h,
      hp: CONFIG.BASE_HP, maxHp: CONFIG.BASE_HP,
      body, bodyColor: color, hpBg, hpFg,
    };
    this.buildings.push(b);
    return b;
  }

  /** Visuell fiende-spawner (én per lane, øst på kartet). Invulnerable. */
  private createSpawner(faction: 'ai', x: number, y: number): BuildingData {
    const w = 70, h = 90;
    const R = 50;
    const color = THEME.BASE_COLOR_AI;
    const rim = THEME.BASE_RIM_AI;
    const highlight = THEME.BASE_HIGHLIGHT_AI;

    this.add.ellipse(x + 3, y + R * 0.4, R * 2, R * 0.5, 0x000000, 0.4).setDepth(2);
    this.add.circle(x, y, R, rim).setDepth(3);
    this.add.circle(x - 2, y - 2, R * 0.93, color).setDepth(3);
    this.add.circle(x - R * 0.2, y - R * 0.22, R * 0.5, highlight, 0.55).setDepth(3);

    // Granulat
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 0.85;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const gc = THEME.SOIL_GRAIN_AI[Phaser.Math.Between(0, THEME.SOIL_GRAIN_AI.length - 1)];
      this.add.circle(cx, cy, Phaser.Math.FloatBetween(0.8, 1.5), gc, 0.85).setDepth(3);
    }
    // Entré
    this.add.ellipse(x, y + R * 0.04, R * 0.45, R * 0.28, THEME.BASE_ENTRANCE_COLOR).setDepth(4);
    // Liten "fare"-markør (subtil rød pulse)
    const warn = this.add.circle(x, y, R * 1.18, 0xaa3322, 0.0).setDepth(2);
    this.tweens.add({
      targets: warn,
      fillAlpha: 0.15,
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(3);
    const hpBg = this.add.rectangle(x, y - h / 2 - 10, 48, 4, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 24, y - h / 2 - 10, 48, 4, 0xff5544).setOrigin(0, 0.5).setDepth(8).setVisible(false);

    return {
      id: this.nextId++, kind: 'spawner', faction,
      x, y, w, h,
      hp: 1, maxHp: 1,
      body, bodyColor: color, hpBg, hpFg,
      invulnerable: true,
    };
  }

  private createTower(type: TowerKind, x: number, y: number): BuildingData {
    const spec = CONFIG.TOWER_TYPES[type];
    const w = 36, h = 44;

    const shadow = this.add.ellipse(2, h * 0.42, w * 1.1, h * 0.28, 0x000000, 0.45);
    const base = this.add.ellipse(0, h * 0.18, w, h * 0.45, 0x6a5a3a).setStrokeStyle(1.5, 0x2a1f12, 0.85);
    const shaft = this.add.rectangle(0, -h * 0.05, w * 0.55, h * 0.55, 0x8a7a52).setStrokeStyle(1.2, 0x3a2a18, 0.85);
    const top = this.add.circle(0, -h * 0.35, w * 0.42, spec.color).setStrokeStyle(1.4, 0x1a1208, 1);
    const muzzle = this.add.triangle(0, -h * 0.55, -3, 0, 3, 0, 0, -7, spec.color).setStrokeStyle(1, 0x1a1208, 0.85);

    const container = this.add.container(x, y, [shadow, base, shaft, top, muzzle]).setDepth(4);
    const body = this.add.ellipse(x, y, w, h, 0x000000, 0).setDepth(4);
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
    this.buildings.push(b);
    this.towers.push(b);
    return b;
  }

  // ── Soldat / creep spawn ──────────────────────────────────────────────

  /** Spilleren sender én soldat i en gitt lane. Trekker gull og spawner. */
  private sendLaneSoldier(lane: 0 | 1 | 2) {
    if (this.gameState !== 'running') return;
    if (this.playerGold < CONFIG.LANE_SOLDIER_COST) {
      this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Mangler mat', '#ee5544');
      return;
    }
    this.playerGold -= CONFIG.LANE_SOLDIER_COST;
    const laneCfg = this.lanes[lane];
    const sx = this.playerBase.x + 50;
    const sy = laneCfg.y + Phaser.Math.FloatBetween(-12, 12);
    const unit = this.spawnUnit('player', lane, sx, sy, false, false);
    unit.moveTarget = { x: CONFIG.ENEMY_SPAWN_X - 50, y: laneCfg.y };
    unit.state = 'moving';
    this.statsSoldiersTrained++;
    playSfx(this, 'train', { volume: 0.45 });
    this.spawnCommandRipple(sx, sy, 0xddff88);
  }

  /** WaveManager kaller denne for hver creep i en bølge. */
  private spawnCreep(lane: 0 | 1 | 2, tank: boolean, boss: boolean) {
    const laneCfg = this.lanes[lane];
    const sx = CONFIG.ENEMY_SPAWN_X - 50;
    const sy = laneCfg.y + Phaser.Math.FloatBetween(-12, 12);
    const unit = this.spawnUnit('ai', lane, sx, sy, tank, boss);
    unit.moveTarget = { x: CONFIG.PLAYER_BASE_X + 50, y: laneCfg.y };
    unit.state = 'moving';
  }

  private spawnUnit(
    faction: 'player' | 'ai',
    lane: 0 | 1 | 2,
    x: number, y: number,
    tank: boolean,
    boss: boolean,
  ): UnitData {
    const isPlayer = faction === 'player';
    const bodyColor = isPlayer ? THEME.PLAYER_SOLDIER_COLOR : THEME.AI_SOLDIER_COLOR;
    const legColor = isPlayer ? THEME.ANT_LEG_COLOR_PLAYER : THEME.ANT_LEG_COLOR_AI;
    const headHighlight = isPlayer ? THEME.ANT_HEAD_HIGHLIGHT_PLAYER : THEME.ANT_HEAD_HIGHLIGHT_AI;
    const mandibleColor = isPlayer ? THEME.ANT_MANDIBLE_COLOR_PLAYER : THEME.ANT_MANDIBLE_COLOR_AI;

    // Ant-proporsjoner. Tank/boss-multipliere skaler hele body opp.
    const scale = boss ? 1.6 : tank ? 1.25 : 1.0;
    const dims = {
      abdW: 13, abdH: 9, abdX: -7, thW: 7, thH: 6,
      hdW: 9, hdH: 8, hdX: 7, legLen: 8, antLen: 7, mandLen: 5,
    };
    const r = 13;

    const footprint = this.add.ellipse(0, r * 0.45, r * 2.0, r * 0.6, bodyColor, 0.22);
    const shadow = this.add.ellipse(2, r * 0.35, r * 1.7, r * 0.6, 0x000000, 0.42);
    const antBody = this.add.container(0, 0);

    const legs = this.add.graphics();
    legs.lineStyle(1.4, legColor, 0.95);
    const drawLegPair = (rootX: number, tipX: number, sign: number) => {
      const rootY = sign * dims.thH * 0.4;
      const tipY = sign * (dims.thH * 0.4 + dims.legLen);
      const kneeX = (rootX + tipX) / 2 + sign * 0.5;
      const kneeY = sign * (dims.thH * 0.4 + dims.legLen * 0.5);
      legs.beginPath();
      legs.moveTo(rootX, rootY);
      legs.lineTo(kneeX, kneeY);
      legs.lineTo(tipX, tipY);
      legs.strokePath();
    };
    const legFrontX = dims.thW * 0.35;
    const legMidX = 0;
    const legRearX = -dims.thW * 0.35;
    drawLegPair(legFrontX, legFrontX + dims.legLen * 0.5, -1);
    drawLegPair(legMidX, legMidX, -1);
    drawLegPair(legRearX, legRearX - dims.legLen * 0.5, -1);
    drawLegPair(legFrontX, legFrontX + dims.legLen * 0.5, 1);
    drawLegPair(legMidX, legMidX, 1);
    drawLegPair(legRearX, legRearX - dims.legLen * 0.5, 1);

    const abdomen = this.add.ellipse(dims.abdX, 0, dims.abdW, dims.abdH, bodyColor);
    const thorax = this.add.ellipse(0, 0, dims.thW, dims.thH, bodyColor);
    const head = this.add.ellipse(dims.hdX, 0, dims.hdW, dims.hdH, bodyColor);
    const headSheen = this.add.ellipse(dims.hdX - 0.5, -dims.hdH * 0.15, dims.hdW * 0.55, dims.hdH * 0.45, headHighlight, 0.7);
    abdomen.setStrokeStyle(0.8, 0x000000, 0.7);
    thorax.setStrokeStyle(0.8, 0x000000, 0.7);
    head.setStrokeStyle(0.8, 0x000000, 0.7);

    const appendages = this.add.graphics();
    appendages.lineStyle(1, legColor, 1);
    const antRootX = dims.hdX + dims.hdW * 0.35;
    appendages.lineBetween(antRootX, -dims.hdH * 0.2, antRootX + dims.antLen * 0.9, -dims.hdH * 0.2 - dims.antLen * 0.7);
    appendages.lineBetween(antRootX, dims.hdH * 0.2,  antRootX + dims.antLen * 0.9,  dims.hdH * 0.2 + dims.antLen * 0.7);
    appendages.lineStyle(1.6, mandibleColor, 1);
    const mRootX = dims.hdX + dims.hdW * 0.45;
    appendages.lineBetween(mRootX, -dims.hdH * 0.15, mRootX + dims.mandLen, -dims.hdH * 0.45);
    appendages.lineBetween(mRootX,  dims.hdH * 0.15, mRootX + dims.mandLen,  dims.hdH * 0.45);

    antBody.add([legs, abdomen, thorax, head, headSheen, appendages]);
    antBody.setScale(scale);

    const hpBg = this.add.rectangle(0, -r * scale - 7, r * 2 + 2, 6, 0x2a1810).setStrokeStyle(1, 0x000000, 0.95);
    const hpFg = this.add.rectangle(-r, -r * scale - 7, r * 2, 4, 0x8cd95a).setOrigin(0, 0.5);
    hpBg.setVisible(false);
    hpFg.setVisible(false);

    const container = this.add.container(x, y, [footprint, shadow, antBody, hpBg, hpFg]).setDepth(5);

    const hpMul = boss ? 5 : tank ? 2.2 : 1;
    const dmgMul = boss ? 2.5 : tank ? 1.6 : 1;
    const speedMul = boss ? 0.6 : tank ? 0.75 : 1;

    const unit: UnitData = {
      id: this.nextId++, faction, type: 'soldier', lane,
      x, y,
      hp: CONFIG.SOLDIER_HP * hpMul, maxHp: CONFIG.SOLDIER_HP * hpMul,
      speed: CONFIG.SOLDIER_SPEED * speedMul,
      damage: CONFIG.SOLDIER_DAMAGE * dmgMul,
      attackRange: CONFIG.SOLDIER_ATTACK_RANGE,
      attackInterval: CONFIG.SOLDIER_ATTACK_SPEED,
      lastAttackAt: 0,
      state: 'idle', moveTarget: null, attackTarget: null,
      dead: false, tank, boss,
      container, antBody,
      segments: [abdomen, thorax, head],
      bodyColor, hpBg, hpFg,
      radius: r * scale,
      lastDx: isPlayer ? 1 : -1, lastDy: 0,
      slowedUntil: 0,
    };
    this.units.push(unit);
    return unit;
  }

  private removeUnit(unit: UnitData, killedByPlayer: boolean) {
    unit.dead = true;
    if (unit.faction === 'player') {
      this.statsUnitsLost++;
    } else if (killedByPlayer) {
      this.statsEnemyKills++;
      this.playerGold += CONFIG.KILL_GOLD * (unit.boss ? 5 : unit.tank ? 2 : 1);
      this.statsGoldEarned += CONFIG.KILL_GOLD;
      this.vfx.floatText(unit.x, unit.y - 18, `+${CONFIG.KILL_GOLD * (unit.boss ? 5 : unit.tank ? 2 : 1)}`, '#ddff88');
    }
    this.units = this.units.filter(u => u !== unit);
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

  // ── Hovedløkke ─────────────────────────────────────────────────────────

  update(time: number, delta: number) {
    if (this.gameState !== 'running') return;

    const rawDt = delta / 1000;
    this.updateCameraScroll(rawDt);

    if (this.gameSpeed === 0) {
      this.emitHudState();
      return;
    }

    const dt = rawDt * this.gameSpeed;
    const scaledDeltaMs = delta * this.gameSpeed;
    this.gameTime += dt;

    for (const unit of [...this.units]) {
      if (!unit.dead) this.updateUnit(unit, time, dt);
    }

    this.updateTowers(time);

    // Wave-manager
    const aiAlive = this.units.filter(u => u.faction === 'ai' && !u.dead).length;
    const prevPhase = this.waveManager.currentPhase;
    const victory = this.waveManager.tick(scaledDeltaMs, aiAlive);

    // Alarm når en ny wave starter
    if (prevPhase === 'prep' && this.waveManager.currentPhase === 'spawning') {
      this.currentAlert = {
        message: `BØLGE ${this.waveManager.displayWave} STARTER!`,
        urgency: 'critical',
        triggeredAt: time,
      };
      playSfx(this, 'base-alarm', { volume: 0.5 });
    }

    if (victory) {
      this.wavesCleared = true;
      this.endGame('won');
      return;
    }

    if (this.playerBase.hp <= 0) {
      this.endGame('lost');
      return;
    }

    // Base-alarm når egen base under 50 % HP
    if (this.baseAlarmLoop) {
      const pct = this.playerBase.hp / this.playerBase.maxHp;
      if (pct < 0.5) this.baseAlarmLoop.start();
      else this.baseAlarmLoop.stop();
    }

    // Decay alert etter 3s
    if (this.currentAlert && time - this.currentAlert.triggeredAt > 3000) {
      this.currentAlert = null;
    }

    // Building HP bars
    for (const b of this.buildings) {
      if (b.invulnerable) continue;
      const pct = Math.max(0, b.hp / b.maxHp);
      b.hpFg.setDisplaySize(60 * pct, 6);
      b.hpFg.setFillStyle(hpBarColor(pct));
      const showBar = b.hp < b.maxHp && b.hp > 0;
      b.hpBg.setVisible(showBar);
      b.hpFg.setVisible(showBar);
    }

    this.emitHudState();
  }

  // ── Unit logic ─────────────────────────────────────────────────────────

  private updateUnit(unit: UnitData, time: number, dt: number) {
    unit.container.setPosition(unit.x, unit.y);

    // Idle-bob
    const bob = Math.sin((time + unit.id * 137) * 0.004) * 1.0;
    unit.antBody.y = bob;
    unit.antBody.rotation = Math.atan2(unit.lastDy, unit.lastDx);

    // HP bar
    const hurt = unit.hp < unit.maxHp;
    unit.hpBg.setVisible(hurt);
    unit.hpFg.setVisible(hurt);
    const pct = unit.hp / unit.maxHp;
    const barW = 24;
    unit.hpFg.setDisplaySize(Math.max(0, barW * pct), 4);
    unit.hpFg.setFillStyle(hpBarColor(pct));

    // Stale attack target?
    if (unit.attackTarget) {
      const t = unit.attackTarget;
      const dead = isUnit(t) ? t.dead : (t.dead ?? false);
      if (dead || t.hp <= 0) {
        unit.attackTarget = null;
        if (unit.state === 'attacking') unit.state = 'idle';
      }
    }

    // Engage: finn fiende i samme lane
    if (unit.state !== 'attacking') {
      this.findLaneEngagement(unit);
    }

    switch (unit.state) {
      case 'attacking':
        this.updateAttacking(unit, time, dt);
        break;
      case 'moving':
        if (unit.moveTarget) {
          this.moveAlongLane(unit, dt);
        } else {
          unit.state = 'idle';
        }
        break;
      case 'idle':
        // Soldater i idle holder seg på lane og venter på fiender
        break;
    }
  }

  /** Soldat marsjerer langs sin lane mot moveTarget. Y-aksen klampes til lane-bånd. */
  private moveAlongLane(unit: UnitData, dt: number) {
    const target = unit.moveTarget!;
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      unit.moveTarget = null;
      unit.state = 'idle';
      // Hvis fiende-creep har nådd basen — gjør skade og dø
      if (unit.faction === 'ai') {
        this.creepReachedBase(unit);
      }
      return;
    }
    const slowed = this.time.now < unit.slowedUntil;
    const speed = unit.speed * (slowed ? 0.5 : 1);
    const step = speed * dt;
    const nx = dx / dist;
    const ny = dy / dist;
    unit.x += nx * step;
    unit.y += ny * step;
    // Klamp til lane-bånd så enheter aldri forlater lanen
    const lane = this.lanes[unit.lane];
    const minY = lane.y - lane.halfHeight + 6;
    const maxY = lane.y + lane.halfHeight - 6;
    if (unit.y < minY) unit.y = minY;
    if (unit.y > maxY) unit.y = maxY;
    unit.lastDx = nx;
    unit.lastDy = ny;
  }

  /** Finn nærmeste fiende-unit eller -base i samme lane innenfor attack-range. */
  private findLaneEngagement(unit: UnitData) {
    const enemyFaction = unit.faction === 'player' ? 'ai' : 'player';
    let best: UnitData | BuildingData | null = null;
    let bestDist = unit.attackRange + 80;  // søk litt utenfor range, beveg seg dit

    for (const other of this.units) {
      if (other.dead || other.faction !== enemyFaction) continue;
      if (other.lane !== unit.lane) continue;
      const d = Phaser.Math.Distance.Between(unit.x, unit.y, other.x, other.y);
      if (d < bestDist) { best = other; bestDist = d; }
    }

    // Player-soldater kan også angripe en spawner hvis de når den. Spawner er invulnerable
    // — så vi ikke targeter dem her. Player-base er fienders endemål (creepReachedBase
    // håndterer skade når de når dit).

    if (best) {
      unit.attackTarget = best;
      unit.state = 'attacking';
    }
  }

  private updateAttacking(unit: UnitData, time: number, dt: number) {
    const target = unit.attackTarget!;
    const dist = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);

    if (dist > unit.attackRange) {
      // Beveg deg mot target, men hold lane-y
      const lane = this.lanes[unit.lane];
      const slowed = this.time.now < unit.slowedUntil;
      const speed = unit.speed * (slowed ? 0.5 : 1);
      const step = speed * dt;
      const dx = target.x - unit.x;
      const d = Math.hypot(dx, target.y - unit.y) || 1;
      const nx = dx / d;
      const ny = (target.y - unit.y) / d;
      unit.x += nx * step;
      unit.y += ny * step;
      const minY = lane.y - lane.halfHeight + 6;
      const maxY = lane.y + lane.halfHeight - 6;
      if (unit.y < minY) unit.y = minY;
      if (unit.y > maxY) unit.y = maxY;
      unit.lastDx = nx; unit.lastDy = ny;
    } else if (time - unit.lastAttackAt >= unit.attackInterval) {
      unit.lastAttackAt = time;

      // Face target
      const fdx = target.x - unit.x; const fdy = target.y - unit.y; const fd = Math.hypot(fdx, fdy) || 1;
      unit.lastDx = fdx / fd; unit.lastDy = fdy / fd;

      const projColor = unit.faction === 'player' ? THEME.ATTACK_PROJECTILE_PLAYER : THEME.ATTACK_PROJECTILE_AI;
      this.vfx.fireProjectile(unit.x, unit.y, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);
      playSfx(this, 'attack', { volume: 0.16 });

      if (!isUnit(target) && target.invulnerable) {
        unit.attackTarget = null;
        unit.state = 'idle';
        return;
      }

      target.hp -= unit.damage;

      // Flash white
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

      if (!isUnit(target) && target === this.playerBase) {
        if (time - this.lastBaseShakeAt > 150) {
          this.cameras.main.shake(120, 0.003);
          this.lastBaseShakeAt = time;
        }
      }

      if (target.hp <= 0) {
        if (isUnit(target)) {
          playSfx(this, 'unit-die', { volume: 0.3 });
          this.removeUnit(target, unit.faction === 'player');
        } else {
          // Player-base destroyed — endGame håndteres i update()
        }
        unit.attackTarget = null;
        unit.state = 'idle';
      }
    }
  }

  /** Creep har nådd player-basen — påfør skade og dø. */
  private creepReachedBase(creep: UnitData) {
    this.playerBase.hp -= creep.damage * 3;   // creeps gjør ekstra skade når de når basen
    this.cameras.main.shake(180, 0.005);
    this.vfx.impact(this.playerBase.x, this.playerBase.y);
    playSfx(this, 'attack', { volume: 0.3 });
    this.removeUnit(creep, false);
  }

  // ── Towers ─────────────────────────────────────────────────────────────

  private updateTowers(time: number) {
    for (const tower of this.towers) {
      if (tower.dead || tower.hp <= 0 || !tower.tower) continue;
      const t = tower.tower;
      if (time - t.lastFireAt < t.fireRate) continue;

      // Tårn skyter på AI (creeps)
      let target: UnitData | null = null;
      let bestDist = t.range;
      for (const u of this.units) {
        if (u.dead || u.faction !== 'ai') continue;
        const d = Phaser.Math.Distance.Between(tower.x, tower.y, u.x, u.y);
        if (d < bestDist) { target = u; bestDist = d; }
      }
      if (!target) continue;

      t.lastFireAt = time;
      const projColor = t.type === 'spitter' ? 0x8acc6a
        : t.type === 'webber' ? 0xc8c8e8
        : THEME.ATTACK_PROJECTILE_PLAYER;
      this.vfx.fireProjectile(tower.x, tower.y - 14, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);
      playSfx(this, 'attack', { volume: 0.14 });

      this.applyTowerHit(target, t.damage, t.slow, time);

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
    for (const s of target.segments) s.setFillStyle(0xffffff);
    this.time.delayedCall(80, () => {
      if (!target.dead) for (const s of target.segments) s.setFillStyle(target.bodyColor);
    });
    if (target.hp <= 0) {
      playSfx(this, 'unit-die', { volume: 0.3 });
      this.removeUnit(target, true);
    }
  }

  // ── Tower build mode ───────────────────────────────────────────────────

  private isTowerKind(kind: BuildKind): kind is TowerKind {
    return kind === 'stinger' || kind === 'webber' || kind === 'spitter';
  }

  private startBuildMode(kind: TowerKind) {
    if (this.gameState !== 'running') return;
    this.cancelBuildMode();
    const ghostBody = this.add.graphics().setDepth(24);
    const ghostRange = this.add.graphics().setDepth(23);
    this.buildMode = { kind, ghostBody, ghostRange, valid: false };
  }

  private cancelBuildMode() {
    if (!this.buildMode) return;
    this.buildMode.ghostBody.destroy();
    this.buildMode.ghostRange.destroy();
    this.buildMode = null;
  }

  /** Er punktet inne i et lane-bånd? Brukes for tower-placement-blokk. */
  private isInsideAnyLane(y: number): boolean {
    for (const lane of this.lanes) {
      if (Math.abs(y - lane.y) <= lane.halfHeight) return true;
    }
    return false;
  }

  private canPlaceTower(kind: TowerKind, x: number, y: number): boolean {
    if (this.gameState !== 'running') return false;
    // Innenfor kartet
    if (x < 60 || x > CONFIG.MAP_WIDTH - 60 || y < 40 || y > CONFIG.MAP_HEIGHT - 40) return false;
    // Ikke i en lane
    if (this.isInsideAnyLane(y)) return false;
    // Ikke for nær player-base (la basen være fri)
    if (Phaser.Math.Distance.Between(x, y, this.playerBase.x, this.playerBase.y) < 70) return false;
    // Ikke på fiende-spawner
    for (const sp of this.enemySpawners) {
      if (Phaser.Math.Distance.Between(x, y, sp.x, sp.y) < 70) return false;
    }
    // Klaring til andre bygninger
    const c = CONFIG.TOWER_PLACE_CLEARANCE;
    for (const b of this.buildings) {
      if (b.dead || b.hp <= 0) continue;
      if (b.kind === 'base' || b.kind === 'spawner') continue;
      if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < c) return false;
    }
    // Bekreft type-spesifikk eksistens (avoid TS narrowing concern)
    void kind;
    return true;
  }

  private updateBuildGhost(w: Vec2) {
    if (!this.buildMode) return;
    const kind = this.buildMode.kind;
    const spec = CONFIG.TOWER_TYPES[kind];
    const ok = this.canPlaceTower(kind, w.x, w.y) && this.playerGold >= spec.cost;
    this.buildMode.valid = ok;
    const color = ok ? 0x66dd66 : 0xee5544;

    const g = this.buildMode.ghostBody;
    g.clear();
    g.lineStyle(2, color, 0.95);
    g.fillStyle(color, 0.18);
    g.fillRect(w.x - 18, w.y - 22, 36, 44);
    g.strokeRect(w.x - 18, w.y - 22, 36, 44);
    g.fillStyle(spec.color, 0.55);
    g.fillCircle(w.x, w.y - 8, 14);

    const rg = this.buildMode.ghostRange;
    rg.clear();
    rg.lineStyle(1.5, color, 0.55);
    rg.strokeCircle(w.x, w.y, spec.range);
  }

  private placeTower(w: Vec2): boolean {
    if (!this.buildMode) return false;
    const kind = this.buildMode.kind;
    const spec = CONFIG.TOWER_TYPES[kind];
    if (!this.canPlaceTower(kind, w.x, w.y) || this.playerGold < spec.cost) return false;
    this.playerGold -= spec.cost;
    this.createTower(kind, w.x, w.y);
    this.spawnCommandRipple(w.x, w.y, 0xddff88);
    playSfx(this, 'train', { volume: 0.5 });
    return true;
  }

  private spawnCommandRipple(x: number, y: number, color: number) {
    const ring = this.add.circle(x, y, 6, 0x000000, 0).setStrokeStyle(2, color, 0.9).setDepth(20);
    this.tweens.add({
      targets: ring,
      radius: 30,
      alpha: 0,
      duration: 420,
      ease: 'Cubic.easeOut',
      onUpdate: (_t, tgt) => {
        const c = tgt as Phaser.GameObjects.Arc;
        c.setStrokeStyle(2, color, c.alpha);
      },
      onComplete: () => ring.destroy(),
    });
  }

  // ── Økonomi ────────────────────────────────────────────────────────────

  private passiveIncomeTick() {
    if (this.gameState !== 'running') return;
    if (this.gameSpeed === 0) return;
    this.playerGold += CONFIG.PASSIVE_INCOME_PER_TICK;
    this.statsGoldEarned += CONFIG.PASSIVE_INCOME_PER_TICK;
  }

  // ── Input ──────────────────────────────────────────────────────────────

  private updateCameraScroll(dt: number) {
    const cam = this.cameras.main;
    const speed = CONFIG.CAMERA_SCROLL_SPEED * dt;
    let dx = 0, dy = 0;

    if (this.keyW?.isDown || this.keyUp?.isDown)       dy -= 1;
    if (this.keyS?.isDown || this.keyDown?.isDown)     dy += 1;
    if (this.keyA?.isDown || this.keyLeft?.isDown)     dx -= 1;
    if (this.keyD?.isDown || this.keyRight?.isDown)    dx += 1;

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
      const len = Math.hypot(dx, dy);
      cam.scrollX += (dx / len) * speed;
      cam.scrollY += (dy / len) * speed;
    }
  }

  private wp(pointer: Phaser.Input.Pointer): Vec2 {
    const v = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: v.x, y: v.y };
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.buildMode) {
      if (pointer.rightButtonDown()) {
        this.cancelBuildMode();
      } else {
        const placed = this.placeTower(this.wp(pointer));
        if (placed && !pointer.event.shiftKey) this.cancelBuildMode();
      }
      return;
    }
    // Ingen unit-selection lenger — alt skjer via HUD-knapper og hotkeys.
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.buildMode) {
      this.updateBuildGhost(this.wp(pointer));
    }
  }

  // ── Pause / speed ──────────────────────────────────────────────────────

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

  private cycleSpeed(direction: 1 | -1) {
    if (this.gameState !== 'running') return;
    const scales = [...CONFIG.TIME_SCALES] as number[];
    const cur = this.gameSpeed === 0 ? this.prePauseSpeed : this.gameSpeed;
    const idx = scales.indexOf(cur);
    let nxt = idx + direction;
    if (nxt < 0) nxt = 0;
    if (nxt >= scales.length) nxt = scales.length - 1;
    this.gameSpeed = scales[nxt];
    this.prePauseSpeed = this.gameSpeed;
    this.applyGameSpeed();
  }

  // ── HUD-broen ──────────────────────────────────────────────────────────

  private handleHudCommand(c: HudCommand) {
    switch (c.type) {
      case 'send-lane':
        this.sendLaneSoldier(c.lane);
        break;
      case 'wave-ready':
        this.waveManager.skipPrep();
        break;
      case 'build-tower-start':
        this.startBuildMode(c.tower);
        break;
      case 'build-start':
        if (this.isTowerKind(c.kind)) this.startBuildMode(c.kind);
        break;
      case 'build-cancel':
        this.cancelBuildMode();
        break;
      case 'toggle-pause':
        this.togglePause();
        break;
      case 'cycle-speed':
        this.cycleSpeed(+1);
        break;
      case 'restart':
        this.scene.restart();
        break;
      case 'to-menu':
        this.scene.start('MenuScene');
        break;
      case 'minimap-pan':
        this.cameras.main.centerOn(c.x, c.y);
        break;
      case 'minimap-attack':
        this.cameras.main.centerOn(c.x, c.y);
        break;
      // Ignorerte (RTS-arv, ikke aktuelle i TD)
      case 'train':
      case 'select-all-soldiers':
      case 'select-all-workers':
      case 'clear-selection':
      case 'formation':
      case 'upgrade-base-defense':
        break;
    }
  }

  private emitHudState() {
    const players = this.units.filter((u) => u.faction === 'player' && !u.dead);
    const ais = this.units.filter((u) => u.faction === 'ai' && !u.dead);

    const minimapUnits: HudUnit[] = this.units
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.x, y: u.y, faction: u.faction, type: 'soldier' as const }));
    const minimapBuildings: HudBuilding[] = this.buildings.map((b) => ({
      x: b.x, y: b.y, w: b.w, h: b.h,
      faction: b.faction,
      kind: b.kind === 'spawner' ? 'base' : (b.kind === 'tower' ? 'tower' : 'base'),
      hp: b.hp, maxHp: b.maxHp,
      towerType: b.kind === 'tower' && b.tower ? b.tower.type : undefined,
    }));

    const selection: HudSelection = { kind: 'none' };

    const nextDef = this.waveManager.nextWaveDef;
    const waveMode: HudWaveState = {
      current: this.waveManager.displayWave,
      total: this.waveManager.totalWaves,
      nextInMs: this.waveManager.prepRemainingMs,
      active: this.waveManager.currentPhase === 'spawning' || this.waveManager.currentPhase === 'mopUp',
      preparing: this.waveManager.isPreparing,
      prepRemainingMs: this.waveManager.prepRemainingMs,
      nextWavePreview: nextDef ? { soldiers: nextDef.soldiers, lane: nextDef.lane, tank: nextDef.tank, boss: nextDef.boss } : undefined,
      remainingEnemies: ais.length + this.waveManager.remainingInWave,
    };

    const s: HudState = {
      state: this.gameState,
      time: this.gameTime,
      player: {
        gold: this.playerGold,
        workers: 0,
        soldiers: players.length,
        baseHp: this.playerBase.hp, baseMaxHp: this.playerBase.maxHp,
        barracksHp: 0, barracksMaxHp: 0,
      },
      enemy: {
        gold: 0,
        workers: 0,
        soldiers: ais.length,
        baseHp: 0, baseMaxHp: 0,
      },
      costs: { worker: CONFIG.LANE_SOLDIER_COST, soldier: CONFIG.LANE_SOLDIER_COST },
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
        trained: this.statsSoldiersTrained,
        goldEarned: this.statsGoldEarned,
        soldiersTrained: this.statsSoldiersTrained,
        workersTrained: 0,
        enemyKills: this.statsEnemyKills,
        unitsLost: this.statsUnitsLost,
        peakMines: 0,
        aiTowers: 0,
        playerTowers: this.towers.filter(t => !t.dead && t.hp > 0).length,
      },
      gameSpeed: this.gameSpeed,
      alert: this.currentAlert ? { ...this.currentAlert } : null,
      buildMode: this.buildMode ? ({
        kind: this.buildMode.kind,
        cost: CONFIG.TOWER_TYPES[this.buildMode.kind].cost,
        canAfford: this.playerGold >= CONFIG.TOWER_TYPES[this.buildMode.kind].cost,
      } satisfies HudBuildMode) : null,
      waveMode,
    };
    hudBridge.emitState(s);
  }

  private updateMetrics() {
    if (!this.metricsEl) return;
    const ps = this.units.filter(u => u.faction === 'player').length;
    const as_ = this.units.filter(u => u.faction === 'ai').length;
    const playerTowers = this.towers.filter(t => !t.dead && t.hp > 0).length;
    this.metricsEl.setAttribute('data-state', this.gameState);
    this.metricsEl.setAttribute('data-player-gold', String(this.playerGold));
    this.metricsEl.setAttribute('data-player-soldiers', String(ps));
    this.metricsEl.setAttribute('data-player-workers', '0');
    this.metricsEl.setAttribute('data-player-base-hp', String(Math.max(0, this.playerBase.hp)));
    this.metricsEl.setAttribute('data-player-towers', String(playerTowers));
    this.metricsEl.setAttribute('data-ai-soldiers', String(as_));
    this.metricsEl.setAttribute('data-ai-base-hp', '0');
    this.metricsEl.setAttribute('data-ai-towers', '0');
    this.metricsEl.setAttribute('data-game-time', String(Math.floor(this.gameTime)));
    this.metricsEl.setAttribute('data-current-wave', String(this.waveManager?.displayWave ?? 0));
    this.metricsEl.setAttribute('data-waves-cleared', String(this.wavesCleared ? 1 : 0));
    this.metricsEl.setAttribute('data-total-waves', String(CONFIG.WAVE_MODE.waves.length));
  }

  private endGame(result: 'won' | 'lost') {
    this.gameState = result;
    if (this.gameSpeed === 0) this.gameSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.applyGameSpeed();
    this.baseAlarmLoop?.stop();
    playSfx(this, result === 'won' ? 'victory' : 'defeat', { volume: 0.9 });
    this.updateMetrics();
    this.emitHudState();

    const tints = result === 'won'
      ? [0xffd700, 0xffe680, 0xffaa22]
      : [0x444444, 0x222222, 0x665555];
    this.vfx.victoryRain(CONFIG.MAP_WIDTH, tints);

    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
  }
}
