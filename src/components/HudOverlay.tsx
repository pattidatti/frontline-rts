import { useEffect, useState, useCallback, useRef } from 'react';
import { hudBridge, type HudState, type TowerKind } from '../game/hudBridge';
import { getVolume, setVolume, onVolumeChange } from '../game/audio';
import { CONFIG } from '../game/config';
import './HudOverlay.css';

// ── SVG icons (tiny, theme-matched) ─────────────────────────────────────

function AntIcon({ size = 22, faction = 'player', kind = 'worker' }: {
  size?: number; faction?: 'player' | 'ai'; kind?: 'worker' | 'soldier';
}) {
  const body = faction === 'player' ? '#1a1a1a' : '#7a2a14';
  const highlight = faction === 'player' ? '#3a3a3a' : '#a04428';
  const mandible = faction === 'player' ? '#d8c8a0' : '#e8b078';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      {/* legs */}
      <g stroke={body} strokeWidth="1.2" strokeLinecap="round">
        <line x1="13" y1="16" x2="6" y2="11" />
        <line x1="13" y1="16" x2="5" y2="16" />
        <line x1="13" y1="16" x2="6" y2="22" />
        <line x1="19" y1="16" x2="26" y2="11" />
        <line x1="19" y1="16" x2="27" y2="16" />
        <line x1="19" y1="16" x2="26" y2="22" />
      </g>
      {/* abdomen */}
      <ellipse cx="22" cy="16" rx="6" ry="4.5" fill={body} />
      <ellipse cx="21" cy="14.5" rx="2.5" ry="1.2" fill={highlight} opacity="0.65" />
      {/* thorax */}
      <ellipse cx="15" cy="16" rx="3.2" ry="2.8" fill={body} />
      {/* head */}
      <ellipse cx="9" cy="16" rx="3.5" ry="3" fill={body} />
      <ellipse cx="8.5" cy="15" rx="1.4" ry="1" fill={highlight} opacity="0.7" />
      {/* mandibles */}
      <line x1="6" y1="15" x2="3.5" y2="13.5" stroke={mandible} strokeWidth="1" strokeLinecap="round" />
      <line x1="6" y1="17" x2="3.5" y2="18.5" stroke={mandible} strokeWidth="1" strokeLinecap="round" />
      {/* antennae */}
      <path d="M 8 13 Q 5 9 7 6" stroke={body} strokeWidth="1" fill="none" strokeLinecap="round" />
      <path d="M 10 13 Q 9 8 11 6" stroke={body} strokeWidth="1" fill="none" strokeLinecap="round" />
      {/* soldier carries a small sword */}
      {kind === 'soldier' && (
        <g>
          <line x1="22" y1="9" x2="28" y2="3" stroke="#c8c8d0" strokeWidth="1.6" strokeLinecap="round" />
          <line x1="21" y1="10" x2="23" y2="8" stroke="#b8945a" strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )}
    </svg>
  );
}

function FoodIcon({ size = 22 }: { size?: number }) {
  // Stylized leaf with vein — the food/"mat" resource
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M 6 22 Q 6 6 22 6 Q 26 18 16 26 Q 8 26 6 22 Z"
        fill="#6ba84a" stroke="#3a5a28" strokeWidth="1" />
      <path d="M 6 22 Q 14 18 22 6" stroke="#3a5a28" strokeWidth="1.4" fill="none" />
      <path d="M 10 20 Q 13 17 16 14" stroke="#3a5a28" strokeWidth="0.7" fill="none" />
      <path d="M 8 18 Q 11 15 14 12" stroke="#3a5a28" strokeWidth="0.7" fill="none" />
      <ellipse cx="13" cy="13" rx="3" ry="1" fill="#8ec862" opacity="0.5" />
    </svg>
  );
}

function MoundIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const main = faction === 'player' ? '#6b4a2a' : '#7a3a1a';
  const rim = faction === 'player' ? '#3a2614' : '#401a0a';
  const hl = faction === 'player' ? '#8e6638' : '#a05528';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="26" rx="14" ry="3" fill="#000" opacity="0.4" />
      <ellipse cx="16" cy="20" rx="13" ry="9" fill={main} />
      <ellipse cx="16" cy="20" rx="13" ry="9" fill="none" stroke={rim} strokeWidth="1.2" />
      <ellipse cx="13" cy="16" rx="6" ry="2.4" fill={hl} opacity="0.7" />
      <ellipse cx="16" cy="23" rx="3" ry="2" fill="#0a0604" />
    </svg>
  );
}

