import Phaser from 'phaser';
import { loadAllSfx } from '../audio';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload() {
    // M1.4 — SFX-filer i public/sfx/. Manglende filer er tolerert (se audio.ts).
    loadAllSfx(this);
  }

  create() {
    // Generate a soft-edge spark texture used by VFX particle emitters
    const size = 12;
    const g = this.make.graphics({ x: 0, y: 0 });
    g.fillStyle(0xffffff, 1);
    g.fillCircle(size / 2, size / 2, size / 2);
    g.fillStyle(0xffffff, 0.5);
    g.fillCircle(size / 2, size / 2, size / 2 + 2);
    g.generateTexture('spark', size + 4, size + 4);
    g.destroy();

    this.scene.start('GameScene');
  }
}
