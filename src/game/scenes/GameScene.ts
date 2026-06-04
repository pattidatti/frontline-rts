import Phaser from 'phaser';
import { CONFIG, THEME, type UnitKind } from '../config';
import { VFXManager } from '../vfx';
import { WildlifeManager } from '../wildlife';
import { hudBridge, type HudState, type HudCommand, type HudUnit, type HudBuilding, type HudWaveState, type HudBuildMode, type TowerKind, type BuildKind, type HudLanePortal, type HudUpgradeChoice } from '../hudBridge';
import { playSfx, LoopingSfx } from '../audio';
import { WaveManager } from '../WaveManager';
import { buildLane, type LaneGeometry, type LanesAll, isOnLaneOrArena } from '../lanes';
import { defaultModifiers, pickThreeUpgrades, findUpgrade, type UpgradeModifiers, type UpgradeDef, type UpgradeId } from '../upgrades';

interface Vec2 { x: number; y: number; }

interface UnitData {
  id: number;
  faction: 'player' | 'ai';
  kind: UnitKind;
  lane: 0 | 1 | 2;
  /** Posisjon langs sin lane (0 = vest-arena, 1 = øst-arena). */
  laneT: number;
  /** Marsj-retning langs lane (+1 = øst, -1 = vest). */
  laneDir: 1 | -1;
  x: number; y: number;
  hp: number; maxHp: number;
  speed: number; damage: number;
  attackRange: number; attackInterval: number; lastAttackAt: number;
  bounty: number;
  state: 'moving' | 'attacking' | 'idle';
  attackTarget: UnitData | BuildingData | null;
  dead: boolean;
  boss: boolean;
  container: Phaser.GameObjects.Container;
  antBody: Phaser.GameObjects.Container;
  segments: Phaser.GameObjects.Ellipse[];
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  radius: number;
  lastDx: number; lastDy: number;
  slowedUntil: number;
  /** Har enheten gjort sitt første angrep? (For Embuskemaur-effekten.) */
  firstAttackDone: boolean;
  /** Tidsstempel for siste fotavtrykk-puff (ms, scene.time.now). */
  lastFootprintAt: number;
  /** Web-overlay vist når enheten er slowed; fjernes når slow utløper. */
  webOverlay: Phaser.GameObjects.Graphics | null;
}

