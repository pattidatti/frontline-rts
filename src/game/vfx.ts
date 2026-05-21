import Phaser from 'phaser';
import { THEME } from './config';

const PROJECTILE_POOL_SIZE = 60;
const FLOAT_TEXT_POOL_SIZE = 24;
const PROJECTILE_DURATION = 130;
const MUZZLE_DURATION = 90;
const FLOAT_TEXT_DURATION = 850;
const IMPACT_PARTICLE_COUNT = 6;
const DUST_PARTICLE_COUNT = 10;

interface PoolLine {
  line: Phaser.GameObjects.Line;
  inUse: boolean;
}

interface PoolText {
  text: Phaser.GameObjects.Text;
  inUse: boolean;
}

export class VFXManager {
  private scene: Phaser.Scene;
  private projectilePool: PoolLine[] = [];
  private textPool: PoolText[] = [];
  private sparkEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private dustEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;
  private footprintEmitter!: Phaser.GameObjects.Particles.ParticleEmitter;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;

    // Projectile pool
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const line = scene.add.line(0, 0, 0, 0, 0, 0, 0xffffff)
        .setOrigin(0, 0)
        .setLineWidth(2)
        .setDepth(15)
        .setVisible(false);
      this.projectilePool.push({ line, inUse: false });
    }

    // Floating text pool
    for (let i = 0; i < FLOAT_TEXT_POOL_SIZE; i++) {
      const text = scene.add.text(0, 0, '', {
        fontSize: '14px',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      })
        .setOrigin(0.5)
        .setDepth(16)
        .setVisible(false);
      this.textPool.push({ text, inUse: false });
    }

    // Spark emitter (maursyre-sprut ved kampimpakt)
    this.sparkEmitter = scene.add.particles(0, 0, 'spark', {
      lifespan: 320,
      speed: { min: 60, max: 180 },
      angle: { min: 0, max: 360 },
      scale: { start: 0.8, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      tint: THEME.SPARK_TINTS,
      emitting: false,
    }).setDepth(15);

    // Footprint emitter — små svake puffer der maur tråkker
    this.footprintEmitter = scene.add.particles(0, 0, 'spark', {
      lifespan: 900,
      speed: 0,
      scale: { start: 0.6, end: 1.4 },
      alpha: { start: 0.32, end: 0 },
      tint: [0x4a3220, 0x6a5238, 0x3a2614],
      emitting: false,
    }).setDepth(2);

    // Dust emitter (jordstøv ved død/kollaps)
    this.dustEmitter = scene.add.particles(0, 0, 'spark', {
      lifespan: 600,
      speed: { min: 20, max: 80 },
      angle: { min: 200, max: 340 },
      gravityY: 60,
      scale: { start: 1.2, end: 0.2 },
      alpha: { start: 0.7, end: 0 },
      tint: THEME.DUST_TINTS,
      emitting: false,
    }).setDepth(15);
  }

  fireProjectile(fromX: number, fromY: number, toX: number, toY: number, color: number) {
    const slot = this.projectilePool.find(p => !p.inUse);
    if (!slot) return;
    slot.inUse = true;
    const { line } = slot;
    line.setTo(fromX, fromY, toX, toY);
    line.setStrokeStyle(2, color, 1);
    line.setAlpha(1);
    line.setVisible(true);
    this.scene.tweens.add({
      targets: line,
      alpha: 0,
      duration: PROJECTILE_DURATION,
      onComplete: () => {
        line.setVisible(false);
        slot.inUse = false;
      },
    });

    // Muzzle flash at origin
    const muzzle = this.scene.add.arc(fromX, fromY, 5, 0, 360, false, color)
      .setDepth(15)
      .setAlpha(1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: muzzle,
      scale: 1.8,
      alpha: 0,
      duration: MUZZLE_DURATION,
      onComplete: () => muzzle.destroy(),
    });
  }

  impact(x: number, y: number) {
    this.sparkEmitter.emitParticleAt(x, y, IMPACT_PARTICLE_COUNT);
  }

  dust(x: number, y: number, count = DUST_PARTICLE_COUNT) {
    this.dustEmitter.emitParticleAt(x, y, count);
  }

  footprint(x: number, y: number) {
    this.footprintEmitter.emitParticleAt(x, y, 1);
  }

  floatText(x: number, y: number, msg: string, colorHex: string) {
    const slot = this.textPool.find(t => !t.inUse);
    if (!slot) return;
    slot.inUse = true;
    const { text } = slot;
    text.setText(msg).setColor(colorHex).setPosition(x, y).setAlpha(1).setScale(1).setVisible(true);
    this.scene.tweens.add({
      targets: text,
      y: y - 32,
      alpha: 0,
      duration: FLOAT_TEXT_DURATION,
      ease: 'Cubic.easeOut',
      onComplete: () => {
        text.setVisible(false);
        slot.inUse = false;
      },
    });
  }

  /** Expanding ring at (x, y) — for splash hits, base alarms, etc. */
  shockwave(x: number, y: number, opts?: { color?: number; radius?: number; thickness?: number; duration?: number }) {
    const color = opts?.color ?? 0xffe488;
    const radius = opts?.radius ?? 60;
    const thickness = opts?.thickness ?? 2.5;
    const duration = opts?.duration ?? 320;
    const ring = this.scene.add.circle(x, y, 6, 0, 0)
      .setStrokeStyle(thickness, color, 1)
      .setDepth(15)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: ring,
      radius,
      alpha: 0,
      duration,
      ease: 'Cubic.easeOut',
      onUpdate: (_t, tgt) => {
        const c = tgt as Phaser.GameObjects.Arc;
        c.setStrokeStyle(thickness, color, c.alpha);
      },
      onComplete: () => ring.destroy(),
    });
  }

  /** Continuous smoke plume tied to (x, y). Returns emitter so caller can stop/destroy when no longer needed. */
  smoke(x: number, y: number): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(x, y, 'spark', {
      lifespan: 1400,
      speed: { min: 10, max: 35 },
      angle: { min: 250, max: 290 },
      gravityY: -20,
      scale: { start: 0.6, end: 2.2 },
      alpha: { start: 0.55, end: 0 },
      tint: [0x222222, 0x3a2a22, 0x554a3a],
      frequency: 80,
    }).setDepth(15);
  }

  // Victory/defeat particle rain — call once in endGame; returns the emitter so caller can stop it later if needed.
  victoryRain(width: number, tints: number[]): Phaser.GameObjects.Particles.ParticleEmitter {
    return this.scene.add.particles(0, 0, 'spark', {
      x: { min: 0, max: width },
      y: -10,
      lifespan: 2400,
      speedY: { min: 80, max: 220 },
      speedX: { min: -30, max: 30 },
      gravityY: 120,
      scale: { start: 1.2, end: 0.4 },
      alpha: { start: 1, end: 0 },
      tint: tints,
      frequency: 25,
    }).setDepth(51);
  }
}
