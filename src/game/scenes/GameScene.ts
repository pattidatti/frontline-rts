import Phaser from 'phaser';
import { CONFIG, THEME } from '../config';
import { VFXManager } from '../vfx';

interface Vec2 { x: number; y: number; }

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
}

interface BuildingData {
  id: number;
  kind: 'base' | 'barracks' | 'mine';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Ellipse;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  dead?: boolean;
}

type MineData = BuildingData & { kind: 'mine'; faction: 'neutral' };

function isUnit(t: UnitData | BuildingData): t is UnitData {
  return 'container' in t;
}

type GameState = 'running' | 'won' | 'lost';

export class GameScene extends Phaser.Scene {
  private units: UnitData[] = [];
  private buildings: BuildingData[] = [];
  private mines: MineData[] = [];
  private playerBase!: BuildingData;
  private aiBase!: BuildingData;
  private playerBarracks!: BuildingData;
  private aiBarracks!: BuildingData;

  private playerGold = 0;
  private aiGold = 0;
  private nextId = 1;

  private selectedUnits: UnitData[] = [];
  private pointerIsDown = false;
  private dragStart: Vec2 = { x: 0, y: 0 };
  private isDragging = false;
  private dragRect!: Phaser.GameObjects.Rectangle;

  private goldText!: Phaser.GameObjects.Text;
  private selectionText!: Phaser.GameObjects.Text;
  private hoverGfx!: Phaser.GameObjects.Graphics;
  private trainPanel: Phaser.GameObjects.Container | null = null;
  private trainPanelBounds: Phaser.Geom.Rectangle | null = null;
  private trainButtons: { btn: Phaser.GameObjects.Text; cost: number; baseLabel: string; key: string }[] = [];

  private gameState: GameState = 'running';
  private gameTime = 0;
  private metricsEl: HTMLElement | null = null;
  private vfx!: VFXManager;
  private lastBaseShakeAt = 0;
  private statsTrained = 0;
  private statsGoldEarned = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
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

    // Vignette — subtle darkening at edges
    const vignette = this.add.graphics().setDepth(0);
    vignette.fillStyle(0x000000, 0.32);
    vignette.fillRect(0, 0, W, 60);
    vignette.fillRect(0, H - 60, W, 60);
    vignette.fillRect(0, 0, 60, H);
    vignette.fillRect(W - 60, 0, 60, H);

    // Drag selection box (tan/sand for ant theme)
    this.dragRect = this.add.rectangle(0, 0, 1, 1, 0xddcc88, 0.15)
      .setStrokeStyle(1, 0xddcc88, 0.85)
      .setOrigin(0, 0)
      .setVisible(false)
      .setDepth(20);

    // Mines
    this.createMine(400, 180);
    this.createMine(880, 540);

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

    // HUD
    this.goldText = this.add.text(12, 12, '', {
      fontSize: '16px', color: '#f5dc6e', fontFamily: 'monospace',
    }).setDepth(25);

    this.selectionText = this.add.text(12, 34, '', {
      fontSize: '13px', color: '#cfe3a3', fontFamily: 'monospace',
    }).setDepth(25);

    this.add.text(W - 12, H - 8, 'Klikk larvekammer eller Q/E  ·  Høyreklikk = kommando  ·  Esc rydder', {
      fontSize: '12px', color: '#d8c896', fontFamily: 'monospace',
    }).setOrigin(1, 1).setDepth(25);

    // Hover-indikator (tegnes på nytt i onPointerMove)
    this.hoverGfx = this.add.graphics().setDepth(22);

    // Input
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    // Tastatur
    this.input.keyboard?.on('keydown-Q', () => this.trainUnit('worker'));
    this.input.keyboard?.on('keydown-E', () => this.trainUnit('soldier'));
    this.input.keyboard?.on('keydown-ESC', () => {
      this.closeTrainPanel();
      this.clearSelection();
    });

