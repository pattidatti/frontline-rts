// Liv i kartet: mariehøner, sommerfugler og én frosk.
// Mariehøner og sommerfugler er rene atmosfære-elementer (ingen gameplay-effekt).
// Frosken sitter i gresset og dreper én tilfeldig creep med tunga av og til —
// ingen bounty (siden den ikke ble drept av spilleren).

import Phaser from 'phaser';
import { CONFIG, THEME } from './config';
import { isOnLaneOrArena, type LanesAll } from './lanes';

export interface WildlifeCreep { id: number; x: number; y: number; }

export interface WildlifeAPI {
  /** Returner aktiv lane-geometri (kan endre seg når stages åpner). */
  getLanes(): LanesAll;
  /** Finn nærmeste levende AI-creep innenfor `range` fra (x,y). */
  findCreepNear(x: number, y: number, range: number): WildlifeCreep | null;
  /** Drep creep uten å gi bounty (ble spist av frosken). */
  eatCreep(id: number): void;
}

interface Ladybug {
  container: Phaser.GameObjects.Container;
  x: number; y: number;
  targetX: number; targetY: number;
  pauseUntil: number;       // scene-time (ms)
  facing: number;           // radians
}

interface Butterfly {
  container: Phaser.GameObjects.Container;
  wingL: Phaser.GameObjects.Graphics;
  wingR: Phaser.GameObjects.Graphics;
  x: number; y: number;
  targetX: number; targetY: number;
  flapPhase: number;
  bobPhase: number;
  color: number;
}

type FrogState = 'idle' | 'striking' | 'retracting' | 'hopping';

interface Frog {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Ellipse;
  tongue: Phaser.GameObjects.Graphics;
  x: number; y: number;
  state: FrogState;
  // timers (alle i scene-time ms)
  nextStrikeAt: number;
  relocateAt: number;
  strikeStartedAt: number;
  // strike-tilstand
  targetCreepId: number | null;
  targetX: number; targetY: number;
  caughtCreepX: number; caughtCreepY: number;
  caughtCreepId: number | null;
  // hop-animasjon
  hopStartedAt: number;
  hopFromX: number; hopFromY: number;
  hopToX: number; hopToY: number;
}

const STRIKE_EXTEND_MS = 220;
const STRIKE_HOLD_MS = 80;
const STRIKE_RETRACT_MS = 260;
const HOP_DURATION_MS = 600;

export class WildlifeManager {
  private scene: Phaser.Scene;
  private api: WildlifeAPI;
  private ladybugs: Ladybug[] = [];
  private butterflies: Butterfly[] = [];
  private frog: Frog | null = null;

  constructor(scene: Phaser.Scene, api: WildlifeAPI) {
    this.scene = scene;
    this.api = api;
    this.spawnAll();
  }

  destroy() {
    for (const lb of this.ladybugs) lb.container.destroy();
    for (const bf of this.butterflies) bf.container.destroy();
    if (this.frog) this.frog.container.destroy();
    this.ladybugs = [];
    this.butterflies = [];
    this.frog = null;
  }

  private spawnAll() {
    const W = CONFIG.MAP_WIDTH;
    const H = CONFIG.MAP_HEIGHT;

    for (let i = 0; i < CONFIG.WILDLIFE.LADYBUG_COUNT; i++) {
      const pos = this.randomGrassPoint(20, 60);
      if (!pos) continue;
      this.ladybugs.push(this.createLadybug(pos.x, pos.y));
    }

    for (let i = 0; i < CONFIG.WILDLIFE.BUTTERFLY_COUNT; i++) {
      const x = Phaser.Math.Between(40, W - 40);
      const y = Phaser.Math.Between(40, H - 200);
      this.butterflies.push(this.createButterfly(x, y));
    }

    const frogPos = this.randomGrassPoint(
      CONFIG.WILDLIFE.FROG_LANE_CLEARANCE,
      CONFIG.WILDLIFE.FROG_BASE_CLEARANCE,
    );
    if (frogPos) this.frog = this.createFrog(frogPos.x, frogPos.y);

    void H;
  }

  // ── Tick ───────────────────────────────────────────────────────────────

  tick(time: number, dt: number) {
    for (const lb of this.ladybugs) this.tickLadybug(lb, time, dt);
    for (const bf of this.butterflies) this.tickButterfly(bf, time, dt);
    if (this.frog) this.tickFrog(this.frog, time, dt);
  }

  // ── Ladybug ────────────────────────────────────────────────────────────

