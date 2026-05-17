import { GameCanvas } from './components/GameCanvas';

export default function App() {
  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      background: 'radial-gradient(ellipse at center, #1a2638 0%, #0a1018 70%, #05080d 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <GameCanvas />
      <div
        id="game-metrics"
        data-state="running"
        data-player-gold="0"
        data-player-soldiers="0"
        data-player-workers="0"
        data-player-base-hp="500"
        data-ai-soldiers="0"
        data-ai-base-hp="500"
        data-game-time="0"
        style={{ display: 'none' }}
      />
    </div>
  );
}