function TowerIcon({ size = 22, kind = 'stinger' }: { size?: number; kind?: TowerKind }) {
  // Stein-tårn med fargesignatur per type.
  const tip = kind === 'webber' ? '#c8c8e8' : kind === 'spitter' ? '#8acc6a' : '#b89048';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="28" rx="11" ry="2" fill="#000" opacity="0.45" />
      <ellipse cx="16" cy="24" rx="10" ry="3" fill="#6a5a3a" stroke="#2a1f12" strokeWidth="1.2" />
      <rect x="11" y="14" width="10" height="11" fill="#8a7a52" stroke="#3a2a18" strokeWidth="1" />
      <circle cx="16" cy="11" r="5.5" fill={tip} stroke="#1a1208" strokeWidth="1" />
      <polygon points="14,6 18,6 16,2" fill={tip} stroke="#1a1208" strokeWidth="1" />
    </svg>
  );
}

// ── Top bar ─────────────────────────────────────────────────────────────

function formatTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function VolumeControl() {
  const [vol, setVol] = useState<number>(() => getVolume());
  useEffect(() => onVolumeChange((v) => setVol(v)), []);
  const muted = vol <= 0;
  const icon = muted ? '🔇' : vol < 0.34 ? '🔈' : vol < 0.67 ? '🔉' : '🔊';
  return (
    <div className="rts-vol" title={muted ? 'Lyd av' : `Volum ${Math.round(vol * 100)} %`}>
      <button
        type="button"
        className="rts-vol-icon"
        onClick={() => setVolume(muted ? 0.6 : 0)}
        aria-label={muted ? 'Slå på lyd' : 'Mute'}
      >
        {icon}
      </button>
      <input
        className="rts-vol-slider"
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={vol}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
        aria-label="Volum"
      />
    </div>
  );
}

function SpeedBadge({ s }: { s: HudState }) {
  const paused = s.gameSpeed === 0;
  const label = paused ? '⏸' : `▶ ${s.gameSpeed}×`;
  const title = paused
    ? 'Pause (Mellomrom) — klikk for å fortsette'
    : `Hastighet ${s.gameSpeed}× — klikk for neste, Mellomrom for pause, +/− for å endre`;
  return (
    <button
      type="button"
      className={`rts-speed-badge ${paused ? 'paused' : ''}`}
      title={title}
      onClick={() => {
        if (paused) hudBridge.sendCommand({ type: 'toggle-pause' });
        else hudBridge.sendCommand({ type: 'cycle-speed' });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        hudBridge.sendCommand({ type: 'toggle-pause' });
      }}
    >
      {label}
    </button>
  );
}

function ResValue({ value, className = '' }: { value: number; className?: string }) {
  const [displayed, setDisplayed] = useState(value);
  const [flashing, setFlashing] = useState(false);
  const prevTargetRef = useRef(value);
  const rafRef = useRef<number | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const from = prevTargetRef.current;
    const to = value;
    prevTargetRef.current = to;
    if (from === to) return;
    if (to > from) {
      setFlashing(true);
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => setFlashing(false), 260);
    }
    const start = performance.now();
    const dur = Math.min(280, Math.max(120, Math.abs(to - from) * 18));
    const tween = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) * (1 - t);
      setDisplayed(Math.round(from + (to - from) * eased));
      if (t < 1) rafRef.current = requestAnimationFrame(tween);
      else rafRef.current = null;
    };
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tween);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [value]);

  useEffect(() => () => {
    if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
  }, []);

  return <span className={`rts-res-value ${flashing ? 'flash' : ''} ${className}`}>{displayed}</span>;
}

