import Phaser from 'phaser';
import { THEME } from '../config';

/**
 * Start-meny — første scene som vises etter BootScene.
 *
 * Klikk Play-knappen eller trykk Enter / Space for å starte spillet.
 */
export class MenuScene extends Phaser.Scene {
  private playStarted = false;

  constructor() {
    super({ key: 'MenuScene' });
  }

  create() {
    const W = this.scale.width;
    const H = this.scale.height;
    const cx = W / 2;
    const cy = H / 2;

    // Bakgrunn — dyp teal gradering matchende HUD-paletten
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x162e34, 0x162e34, 0x0c1c22, 0x041014, 1);
    bg.fillRect(0, 0, W, H);

    // Subtile gress-prikker i kantene (matcher maur-temaet)
    const noise = this.add.graphics();
    for (let i = 0; i < 80; i++) {
      const x = Phaser.Math.Between(0, W);
      const y = Phaser.Math.Between(0, H);
      const r = Phaser.Math.FloatBetween(0.8, 2.2);
      noise.fillStyle(THEME.GRASS_BLADE_COLOR, Phaser.Math.FloatBetween(0.15, 0.35));
      noise.fillCircle(x, y, r);
    }

    // Tittel
    const title = this.add.text(cx, cy - 130, 'FRONTLINE TD', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '64px',
      fontStyle: 'bold',
      color: '#ffb547',
    }).setOrigin(0.5).setShadow(0, 4, '#000', 14, true, true);

    // Tag-line
    this.add.text(cx, cy - 70, 'Forsvar maurtua. Send soldater i 3 lanes. Overlev 15 bølger.', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '18px',
      color: '#a8c2c6',
    }).setOrigin(0.5);

    // Play-knapp — fungerer både ved klikk og Enter/Space
    const btnW = 240, btnH = 64;
    const btnContainer = this.add.container(cx, cy + 20);
    const btnBg = this.add.rectangle(0, 0, btnW, btnH, 0x1f4650)
      .setStrokeStyle(2, 0xc9a55c, 1);
    const btnLabel = this.add.text(0, 0, '▶  SPILL', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#ffd27a',
    }).setOrigin(0.5);
    btnContainer.add([btnBg, btnLabel]);
    btnContainer.setSize(btnW, btnH);
    btnContainer.setInteractive(
      new Phaser.Geom.Rectangle(-btnW / 2, -btnH / 2, btnW, btnH),
      Phaser.Geom.Rectangle.Contains,
    );

    btnContainer.on('pointerover', () => {
      btnBg.setFillStyle(0x266c7a);
      btnBg.setStrokeStyle(2.5, 0x7dd3c0, 1);
      btnLabel.setColor('#fff5e0');
      this.input.manager.canvas.style.cursor = 'pointer';
    });
    btnContainer.on('pointerout', () => {
      btnBg.setFillStyle(0x1f4650);
      btnBg.setStrokeStyle(2, 0xc9a55c, 1);
      btnLabel.setColor('#ffd27a');
      this.input.manager.canvas.style.cursor = '';
    });
    btnContainer.on('pointerdown', () => this.startPlay());

    // Subtekst med hotkeys
    this.add.text(cx, cy + 90, 'Trykk SPACE eller ENTER for å starte', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '13px',
      color: '#6a8488',
    }).setOrigin(0.5);

    // Footer
    this.add.text(cx, H - 28, 'WASD / piltaster panorerer • H i spillet viser alle hurtigtaster', {
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: '12px',
      color: '#5a7a80',
    }).setOrigin(0.5);

    // Pulserende tittel-glød
    this.tweens.add({
      targets: title,
      alpha: 0.85,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    // Keyboard-shortcuts
    this.input.keyboard?.on('keydown-SPACE', () => this.startPlay());
    this.input.keyboard?.on('keydown-ENTER', () => this.startPlay());
  }

  private startPlay() {
    if (this.playStarted) return;
    this.playStarted = true;
    this.input.manager.canvas.style.cursor = '';
    this.scene.start('GameScene');
  }
}