interface BuildingData {
  id: number;
  kind: 'base' | 'tower';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Ellipse;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  dead?: boolean;
  towerContainer?: Phaser.GameObjects.Container;
  tower?: {
    type: TowerKind;
    range: number;
    damage: number;
    fireRate: number;
    splash: number;
    slow: number;
    lastFireAt: number;
    builtCost: number;
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
  private enemyBase!: BuildingData;

  private lanesAll!: LanesAll;
  private lanesById: { [k in 0 | 1 | 2]: LaneGeometry } = {} as { [k in 0 | 1 | 2]: LaneGeometry };
  /** Indeks i CONFIG.STAGES — hvilken stage som er aktiv nå. -1 = ikke initialisert. */
  private currentStageIndex = -1;
  /** Phaser-objekter som tegner aktive laner — destrueres ved stage-rebuild. */
  private laneGfxObjects: Phaser.GameObjects.GameObject[] = [];

  private playerGold = 0;
  private nextId = 1;

  private hudCommandUnsub: (() => void) | null = null;

  private gameState: GameState = 'running';
  private gameTime = 0;
  private metricsEl: HTMLElement | null = null;
  private vfx!: VFXManager;
  private wildlife: WildlifeManager | null = null;
  private lastBaseShakeAt = 0;

  private gameSpeed: number = CONFIG.DEFAULT_TIME_SCALE;
  private prePauseSpeed: number = CONFIG.DEFAULT_TIME_SCALE;

  /** Røyk-emitter aktiv så lenge maurtua er kritisk skadet (< 30 % HP). */
  private playerBaseSmoke: Phaser.GameObjects.Particles.ParticleEmitter | null = null;

  private currentAlert: { message: string; urgency: 'critical' | 'warn'; triggeredAt: number } | null = null;
  private baseAlarmLoop: LoopingSfx | null = null;

  private buildMode: {
    kind: TowerKind;
    ghostBody: Phaser.GameObjects.Graphics;
    ghostRange: Phaser.GameObjects.Graphics;
    valid: boolean;
  } | null = null;

  private statsSoldiersTrained = 0;
  private statsEnemyKills = 0;
  private statsUnitsLost = 0;
  private statsGoldEarned = 0;
  private statsGoldSpent = 0;

  private waveManager!: WaveManager;
  private wavesCleared = false;

  private modifiers: UpgradeModifiers = defaultModifiers();
  private takenUpgrades: UpgradeId[] = [];
  /** Aktive valg, satt når waveManager går inn i upgradeChoice-fasen. */
  private upgradeOptions: UpgradeDef[] | null = null;
  /** Hastigheten som var aktiv før upgrade-modalen pauset spillet. */
  private prePickSpeed: number = CONFIG.DEFAULT_TIME_SCALE;

  // ── Bananas-effekt-state ───────────────────────────────────────────
  /** Sekunder akkumulert mot neste doomsday-dmg-step. */
  private doomsdayTimer = 0;
  /** Sekunder akkumulert mot neste tordenslag. */
  private thunderstormTimer = 0;
  /** Cache: er adrenalin trigget akkurat nå? (base-HP < 30 %.) Oppdateres i update(). */
  private adrenalineActive = false;
  /** Aktive sopp-skyer som ticker DoT på nærliggende AI-maur. */
  private sporeClouds: Array<{
    x: number; y: number; radius: number; dmgPerTick: number;
    tickIntervalMs: number; expiresAtMs: number; lastTickAtMs: number;
    gfx: Phaser.GameObjects.Graphics;
  }> = [];

  constructor() {
    super({ key: 'GameScene' });
  }

  create() {
    // Reset all per-scene state
    this.units = [];
    this.buildings = [];
    this.towers = [];
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
    this.statsGoldSpent = 0;
    this.wavesCleared = false;
    this.currentStageIndex = -1;
    this.laneGfxObjects = [];
    this.modifiers = defaultModifiers();
    this.takenUpgrades = [];
    this.upgradeOptions = null;
    this.prePickSpeed = CONFIG.DEFAULT_TIME_SCALE;
    this.doomsdayTimer = 0;
    this.thunderstormTimer = 0;
    this.adrenalineActive = false;
    for (const c of this.sporeClouds) c.gfx.destroy();
    this.sporeClouds = [];
    if (this.playerBaseSmoke) {
      this.playerBaseSmoke.stop();
      this.playerBaseSmoke.destroy();
      this.playerBaseSmoke = null;
    }
    if (this.hudCommandUnsub) { this.hudCommandUnsub(); this.hudCommandUnsub = null; }

    const W = CONFIG.MAP_WIDTH;
    const H = CONFIG.MAP_HEIGHT;

    // Tom lane-init — fylles av rebuildLanesForStage(0) under.
    this.lanesAll = {
      lanes: [],
      westArena: { x: CONFIG.PLAYER_BASE_X, y: CONFIG.PLAYER_BASE_Y, r: CONFIG.ARENA_RADIUS },
      eastArena: { x: CONFIG.ENEMY_SPAWN_X, y: CONFIG.ENEMY_SPAWN_Y, r: CONFIG.ARENA_RADIUS },
    };
    this.lanesById = {} as { [k in 0 | 1 | 2]: LaneGeometry };

    // ── Bakgrunn: gress (tett tekstur) ───────────────────────────────────
    this.renderGrassBackground(W, H);

    // ── Arenaer (vest + øst) — store jord-flekker hvor lanene møtes ─────
    this.renderArena(this.lanesAll.westArena.x, this.lanesAll.westArena.y, this.lanesAll.westArena.r);
    this.renderArena(this.lanesAll.eastArena.x, this.lanesAll.eastArena.y, this.lanesAll.eastArena.r);

    // ── Lanes (jord-stier) — bygges fra stage 0 (kun MIDT åpen) ─────────
    this.rebuildLanesForStage(0, /* announce */ false);

    // ── Maurtuer ─────────────────────────────────────────────────────────
    this.playerBase = this.createBase('player', CONFIG.PLAYER_BASE_X, CONFIG.PLAYER_BASE_Y);
    this.enemyBase = this.createEnemyBase(CONFIG.ENEMY_SPAWN_X, CONFIG.ENEMY_SPAWN_Y);

    // ── Gratis start-tårn ────────────────────────────────────────────────
    for (const st of CONFIG.FREE_STARTER_TOWERS) {
      if (!isOnLaneOrArena(st.x, st.y, this.lanesAll)) {
        this.createTower(st.type, st.x, st.y);
      }
    }

    // ── Input ────────────────────────────────────────────────────────────
    this.hudCommandUnsub = hudBridge.onCommand((c) => this.handleHudCommand(c));

    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);

    // Pause/speed-keys
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
    this.input.keyboard?.on('keydown-G', () => this.waveManager.startNextWave());

    // Kamera er låst — hele kartet får plass.
    this.cameras.main.setBounds(0, 0, W, H);
    this.cameras.main.centerOn(W / 2, H / 2);

    // Timers
    this.time.addEvent({ delay: CONFIG.MINE_TICK_INTERVAL, callback: this.passiveIncomeTick, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 500, callback: this.updateMetrics, callbackScope: this, loop: true });

    this.metricsEl = document.getElementById('game-metrics');

    this.vfx = new VFXManager(this);

    this.baseAlarmLoop = new LoopingSfx(this, 'base-alarm', 0.55);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.baseAlarmLoop?.stop();
      this.baseAlarmLoop = null;
    });

    this.waveManager = new WaveManager((req) => this.spawnCreep(req.lane, req.unitKind, req.boss));
    this.waveManager.setActiveLanes(CONFIG.STAGES[0].activeLanes);

    // ── Liv i kartet: mariehøner, sommerfugler, frosk ──────────────────
    if (this.wildlife) this.wildlife.destroy();
    this.wildlife = new WildlifeManager(this, {
      getLanes: () => this.lanesAll,
      findCreepNear: (x, y, range) => {
        let best: UnitData | null = null;
        let bestDistSq = range * range;
        for (const u of this.units) {
          if (u.dead || u.faction !== 'ai') continue;
          const dx = u.x - x, dy = u.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDistSq) { bestDistSq = d2; best = u; }
        }
        return best ? { id: best.id, x: best.x, y: best.y } : null;
      },
      eatCreep: (id) => {
        const target = this.units.find((u) => u.id === id && !u.dead);
        if (!target) return;
        // Frosken får skylda — ingen bounty til spilleren.
        this.removeUnit(target, false);
      },
    });
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.wildlife?.destroy();
      this.wildlife = null;
    });

    this.applyCameraFX();
  }

  // ── Grass-bakgrunn ─────────────────────────────────────────────────────

  private renderGrassBackground(W: number, H: number) {
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(
      THEME.GRASS_COLOR_TOP, THEME.GRASS_COLOR_TOP,
      THEME.GRASS_COLOR_BOTTOM, THEME.GRASS_COLOR_BOTTOM, 1,
    );
    bg.fillRect(0, 0, W, H);

    // Mye gress-blader for tett "plen"-følelse
    const blades = this.add.graphics().setDepth(0);
    const bladeCount = Math.floor((W * H) / 900);  // ~tetthet
    for (let i = 0; i < bladeCount; i++) {
      const bx = Phaser.Math.Between(0, W);
      const by = Phaser.Math.Between(0, H);
      const len = Phaser.Math.Between(4, 10);
      const tilt = Phaser.Math.FloatBetween(-1.8, 1.8);
      const color = Math.random() < 0.5 ? THEME.GRASS_BLADE_COLOR : THEME.GRASS_BLADE_DARK;
      blades.lineStyle(1, color, Phaser.Math.FloatBetween(0.4, 0.85));
      blades.lineBetween(bx, by, bx + tilt, by - len);
    }

    // Småblomster og kløver-tuer
    for (let i = 0; i < 60; i++) {
      const fx = Phaser.Math.Between(10, W - 10);
      const fy = Phaser.Math.Between(10, H - 10);
      const flowerColors = [THEME.FLOWER_PINK, THEME.FLOWER_YELLOW, THEME.FLOWER_WHITE];
      const fc = flowerColors[Phaser.Math.Between(0, 2)];
      // Liten kløver-base
      this.add.circle(fx, fy, 3, THEME.CLOVER_LEAF, 0.85).setDepth(0);
      this.add.circle(fx - 2, fy - 1, 2, THEME.CLOVER_LEAF, 0.85).setDepth(0);
      this.add.circle(fx + 2, fy - 1, 2, THEME.CLOVER_LEAF, 0.85).setDepth(0);
      // Blomst-prikk
      this.add.circle(fx, fy - 1, 1.5, fc, 0.95).setDepth(0);
    }

    // Spredte pebbler
    for (let i = 0; i < 32; i++) {
      const px = Phaser.Math.Between(30, W - 30);
      const py = Phaser.Math.Between(30, H - 30);
      const pw = Phaser.Math.Between(4, 7);
      const ph = Phaser.Math.Between(3, 5);
      const pc = THEME.PEBBLE_COLORS[i % THEME.PEBBLE_COLORS.length];
      this.add.ellipse(px + 1, py + 1.5, pw, ph, 0x000000, 0.35).setDepth(0);
      this.add.ellipse(px, py, pw, ph, pc).setDepth(0);
      this.add.ellipse(px - pw * 0.2, py - ph * 0.25, pw * 0.45, ph * 0.4, 0xffffff, 0.18).setDepth(0);
    }
  }

  // ── Arena (jord-flekk foran maurtue) ───────────────────────────────────

  private renderArena(cx: number, cy: number, r: number) {
    const g = this.add.graphics().setDepth(1);
    // Ytre myk kant (gradient-illusjon via flere lag)
    for (let i = 4; i >= 0; i--) {
      const layerR = r * (1 + i * 0.08);
      const a = 0.08 + (4 - i) * 0.12;
      g.fillStyle(THEME.LANE_DIRT_DARK, a);
      g.fillCircle(cx, cy, layerR);
    }
    g.fillStyle(THEME.LANE_DIRT, 0.9);
    g.fillCircle(cx, cy, r);
    g.fillStyle(THEME.LANE_DIRT_LIGHT, 0.35);
    g.fillCircle(cx, cy, r * 0.7);

    // Småstein-tekstur
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * r * 0.95;
      const px = cx + Math.cos(a) * rr;
      const py = cy + Math.sin(a) * rr;
      this.add.circle(px, py, Phaser.Math.FloatBetween(0.6, 1.6), THEME.LANE_PEBBLE, 0.6).setDepth(1);
    }
  }

  // ── Lanes (jord-stier) ─────────────────────────────────────────────────

  /**
   * Bygg LaneGeometry for valgt stage, oppdater lanesAll/lanesById, og tegn
   * lane-grafikk på nytt. Destruerer tidligere lane-gfx-objekter.
   */
  private rebuildLanesForStage(stageIndex: number, announce: boolean) {
    if (stageIndex < 0 || stageIndex >= CONFIG.STAGES.length) return;
    const stage = CONFIG.STAGES[stageIndex];
    const activeSet = new Set<0 | 1 | 2>(stage.activeLanes);

    // Destruer tidligere lane-grafikk
    for (const obj of this.laneGfxObjects) obj.destroy();
    this.laneGfxObjects = [];

    // Bygg kun de aktive lanene
    const lanes = CONFIG.LANES
      .filter((ld) => activeSet.has(ld.id))
      .map((ld) => buildLane({
        id: ld.id,
        label: ld.label,
        baseWidth: ld.baseWidth,
        waypoints: ld.waypoints.map((w) => ({ x: w.x, y: w.y })),
      }));

    this.lanesAll = {
      ...this.lanesAll,
      lanes,
    };
    this.lanesById = {} as { [k in 0 | 1 | 2]: LaneGeometry };
    for (const l of lanes) this.lanesById[l.id] = l;

    this.renderLanes();

    if (this.waveManager) {
      this.waveManager.setActiveLanes(stage.activeLanes);
    }

    const prevIndex = this.currentStageIndex;
    this.currentStageIndex = stageIndex;

    if (announce && prevIndex >= 0 && stage.newLane !== null) {
      const label = CONFIG.LANES.find((l) => l.id === stage.newLane)?.label ?? '';
      this.currentAlert = {
        message: `${label.toUpperCase()}-STI ÅPNER!`,
        urgency: 'warn',
        triggeredAt: this.time.now,
      };
      playSfx(this, 'base-alarm', { volume: 0.4 });
    }
  }

  /**
   * Returner riktig stage-indeks for hva som *snart skjer*: hvis en wave er aktiv
   * eller i countdown, bruk den waven; ellers (idle/upgrade) bruk neste wave —
   * slik at en ny lane vises mens spilleren velger upgrade og forbereder seg.
   */
  private targetStageIndexForUpcomingWave(): number {
    const wm = this.waveManager;
    let targetWave: number;
    if (!wm) {
      targetWave = 1;
    } else if (wm.isActive || wm.isCountdown) {
      targetWave = wm.displayWave;
    } else {
      // idle / upgradeChoice / victory — sikt mot neste wave
      targetWave = Math.min(wm.totalWaves, wm.displayWave + 1);
    }
    let idx = 0;
    for (let i = 0; i < CONFIG.STAGES.length; i++) {
      if (CONFIG.STAGES[i].unlockAtWave <= targetWave) idx = i;
    }
    return idx;
  }

  private renderLanes() {
    const g = this.add.graphics().setDepth(1);
    this.laneGfxObjects.push(g);
    for (const lane of this.lanesAll.lanes) {
      const samples = lane.samples;
      // Bygg polygon for variabel bredde og tegn som utfylt sti.
      // For hver sample beregn normal og legg punkt på begge sider.
      const leftPoints: { x: number; y: number }[] = [];
      const rightPoints: { x: number; y: number }[] = [];
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const t = i / (samples.length - 1);
        const w = lane.widthAt(t) * 0.5;
        // Normal via tangent
        const tan = lane.tangentAt(t);
        const nx = -tan.y, ny = tan.x;
        leftPoints.push({ x: p.x + nx * w, y: p.y + ny * w });
        rightPoints.push({ x: p.x - nx * w, y: p.y - ny * w });
      }

      // Skygge / mørkere kant
      g.fillStyle(THEME.LANE_EDGE, 0.55);
      this.fillStripPolygon(g, leftPoints, rightPoints, 3);

      // Hoved-jord
      g.fillStyle(THEME.LANE_DIRT, 0.95);
      this.fillStripPolygon(g, leftPoints, rightPoints, 0);

      // Lysere senter-stripe for dybde
      const midLeftPoints: { x: number; y: number }[] = [];
      const midRightPoints: { x: number; y: number }[] = [];
      for (let i = 0; i < samples.length; i++) {
        const p = samples[i];
        const t = i / (samples.length - 1);
        const w = lane.widthAt(t) * 0.25;
        const tan = lane.tangentAt(t);
        const nx = -tan.y, ny = tan.x;
        midLeftPoints.push({ x: p.x + nx * w, y: p.y + ny * w });
        midRightPoints.push({ x: p.x - nx * w, y: p.y - ny * w });
      }
      g.fillStyle(THEME.LANE_DIRT_LIGHT, 0.45);
      this.fillStripPolygon(g, midLeftPoints, midRightPoints, 0);

      // Småstein-prikker langs stien
      for (let i = 0; i < samples.length; i += 2) {
        const p = samples[i];
        const t = i / (samples.length - 1);
        const w = lane.widthAt(t) * 0.45;
        for (let k = 0; k < 3; k++) {
          const tan = lane.tangentAt(t);
          const nx = -tan.y, ny = tan.x;
          const off = Phaser.Math.FloatBetween(-w, w);
          const px = p.x + nx * off + Phaser.Math.FloatBetween(-2, 2);
          const py = p.y + ny * off + Phaser.Math.FloatBetween(-2, 2);
          const pebble = this.add.circle(px, py, Phaser.Math.FloatBetween(0.6, 1.4), THEME.LANE_PEBBLE, 0.55).setDepth(1);
          this.laneGfxObjects.push(pebble);
        }
      }
    }
  }

  /** Hjelper for å tegne en bånd-polygon (venstre-side fra start→slutt, høyre-side fra slutt→start). */
  private fillStripPolygon(
    g: Phaser.GameObjects.Graphics,
    leftPoints: { x: number; y: number }[],
    rightPoints: { x: number; y: number }[],
    yOffset: number,
  ) {
    g.beginPath();
    g.moveTo(leftPoints[0].x, leftPoints[0].y + yOffset);
    for (let i = 1; i < leftPoints.length; i++) g.lineTo(leftPoints[i].x, leftPoints[i].y + yOffset);
    for (let i = rightPoints.length - 1; i >= 0; i--) g.lineTo(rightPoints[i].x, rightPoints[i].y + yOffset);
    g.closePath();
    g.fillPath();
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
    const R = Math.max(w, h) * 0.55;
    const color = THEME.BASE_COLOR_PLAYER;
    const rim = THEME.BASE_RIM_PLAYER;
    const highlight = THEME.BASE_HIGHLIGHT_PLAYER;
    const grainPalette = THEME.SOIL_GRAIN_PLAYER;

    this.add.ellipse(x + 3, y + R * 0.42, R * 2.15, R * 0.55, 0x000000, 0.45).setDepth(2);

    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const r = R * Phaser.Math.FloatBetween(1.02, 1.28);
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const cs = Phaser.Math.FloatBetween(4, 8);
      this.add.ellipse(cx, cy, cs * 1.4, cs, THEME.DISTURBED_SOIL_PLAYER, 0.85).setDepth(2);
    }

    this.add.circle(x, y, R, rim).setDepth(3);
    this.add.circle(x - 2, y - 2, R * 0.94, color).setDepth(3);
    this.add.circle(x - R * 0.18, y - R * 0.22, R * 0.55, highlight, 0.55).setDepth(3);

    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 0.88;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const gc = grainPalette[Phaser.Math.Between(0, grainPalette.length - 1)];
      this.add.circle(cx, cy, Phaser.Math.FloatBetween(0.8, 1.6), gc, 0.85).setDepth(3);
    }

    this.add.ellipse(x, y + R * 0.05, R * 0.42, R * 0.32, THEME.BASE_ENTRANCE_COLOR).setDepth(4);
    this.add.ellipse(x, y - R * 0.04, R * 0.4, R * 0.16, 0x000000, 0.85).setDepth(4);

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

  private createEnemyBase(x: number, y: number): BuildingData {
    const w = 90, h = 110;
    const R = Math.max(w, h) * 0.55;
    const color = THEME.BASE_COLOR_AI;
    const rim = THEME.BASE_RIM_AI;
    const highlight = THEME.BASE_HIGHLIGHT_AI;
    const grainPalette = THEME.SOIL_GRAIN_AI;

    this.add.ellipse(x + 3, y + R * 0.42, R * 2.15, R * 0.55, 0x000000, 0.45).setDepth(2);

    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2 + Phaser.Math.FloatBetween(-0.2, 0.2);
      const r = R * Phaser.Math.FloatBetween(1.02, 1.28);
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const cs = Phaser.Math.FloatBetween(4, 8);
      this.add.ellipse(cx, cy, cs * 1.4, cs, THEME.DISTURBED_SOIL_AI, 0.85).setDepth(2);
    }

    this.add.circle(x, y, R, rim).setDepth(3);
    this.add.circle(x - 2, y - 2, R * 0.94, color).setDepth(3);
    this.add.circle(x - R * 0.18, y - R * 0.22, R * 0.55, highlight, 0.55).setDepth(3);

    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * R * 0.88;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      const gc = grainPalette[Phaser.Math.Between(0, grainPalette.length - 1)];
      this.add.circle(cx, cy, Phaser.Math.FloatBetween(0.8, 1.6), gc, 0.85).setDepth(3);
    }

    this.add.ellipse(x, y + R * 0.05, R * 0.42, R * 0.32, THEME.BASE_ENTRANCE_COLOR).setDepth(4);
    this.add.ellipse(x, y - R * 0.04, R * 0.4, R * 0.16, 0x000000, 0.85).setDepth(4);

    // Pulserende advarsel-ring beholdes som tematisk markør for fiendebasen.
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
    const hpBg = this.add.rectangle(x, y - h / 2 - 10, 60, 6, 0x222222).setDepth(8);
    const hpFg = this.add.rectangle(x - 30, y - h / 2 - 10, 60, 6, 0xff5544).setOrigin(0, 0.5).setDepth(8);

    const b: BuildingData = {
      id: this.nextId++, kind: 'base', faction: 'ai',
      x, y, w, h,
      hp: CONFIG.ENEMY_BASE_HP, maxHp: CONFIG.ENEMY_BASE_HP,
      body, bodyColor: color, hpBg, hpFg,
    };
    this.buildings.push(b);
    return b;
  }

  private createTower(type: TowerKind, x: number, y: number, builtCost = 0): BuildingData {
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
        builtCost,
      },
    };
    this.buildings.push(b);
    this.towers.push(b);
    return b;
  }

  // ── Spawn-API ──────────────────────────────────────────────────────────

  /** Modifier-bevisst pris for en unit-type. */
  private unitCostFor(kind: UnitKind): number {
    let c = CONFIG.UNITS[kind].cost * this.modifiers.playerCostMul;
    if (kind === 'light') c *= this.modifiers.lightCostMul;
    return Math.max(1, Math.round(c));
  }

  /** Modifier-bevisst pris for et tårn. */
  private towerCostFor(kind: TowerKind): number {
    return Math.max(1, Math.round(CONFIG.TOWER_TYPES[kind].cost * this.modifiers.towerCostMul));
  }

  /** Spilleren sender én unit av valgt type i en gitt lane. */
  private sendLaneUnit(lane: 0 | 1 | 2, kind: UnitKind) {
    if (this.gameState !== 'running') return;
    if (this.upgradeOptions) return;  // pauset for valg
    if (!this.lanesById[lane]) return;  // lanen er ikke åpen i nåværende stage
    if (!this.waveManager.isActive) {
      // Ingen aksjon før bølgen faktisk har startet — likt for spiller og fiende.
      this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Vent på bølgen', '#ffcc66');
      return;
    }
    const cost = this.unitCostFor(kind);
    if (this.playerGold < cost) {
      this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Mangler mat', '#ee5544');
      return;
    }
    this.playerGold -= cost;
    this.statsGoldSpent += cost;
    const cosmicBoss = Math.random() < this.modifiers.cosmicBossChance;
    const unit = this.spawnUnit('player', lane, kind, cosmicBoss);
    this.statsSoldiersTrained++;
    playSfx(this, 'train', { volume: 0.45 });
    this.spawnCommandRipple(unit.x, unit.y, 0xddff88);
    if (cosmicBoss) {
      this.vfx.floatText(unit.x, unit.y - 24, '🧬 MUTERT!', '#c98aff');
    }

    // Søsterkull-klon: ekstra gratis maur, samme lane og type (ikke-rekursiv)
    if (Math.random() < this.modifiers.cloneSpawnChance) {
      const twin = this.spawnUnit('player', lane, kind, false);
      this.statsSoldiersTrained++;
      this.spawnCommandRipple(twin.x, twin.y, 0xffe0ff);
      this.vfx.floatText(twin.x, twin.y - 18, '👯 KLON', '#ffaaff');
    }
  }

  /** WaveManager kaller denne for hver creep i en bølge. */
  private spawnCreep(lane: 0 | 1 | 2, kind: UnitKind, boss: boolean) {
    const u = this.spawnUnit('ai', lane, kind, boss);
    if (boss) this.bossSpawnEffect(u.x, u.y);
  }

  /** Dramatisk feedback når en boss spawner: shake + kort zoom-pulse + shockwave. */
  private bossSpawnEffect(x: number, y: number) {
    this.cameras.main.shake(280, 0.008);
    const cam = this.cameras.main;
    const startZoom = cam.zoom;
    this.tweens.add({
      targets: cam,
      zoom: startZoom * 1.035,
      duration: 180,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => cam.setZoom(startZoom),
    });
    this.vfx.shockwave(x, y, { color: 0xff5544, radius: 90, thickness: 4, duration: 520 });
    this.vfx.dust(x, y, 18);
  }

  private spawnUnit(
    faction: 'player' | 'ai',
    lane: 0 | 1 | 2,
    kind: UnitKind,
    boss: boolean,
  ): UnitData {
    const isPlayer = faction === 'player';
    const spec = CONFIG.UNITS[kind];
    const laneGeom = this.lanesById[lane];

    // Player starter ved t=0, AI starter ved t=1; marsj-retning er motsatt.
    const baseStart = isPlayer ? 0.02 : 0.98;
    const startT = isPlayer
      ? Math.max(baseStart, Math.min(0.6, this.modifiers.tunnelStartT))
      : baseStart;
    const dir: 1 | -1 = isPlayer ? 1 : -1;
    const startPos = laneGeom.pointAt(startT);

    const bodyColor = isPlayer ? THEME.PLAYER_SOLDIER_COLOR : THEME.AI_SOLDIER_COLOR;
    const legColor = isPlayer ? THEME.ANT_LEG_COLOR_PLAYER : THEME.ANT_LEG_COLOR_AI;
    const headHighlight = isPlayer ? THEME.ANT_HEAD_HIGHLIGHT_PLAYER : THEME.ANT_HEAD_HIGHLIGHT_AI;
    const mandibleColor = isPlayer ? THEME.ANT_MANDIBLE_COLOR_PLAYER : THEME.ANT_MANDIBLE_COLOR_AI;

    // ─── Modifier-multipliers ───────────────────────────────────────────
    let modHp = 1, modDmg = 1, modSpeed = 1, modAtkInt = 1;
    if (isPlayer) {
      modHp = this.modifiers.playerHpMul * (kind === 'light' ? this.modifiers.lightHpMul : 1);
      modDmg = this.modifiers.playerDmgMul;
      modSpeed = this.modifiers.playerSpeedMul;
      modAtkInt = this.modifiers.playerAtkIntervalMul;
    } else {
      modHp = this.modifiers.aiHpMul;
    }

    const baseScale = spec.bodyScale * (boss ? 1.5 : 1.0);
    const r = 13;

    const footprint = this.add.ellipse(0, r * 0.45, r * 2.0, r * 0.6, bodyColor, 0.22);
    const shadow = this.add.ellipse(2, r * 0.35, r * 1.7, r * 0.6, 0x000000, 0.42);
    const antBody = this.add.container(0, 0);

    let segments: Phaser.GameObjects.Ellipse[];
    let effectiveBodyColor = bodyColor;

    if (kind === 'medium') {
      // ─── LARVE — gulgrønn segmentert klump, ingen synlige bein/mandibler ───
      const larvaColor = isPlayer ? THEME.LARVA_BODY_PLAYER : THEME.LARVA_BODY_AI;
      const larvaSheen = isPlayer ? THEME.LARVA_SHEEN_PLAYER : THEME.LARVA_SHEEN_AI;
      const larvaRim = isPlayer ? THEME.LARVA_SEG_RIM_PLAYER : THEME.LARVA_SEG_RIM_AI;
      effectiveBodyColor = larvaColor;

      const seg = (cx: number, w: number, h: number) => {
        const s = this.add.ellipse(cx, 0, w, h, larvaColor);
        s.setStrokeStyle(0.9, larvaRim, 0.9);
        return s;
      };
      const tail = seg(-10, 9, 7);
      const body2 = seg(-4, 12, 10);
      const body1 = seg(3, 12, 11);
      const headSeg = seg(10, 9, 8);

      const sheen = this.add.graphics();
      sheen.fillStyle(larvaSheen, 0.7);
      sheen.fillEllipse(-9, -1.5, 4, 2);
      sheen.fillEllipse(-3, -2.5, 6, 2.5);
      sheen.fillEllipse(4, -3, 6, 2.8);
      sheen.fillEllipse(10, -2.2, 4, 2);

      const eyes = this.add.graphics();
      eyes.fillStyle(0x0a0a0a, 1);
      eyes.fillCircle(12, -1.2, 0.9);
      eyes.fillCircle(12, 1.2, 0.9);

      antBody.add([tail, body2, body1, headSeg, sheen, eyes]);
      antBody.setScale(baseScale);

      // Klønete vugg fram og tilbake.
      this.tweens.add({
        targets: antBody,
        angle: { from: -6, to: 6 },
        duration: 360,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      segments = [tail, body2, body1, headSeg];
    } else if (kind === 'heavy') {
      // ─── HUMLE — knubbete kropp med striper og vinger ───
      const beeBody = isPlayer ? THEME.BEE_BODY_PLAYER : THEME.BEE_BODY_AI;
      const beeStripe = isPlayer ? THEME.BEE_STRIPE_PLAYER : THEME.BEE_STRIPE_AI;
      effectiveBodyColor = beeBody;

      const wingL = this.add.ellipse(-2, -7, 11, 6, THEME.BEE_WING, 0.75);
      const wingR = this.add.ellipse(-2,  7, 11, 6, THEME.BEE_WING, 0.75);
      wingL.setStrokeStyle(0.6, 0x88aacc, 0.7);
      wingR.setStrokeStyle(0.6, 0x88aacc, 0.7);

      const body = this.add.ellipse(-2, 0, 18, 14, beeBody);
      body.setStrokeStyle(1, 0x000000, 0.85);

      const stripes = this.add.graphics();
      stripes.fillStyle(beeStripe, 1);
      stripes.fillEllipse(-7, 0, 3.2, 11);
      stripes.fillEllipse(-2, 0, 3.2, 12);
      stripes.fillEllipse(3, 0, 3.0, 11);

      const head = this.add.ellipse(10, 0, 8.5, 8, beeBody);
      head.setStrokeStyle(0.9, 0x000000, 0.85);

      const eyesG = this.add.graphics();
      eyesG.fillStyle(0x111111, 1);
      eyesG.fillCircle(12, -2, 1.6);
      eyesG.fillCircle(12,  2, 1.6);
      eyesG.fillStyle(0xffffff, 1);
      eyesG.fillCircle(12.5, -2.4, 0.55);
      eyesG.fillCircle(12.5,  1.6, 0.55);

      const antennae = this.add.graphics();
      antennae.lineStyle(1, 0x000000, 1);
      antennae.lineBetween(13, -2.5, 16, -5);
      antennae.lineBetween(13,  2.5, 16,  5);
      antennae.fillStyle(0x000000, 1);
      antennae.fillCircle(16, -5, 0.8);
      antennae.fillCircle(16,  5, 0.8);

      antBody.add([wingL, wingR, body, stripes, head, eyesG, antennae]);
      antBody.setScale(baseScale);

      // Vinge-flagring.
      this.tweens.add({
        targets: [wingL, wingR],
        scaleY: { from: 1, to: 0.45 },
        duration: 70,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      // Bobbing.
      this.tweens.add({
        targets: antBody,
        y: { from: -1, to: 1.5 },
        duration: 280,
        ease: 'Sine.easeInOut',
        yoyo: true,
        repeat: -1,
      });

      segments = [body, head];
    } else {
      // ─── MAUR (light / sumo / default) — original anatomi ───
      const dims = {
        abdW: 13, abdH: 9, abdX: -7, thW: 7, thH: 6,
        hdW: 9, hdH: 8, hdX: 7, legLen: 8, antLen: 7, mandLen: 5,
      };

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
      antBody.setScale(baseScale);

      segments = [abdomen, thorax, head];
    }

    const hpBg = this.add.rectangle(0, -r * baseScale - 7, r * 2 + 2, 6, 0x2a1810).setStrokeStyle(1, 0x000000, 0.95);
    const hpFg = this.add.rectangle(-r, -r * baseScale - 7, r * 2, 4, 0x8cd95a).setOrigin(0, 0.5);
    hpBg.setVisible(false);
    hpFg.setVisible(false);

    const container = this.add.container(startPos.x, startPos.y, [footprint, shadow, antBody, hpBg, hpFg]).setDepth(5);

    const hpMul = (boss ? 4.0 : 1) * modHp;  // heavy 250 -> boss 1000 HP. run 85 BREAKTHROUGH: 1000 FINALLY produced W15 teeth — first non-zero-damage climax in the loop's history (heal entry 750 -> 270, -480 = ~3-4 bosses leaked, ~8-9/12 transit-killed), exactly the run-84 prediction (12/12 -> ~9/12). This is the documented "leaks 1-3 -> coin-flip approaches" branch -> HOLD config FIXED (this hpMul AND W15 count=12) and SAMPLE win-rate across runs; do NOT crank further. Heal run won 270/750 (comfortable); a no-heal entry (500) would land ~20 HP or wipe -> genuine coin-flip edge. Next runs: gather a no-heal sample before any change. Only if 2-3 samples show win-rate still >60% -> small bump to ~1100; if a clean entry hard-wipes -> drop to ~880.
    const dmgMul = (boss ? 1.5 : 1) * modDmg;
    const finalHp = Math.max(1, Math.round(spec.hp * hpMul));

    const unit: UnitData = {
      id: this.nextId++, faction, kind, lane,
      laneT: startT, laneDir: dir,
      x: startPos.x, y: startPos.y,
      hp: finalHp, maxHp: finalHp,
      speed: spec.speed * (boss ? 0.6 : 1) * modSpeed,
      damage: Math.max(1, Math.round(spec.damage * dmgMul)),
      attackRange: spec.attackRange,
      attackInterval: Math.max(150, Math.round(spec.attackInterval * modAtkInt)),
      bounty: spec.bounty * (boss ? 5 : 1),
      lastAttackAt: 0,
      state: 'moving', attackTarget: null,
      dead: false, boss,
      container, antBody,
      segments,
      bodyColor: effectiveBodyColor, hpBg, hpFg,
      radius: r * baseScale,
      lastDx: isPlayer ? 1 : -1, lastDy: 0,
      slowedUntil: 0,
      firstAttackDone: false,
      lastFootprintAt: 0,
      webOverlay: null,
    };
    this.units.push(unit);
    return unit;
  }

  /**
   * Nullstill brettet etter at en bølge er ferdig: fjern alle levende maur (begge
   * sider). Tårn og baser beholdes med sin nåværende HP.
   */
  private clearBoard() {
    if (this.buildMode) this.cancelBuildMode();

    // Riv alle maur uten loot/death-effekter — dette er en wipe, ikke et drap.
    for (const u of this.units) {
      u.dead = true;
      this.tweens.killTweensOf(u.container);
      u.container.destroy();
    }
    this.units = [];

    // Liten støvsky for feedback.
    this.vfx.dust(this.playerBase.x, this.playerBase.y - 40, 6);
  }

  private removeUnit(unit: UnitData, killedByPlayer: boolean, fromSpore = false) {
    unit.dead = true;
    if (unit.faction === 'player') {
      this.statsUnitsLost++;
      this.triggerDeathEffects(unit);
    } else if (killedByPlayer) {
      this.statsEnemyKills++;
      const bounty = Math.max(0, Math.round(unit.bounty * this.modifiers.bountyMul));
      this.playerGold += bounty;
      this.statsGoldEarned += bounty;
      this.vfx.floatText(unit.x, unit.y - 18, `+${bounty}`, '#ddff88');
      // Sopp-spore: AI-dødsfall (utenom sopp-induserte kills) etterlater DoT-sky
      if (this.modifiers.deathSporeCloud && !fromSpore) {
        this.createSporeCloud(unit.x, unit.y);
      }
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

  /** Eksplosjon / heal-allied når en player-maur dør, hvis modifiere er aktive. */
  private triggerDeathEffects(unit: UnitData) {
    if (this.modifiers.deathExplosion) {
      const radius = 60;
      const dmg = 30;
      // Visuell ring
      const ring = this.add.circle(unit.x, unit.y, 8, 0xff8844, 0).setStrokeStyle(3, 0xffaa44, 0.95).setDepth(7);
      this.tweens.add({
        targets: ring,
        radius,
        alpha: 0,
        duration: 320,
        ease: 'Cubic.easeOut',
        onUpdate: (_t, tgt) => {
          const c = tgt as Phaser.GameObjects.Arc;
          c.setStrokeStyle(3, 0xffaa44, c.alpha);
        },
        onComplete: () => ring.destroy(),
      });
      this.vfx.dust(unit.x, unit.y, 16);
      playSfx(this, 'attack', { volume: 0.25 });
      const victims: UnitData[] = [];
      for (const u of this.units) {
        if (u === unit || u.dead || u.faction !== 'ai') continue;
        const d = Phaser.Math.Distance.Between(unit.x, unit.y, u.x, u.y);
        if (d <= radius) victims.push(u);
      }
      for (const v of victims) {
        v.hp -= dmg;
        for (const s of v.segments) s.setFillStyle(0xffaa44);
        this.time.delayedCall(80, () => {
          if (!v.dead) for (const s of v.segments) s.setFillStyle(v.bodyColor);
        });
        if (v.hp <= 0) this.removeUnit(v, true);
      }
    }
    if (this.modifiers.deathHealAlly) {
      let nearest: UnitData | null = null;
      let bestDist = Infinity;
      for (const u of this.units) {
        if (u === unit || u.dead || u.faction !== 'player') continue;
        if (u.hp >= u.maxHp) continue;
        const d = Phaser.Math.Distance.Between(unit.x, unit.y, u.x, u.y);
        if (d < bestDist) { nearest = u; bestDist = d; }
      }
      if (nearest) {
        const heal = 30;
        nearest.hp = Math.min(nearest.maxHp, nearest.hp + heal);
        this.vfx.floatText(nearest.x, nearest.y - 18, `+${heal}`, '#88ff88');
      }
    }
  }

  // ── Hovedløkke ─────────────────────────────────────────────────────────

  update(time: number, delta: number) {
    if (this.gameState !== 'running') return;

    const rawDt = delta / 1000;

    if (this.gameSpeed === 0) {
      this.emitHudState();
      return;
    }

    const dt = rawDt * this.gameSpeed;
    const scaledDeltaMs = delta * this.gameSpeed;
    this.gameTime += dt;

    // ── Bananas-effekt-tikker ───────────────────────────────────────
    this.adrenalineActive = this.modifiers.adrenalineEnabled
      && (this.playerBase.hp / this.playerBase.maxHp) < 0.3;

    if (this.modifiers.doomsdayActive) {
      this.doomsdayTimer += dt;
      while (this.doomsdayTimer >= 60) {
        this.doomsdayTimer -= 60;
        this.modifiers.playerDmgMul *= 1.10;
        this.vfx.floatText(this.playerBase.x, this.playerBase.y - 100, '⏳ +10 % SKADE', '#ffdd66');
        playSfx(this, 'victory', { volume: 0.25 });
      }
    }

    if (this.modifiers.thunderstormIntervalMs > 0) {
      this.thunderstormTimer += scaledDeltaMs;
      if (this.thunderstormTimer >= this.modifiers.thunderstormIntervalMs) {
        this.thunderstormTimer = 0;
        this.fireThunderstrike();
      }
    }

    this.tickSporeClouds(time);

    this.wildlife?.tick(time, dt);

    for (const unit of [...this.units]) {
      if (!unit.dead) this.updateUnit(unit, time, dt);
    }

    this.updateTowers(time);

    const aiAlive = this.units.filter(u => u.faction === 'ai' && !u.dead).length;
    const prevPhase = this.waveManager.currentPhase;
    const victory = this.waveManager.tick(scaledDeltaMs, aiAlive);

    if (prevPhase === 'countdown' && this.waveManager.currentPhase === 'spawning') {
      this.currentAlert = {
        message: `BØLGE ${this.waveManager.displayWave} STARTER!`,
        urgency: 'critical',
        triggeredAt: time,
      };
      playSfx(this, 'base-alarm', { volume: 0.5 });
    }

    // Stage-progresjon: åpne nye laner før neste wave starter.
    const targetStage = this.targetStageIndexForUpcomingWave();
    if (targetStage !== this.currentStageIndex) {
      this.rebuildLanesForStage(targetStage, /* announce */ true);
    }

    // Bølgen er ferdig (mopUp slutt) — nullstill brettet før upgrade-valg / neste idle.
    if (prevPhase === 'mopUp' && this.waveManager.currentPhase === 'upgradeChoice') {
      this.clearBoard();
      this.beginUpgradeChoice();
    }

    // Primær win: fiendebasen er ødelagt.
    if (this.enemyBase.hp <= 0) {
      this.wavesCleared = true;
      this.endGame('won');
      return;
    }

    // Sekundær win: spilleren har overlevd alle 15 bølger.
    if (victory) {
      this.wavesCleared = true;
      this.endGame('won');
      return;
    }

    if (this.playerBase.hp <= 0) {
      this.endGame('lost');
      return;
    }

    if (this.baseAlarmLoop) {
      const pct = this.playerBase.hp / this.playerBase.maxHp;
      if (pct < 0.5) this.baseAlarmLoop.start();
      else this.baseAlarmLoop.stop();
    }

    // Røyk fra brennende maurtue når HP < 30 %.
    const basePct = this.playerBase.hp / this.playerBase.maxHp;
    if (basePct < 0.3 && !this.playerBaseSmoke) {
      this.playerBaseSmoke = this.vfx.smoke(this.playerBase.x, this.playerBase.y - 20);
    } else if (basePct >= 0.3 && this.playerBaseSmoke) {
      this.playerBaseSmoke.stop();
      this.playerBaseSmoke.destroy();
      this.playerBaseSmoke = null;
    }

    if (this.currentAlert && time - this.currentAlert.triggeredAt > 3000) {
      this.currentAlert = null;
    }

    for (const b of this.buildings) {
      const pct = Math.max(0, b.hp / b.maxHp);
      b.hpFg.setDisplaySize(60 * pct, 6);
      b.hpFg.setFillStyle(hpBarColor(pct));
      const showBar = b.hp < b.maxHp && b.hp > 0;
      b.hpBg.setVisible(showBar);
      b.hpFg.setVisible(showBar);
    }

    this.emitHudState();
  }

  // ── Unit logic — spline-følgende ───────────────────────────────────────

  private updateUnit(unit: UnitData, time: number, dt: number) {
    // Plassér container på spline-posisjon ut fra laneT
    const lane = this.lanesById[unit.lane];

    // Idle-bob
    const bob = Math.sin((time + unit.id * 137) * 0.004) * 1.0;
    unit.antBody.y = bob;
    unit.antBody.rotation = Math.atan2(unit.lastDy, unit.lastDx);

    // Rydd opp web-overlay når slow har utløpt.
    if (unit.webOverlay && time >= unit.slowedUntil) {
      unit.webOverlay.destroy();
      unit.webOverlay = null;
    }

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
        if (unit.state === 'attacking') unit.state = 'moving';
      }
    }

    if (unit.state !== 'attacking') {
      this.findLaneEngagement(unit);
    }

    switch (unit.state) {
      case 'attacking':
        this.updateAttacking(unit, time, dt);
        break;
      case 'moving':
        this.advanceAlongLane(unit, lane, dt);
        break;
      case 'idle':
        break;
    }

    unit.container.setPosition(unit.x, unit.y);
  }

  /** Marsjer langs spline. dt i sekunder. */
  private advanceAlongLane(unit: UnitData, lane: LaneGeometry, dt: number) {
    const slowed = this.time.now < unit.slowedUntil;
    const adrenalineMul = (unit.faction === 'player' && this.adrenalineActive) ? 1.5 : 1;
    const speed = unit.speed * (slowed ? 0.5 : 1) * adrenalineMul;
    const dT = lane.tFromDistance(speed * dt) * unit.laneDir;
    unit.laneT += dT;

    // Reached end?
    if (unit.laneDir > 0 && unit.laneT >= 0.99) {
      unit.laneT = 1.0;
      const p = lane.pointAt(1.0);
      unit.x = p.x; unit.y = p.y;
      // Player-soldater når øst-arena → låser angrep på fiendebasen.
      if (this.enemyBase.hp > 0) {
        unit.attackTarget = this.enemyBase;
        unit.state = 'attacking';
      } else {
        unit.state = 'idle';
      }
      return;
    }
    if (unit.laneDir < 0 && unit.laneT <= 0.01) {
      // Creep har nådd vest-arenaen → påfør basen skade
      this.creepReachedBase(unit);
      return;
    }

    const p = lane.pointAt(unit.laneT);
    const tan = lane.tangentAt(unit.laneT);
    unit.x = p.x;
    unit.y = p.y;
    unit.lastDx = tan.x * unit.laneDir;
    unit.lastDy = tan.y * unit.laneDir;

    // Slipp et lett fotavtrykk bak unit'en, intervall skalerer med boss-størrelse.
    const nowMs = this.time.now;
    const footprintInterval = unit.boss ? 110 : 180;
    if (nowMs - unit.lastFootprintAt > footprintInterval) {
      unit.lastFootprintAt = nowMs;
      // Litt jitter slik at sporet er to-tå-aktig
      const nx = -tan.y, ny = tan.x;
      const side = (Math.floor(nowMs / footprintInterval) & 1) ? 1 : -1;
      const off = (unit.radius * 0.35) * side;
      this.vfx.footprint(p.x + nx * off, p.y + ny * off);
    }
  }

  /** Finn nærmeste fiende i samme lane innenfor søke-rekkevidde. */
  private findLaneEngagement(unit: UnitData) {
    const enemyFaction = unit.faction === 'player' ? 'ai' : 'player';
    let best: UnitData | null = null;
    let bestDist = unit.attackRange + 60;

    for (const other of this.units) {
      if (other.dead || other.faction !== enemyFaction) continue;
      if (other.lane !== unit.lane) continue;
      const d = Phaser.Math.Distance.Between(unit.x, unit.y, other.x, other.y);
      if (d < bestDist) { best = other; bestDist = d; }
    }

    if (best) {
      unit.attackTarget = best;
      unit.state = 'attacking';
    }
  }

  private updateAttacking(unit: UnitData, time: number, dt: number) {
    const target = unit.attackTarget!;
    const dist = Phaser.Math.Distance.Between(unit.x, unit.y, target.x, target.y);

    if (dist > unit.attackRange) {
      // Beveg deg langs spline mot target — bare juster laneT
      const lane = this.lanesById[unit.lane];
      this.advanceAlongLane(unit, lane, dt);
    } else if (time - unit.lastAttackAt >= unit.attackInterval) {
      unit.lastAttackAt = time;

      const fdx = target.x - unit.x; const fdy = target.y - unit.y; const fd = Math.hypot(fdx, fdy) || 1;
      unit.lastDx = fdx / fd; unit.lastDy = fdy / fd;

      const projColor = unit.faction === 'player' ? THEME.ATTACK_PROJECTILE_PLAYER : THEME.ATTACK_PROJECTILE_AI;
      this.vfx.fireProjectile(unit.x, unit.y, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);
      playSfx(this, 'attack', { volume: 0.16 });

      this.attackPounce(unit);

      let dmg = unit.damage;
      if (unit.faction === 'player') {
        if (this.modifiers.berserkDmgMul > 1 && unit.hp / unit.maxHp < 0.5) {
          dmg = Math.round(dmg * this.modifiers.berserkDmgMul);
        }
        if (this.modifiers.firstStrikeMul > 1 && !unit.firstAttackDone) {
          dmg = Math.round(dmg * this.modifiers.firstStrikeMul);
          this.vfx.floatText(unit.x, unit.y - 18, '🗡️', '#ffd86a');
        }
        if (this.adrenalineActive) dmg = Math.round(dmg * 2);
        unit.firstAttackDone = true;
      }
      target.hp -= dmg;
      if (unit.faction === 'player' && this.modifiers.lifestealPct > 0) {
        const heal = Math.round(dmg * this.modifiers.lifestealPct);
        if (heal > 0) unit.hp = Math.min(unit.maxHp, unit.hp + heal);
      }

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
        }
        unit.attackTarget = null;
        unit.state = 'moving';
      }
    }
  }

  /** Kort squash & stretch på antBody når unit angriper. */
  private attackPounce(unit: UnitData) {
    if (!unit.antBody || !unit.antBody.scene) return;
    const base = CONFIG.UNITS[unit.kind].bodyScale * (unit.boss ? 1.5 : 1.0);
    // Stopp tidligere pounce (skala-tweens kan stables) men la idle-bob/vinger leve.
    this.tweens.getTweensOf(unit.antBody)
      .filter(tw => (tw.data as Phaser.Tweens.TweenData[]).some(d => d.key === 'scaleX' || d.key === 'scaleY'))
      .forEach(tw => tw.stop());
    unit.antBody.setScale(base);
    this.tweens.add({
      targets: unit.antBody,
      scaleX: base * 1.25,
      scaleY: base * 0.78,
      duration: 70,
      ease: 'Quad.easeOut',
      yoyo: true,
      onComplete: () => {
        if (unit.dead || !unit.antBody.scene) return;
        unit.antBody.setScale(base);
      },
    });
  }

  private creepReachedBase(creep: UnitData) {
    this.playerBase.hp -= creep.damage * 3;
    this.cameras.main.shake(180, 0.005);
    this.vfx.impact(this.playerBase.x, this.playerBase.y);
    this.pulsePlayerBase();
    playSfx(this, 'attack', { volume: 0.3 });
    this.removeUnit(creep, false);
  }

  /** Rødt blunk + scale-pulse på maurtua når den blir truffet. */
  private pulsePlayerBase() {
    const b = this.playerBase;
    if (!b.body || !b.body.scene) return;
    const baseColor = b.bodyColor;
    b.body.setFillStyle(0xff4422, 0.55);
    b.body.setScale(1.08);
    this.tweens.add({
      targets: b.body,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: 'Quad.easeOut',
      onComplete: () => {
        if (b.body.scene) b.body.setFillStyle(baseColor, 0);
      },
    });
  }

  // ── Towers ─────────────────────────────────────────────────────────────

  private updateTowers(time: number) {
    for (const tower of this.towers) {
      if (tower.dead || tower.hp <= 0 || !tower.tower) continue;
      const t = tower.tower;
      if (time - t.lastFireAt < t.fireRate) continue;

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

      // Recoil + scale-pulse på tårn-container ved fyring.
      this.towerRecoil(tower, target.x, target.y);

      this.applyTowerHit(target, t.damage, t.slow, time);

      if (t.splash > 0) {
        // Splash-shockwave ring ved impact.
        this.vfx.shockwave(target.x, target.y, { color: 0xb0ff80, radius: t.splash, thickness: 3, duration: 360 });
        for (const u of this.units) {
          if (u === target || u.dead || u.faction !== 'ai') continue;
          const d = Phaser.Math.Distance.Between(target.x, target.y, u.x, u.y);
          if (d <= t.splash) this.applyTowerHit(u, Math.round(t.damage * 0.6), t.slow, time);
        }
      }
    }
  }

  /** Push tower-container kort tilbake fra target, deretter spring tilbake. */
  private towerRecoil(tower: BuildingData, tx: number, ty: number) {
    const c = tower.towerContainer;
    if (!c || !c.scene) return;
    const dx = tower.x - tx, dy = tower.y - ty;
    const d = Math.hypot(dx, dy) || 1;
    const kickX = (dx / d) * 4;
    const kickY = (dy / d) * 4;
    this.tweens.getTweensOf(c).filter(tw => (tw.data as Phaser.Tweens.TweenData[]).some(dd => dd.key === 'x' || dd.key === 'y' || dd.key === 'scaleX')).forEach(tw => tw.stop());
    c.setPosition(tower.x + kickX, tower.y + kickY);
    c.setScale(1.12, 0.92);
    this.tweens.add({
      targets: c,
      x: tower.x,
      y: tower.y,
      scaleX: 1,
      scaleY: 1,
      duration: 180,
      ease: 'Back.easeOut',
    });
  }

  private applyTowerHit(target: UnitData, damage: number, slow: number, time: number) {
    target.hp -= damage;
    if (slow > 0) {
      target.slowedUntil = time + CONFIG.TOWER_SLOW_DURATION;
      this.ensureWebOverlay(target);
    }
    for (const s of target.segments) s.setFillStyle(0xffffff);
    this.time.delayedCall(80, () => {
      if (!target.dead) for (const s of target.segments) s.setFillStyle(target.bodyColor);
    });
    if (target.hp <= 0) {
      playSfx(this, 'unit-die', { volume: 0.3 });
      this.removeUnit(target, true);
    }
  }

  /** Tegn spider-web-overlay på en sloweed unit. Auto-fjernes når slow utløper. */
  private ensureWebOverlay(unit: UnitData) {
    if (unit.webOverlay || unit.dead) return;
    const r = unit.radius * 1.1;
    const g = this.add.graphics();
    g.lineStyle(1, 0xeef2ff, 0.85);
    // Radielle tråder
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.lineBetween(0, 0, Math.cos(a) * r, Math.sin(a) * r);
    }
    // To konsentriske sirkler
    g.strokeCircle(0, 0, r * 0.45);
    g.strokeCircle(0, 0, r * 0.85);
    g.setAlpha(0.9);
    unit.container.add(g);
    unit.webOverlay = g;
  }

  // ── Tower build mode ───────────────────────────────────────────────────

  private isTowerKind(kind: BuildKind): kind is TowerKind {
    return kind === 'stinger' || kind === 'webber' || kind === 'spitter';
  }

  private startBuildMode(kind: TowerKind) {
    if (this.gameState !== 'running') return;
    if (this.upgradeOptions) return;
    if (!this.waveManager.isActive) {
      this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, 'Vent på bølgen', '#ffcc66');
      return;
    }
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

  private canPlaceTower(kind: TowerKind, x: number, y: number): boolean {
    if (this.gameState !== 'running') return false;
    if (!this.waveManager.isActive) return false;
    if (x < 60 || x > CONFIG.MAP_WIDTH - 60 || y < 40 || y > CONFIG.MAP_HEIGHT - 40) return false;
    // Ikke på en sti eller arena
    if (isOnLaneOrArena(x, y, this.lanesAll)) return false;
    // Ikke for nær spawnerne
    if (Phaser.Math.Distance.Between(x, y, this.enemyBase.x, this.enemyBase.y) < 80) return false;
    // Klaring til andre bygninger
    const c = CONFIG.TOWER_PLACE_CLEARANCE;
    for (const b of this.buildings) {
      if (b.dead || b.hp <= 0) continue;
      if (b.kind === 'base') continue;
      if (Phaser.Math.Distance.Between(x, y, b.x, b.y) < c) return false;
    }
    void kind;
    return true;
  }

  private updateBuildGhost(w: Vec2) {
    if (!this.buildMode) return;
    const kind = this.buildMode.kind;
    const spec = CONFIG.TOWER_TYPES[kind];
    const cost = this.towerCostFor(kind);
    const ok = this.canPlaceTower(kind, w.x, w.y) && this.playerGold >= cost;
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
    const cost = this.towerCostFor(kind);
    if (!this.canPlaceTower(kind, w.x, w.y) || this.playerGold < cost) return false;
    this.playerGold -= cost;
    this.statsGoldSpent += cost;
    this.createTower(kind, w.x, w.y, cost);
    this.spawnCommandRipple(w.x, w.y, 0xddff88);
    playSfx(this, 'train', { volume: 0.5 });
    return true;
  }

  private sellTower(b: BuildingData) {
    if (!b.tower || b.dead || b.hp <= 0) return;
    const refund = Math.floor(b.tower.builtCost * CONFIG.TOWER_SELL_REFUND);
    b.dead = true;
    b.towerContainer?.destroy();
    b.body.destroy();
    b.hpBg.destroy();
    b.hpFg.destroy();
    if (refund > 0) {
      this.playerGold += refund;
      this.vfx.floatText(b.x, b.y - 30, `+${refund}`, '#ffdd66');
    }
    this.spawnCommandRipple(b.x, b.y, 0xffaa22);
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
    if (!this.waveManager.isActive) return;
    const amount = CONFIG.PASSIVE_INCOME_PER_TICK + this.modifiers.passiveBonus;
    this.playerGold += amount;
    this.statsGoldEarned += amount;
  }

  // ── Input ──────────────────────────────────────────────────────────────

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
    if (pointer.rightButtonDown()) {
      const w = this.wp(pointer);
      const SELL_RADIUS = 40;
      const target = this.towers.find(t =>
        !t.dead && t.hp > 0 &&
        Phaser.Math.Distance.Between(w.x, w.y, t.x, t.y) <= SELL_RADIUS
      );
      if (target) this.sellTower(target);
    }
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
    if (this.upgradeOptions) return;
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
    if (this.upgradeOptions) return;
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

  // ── Upgrade-valg mellom bølger ─────────────────────────────────────────

  private beginUpgradeChoice() {
    const taken = new Set<UpgradeId>(this.takenUpgrades);
    this.upgradeOptions = pickThreeUpgrades(taken);
    // Pause spillet for valget
    if (this.gameSpeed !== 0) this.prePickSpeed = this.gameSpeed;
    this.gameSpeed = 0;
    this.applyGameSpeed();
    if (this.buildMode) this.cancelBuildMode();
    playSfx(this, 'train', { volume: 0.4 });
  }

  private resolveUpgradeChoice(id: string) {
    if (!this.upgradeOptions) return;
    const choice = this.upgradeOptions.find((u) => u.id === id) ?? findUpgrade(id);
    if (!choice) return;
    const api = {
      giveGold: (n: number) => { this.playerGold += n; this.statsGoldEarned += n; },
      healBase: (n: number) => { this.playerBase.hp = Math.min(this.playerBase.maxHp, this.playerBase.hp + n); },
      raiseBaseMaxHp: (n: number) => { this.playerBase.maxHp += n; },
      summonKing: () => this.summonAntKing(),
    };
    choice.apply(this.modifiers, api);
    this.takenUpgrades.push(choice.id);
    this.upgradeOptions = null;
    this.waveManager.resolveUpgradeChoice();
    // Resumér spillet i den hastigheten det var i før
    this.gameSpeed = this.prePickSpeed || CONFIG.DEFAULT_TIME_SCALE;
    this.applyGameSpeed();
    this.vfx.floatText(this.playerBase.x, this.playerBase.y - 80, choice.icon + ' ' + choice.name, '#ffdd66');
    playSfx(this, 'victory', { volume: 0.35 });
  }

  // ── Bananas-effekt-hjelpere ────────────────────────────────────────────

  /** Tordenslag på en tilfeldig AI-maur. */
  private fireThunderstrike() {
    const targets = this.units.filter((u) => u.faction === 'ai' && !u.dead);
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    const startX = target.x + Phaser.Math.Between(-40, 40);
    // Lyn-projektil fra "himmelen" ned til mål
    this.vfx.fireProjectile(startX, 0, target.x, target.y, 0xc8d8ff);
    this.vfx.impact(target.x, target.y);
    // Stor flash + kort kamera-shake
    const flash = this.add.circle(target.x, target.y, 6, 0xffffff, 1).setDepth(20);
    this.tweens.add({
      targets: flash,
      radius: 60,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => flash.destroy(),
    });
    this.cameras.main.shake(80, 0.0035);
    playSfx(this, 'attack', { volume: 0.45 });
    const dmg = 80;
    target.hp -= dmg;
    this.vfx.floatText(target.x, target.y - 18, `⚡ ${dmg}`, '#bbddff');
    for (const s of target.segments) s.setFillStyle(0xffffff);
    this.time.delayedCall(80, () => {
      if (!target.dead) for (const s of target.segments) s.setFillStyle(target.bodyColor);
    });
    if (target.hp <= 0) this.removeUnit(target, true);
  }

  /** Tick sopp-skyer: applisér DoT på nærliggende AI, kast skyer som har utløpt. */
  private tickSporeClouds(time: number) {
    for (let i = this.sporeClouds.length - 1; i >= 0; i--) {
      const cl = this.sporeClouds[i];
      if (time >= cl.expiresAtMs) {
        cl.gfx.destroy();
        this.sporeClouds.splice(i, 1);
        continue;
      }
      if (time - cl.lastTickAtMs >= cl.tickIntervalMs) {
        cl.lastTickAtMs = time;
        for (const u of [...this.units]) {
          if (u.dead || u.faction !== 'ai') continue;
          const d = Phaser.Math.Distance.Between(cl.x, cl.y, u.x, u.y);
          if (d <= cl.radius) {
            u.hp -= cl.dmgPerTick;
            if (u.hp <= 0) this.removeUnit(u, true, true);
          }
        }
      }
    }
  }

  /** Spawn en sopp-sky som ticker DoT på AI-maur i radius i 5 sekunder. */
  private createSporeCloud(x: number, y: number) {
    const radius = 70;
    const gfx = this.add.graphics().setDepth(2);
    gfx.fillStyle(0x6acc6a, 0.22);
    gfx.fillCircle(x, y, radius);
    gfx.lineStyle(1.5, 0x4a9a4a, 0.55);
    gfx.strokeCircle(x, y, radius);
    // Bittesmå sopp-prikker
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * radius * 0.85;
      gfx.fillStyle(0x9adc7a, 0.7);
      gfx.fillCircle(x + Math.cos(a) * r, y + Math.sin(a) * r, Phaser.Math.FloatBetween(1.5, 3));
    }
    this.tweens.add({
      targets: gfx,
      alpha: 0.4,
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
    this.sporeClouds.push({
      x, y, radius,
      dmgPerTick: 10,
      tickIntervalMs: 500,
      expiresAtMs: this.time.now + 5000,
      lastTickAtMs: this.time.now,
      gfx,
    });
  }

  /** Maurkongen: gigantisk Sumo (boss-versjon) i midt-lane som tanker fronten. */
  private summonAntKing() {
    const king = this.spawnUnit('player', 1, 'sumo', true);
    // Ekstra HP-buff slik at kongen virkelig er kongen
    king.maxHp = Math.round(king.maxHp * 2);
    king.hp = king.maxHp;
    this.statsSoldiersTrained++;
    this.spawnCommandRipple(king.x, king.y, 0xffd86a);
    this.vfx.floatText(king.x, king.y - 24, '🤴 KONGEN', '#ffd86a');
    playSfx(this, 'victory', { volume: 0.6 });
  }

  // ── HUD-broen ──────────────────────────────────────────────────────────

  private handleHudCommand(c: HudCommand) {
    switch (c.type) {
      case 'send-lane':
        this.sendLaneUnit(c.lane, c.unitKind);
        break;
      case 'start-wave':
        this.waveManager.startNextWave();
        break;
      case 'select-upgrade':
        this.resolveUpgradeChoice(c.id);
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
    }
  }

  /** Lane-portal: verdens-koord der lane-knappen skal floate over kartet. */
  private lanePortalPos(lane: 0 | 1 | 2): { worldX: number; worldY: number } {
    // Plasser portalene radielt rundt player-basen så de ikke overlapper hverandre.
    // Nord-lane peker oppover, Sør nedover; Midt rett øst.
    const bx = CONFIG.PLAYER_BASE_X;
    const by = CONFIG.PLAYER_BASE_Y;
    const r = 165;  // avstand fra base
    const angles: { [k in 0 | 1 | 2]: number } = { 0: -0.95, 1: 0.0, 2: 0.95 };  // radianer
    const a = angles[lane];
    return {
      worldX: bx + Math.cos(a) * r,
      worldY: by + Math.sin(a) * r,
    };
  }

  private emitHudState() {
    const players = this.units.filter((u) => u.faction === 'player' && !u.dead);
    const ais = this.units.filter((u) => u.faction === 'ai' && !u.dead);

    const minimapUnits: HudUnit[] = this.units
      .filter((u) => !u.dead)
      .map((u) => ({ x: u.x, y: u.y, faction: u.faction, kind: u.kind }));
    const minimapBuildings: HudBuilding[] = this.buildings.map((b) => ({
      x: b.x, y: b.y, w: b.w, h: b.h,
      faction: b.faction,
      kind: b.kind,
      hp: b.hp, maxHp: b.maxHp,
      towerType: b.kind === 'tower' && b.tower ? b.tower.type : undefined,
    }));

    // Lane-portaler — kun for aktive laner (basert på nåværende stage).
    const activeLanes = this.currentStageIndex >= 0
      ? CONFIG.STAGES[this.currentStageIndex].activeLanes
      : ([0, 1, 2] as ReadonlyArray<0 | 1 | 2>);
    const lanePortals: HudLanePortal[] = activeLanes.map((i) => {
      const p = this.lanePortalPos(i);
      return { lane: i, worldX: p.worldX, worldY: p.worldY };
    });

    // Lane-tellinger (egne soldater per lane)
    const laneCounts: [number, number, number] = [0, 0, 0];
    for (const u of players) laneCounts[u.lane]++;

    const nextDef = this.waveManager.nextWaveDef;
    const waveMode: HudWaveState = {
      current: this.waveManager.displayWave,
      total: this.waveManager.totalWaves,
      active: this.waveManager.isActive,
      idle: this.waveManager.isIdle,
      inCountdown: this.waveManager.isCountdown,
      countdownRemainingMs: this.waveManager.countdownRemainingMs,
      upcomingWaveNumber: this.waveManager.nextWaveNumber,
      nextWavePreview: nextDef ? { soldiers: nextDef.soldiers, lane: nextDef.lane, unitKind: nextDef.unitKind, boss: nextDef.boss } : undefined,
      remainingEnemies: ais.length + this.waveManager.remainingInWave,
      choosingUpgrade: this.waveManager.isChoosingUpgrade,
    };

    let upgradeChoice: HudUpgradeChoice | null = null;
    if (this.upgradeOptions) {
      upgradeChoice = {
        clearedWave: this.waveManager.displayWave,
        options: this.upgradeOptions.map((u) => ({
          id: u.id, name: u.name, description: u.description,
          flavor: u.flavor, rarity: u.rarity, icon: u.icon,
        })),
        taken: this.takenUpgrades.map((id) => {
          const def = findUpgrade(id);
          return { id, name: def?.name ?? id, icon: def?.icon ?? '•' };
        }),
      };
    }

    const s: HudState = {
      state: this.gameState,
      time: this.gameTime,
      player: {
        gold: this.playerGold,
        soldiers: players.length,
        baseHp: this.playerBase.hp, baseMaxHp: this.playerBase.maxHp,
      },
      enemy: {
        soldiers: ais.length,
        baseHp: this.enemyBase.hp,
        baseMaxHp: this.enemyBase.maxHp,
      },
      costs: {
        light: this.unitCostFor('light'),
        medium: this.unitCostFor('medium'),
        heavy: this.unitCostFor('heavy'),
        sumo: this.unitCostFor('sumo'),
        wasp: this.unitCostFor('wasp'),
        termite: this.unitCostFor('termite'),
      },
      unlockedUnits: [...this.modifiers.unlockedUnits],
      towerCosts: {
        stinger: this.towerCostFor('stinger'),
        webber: this.towerCostFor('webber'),
        spitter: this.towerCostFor('spitter'),
      },
      map: { width: CONFIG.MAP_WIDTH, height: CONFIG.MAP_HEIGHT },
      minimap: { units: minimapUnits, buildings: minimapBuildings },
      stats: {
        soldiersTrained: this.statsSoldiersTrained,
        goldEarned: this.statsGoldEarned,
        goldSpent: this.statsGoldSpent,
        enemyKills: this.statsEnemyKills,
        unitsLost: this.statsUnitsLost,
        playerTowers: this.towers.filter(t => !t.dead && t.hp > 0).length,
      },
      lanePortals,
      laneCounts,
      gameSpeed: this.gameSpeed,
      alert: this.currentAlert ? { ...this.currentAlert } : null,
      buildMode: this.buildMode ? ({
        kind: this.buildMode.kind,
        cost: this.towerCostFor(this.buildMode.kind),
        canAfford: this.playerGold >= this.towerCostFor(this.buildMode.kind),
      } satisfies HudBuildMode) : null,
      waveMode,
      upgradeChoice,
      activeUpgrades: this.takenUpgrades.map((id) => {
        const def = findUpgrade(id);
        return {
          id,
          name: def?.name ?? id,
          description: def?.description ?? '',
          icon: def?.icon ?? '•',
          rarity: def?.rarity ?? 'common',
        };
      }),
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
    this.metricsEl.setAttribute('data-ai-base-hp', String(Math.max(0, this.enemyBase.hp)));
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