function TopBar({ s }: { s: HudState }) {
  const wave = s.waveMode;
  const baseHpPct = Math.max(0, (s.player.baseHp / s.player.baseMaxHp) * 100);
  return (
    <div className="rts-topbar">
      <div className="rts-brand">Frontline TD</div>
      <SpeedBadge s={s} />

      <div className="rts-res">
        <span className="rts-res-icon"><FoodIcon /></span>
        <div className="rts-res-stack">
          <ResValue value={s.player.gold} />
          <span className="rts-res-label">Mat</span>
        </div>
      </div>

      <span className="rts-divider" />

      <div className="rts-res">
        <span className="rts-res-icon"><AntIcon kind="soldier" /></span>
        <div className="rts-res-stack">
          <ResValue value={s.player.soldiers} />
          <span className="rts-res-label">På lanene</span>
        </div>
      </div>

      <div className="rts-topbar-spacer" />

      <div className="rts-enemy-intel">
        <div className="rts-res">
          <span className="rts-res-icon"><MoundIcon faction="player" /></span>
          <div className="rts-res-stack">
            <ResValue value={Math.max(0, s.player.baseHp)} />
            <span className="rts-res-label">Maurtue {Math.round(baseHpPct)}%</span>
          </div>
        </div>
        {wave && (
          <div className="rts-res">
            <span className="rts-res-icon"><AntIcon kind="soldier" faction="ai" /></span>
            <div className="rts-res-stack">
              <ResValue value={wave.remainingEnemies ?? s.enemy.soldiers} />
              <span className="rts-res-label">Fiender igjen</span>
            </div>
          </div>
        )}
      </div>

      <span className="rts-divider" />
      <VolumeControl />
      <span className="rts-divider" />
      <div className="rts-time">⏱ {formatTime(s.time)}</div>
    </div>
  );
}

// ── Minimap ─────────────────────────────────────────────────────────────

function Minimap({ s }: { s: HudState }) {
  const { width: mw, height: mh } = s.map;
  const { units, buildings } = s.minimap;
  const cam = s.camera;
  const handleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const x = fx * mw, y = fy * mh;
    if (e.button === 2 || e.shiftKey) {
      hudBridge.sendCommand({ type: 'minimap-attack', x, y });
    } else {
      hudBridge.sendCommand({ type: 'minimap-pan', x, y });
    }
  };

  return (
    <div className="rts-panel rts-minimap-panel">
      <div className="rts-section-title">Slagmark</div>
      <div className="rts-minimap-frame" onMouseDown={handleClick} onContextMenu={(e) => e.preventDefault()}>
        <svg viewBox={`0 0 ${mw} ${mh}`} preserveAspectRatio="none">
          {/* Lane-bånd (under units/buildings) */}
          {CONFIG.LANES.map((lane) => (
            <rect
              key={`lane-${lane.id}`}
              x={0}
              y={lane.y - lane.halfHeight}
              width={mw}
              height={lane.halfHeight * 2}
              fill="rgba(90, 74, 44, 0.35)"
              stroke="rgba(40, 30, 18, 0.7)"
              strokeWidth={Math.max(1, mw / 400)}
            />
          ))}
          {/* buildings */}
          {buildings.map((b, i) => {
            // V9 — Mines fargelegges etter kontroll. Contested = oransje stripet (differensiert
            // fra AI sin røde) så spilleren ikke forveksler "i kamp" med "fiende-eid".
            let color: string;
            let stroke: string = '#000';
            let strokeW = Math.max(1, mw / 400);
            if (b.kind === 'mine') {
              if (b.control === 'contested') {
                color = '#ffaa33';            // markant oransje
                stroke = '#ff6600';
                strokeW = Math.max(2, mw / 240);
              } else {
                color = b.control === 'player' ? '#6ec8ff'
                  : b.control === 'ai' ? '#ff7c5a'
                  : '#e6c45a';
              }
            } else if (b.kind === 'bridge') {
              color = '#8a6638';
            } else if (b.kind === 'tower') {
              const tColor = b.towerType === 'webber' ? '#c8c8e8' : b.towerType === 'spitter' ? '#8acc6a' : '#b89048';
              color = tColor;
              // Distinguish tower faction via stroke
              stroke = b.faction === 'ai' ? '#ff5a30' : '#3a8ec8';
              strokeW = Math.max(1.5, mw / 320);
            } else {
              color = b.faction === 'player' ? '#6ec8ff'
                : b.faction === 'ai' ? '#ff7c5a'
                : '#e6c45a';
            }
            const w = Math.max(b.w * 0.9, mw * 0.018);
            const h = Math.max(b.h * 0.9, mh * 0.026);
            return (
              <rect key={`b${i}`}
                x={b.x - w / 2} y={b.y - h / 2}
                width={w} height={h}
                fill={color}
                stroke={stroke} strokeWidth={strokeW}
                opacity={b.hp > 0 ? 0.95 : 0.3}
              />
            );
          })}
          {/* units */}
          {units.map((u, i) => {
            const color = u.faction === 'player' ? '#cfe3a3' : '#ffb088';
            const r = u.type === 'soldier' ? mw * 0.008 : mw * 0.006;
            return <circle key={`u${i}`} cx={u.x} cy={u.y} r={r} fill={color} />;
          })}
          {/* viewport rectangle — viser hva kameraet ser */}
          {cam && (
            <rect
              x={cam.x} y={cam.y}
              width={cam.width} height={cam.height}
              fill="none"
              stroke="#ffffff"
              strokeWidth={Math.max(2, mw / 320)}
              strokeOpacity={0.85}
              pointerEvents="none"
            />
          )}
        </svg>
      </div>
    </div>
  );
}