    // Timers
    this.time.addEvent({ delay: CONFIG.MINE_TICK_INTERVAL, callback: this.mineTick, callbackScope: this, loop: true });
    this.time.addEvent({ delay: CONFIG.AI_DECISION_INTERVAL, callback: this.aiDecision, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 500, callback: this.updateMetrics, callbackScope: this, loop: true });
    if (CONFIG.DEMO_MODE) {
      this.time.addEvent({ delay: CONFIG.PLAYER_DECISION_INTERVAL, callback: this.playerDecision, callbackScope: this, loop: true });
    }

    // DOM metrics bridge
    this.metricsEl = document.getElementById('game-metrics');

    // VFX manager (must be created after BootScene generated the spark texture)
    this.vfx = new VFXManager(this);
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

    // Maurtue tegnes som en bred jordklump (ellipse) sett ovenfra.
    // Bredde og høyde fra w/h beholdes for hit-detection (mode bygg-firkant), men selve grafikken
    // er en oval dome som ser mer organisk ut.
    const domeW = w * 1.4;
    const domeH = h * 1.15;

    // Drop shadow under tuen
    this.add.ellipse(x + 3, y + domeH * 0.45, domeW * 0.95, domeH * 0.4, 0x000000, 0.45).setDepth(1);

    // Ytre rim (mørkere, danner kantvoll rundt inngangen)
    this.add.ellipse(x, y, domeW * 1.05, domeH * 1.05, rim).setDepth(2).setAlpha(0.9);

    // Hovedkropp — denne sporer damage/tint (tracked som body)
    const body = this.add.ellipse(x, y, domeW, domeH, color).setDepth(3);

    // Topp-highlight (lysere brun klump på toppen av dommen)
    this.add.ellipse(x - domeW * 0.15, y - domeH * 0.25, domeW * 0.7, domeH * 0.5, highlight, 0.7).setDepth(4);

    // Subtil tekstur — små mørke flekker som antyder jordklumper
    for (let i = 0; i < 8; i++) {
      const dx = Phaser.Math.FloatBetween(-domeW * 0.35, domeW * 0.35);
      const dy = Phaser.Math.FloatBetween(-domeH * 0.3, domeH * 0.3);
      const ds = Phaser.Math.FloatBetween(1.5, 2.8);
      this.add.ellipse(x + dx, y + dy, ds * 1.3, ds, rim, 0.4).setDepth(4);
    }

    // Inngangshull — peker mot midten av kartet
    const entranceDir = x < CONFIG.MAP_WIDTH / 2 ? 1 : -1;
    const entranceX = x + entranceDir * domeW * 0.28;
    const entranceY = y + domeH * 0.1;
    if (kind === 'base') {
      // Stort tunell-inngang
      this.add.ellipse(entranceX, entranceY, domeW * 0.32, domeH * 0.32, THEME.BASE_ENTRANCE_COLOR).setDepth(5);
      this.add.ellipse(entranceX, entranceY - 1, domeW * 0.28, domeH * 0.18, 0x000000, 0.6).setDepth(5);
    } else if (kind === 'barracks') {
      // Mindre inngang + synlige hvite egg som ligger på toppen
      this.add.ellipse(entranceX, entranceY, domeW * 0.22, domeH * 0.22, THEME.BASE_ENTRANCE_COLOR).setDepth(5);
      // 3 egg på toppen av kammeret
      const eggBaseX = x - domeW * 0.12;
      const eggBaseY = y - domeH * 0.2;
      for (let i = 0; i < 3; i++) {
        const ex = eggBaseX + i * (domeW * 0.12);
        const ey = eggBaseY + (i % 2 === 1 ? 2 : 0);
        this.add.ellipse(ex + 0.5, ey + 1, 6.5, 4, 0x000000, 0.35).setDepth(5);
        this.add.ellipse(ex, ey, 6, 3.5, THEME.BARRACKS_EGG_COLOR).setDepth(6);
        this.add.ellipse(ex - 1, ey - 0.5, 2.5, 1.4, 0xffffff, 0.5).setDepth(7);
      }
    }

