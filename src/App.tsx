import { GameCanvas } from './components/GameCanvas';
import { HudOverlay } from './components/HudOverlay';
import { Tutorial } from './components/Tutorial';

export default function App() {
  return (
    <div style={{
      position: 'relative',
      width: '100vw',
      height: '100vh',
      overflow: 'hidden',
      background: 'radial-gradient(ellipse at center, #16282e 0%, #0a1620 70%, #050a10 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <GameCanvas />
      <HudOverlay />
      <Tutorial />
      <div
        id="game-metrics"
        data-state="running"
        data-player-gold="0"
        data-player-soldiers="0"
        data-player-workers="0"
        data-player-base-hp="500"
        data-player-towers="0"
        data-ai-soldiers="0"
        data-ai-base-hp="500"
        data-ai-towers="0"
        data-game-time="0"
        style={{ display: 'none' }}
      />
    </div>
  );
}