// ── Command card ───────────────────────────────────────────────────────

function CommandCard({ s }: { s: HudState }) {
  const laneCost = s.costs.soldier;   // GameScene mapper LANE_SOLDIER_COST → costs.soldier
  const buildActive = !!s.buildMode;
  const cantSend = s.player.gold < laneCost;

  const towers: { key: string; type: TowerKind; label: string; cost: number }[] = [
    { key: '1', type: 'stinger', label: 'Spydd',  cost: 80  },
    { key: '2', type: 'webber',  label: 'Nett',   cost: 100 },
    { key: '3', type: 'spitter', label: 'Spytt',  cost: 120 },
  ];

  const laneButtons: { key: string; lane: 0 | 1 | 2; label: string }[] = [
    { key: 'Q', lane: 0, label: 'Nord-lane'  },
    { key: 'R', lane: 1, label: 'Midt-lane'  },
    { key: 'E', lane: 2, label: 'Sør-lane'   },
  ];

  return (
    <div className="rts-panel rts-command-panel">
      <div className="rts-section-title">Send soldat</div>
      <div className="rts-command-grid">
        {laneButtons.map((b) => (
          <button
            key={`lane-${b.lane}`}
            className={`rts-cmd ${cantSend ? '' : 'affordable'}`}
            disabled={cantSend}
            onClick={() => hudBridge.sendCommand({ type: 'send-lane', lane: b.lane })}
            title={`${b.label} (${laneCost} mat) [${b.key}]`}
          >
            <span className="rts-cmd-hotkey">{b.key}</span>
            <span className="rts-cmd-icon"><AntIcon size={40} kind="soldier" /></span>
            <span className="rts-cmd-label">{b.label}</span>
            <span className={`rts-cmd-cost ${cantSend ? 'cant' : ''}`}>{laneCost}</span>
          </button>
        ))}

        <div className="rts-cmd rts-cmd-empty" aria-hidden style={{ gridColumn: '1 / -1', height: 6 }} />

        {towers.map((t) => {
          const cant = s.player.gold < t.cost;
          const active = buildActive && s.buildMode?.kind === t.type;
          return (
            <button
              key={`tower-${t.type}`}
              className={`rts-cmd ${cant ? '' : 'affordable'} ${active ? 'active' : ''}`}
              disabled={cant && !active}
              onClick={() => hudBridge.sendCommand({ type: 'build-start', kind: t.type })}
              title={`${t.label}-tårn (${t.cost} mat) [${t.key}]`}
            >
              <span className="rts-cmd-hotkey">{t.key}</span>
              <span className="rts-cmd-icon"><TowerIcon size={40} kind={t.type} /></span>
              <span className="rts-cmd-label">{t.label}</span>
              <span className={`rts-cmd-cost ${cant ? 'cant' : ''}`}>{t.cost}</span>
            </button>
          );
        })}

        {buildActive && (
          <button
            className="rts-cmd"
            onClick={() => hudBridge.sendCommand({ type: 'build-cancel' })}
            title="Avbryt bygg-modus [Esc]"
          >
            <span className="rts-cmd-hotkey">Esc</span>
            <span className="rts-cmd-icon" style={{ fontSize: 30 }}>✕</span>
            <span className="rts-cmd-label">Avbryt</span>
          </button>
        )}
      </div>
    </div>
  );
}

// ── Game-over screen ───────────────────────────────────────────────────