  private createLadybug(x: number, y: number): Ladybug {
    const g = this.scene.add.container(x, y).setDepth(2);

    // Skygge
    const shadow = this.scene.add.ellipse(0.6, 1, 9, 5, 0x000000, 0.35);
    // Kropp (rød)
    const body = this.scene.add.ellipse(0, 0, 9, 7, THEME.LADYBUG_RED);
    // Linje langs midten (vinge-skille)
    const split = this.scene.add.rectangle(0, 0, 0.8, 6, THEME.LADYBUG_DARK);
    // Prikker (4 stk)
    const spotA = this.scene.add.circle(-2, -1.2, 0.9, THEME.LADYBUG_DARK);
    const spotB = this.scene.add.circle(2, -1.2, 0.9, THEME.LADYBUG_DARK);
    const spotC = this.scene.add.circle(-2, 1.4, 0.9, THEME.LADYBUG_DARK);
    const spotD = this.scene.add.circle(2, 1.4, 0.9, THEME.LADYBUG_DARK);
    // Hode
    const head = this.scene.add.ellipse(0, -3.6, 4, 3, THEME.LADYBUG_DARK);
    // Antenner
    const antennaL = this.scene.add.line(0, 0, -0.6, -4.2, -1.6, -6, THEME.LADYBUG_DARK, 0.9).setLineWidth(0.5);
    const antennaR = this.scene.add.line(0, 0, 0.6, -4.2, 1.6, -6, THEME.LADYBUG_DARK, 0.9).setLineWidth(0.5);

    g.add([shadow, body, split, spotA, spotB, spotC, spotD, head, antennaL, antennaR]);

    const target = this.pickLadybugTarget(x, y);
    return {
      container: g,
      x, y,
      targetX: target.x, targetY: target.y,
      pauseUntil: 0,
      facing: 0,
    };
  }

