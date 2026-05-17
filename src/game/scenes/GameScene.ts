import Phaser from 'phaser';
import { CONFIG } from '../config';
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
  body: Phaser.GameObjects.Arc;
  bodyColor: number;
  hpBg: Phaser.GameObjects.Rectangle;
  hpFg: Phaser.GameObjects.Rectangle;
  selectionRing: Phaser.GameObjects.Arc;
  selectionTween: Phaser.Tweens.Tween | null;
  directionDot: Phaser.GameObjects.Arc;
  radius: number;
  lastDx: number; lastDy: number;
}

interface BuildingData {
  id: number;
  kind: 'base' | 'barracks' | 'mine';
  faction: 'player' | 'ai' | 'neutral';
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  body: Phaser.GameObjects.Rectangle;
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
  private trainPanel: Phaser.GameObjects.Container | null = null;
  private trainPanelBounds: Phaser.Geom.Rectangle | null = null;

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

    // Background — gradient (cool blue on player side → warm red on AI side)
    const bg = this.add.graphics().setDepth(0);
    bg.fillGradientStyle(0x14233a, 0x2a1418, 0x0a1424, 0x1f0d12, 1);
    bg.fillRect(0, 0, W, H);

    // Subtle noise/dust — one-off pass, no runtime cost
    const noise = this.add.graphics().setDepth(0);
    for (let i = 0; i < 220; i++) {
      const nx = Phaser.Math.Between(0, W);
      const ny = Phaser.Math.Between(0, H);
      const nr = Phaser.Math.FloatBetween(0.5, 1.8);
      noise.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.02, 0.06));
      noise.fillCircle(nx, ny, nr);
    }

    // Vignette — subtle darkening at edges
    const vignette = this.add.graphics().setDepth(0);
    vignette.fillStyle(0x000000, 0.35);
    vignette.fillRect(0, 0, W, 60);
    vignette.fillRect(0, H - 60, W, 60);
    vignette.fillRect(0, 0, 60, H);
    vignette.fillRect(W - 60, 0, 60, H);

    // Grid lines
    const g = this.add.graphics().setDepth(0);
    g.lineStyle(1, 0x1e2d3d, 0.6);
    for (let y = 0; y <= H; y += 80) g.lineBetween(0, y, W, y);
    for (let x = 0; x <= W; x += 80) g.lineBetween(x, 0, x, H);

    // Center divider
    g.lineStyle(2, 0x553344, 0.7);
    g.lineBetween(W / 2, 0, W / 2, H);

    // Drag selection box
    this.dragRect = this.add.rectangle(0, 0, 1, 1, 0x4488ff, 0.15)
      .setStrokeStyle(1, 0x4488ff, 0.8)
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
      fontSize: '16px', color: '#ffd700', fontFamily: 'monospace',
    }).setDepth(25);

    this.add.text(W - 12, 12, 'Click barracks to train  |  Right-click to command', {
      fontSize: '12px', color: '#556677', fontFamily: 'monospace',
    }).setOrigin(1, 0).setDepth(25);

    // Input
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

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
    const color = faction === 'player' ? 0x2255aa : faction === 'ai' ? 0xaa2222 : 0xaa8822;
    const c = Phaser.Display.Color.IntegerToColor(color);
    const topColor = Phaser.Display.Color.GetColor(
      Math.min(255, c.red + 50), Math.min(255, c.green + 50), Math.min(255, c.blue + 50));
    const baseColor = Phaser.Display.Color.GetColor(
      Math.max(0, c.red - 50), Math.max(0, c.green - 50), Math.max(0, c.blue - 50));

    // Drop shadow
    this.add.ellipse(x + 4, y + h / 2 + 6, w * 1.1, 10, 0x000000, 0.5).setDepth(1);

    // Main body (still tracked for HP/damage operations)
    const body = this.add.rectangle(x, y, w, h, color).setDepth(2);

    // 3D overlays: brighter top half, darker base
    this.add.rectangle(x, y - h / 4, w, h / 2, topColor).setDepth(3).setAlpha(0.55);
    this.add.rectangle(x, y + h / 4, w - 4, h / 2, baseColor).setDepth(3).setAlpha(0.7);

    // Thin highlight on top edge
    this.add.rectangle(x, y - h / 2 + 1, w, 2, 0xffffff, 0.35).setDepth(4);

    const hpBg = this.add.rectangle(x, y - h / 2 - 7, 44, 5, 0x222222).setDepth(5).setVisible(false);
    const hpFg = this.add.rectangle(x - 22, y - h / 2 - 7, 44, 5, 0x44ee44)
      .setOrigin(0, 0.5).setDepth(5).setVisible(false);

    const labelText = kind === 'base' ? 'BASE' : kind === 'barracks' ? 'BRCK' : 'MINE';
    this.add.text(x, y, labelText, {
      fontSize: '10px', color: '#ffffff', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(4);

    const b: BuildingData = { id: this.nextId++, kind, faction, x, y, w, h, hp, maxHp: hp, body, bodyColor: color, hpBg, hpFg };
    this.buildings.push(b);
    return b;
  }

  private createMine(x: number, y: number): MineData {
    // Drop shadow
    this.add.ellipse(x + 3, y + 26, 46, 8, 0x000000, 0.5).setDepth(1);

    // Shimmer halo
    const halo = this.add.arc(x, y, 30, 0, 360, false, 0xffcc33, 0.2).setDepth(1);
    this.tweens.add({
      targets: halo,
      scale: 1.25,
      alpha: 0.05,
      yoyo: true,
      repeat: -1,
      duration: 1200,
      ease: 'Sine.easeInOut',
    });

    const body = this.add.rectangle(x, y, 42, 42, 0x886600).setDepth(2);

    // Top/base layers for 3D feel
    this.add.rectangle(x, y - 10, 42, 22, 0xddaa22).setDepth(3).setAlpha(0.7);
    this.add.rectangle(x, y + 11, 38, 20, 0x553300).setDepth(3).setAlpha(0.7);
    this.add.rectangle(x, y - 20, 42, 2, 0xffee88, 0.6).setDepth(4);

    const hpBg = this.add.rectangle(x, y - 28, 38, 4, 0x222222).setDepth(5).setVisible(false);
    const hpFg = this.add.rectangle(x - 19, y - 28, 38, 4, 0xffcc00).setOrigin(0, 0.5).setDepth(5).setVisible(false);
    this.add.text(x, y, '⬡', { fontSize: '18px', color: '#ffee88', fontStyle: 'bold' }).setOrigin(0.5).setDepth(4);

    const mine: MineData = {
      id: this.nextId++, kind: 'mine', faction: 'neutral',
      x, y, w: 42, h: 42, hp: 9999, maxHp: 9999, body, bodyColor: 0x886600, hpBg, hpFg,
    };
    this.buildings.push(mine);
    this.mines.push(mine);
    return mine;
  }

  private spawnUnit(faction: 'player' | 'ai', type: 'worker' | 'soldier', x: number, y: number): UnitData {
    const isSoldier = type === 'soldier';
    const isPlayer = faction === 'player';
    const r = isSoldier ? 12 : 9;
    const bodyColor = isPlayer
      ? (isSoldier ? 0x4488ff : 0x2255aa)
      : (isSoldier ? 0xff4444 : 0xaa2222);

    const c = Phaser.Display.Color.IntegerToColor(bodyColor);
    const glowColor = Phaser.Display.Color.GetColor(
      Math.min(255, c.red + 80), Math.min(255, c.green + 80), Math.min(255, c.blue + 80));
    const dotColor = Phaser.Display.Color.GetColor(
      Math.min(255, c.red + 130), Math.min(255, c.green + 130), Math.min(255, c.blue + 130));

    // Footprint (faction-colored ring on the ground)
    const footprint = this.add.ellipse(0, r * 0.5, r * 2.1, r * 0.7, bodyColor, 0.25);

    // Drop shadow
    const shadow = this.add.ellipse(2, r * 0.4, r * 1.8, r * 0.7, 0x000000, 0.45);

    // Main body
    const body = this.add.arc(0, 0, r, 0, 360, false, bodyColor);

    // Inner glow (offset highlight)
    const glow = this.add.arc(-r * 0.35, -r * 0.35, r * 0.45, 0, 360, false, glowColor)
      .setAlpha(0.55);

    // Outline ring
    const outline = this.add.arc(0, 0, r, 0, 360, false, 0x000000, 0)
      .setStrokeStyle(1.5, 0x0a0a14, 0.8);

    // Direction indicator (small bright dot pointing forward)
    const dirDot = this.add.arc(r * 0.55, 0, 2.6, 0, 360, false, dotColor);

    const hpBg = this.add.rectangle(0, -r - 7, r * 2, 4, 0x111111).setStrokeStyle(1, 0x000000, 0.5);
    const hpFg = this.add.rectangle(-r, -r - 7, r * 2, 4, 0x44ee44).setOrigin(0, 0.5);
    const selRing = this.add.arc(0, 0, r + 5, 0, 360, false, 0xffffff, 0)
      .setStrokeStyle(2, 0xffffff, 1).setVisible(false);

    // Hide HP bar at full health
    hpBg.setVisible(false);
    hpFg.setVisible(false);

    const container = this.add.container(x, y, [footprint, shadow, body, glow, outline, dirDot, hpBg, hpFg, selRing]).setDepth(5);

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
      container, body, bodyColor, hpBg, hpFg, selectionRing: selRing,
      selectionTween: null, directionDot: dirDot, radius: r,
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
      `Gold: ${this.playerGold}g   Soldiers: ${ps}   Workers: ${pw}` +
      `        AI Gold: ${this.aiGold}g   AI Soldiers: ${as_}`
    );
  }

  // ── Unit behavior ────────────────────────────────────────────────────────

  private updateUnit(unit: UnitData, time: number, dt: number) {
    unit.container.setPosition(unit.x, unit.y);
    unit.selectionRing.setVisible(unit.selected);

    // Idle-bob: subtle sine offset on body + glow only (HP/selection/footprint stay anchored)
    const bob = Math.sin((time + unit.id * 137) * 0.004) * 1.4;
    unit.body.y = bob;

    // Direction dot: point toward last movement vector (only when moving/attacking)
    if (unit.state === 'moving' || unit.state === 'attacking') {
      unit.directionDot.setPosition(unit.lastDx * unit.radius * 0.55, unit.lastDy * unit.radius * 0.55 + bob);
      unit.directionDot.setVisible(true);
    } else {
      unit.directionDot.setVisible(false);
    }

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

      // Projectile + impact
      const projColor = unit.faction === 'player' ? 0x88ccff : 0xff9966;
      this.vfx.fireProjectile(unit.x, unit.y, target.x, target.y, projColor);
      this.vfx.impact(target.x, target.y);

      target.hp -= unit.damage;

      // Damage tint — flash white briefly
      if (isUnit(target)) {
        target.body.setFillStyle(0xffffff);
        this.time.delayedCall(80, () => {
          if (!target.dead) target.body.setFillStyle(target.bodyColor);
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
    if (!this.pointerIsDown) return;
    const dx = pointer.x - this.dragStart.x;
    const dy = pointer.y - this.dragStart.y;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
      this.isDragging = true;
      const minX = Math.min(pointer.x, this.dragStart.x);
      const minY = Math.min(pointer.y, this.dragStart.y);
      this.dragRect.setPosition(minX, minY).setSize(Math.abs(dx), Math.abs(dy)).setVisible(true);
    }
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
        for (const u of this.selectedUnits.filter(u => u.type === 'worker')) {
          u.mineTarget = mine;
          u.state = 'moving';
          u.moveTarget = { x: mine.x, y: mine.y };
        }
        return;
      }
    }

    // Attack enemy unit
    const enemyUnit = this.hitUnit(pointer, 'ai');
    if (enemyUnit) {
      for (const u of this.selectedUnits.filter(u => u.type === 'soldier')) {
        u.attackTarget = enemyUnit;
        u.state = 'attacking';
      }
      return;
    }

    // Attack enemy building
    for (const b of [this.aiBase, this.aiBarracks]) {
      if (b.hp > 0 && Math.abs(pointer.x - b.x) < b.w / 2 + 6 && Math.abs(pointer.y - b.y) < b.h / 2 + 6) {
        for (const u of this.selectedUnits.filter(u => u.type === 'soldier')) {
          u.attackTarget = b;
          u.state = 'attacking';
        }
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
    const px = x + 90;
    const py = y - h / 2 - 5;
    const pw = 178; const ph = 68;

    const bg = this.add.rectangle(0, 0, pw, ph, 0x0d1a2a, 0.96)
      .setStrokeStyle(1, 0x3366aa, 1);

    const title = this.add.text(0, -ph / 2 + 9, 'TRAIN', {
      fontSize: '11px', color: '#3366aa', fontFamily: 'monospace', fontStyle: 'bold',
    }).setOrigin(0.5, 0);

    const makeBtn = (label: string, yOff: number, cb: () => void) => {
      const btn = this.add.text(-pw / 2 + 10, yOff, label, {
        fontSize: '13px', color: '#99bbdd', fontFamily: 'monospace',
      }).setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffffff'));
      btn.on('pointerout', () => btn.setColor('#99bbdd'));
      btn.on('pointerdown', (p: Phaser.Input.Pointer) => { p.event.stopPropagation(); cb(); });
      return btn;
    };

    const wBtn = makeBtn(`Worker   ${CONFIG.WORKER_COST}g`, -8, () => this.trainUnit('worker'));
    const sBtn = makeBtn(`Soldier  ${CONFIG.SOLDIER_COST}g`, 14, () => this.trainUnit('soldier'));

    this.trainPanel = this.add.container(px, py, [bg, title, wBtn, sBtn]).setDepth(30);
    this.trainPanelBounds = new Phaser.Geom.Rectangle(px - pw / 2, py - ph / 2, pw, ph);
  }

  private closeTrainPanel() {
    this.trainPanel?.destroy();
    this.trainPanel = null;
    this.trainPanelBounds = null;
  }

  private trainUnit(type: 'worker' | 'soldier') {
    if (this.playerBarracks.hp <= 0) return;
    const cost = type === 'worker' ? CONFIG.WORKER_COST : CONFIG.SOLDIER_COST;
    if (this.playerGold < cost) return;
    this.playerGold -= cost;
    this.statsTrained += 1;
    const { x, y } = this.playerBarracks;
    this.spawnUnit('player', type, x + Phaser.Math.Between(-22, 22), y + Phaser.Math.Between(-22, 22));
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
      if (playerGain > 0) this.vfx.floatText(mine.x - 8, mine.y - 24, `+${playerGain}`, '#ffd700');
      if (aiGain > 0) this.vfx.floatText(mine.x + 8, mine.y - 24, `+${aiGain}`, '#ff9966');
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
    const titleColor = result === 'won' ? '#ffd700' : '#ff5555';
    const title = this.add.text(W / 2, H / 2 - 60, result === 'won' ? 'VICTORY' : 'DEFEAT', {
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
      `Soldiers trained: ${this.statsTrained}    Gold mined: ${this.statsGoldEarned}g    Time: ${timeStr}`,
      { fontSize: '16px', color: '#bbccdd', fontFamily: 'monospace' },
    ).setOrigin(0.5).setDepth(51).setAlpha(0);
    this.tweens.add({ targets: stats, alpha: 1, duration: 500, delay: 600 });

    // Restart hint
    const hint = this.add.text(W / 2, H / 2 + 70, 'Press  R  to restart', {
      fontSize: '20px', color: '#888899', fontFamily: 'monospace',
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