    const hpBg = this.add.rectangle(x, y - domeH * 0.55 - 7, 44, 5, 0x222222).setDepth(8).setVisible(false);
    const hpFg = this.add.rectangle(x - 22, y - domeH * 0.55 - 7, 44, 5, 0x44ee44)
      .setOrigin(0, 0.5).setDepth(8).setVisible(false);

    const b: BuildingData = { id: this.nextId++, kind, faction, x, y, w, h, hp, maxHp: hp, body, bodyColor: color, hpBg, hpFg };
    this.buildings.push(b);
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

    const mine: MineData = {
      id: this.nextId++, kind: 'mine', faction: 'neutral',
      x, y, w: leafW, h: leafH,
      hp: 9999, maxHp: 9999, body, bodyColor: THEME.APHID_LEAF_COLOR, hpBg, hpFg,
    };
    this.buildings.push(mine);
    this.mines.push(mine);
    return mine;
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
    this.gameTime += delta / 1000;
    const dt = delta / 1000;

    for (const unit of [...this.units]) {
      if (!unit.dead) this.updateUnit(unit, time, dt);
    }

    if (this.playerBase.hp <= 0) { this.endGame('lost'); return; }
    if (this.aiBase.hp <= 0) { this.endGame('won'); return; }

    // Building HP bars — only shown when damaged (and not neutral mines, not dead)
    for (const b of this.buildings) {
      const pct = Math.max(0, b.hp / b.maxHp);
      b.hpFg.setDisplaySize(44 * pct, 5);
      const showBar = b.kind !== 'mine' && b.hp < b.maxHp && b.hp > 0;
      b.hpBg.setVisible(showBar);
      b.hpFg.setVisible(showBar);
    }

    // HUD
    const ps = this.units.filter(u => u.faction === 'player' && u.type === 'soldier').length;
    const pw = this.units.filter(u => u.faction === 'player' && u.type === 'worker').length;
    const as_ = this.units.filter(u => u.faction === 'ai' && u.type === 'soldier').length;
    this.goldText.setText(
      `Mat ${this.playerGold}  ·  Sold ${ps}  ·  Arb ${pw}        Fiende: ${this.aiGold} mat / ${as_} sold`
    );

    const sel = this.selectedUnits;
    if (sel.length === 0) {
      this.selectionText.setText('');
    } else {
      const ss = sel.filter(u => u.type === 'soldier').length;
      const sw = sel.filter(u => u.type === 'worker').length;
      const parts: string[] = [];
      if (ss > 0) parts.push(`${ss} soldat${ss === 1 ? '' : 'er'}`);
      if (sw > 0) parts.push(`${sw} arbeider${sw === 1 ? '' : 'e'}`);
      this.selectionText.setText(`Valgt: ${parts.join(', ')}`);
    }

