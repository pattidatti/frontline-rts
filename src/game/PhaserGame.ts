import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { CONFIG } from './config';

// Viewport-størrelsen følger vinduet (med 16:9-aspekt på 1280×720-designet).
// Verden-størrelsen (CONFIG.MAP_WIDTH/HEIGHT) er FAST 2560×1440 — kameraet panorerer over den.
function syncConfigToViewport(): void {
  const vw = Math.max(800, window.innerWidth);
  const vh = Math.max(600, window.innerHeight);
  const designScale = Math.min(vw / 1280, vh / 720);
  CONFIG.VIEWPORT_WIDTH = Math.round(vw / designScale);
  CONFIG.VIEWPORT_HEIGHT = Math.round(vh / designScale);
}

export function createGame(parent: HTMLElement): Phaser.Game {
  syncConfigToViewport();

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width: CONFIG.VIEWPORT_WIDTH,
    height: CONFIG.VIEWPORT_HEIGHT,
    parent,
    backgroundColor: '#111820',
    scene: [BootScene, GameScene],
    physics: { default: 'arcade', arcade: { gravity: { x: 0, y: 0 }, debug: false } },
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
  });

  // Debouncet resize: kun viewport-størrelse endres. Verden forblir 2560×1440 så
  // kart-layout (baser, mines, elver, broer) ikke flytter seg ved resize.
  let resizeTimer: number | null = null;
  const handleResize = () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      syncConfigToViewport();
      game.scale.resize(CONFIG.VIEWPORT_WIDTH, CONFIG.VIEWPORT_HEIGHT);
      game.scene.getScenes(true).forEach((s) => s.scene.restart());
    }, 150);
  };
  window.addEventListener('resize', handleResize);
  game.events.once(Phaser.Core.Events.DESTROY, () => {
    window.removeEventListener('resize', handleResize);
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
  });

  return game;
}