function GameOver({ s }: { s: HudState }) {
  if (s.state === 'running') return null;
  const st = s.stats;
  return (
    <div className="rts-gameover">
      <div className={`rts-gameover-title ${s.state}`}>
        {s.state === 'won' ? 'SEIER' : 'TAPT'}
      </div>
      <div className="rts-gameover-stats-grid">
        <div><span>Tid</span><strong>{formatTime(s.time)}</strong></div>
        <div><span>Bølger overlevd</span><strong>{Math.max(0, (s.waveMode?.current ?? 1) - (s.state === 'won' ? 0 : 1))} / {s.waveMode?.total ?? 0}</strong></div>
        <div><span>Soldater sendt</span><strong>{st.soldiersTrained}</strong></div>
        <div><span>Mat samlet</span><strong>{st.goldEarned}</strong></div>
        <div><span>Fiende-drap</span><strong>{st.enemyKills}</strong></div>
        <div><span>Egne tap</span><strong>{st.unitsLost}</strong></div>
        <div><span>Tårn bygget</span><strong>{st.playerTowers}</strong></div>
        <div><span>Base-HP igjen</span><strong>{Math.max(0, s.player.baseHp)}</strong></div>
      </div>
      <div className="rts-gameover-actions">
        <button
          className="rts-gameover-btn primary"
          onClick={() => hudBridge.sendCommand({ type: 'restart' })}
        >
          ↻ Spill igjen <kbd>R</kbd>
        </button>
        <button
          className="rts-gameover-btn"
          onClick={() => hudBridge.sendCommand({ type: 'to-menu' })}
        >
          Til hovedmeny
        </button>
      </div>
    </div>
  );
}

// ── Hotkeys cheat-sheet (V8) ──────────────────────────────────────────

const HOTKEYS: Array<{ section: string; keys: Array<[string, string]> }> = [
  {
    section: 'Send soldater',
    keys: [
      ['Q', 'Send soldat i Nord-lane'],
      ['R', 'Send soldat i Midt-lane'],
      ['E', 'Send soldat i Sør-lane'],
    ],
  },
  {
    section: 'Tårn-bygg',
    keys: [
      ['T', 'Toggle bygg-modus (Spydd-tårn)'],
      ['1 / 2 / 3', 'Bytt til Spydd / Nett / Spytt (i bygg-modus)'],
      ['Venstreklikk', 'Plasser tårn (utenfor lane-bånd)'],
      ['Shift+klikk', 'Plasser flere uten å gå ut av bygg-modus'],
      ['Esc / Høyreklikk', 'Avbryt bygg-modus'],
    ],
  },
  {
    section: 'Waves',
    keys: [
      ['G', 'Klar — hopp over forberedelsestid og start neste bølge'],
    ],
  },
  {
    section: 'Kamera & spill',
    keys: [
      ['WASD / piltaster', 'Panorér kamera'],
      ['Klikk minimap', 'Pan til punkt'],
      ['Mellomrom', 'Pause / fortsett'],
      ['+ / −', 'Endre hastighet (1× / 2× / 3×)'],
      ['H', 'Vis / skjul denne hjelpen'],
      ['R', 'Restart (etter game over)'],
    ],
  },
];

function HotkeysPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="rts-hotkeys-overlay" onClick={onClose}>
      <div className="rts-hotkeys-card" onClick={(e) => e.stopPropagation()}>
        <div className="rts-hotkeys-header">
          <div className="rts-hotkeys-title">Hurtigtaster</div>
          <button className="rts-hotkeys-close" onClick={onClose}>✕</button>
        </div>
        <div className="rts-hotkeys-body">
          {HOTKEYS.map((sec) => (
            <div className="rts-hotkeys-section" key={sec.section}>
              <div className="rts-hotkeys-section-title">{sec.section}</div>
              {sec.keys.map(([k, desc]) => (
                <div className="rts-hotkeys-row" key={k}>
                  <kbd>{k}</kbd>
                  <span>{desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="rts-hotkeys-footer">Trykk H eller Esc for å lukke</div>
      </div>
    </div>
  );
}

// ── Alert banner (M1.5) ────────────────────────────────────────────────

// GameScene sletter currentAlert ~3s etter triggeredAt og emitter ny state,
// så vi bare speiler s.alert direkte uten React-timing.
function AlertBanner({ s }: { s: HudState }) {
  if (!s.alert) return null;
  return (
    <div className={`rts-alert ${s.alert.urgency}`} role="alert">
      <span className="rts-alert-icon">⚠</span>
      <span className="rts-alert-msg">{s.alert.message}</span>
    </div>
  );
}

// ── Wave banner (M2.2) ────────────────────────────────────────────────

function WaveBanner({ s }: { s: HudState }) {
  if (!s.waveMode) return null;
  const { current, total, active, preparing, prepRemainingMs, nextWavePreview, remainingEnemies } = s.waveMode;
  const ms = prepRemainingMs ?? 0;
  const sec = Math.ceil(ms / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const countdown = `${mm}:${ss.toString().padStart(2, '0')}`;
  const upcoming = current + 1;
  const laneLabel = (l: 0 | 1 | 2 | 'all') => l === 'all' ? 'alle 3' : l === 0 ? 'Nord' : l === 1 ? 'Midt' : 'Sør';

  return (
    <div className={`rts-wave-banner ${active ? 'active' : 'cooldown'}`}>
      <span className="rts-wave-label">Bølge</span>
      <span className="rts-wave-count">{Math.max(0, current)} / {total}</span>

      {preparing && nextWavePreview && (
        <>
          <span className="rts-wave-next">
            Neste (#{upcoming}): <strong>{nextWavePreview.soldiers}</strong> fiender
            {nextWavePreview.tank && <span style={{ color: '#ee9544' }}> · tank</span>}
            {nextWavePreview.boss && <span style={{ color: '#ff5544' }}> · BOSS</span>}
            <span style={{ opacity: 0.75 }}> · lane: {laneLabel(nextWavePreview.lane)}</span>
          </span>
          <span className="rts-wave-next">Klar om <strong>{countdown}</strong></span>
          <button
            type="button"
            className="rts-wave-ready-btn"
            onClick={() => hudBridge.sendCommand({ type: 'wave-ready' })}
            title="Hopp over forberedelsestid og start neste bølge nå [G]"
          >
            Klar! <kbd>G</kbd>
          </button>
        </>
      )}
      {active && (
        <span className="rts-wave-next">
          Forsvarer base — <strong>{remainingEnemies ?? 0}</strong> fiender igjen
        </span>
      )}
    </div>
  );
}

// ── Build-mode banner (M2.1) ──────────────────────────────────────────

function BuildModeBanner({ s }: { s: HudState }) {
  if (!s.buildMode) return null;
  const kind = s.buildMode.kind as TowerKind;
  const labels: Record<TowerKind, string> = { stinger: 'Spydd-tårn', webber: 'Nett-tårn', spitter: 'Spytt-tårn' };
  return (
    <div className="rts-build-banner">
      <span className="rts-build-icon"><TowerIcon size={26} kind={kind} /></span>
      <div className="rts-build-info">
        <div className="rts-build-title">Plasserer {labels[kind] ?? kind} — {s.buildMode.cost} mat</div>
        <div className="rts-build-hint">
          1/2/3 = bytt tårn-type · venstreklikk plasserer (utenfor lane-bånd) · Shift+klikk for flere · Esc avbryter
        </div>
      </div>
      <button
        className="rts-build-cancel"
        type="button"
        onClick={() => hudBridge.sendCommand({ type: 'build-cancel' })}
      >Avbryt</button>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────

export function HudOverlay() {
  const [state, setState] = useState<HudState | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);

  const onState = useCallback((s: HudState) => setState(s), []);
  useEffect(() => hudBridge.onState(onState), [onState]);

  // V8 — H-tast toggler hotkey-overlay. Esc lukker den.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignorer modifier-kombinasjoner og input-felter
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'h' || e.key === 'H' || e.key === '?') {
        setShowHotkeys((v) => !v);
        e.preventDefault();
      } else if (e.key === 'Escape' && showHotkeys) {
        setShowHotkeys(false);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHotkeys]);

  if (!state) return null;

  return (
    <div className="rts-hud">
      <TopBar s={state} />
      <WaveBanner s={state} />
      <AlertBanner s={state} />
      <BuildModeBanner s={state} />
      <Minimap s={state} />
      <CommandCard s={state} />
      <GameOver s={state} />
      <button
        className="rts-help-fab"
        type="button"
        title="Hurtigtaster (H)"
        aria-label="Vis hurtigtaster"
        onClick={() => setShowHotkeys(true)}
      >?</button>
      {showHotkeys && <HotkeysPanel onClose={() => setShowHotkeys(false)} />}
    </div>
  );
}