    if (this.trainPanel) this.refreshTrainButtons();
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
    unit.hpFg.setDisplaySize(Math.max(0, maxW * (unit.hp / unit.maxHp)), 4);

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
    this.cameras.main.shake(220, 0.005);
    this.vfx.dust(b.x, b.y, 14);
    this.tweens.add({
      targets: b.body,
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

  private moveToward(unit: UnitData, target: Vec2, dt: number): boolean {
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 6) return true;
    const nx = dx / dist;
    const ny = dy / dist;
    unit.lastDx = nx; unit.lastDy = ny;
    const step = Math.min(unit.speed * dt, dist);
    unit.x += nx * step;
    unit.y += ny * step;
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
        unit.x += (dx / dist) * push;
        unit.y += (dy / dist) * push;
      }
    }
    unit.x = Phaser.Math.Clamp(unit.x, 20, CONFIG.MAP_WIDTH - 20);
    unit.y = Phaser.Math.Clamp(unit.y, 20, CONFIG.MAP_HEIGHT - 20);
  }

  // ── Input handling ───────────────────────────────────────────────────────

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (pointer.rightButtonDown()) {
      this.handleRightClick(pointer);
      return;
    }

    // If train panel is open and click is within its bounds, let panel buttons handle it
    if (this.trainPanelBounds?.contains(pointer.x, pointer.y)) return;

    // Close train panel on any other click
    this.closeTrainPanel();

    // Click on player barracks → open train panel
    if (this.hitBuilding(pointer, this.playerBarracks) && this.playerBarracks.hp > 0) {
      this.showTrainPanel();
      return;
    }

    // Click on player unit → select
    const clickedUnit = this.hitUnit(pointer, 'player');
    if (clickedUnit) {
      if (!pointer.event.shiftKey) this.clearSelection();
      this.selectUnit(clickedUnit);
      return;
    }

    // Start drag-select
    this.clearSelection();
    this.pointerIsDown = true;
    this.dragStart = { x: pointer.x, y: pointer.y };
    this.isDragging = false;
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.pointerIsDown) {
      const dx = pointer.x - this.dragStart.x;
      const dy = pointer.y - this.dragStart.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
        this.isDragging = true;
        const minX = Math.min(pointer.x, this.dragStart.x);
        const minY = Math.min(pointer.y, this.dragStart.y);
        this.dragRect.setPosition(minX, minY).setSize(Math.abs(dx), Math.abs(dy)).setVisible(true);
      }
      this.hoverGfx.clear();
      return;
    }
    this.updateHover(pointer);
  }

  private updateHover(pointer: Phaser.Input.Pointer) {
    this.hoverGfx.clear();

    // Egen enhet → hvit ring (select-hint)
    const own = this.hitUnit(pointer, 'player');
    if (own) {
      this.hoverGfx.lineStyle(2, 0xffffff, 0.9);
      this.hoverGfx.strokeCircle(own.x, own.y, own.radius + 4);
      this.input.setDefaultCursor('pointer');
      return;
    }

    // Fiende-enhet → rød ring (attack-hint, krever utvalg)
    const foe = this.hitUnit(pointer, 'ai');
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
      if (b.hp > 0 && this.hitBuilding(pointer, b)) {
        this.hoverGfx.lineStyle(2, tint, 0.9);
        this.hoverGfx.strokeRect(b.x - b.w / 2 - 4, b.y - b.h / 2 - 4, b.w + 8, b.h + 8);
        this.input.setDefaultCursor(cur === 'pointer' ? 'pointer' : 'default');
        return;
      }
    }
    for (const m of this.mines) {
      if (Math.abs(pointer.x - m.x) < m.w / 2 + 6 && Math.abs(pointer.y - m.y) < m.h / 2 + 6) {
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
      const minX = Math.min(pointer.x, this.dragStart.x);
      const minY = Math.min(pointer.y, this.dragStart.y);
      const maxX = Math.max(pointer.x, this.dragStart.x);
      const maxY = Math.max(pointer.y, this.dragStart.y);
      for (const u of this.units) {
        if (u.faction === 'player' && !u.dead && u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
          this.selectUnit(u);
        }
      }
    }

    this.dragRect.setVisible(false);
    this.isDragging = false;
  }

  private handleRightClick(pointer: Phaser.Input.Pointer) {
    if (this.selectedUnits.length === 0) return;

    // Assign workers to mine
    for (const mine of this.mines) {
      if (Math.abs(pointer.x - mine.x) < mine.w / 2 + 6 && Math.abs(pointer.y - mine.y) < mine.h / 2 + 6) {
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
    const enemyUnit = this.hitUnit(pointer, 'ai');
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

    // Attack enemy building
    for (const b of [this.aiBase, this.aiBarracks]) {
      if (b.hp > 0 && Math.abs(pointer.x - b.x) < b.w / 2 + 6 && Math.abs(pointer.y - b.y) < b.h / 2 + 6) {
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
      u.moveTarget = { x: pointer.x + offset.x, y: pointer.y + offset.y };
    });
    this.spawnCommandRipple(pointer.x, pointer.y, 0x88ddff);
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

  private hitUnit(pointer: Phaser.Input.Pointer, faction: 'player' | 'ai'): UnitData | null {
    for (const u of this.units) {
      if (u.faction !== faction || u.dead) continue;
      if (Phaser.Math.Distance.Between(pointer.x, pointer.y, u.x, u.y) < 16) return u;
    }
    return null;
  }

  private hitBuilding(pointer: Phaser.Input.Pointer, b: BuildingData): boolean {
    return Math.abs(pointer.x - b.x) < b.w / 2 + 5 && Math.abs(pointer.y - b.y) < b.h / 2 + 5;
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

  private showTrainPanel() {
    this.closeTrainPanel();

    const { x, y, h } = this.playerBarracks;
    const px = x + 100;
    const py = y - h / 2 - 5;
    const pw = 200; const ph = 72;

    const bg = this.add.rectangle(0, 0, pw, ph, 0x2a1f12, 0.96)
      .setStrokeStyle(1, 0xb8945a, 1);

    const title = this.add.text(0, -ph / 2 + 9, 'TREN MAUR', {
      fontSize: '11px', color: '#d8c896', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    this.trainButtons = [];
    const makeBtn = (baseLabel: string, key: string, cost: number, yOff: number, cb: () => void) => {
      const btn = this.add.text(-pw / 2 + 12, yOff, '', {
        fontSize: '13px', color: '#e6d8a6', fontFamily: 'monospace',
      }).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => {
        if (this.playerGold >= cost) btn.setColor('#ffffff');
      });
      btn.on('pointerout', () => this.refreshTrainButtons());
      btn.on('pointerdown', (p: Phaser.Input.Pointer) => { p.event.stopPropagation(); cb(); });
      this.trainButtons.push({ btn, cost, baseLabel, key });
      return btn;
    };

    const wBtn = makeBtn('Arbeider', 'Q', CONFIG.WORKER_COST, -10, () => this.trainUnit('worker'));
    const sBtn = makeBtn('Soldat',   'E', CONFIG.SOLDIER_COST, 14, () => this.trainUnit('soldier'));

    this.trainPanel = this.add.container(px, py, [bg, title, wBtn, sBtn]).setDepth(30);
    this.trainPanelBounds = new Phaser.Geom.Rectangle(px - pw / 2, py - ph / 2, pw, ph);
    this.refreshTrainButtons();
  }

  private refreshTrainButtons() {
    for (const { btn, cost, baseLabel, key } of this.trainButtons) {
      const canAfford = this.playerGold >= cost;
      btn.setText(`[${key}] ${baseLabel.padEnd(9)} ${cost} mat`);
      btn.setColor(canAfford ? '#e6d8a6' : '#6a5a3a');
      btn.setAlpha(canAfford ? 1 : 0.6);
    }
  }

  private closeTrainPanel() {
    this.trainPanel?.destroy();
    this.trainPanel = null;
    this.trainPanelBounds = null;
    this.trainButtons = [];
  }

  private trainUnit(type: 'worker' | 'soldier') {
    if (this.playerBarracks.hp <= 0) return;
    const cost = type === 'worker' ? CONFIG.WORKER_COST : CONFIG.SOLDIER_COST;
    if (this.playerGold < cost) return;
    this.playerGold -= cost;
    this.statsTrained += 1;
    const { x, y } = this.playerBarracks;
    this.spawnUnit('player', type, x + Phaser.Math.Between(-22, 22), y + Phaser.Math.Between(-22, 22));
    if (this.trainPanel) this.refreshTrainButtons();
  }

  // ── AI ───────────────────────────────────────────────────────────────────

  private aiDecision() {
    if (this.gameState !== 'running') return;

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

    // Attack when threshold met
    if (aiSoldiers.length >= CONFIG.AI_AGGRESSION_THRESHOLD) {
      for (const s of aiSoldiers) {
        if (s.state !== 'attacking' || !s.attackTarget || s.attackTarget.hp <= 0) {
          s.attackTarget = this.playerBase;
          s.state = 'attacking';
        }
      }
    }
  }

  private assignWorkerToMine(worker: UnitData) {
    const mine = this.nearestMine(worker);
    if (!mine) return;
    worker.mineTarget = mine;
    worker.state = 'moving';
    worker.moveTarget = { x: mine.x, y: mine.y };
  }

  private nearestMine(pos: Vec2): MineData | null {
    let best: MineData | null = null;
    let bestDist = Infinity;
    for (const m of this.mines) {
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
        this.spawnUnit('player', 'soldier',
          this.playerBarracks.x + Phaser.Math.Between(-22, 22),
          this.playerBarracks.y + Phaser.Math.Between(-22, 22));
      }
    }

    for (const w of playerWorkers.filter(u => u.state === 'idle')) {
      this.assignWorkerToMine(w);
    }

    if (playerSoldiers.length >= CONFIG.PLAYER_AGGRESSION_THRESHOLD) {
      for (const s of playerSoldiers) {
        if (s.state !== 'attacking' || !s.attackTarget || s.attackTarget.hp <= 0) {
          s.attackTarget = this.aiBase;
          s.state = 'attacking';
        }
      }
    }
  }

  // ── Timers & metrics ─────────────────────────────────────────────────────

  private mineTick() {
    if (this.gameState !== 'running') return;
    for (const mine of this.mines) {
      const miners = this.units.filter(u => u.mineTarget === mine && u.state === 'mining' && !u.dead);
      if (miners.length === 0) continue;

      // One floating "+N" per mine per tick, summed across miners, colored by majority faction
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
    this.updateMetrics();
    const W = CONFIG.MAP_WIDTH; const H = CONFIG.MAP_HEIGHT;

    // Fade-in dark overlay
    const overlay = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0).setDepth(50);
    this.tweens.add({ targets: overlay, fillAlpha: 0.7, duration: 350 });

    // Title with scale-bounce
    const titleColor = result === 'won' ? '#ffe080' : '#ff5544';
    const title = this.add.text(W / 2, H / 2 - 60, result === 'won' ? 'SEIER' : 'TAPT', {
      fontSize: '80px', color: titleColor,
      fontFamily: 'monospace', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(51).setScale(0.2).setAlpha(0);

    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 600,
      ease: 'Back.easeOut',
      delay: 150,
    });

    // Stats line
    const mins = Math.floor(this.gameTime / 60);
    const secs = Math.floor(this.gameTime % 60);
    const timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
    const stats = this.add.text(
      W / 2, H / 2 + 30,
      `Maur trent: ${this.statsTrained}    Mat samlet: ${this.statsGoldEarned}    Tid: ${timeStr}`,
      { fontSize: '16px', color: '#d8c896', fontFamily: 'monospace' },
    ).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: stats, alpha: 1, duration: 500, delay: 600 });

    // Restart hint
    const hint = this.add.text(W / 2, H / 2 + 70, 'Trykk  R  for å starte på nytt', {
      fontSize: '20px', color: '#a89878', fontFamily: 'monospace',
    }).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: hint, alpha: 1, duration: 500, delay: 800 });

    // Particle rain (gold for victory, ash for defeat)
    const tints = result === 'won'
      ? [0xffd700, 0xffe680, 0xffaa22]
      : [0x444444, 0x222222, 0x665555];
    this.vfx.victoryRain(W, tints);

    this.input.keyboard?.on('keydown-R', () => this.scene.restart());
    if (CONFIG.DEMO_MODE) {
      this.time.delayedCall(2000, () => this.scene.restart());
    }
  }
}
