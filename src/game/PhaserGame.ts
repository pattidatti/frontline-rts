import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { CONFIG } from './config';

// Viewport = hele verden. Phaser.Scale.FIT skalerer canvas til vinduet.
// Hele kartet vises samtidig — ingen kamera-pan.
function syncConfigToViewport(): void {
  CONFIG.VIEWPORT_WIDTH = CONFIG.MAP_WIDTH;
  CONFIG.VIEWPORT_HEIGHT = CONFIG.MAP_HEIGHT;
}

export function createGame(parent: HTMLElement): Phaser.Game {
  syncConfigToViewport();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: CONFIG.VIEWPORT_WIDTH,
    height: CONFIG.VIEWPORT_HEIGHT,
    parent,
    backgroundColor: '#111820',
    scene: [BootScene, MenuScene, GameScene],
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });

  let resizeTimer: number | null = null;
  const handleResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      syncConfigToViewport();
      game.scale.resize(CONFIG.VIEWPORT_WIDTH, CONFIG.VIEWPORT_HEIGHT);
    }, 150);
  };
  window.addEventListener('resize', handleResize);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('resize', handleResize);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
  });

  return game;
}