  private pickLadybugTarget(fromX: number, fromY: number): { x: number; y: number } {
    const R = CONFIG.WILDLIFE.LADYBUG_WANDER_RADIUS;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 12 + Math.random() * R;
      const nx = fromX + Math.cos(a) * d;
      const ny = fromY + Math.sin(a) * d;
      if (this.isClearGrass(nx, ny, 14, 30)) return { x: nx, y: ny };
    }
    // Fallback: stå stille
    return { x: fromX, y: fromY };
  }

  private tickLadybug(lb: Ladybug, time: number, dt: number) {
    if (time < lb.pauseUntil) return;

    const dx = lb.targetX - lb.x;
    const dy = lb.targetY - lb.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 4) {
      // Nådd mål — ta en pause, så plukk nytt
      lb.pauseUntil = time + Phaser.Math.Between(
        CONFIG.WILDLIFE.LADYBUG_PAUSE_MIN_MS,
        CONFIG.WILDLIFE.LADYBUG_PAUSE_MAX_MS,
      );
      const t = this.pickLadybugTarget(lb.x, lb.y);
      lb.targetX = t.x;
      lb.targetY = t.y;
      return;
    }

    const speed = CONFIG.WILDLIFE.LADYBUG_SPEED;
    const step = speed * dt;
    const k = Math.min(step / dist, 1);
    lb.x += dx * k;
    lb.y += dy * k;
    lb.facing = Math.atan2(dy, dx);
    lb.container.x = lb.x;
    lb.container.y = lb.y;
    // Roter slik at hode peker fremover (sprite peker mot -y)
    lb.container.rotation = lb.facing + Math.PI / 2;
  }

  // ── Butterfly ──────────────────────────────────────────────────────────

  private createButterfly(x: number, y: number): Butterfly {
    const c = this.scene.add.container(x, y).setDepth(9);

    const colorChoices = [THEME.BUTTERFLY_WING_A, THEME.BUTTERFLY_WING_B, THEME.BUTTERFLY_WING_C];
    const color = colorChoices[Phaser.Math.Between(0, colorChoices.length - 1)];

    // Skygge på bakken
    const shadow = this.scene.add.ellipse(0, 14, 10, 3, 0x000000, 0.25);

    const wingL = this.scene.add.graphics();
    const wingR = this.scene.add.graphics();
    this.drawButterflyWing(wingL, color, -1);
    this.drawButterflyWing(wingR, color, +1);

    // Kropp
    const body = this.scene.add.ellipse(0, 0, 2, 9, THEME.BUTTERFLY_BODY);
    const head = this.scene.add.circle(0, -5, 1.4, THEME.BUTTERFLY_BODY);

    c.add([shadow, wingL, wingR, body, head]);

    const target = this.pickButterflyTarget();

    return {
      container: c,
      wingL, wingR,
      x, y,
      targetX: target.x,
      targetY: target.y,
      flapPhase: Math.random() * Math.PI * 2,
      bobPhase: Math.random() * Math.PI * 2,
      color,
    };
  }

  private drawButterflyWing(g: Phaser.GameObjects.Graphics, color: number, side: 1 | -1) {
    g.clear();
    // Øvre vinge
    g.fillStyle(color, 0.92);
    g.beginPath();
    g.moveTo(0, -1);
    g.lineTo(side * 11, -7);
    g.lineTo(side * 13, -2);
    g.lineTo(side * 4, 1);
    g.closePath();
    g.fillPath();
    // Nedre vinge
    g.fillStyle(color, 0.85);
    g.beginPath();
    g.moveTo(0, 1);
    g.lineTo(side * 9, 7);
    g.lineTo(side * 4, 3);
    g.closePath();
    g.fillPath();
    // Lite mørkt aksent
    g.fillStyle(THEME.BUTTERFLY_BODY, 0.5);
    g.fillCircle(side * 7, -3, 1.2);
  }

  private pickButterflyTarget(): { x: number; y: number } {
    return {
      x: Phaser.Math.Between(40, CONFIG.MAP_WIDTH - 40),
      y: Phaser.Math.Between(40, CONFIG.MAP_HEIGHT - 240),
    };
  }

  private tickButterfly(bf: Butterfly, _time: number, dt: number) {
    const dx = bf.targetX - bf.x;
    const dy = bf.targetY - bf.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 24) {
      const t = this.pickButterflyTarget();
      bf.targetX = t.x;
      bf.targetY = t.y;
      return;
    }

    const speed = CONFIG.WILDLIFE.BUTTERFLY_SPEED;
    const step = speed * dt;
    const k = Math.min(step / dist, 1);
    bf.x += dx * k;
    bf.y += dy * k;

    // Vertikal bobbing
    bf.bobPhase += dt * 2.2;
    const bob = Math.sin(bf.bobPhase) * CONFIG.WILDLIFE.BUTTERFLY_BOB_AMP * 0.05;

    bf.container.x = bf.x;
    bf.container.y = bf.y + bob;

    // Vingeflapp via scaleX
    bf.flapPhase += dt * CONFIG.WILDLIFE.BUTTERFLY_FLAP_HZ * Math.PI * 2;
    const flap = 0.35 + 0.65 * Math.abs(Math.cos(bf.flapPhase));
    bf.wingL.scaleX = flap;
    bf.wingR.scaleX = flap;

    // Pek litt mot retning
    const facing = Math.atan2(dy, dx);
    bf.container.rotation = facing + Math.PI / 2;
  }

  // ── Frog ───────────────────────────────────────────────────────────────

  private createFrog(x: number, y: number): Frog {
    const c = this.scene.add.container(x, y).setDepth(2);

    // Skygge
    const shadow = this.scene.add.ellipse(2, 8, 38, 9, 0x000000, 0.4);
    // Bak-bena (sittende profil — to flate ovaler under kroppen)
    const legL = this.scene.add.ellipse(-12, 5, 16, 8, THEME.FROG_BODY_DARK);
    const legR = this.scene.add.ellipse(12, 5, 16, 8, THEME.FROG_BODY_DARK);
    // Mage (lysere)
    const belly = this.scene.add.ellipse(0, 4, 28, 14, THEME.FROG_BELLY);
    // Kropp
    const body = this.scene.add.ellipse(0, 0, 32, 22, THEME.FROG_BODY);
    // Mørkere flekker
    const spotA = this.scene.add.circle(-9, -2, 2.6, THEME.FROG_BODY_DARK, 0.7);
    const spotB = this.scene.add.circle(7, -4, 2.2, THEME.FROG_BODY_DARK, 0.7);
    const spotC = this.scene.add.circle(2, 5, 1.8, THEME.FROG_BODY_DARK, 0.7);
    // Øye-baser (utstikkende oppe)
    const eyeBumpL = this.scene.add.ellipse(-7, -9, 9, 9, THEME.FROG_BODY);
    const eyeBumpR = this.scene.add.ellipse(7, -9, 9, 9, THEME.FROG_BODY);
    // Øyne
    const eyeL = this.scene.add.circle(-7, -10, 3, THEME.FROG_EYE);
    const eyeR = this.scene.add.circle(7, -10, 3, THEME.FROG_EYE);
    // Pupiller
    const pupilL = this.scene.add.ellipse(-7, -10, 1.4, 3, THEME.FROG_PUPIL);
    const pupilR = this.scene.add.ellipse(7, -10, 1.4, 3, THEME.FROG_PUPIL);
    // Munn (smal mørk linje)
    const mouth = this.scene.add.rectangle(0, 3, 14, 1.2, THEME.FROG_BODY_DARK);

    // Tunge — egen graphics tegnes per tick
    const tongue = this.scene.add.graphics();

    c.add([shadow, legL, legR, body, belly, spotA, spotB, spotC, mouth,
      eyeBumpL, eyeBumpR, eyeL, eyeR, pupilL, pupilR, tongue]);

    const now = this.scene.time.now;
    return {
      container: c,
      body,
      tongue,
      x, y,
      state: 'idle',
      nextStrikeAt: now + Phaser.Math.Between(4000, 9000),
      relocateAt: now + Phaser.Math.Between(
        CONFIG.WILDLIFE.FROG_RELOCATE_MIN_MS,
        CONFIG.WILDLIFE.FROG_RELOCATE_MAX_MS,
      ),
      strikeStartedAt: 0,
      targetCreepId: null,
      targetX: 0, targetY: 0,
      caughtCreepX: 0, caughtCreepY: 0,
      caughtCreepId: null,
      hopStartedAt: 0,
      hopFromX: x, hopFromY: y,
      hopToX: x, hopToY: y,
    };
  }

  private tickFrog(f: Frog, time: number, _dt: number) {
    // Idle: skann etter creeps når cooldown er ute
    if (f.state === 'idle') {
      // Re-lokasjons-hopp
      if (time >= f.relocateAt) {
        const dest = this.randomGrassPoint(
          CONFIG.WILDLIFE.FROG_LANE_CLEARANCE,
          CONFIG.WILDLIFE.FROG_BASE_CLEARANCE,
        );
        if (dest) {
          f.state = 'hopping';
          f.hopStartedAt = time;
          f.hopFromX = f.x;
          f.hopFromY = f.y;
          f.hopToX = dest.x;
          f.hopToY = dest.y;
        } else {
          // Klarte ikke finne ny plass — utsett
          f.relocateAt = time + 30000;
        }
        return;
      }

      if (time >= f.nextStrikeAt) {
        const creep = this.api.findCreepNear(f.x, f.y, CONFIG.WILDLIFE.FROG_STRIKE_RANGE);
        if (creep) {
          f.state = 'striking';
          f.strikeStartedAt = time;
          f.targetCreepId = creep.id;
          f.targetX = creep.x;
          f.targetY = creep.y;
          // Vri kroppen mot byttet
          f.container.rotation = 0;
        } else {
          // Ingen mål — vent litt og prøv igjen
          f.nextStrikeAt = time + 1200;
        }
      }
      return;
    }

    if (f.state === 'striking') {
      const elapsed = time - f.strikeStartedAt;
      const extendT = Math.min(1, elapsed / STRIKE_EXTEND_MS);
      // Oppdater target-posisjon med creepens nåværende posisjon hvis fortsatt levende
      if (f.targetCreepId !== null) {
        const c = this.api.findCreepNear(f.x, f.y, CONFIG.WILDLIFE.FROG_STRIKE_RANGE + 30);
        if (c && c.id === f.targetCreepId) {
          f.targetX = c.x;
          f.targetY = c.y;
        }
      }

      this.drawTongue(f, extendT);

      if (extendT >= 1) {
        // Treff — spis creepen (hvis fortsatt levende)
        if (f.targetCreepId !== null) {
          this.api.eatCreep(f.targetCreepId);
          f.caughtCreepId = f.targetCreepId;
          f.caughtCreepX = f.targetX;
          f.caughtCreepY = f.targetY;
        }
        f.state = 'retracting';
        f.strikeStartedAt = time + STRIKE_HOLD_MS;  // gi en kort hold-pause
      }
      return;
    }

    if (f.state === 'retracting') {
      const elapsed = time - f.strikeStartedAt;
      if (elapsed < 0) {
        // Hold-pause før retraction
        this.drawTongue(f, 1);
        return;
      }
      const retractT = Math.min(1, elapsed / STRIKE_RETRACT_MS);
      this.drawTongue(f, 1 - retractT);

      if (retractT >= 1) {
        f.tongue.clear();
        f.state = 'idle';
        f.targetCreepId = null;
        f.caughtCreepId = null;
        f.nextStrikeAt = time + Phaser.Math.Between(
          CONFIG.WILDLIFE.FROG_COOLDOWN_MIN_MS,
          CONFIG.WILDLIFE.FROG_COOLDOWN_MAX_MS,
        );
      }
      return;
    }

    if (f.state === 'hopping') {
      const elapsed = time - f.hopStartedAt;
      const t = Math.min(1, elapsed / HOP_DURATION_MS);
      // Parabolsk hopp
      const arc = Math.sin(t * Math.PI) * 28;
      f.x = f.hopFromX + (f.hopToX - f.hopFromX) * t;
      f.y = f.hopFromY + (f.hopToY - f.hopFromY) * t;
      f.container.x = f.x;
      f.container.y = f.y - arc;
      f.container.scaleX = 1 + 0.08 * Math.sin(t * Math.PI);
      f.container.scaleY = 1 - 0.12 * Math.sin(t * Math.PI);

      if (t >= 1) {
        f.container.scaleX = 1;
        f.container.scaleY = 1;
        f.state = 'idle';
        f.nextStrikeAt = time + Phaser.Math.Between(2000, 5000);
        f.relocateAt = time + Phaser.Math.Between(
          CONFIG.WILDLIFE.FROG_RELOCATE_MIN_MS,
          CONFIG.WILDLIFE.FROG_RELOCATE_MAX_MS,
        );
      }
      return;
    }
  }

  private drawTongue(f: Frog, extendT: number) {
    f.tongue.clear();
    if (extendT <= 0) return;
    // Tunga starter ved munnen (lokal 0,3) og strekker seg mot target i verdens-koord.
    const mouthWorldX = f.x;
    const mouthWorldY = f.y + 3;
    const targetX = f.targetX;
    const targetY = f.targetY;
    const tipX = mouthWorldX + (targetX - mouthWorldX) * extendT;
    const tipY = mouthWorldY + (targetY - mouthWorldY) * extendT;

    // Tegn i scene-rom — tunge har egen container, så vi må kompensere.
    // Lokale koord: (tipX - f.x, tipY - f.y)
    const lx0 = 0;
    const ly0 = 3;
    const lx1 = tipX - f.x;
    const ly1 = tipY - f.y;

    f.tongue.lineStyle(2.4, THEME.FROG_TONGUE, 0.95);
    f.tongue.beginPath();
    f.tongue.moveTo(lx0, ly0);
    f.tongue.lineTo(lx1, ly1);
    f.tongue.strokePath();
    // Tipp (liten klump)
    f.tongue.fillStyle(THEME.FROG_TONGUE, 1);
    f.tongue.fillCircle(lx1, ly1, 2.4);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  /**
   * (re)finn et tilfeldig punkt i gress-området som er ryddig nok for et
   * ambient-element. `laneClearance` = min avstand til lane, `baseClearance`
   * = min avstand til player-basen.
   */
  private randomGrassPoint(laneClearance: number, baseClearance: number): { x: number; y: number } | null {
    const W = CONFIG.MAP_WIDTH;
    const H = CONFIG.MAP_HEIGHT;
    for (let i = 0; i < 40; i++) {
      const x = Phaser.Math.Between(40, W - 40);
      const y = Phaser.Math.Between(40, H - 40);
      if (this.isClearGrass(x, y, laneClearance, baseClearance)) return { x, y };
    }
    return null;
  }

  private isClearGrass(x: number, y: number, laneClearance: number, baseClearance: number): boolean {
    const lanes = this.api.getLanes();
    // Player-base + spawner clearance
    const dPlayer = Math.hypot(x - CONFIG.PLAYER_BASE_X, y - CONFIG.PLAYER_BASE_Y);
    if (dPlayer < baseClearance) return false;
    const dEnemy = Math.hypot(x - CONFIG.ENEMY_SPAWN_X, y - CONFIG.ENEMY_SPAWN_Y);
    if (dEnemy < 180) return false;
    // Lane / arena (isOnLaneOrArena bruker base-bredde; ekstra clearance via lane-samples)
    if (isOnLaneOrArena(x, y, lanes)) return false;
    if (laneClearance > 0) {
      for (const lane of lanes.lanes) {
        const halfBase = lane.widthAt(0.5) * 0.55;
        const limit = halfBase + laneClearance;
        const limitSq = limit * limit;
        for (const s of lane.samples) {
          const dx = s.x - x, dy = s.y - y;
          if (dx * dx + dy * dy < limitSq) return false;
        }
      }
    }
    return true;
  }
}
