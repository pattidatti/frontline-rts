import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { hudBridge, type HudState, type HudBuilding, type TowerKind, type BuildKind } from '../game/hudBridge';
import { getVolume, setVolume, onVolumeChange } from '../game/audio';
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

function FarmIcon({ size = 22 }: { size?: number }) {
  // Bladlus-farm: blad med 3 bladlus
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="26" rx="13" ry="2" fill="#000" opacity="0.35" />
      <ellipse cx="16" cy="18" rx="13" ry="9" fill="#4f8a3a" stroke="#2a4a1c" strokeWidth="1" />
      <path d="M 4 18 L 28 18" stroke="#2a4a1c" strokeWidth="1.2" />
      <ellipse cx="10" cy="14" rx="3" ry="2.2" fill="#88dd66" stroke="#356b22" strokeWidth="0.7" />
      <ellipse cx="16" cy="13" rx="3" ry="2.2" fill="#88dd66" stroke="#356b22" strokeWidth="0.7" />
      <ellipse cx="22" cy="14" rx="3" ry="2.2" fill="#88dd66" stroke="#356b22" strokeWidth="0.7" />
    </svg>
  );
}

function WallIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="28" rx="13" ry="2" fill="#000" opacity="0.35" />
      <rect x="5" y="8" width="22" height="18" fill="#6c5a3a" stroke="#2a1f12" strokeWidth="1.4" />
      <rect x="5" y="8" width="22" height="3.5" fill="#8a7a52" />
      <line x1="11" y1="11.5" x2="11" y2="26" stroke="#2a1f12" strokeWidth="0.9" />
      <line x1="21" y1="11.5" x2="21" y2="26" stroke="#2a1f12" strokeWidth="0.9" />
      <line x1="5" y1="18" x2="27" y2="18" stroke="#2a1f12" strokeWidth="0.7" />
    </svg>
  );
}

function ArmoryIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="29" rx="12" ry="2" fill="#000" opacity="0.4" />
      <rect x="6" y="12" width="20" height="15" fill="#8a6a3a" stroke="#3a2a18" strokeWidth="1.2" />
      <polygon points="4,12 28,12 16,4" fill="#6c4a26" stroke="#2a1f12" strokeWidth="1.2" />
      <rect x="13" y="17" width="6" height="10" fill="#2a1f12" />
      <rect x="11" y="20" width="10" height="1.8" fill="#9aa0a8" />
      <rect x="14.5" y="20" width="3" height="3" fill="#5a606a" />
    </svg>
  );
}

function ShieldIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M 16 4 L 26 8 L 26 18 Q 26 24 16 28 Q 6 24 6 18 L 6 8 Z"
        fill="#b8945a" stroke="#3a2a14" strokeWidth="1.4" />
      <path d="M 16 4 L 26 8 L 26 18 Q 26 24 16 28 Z" fill="#8e6638" opacity="0.5" />
      <line x1="16" y1="11" x2="16" y2="22" stroke="#f5e8c8" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="11" y1="16" x2="21" y2="16" stroke="#f5e8c8" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function BarracksIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const main = faction === 'player' ? '#6b4a2a' : '#7a3a1a';
  const rim = faction === 'player' ? '#3a2614' : '#401a0a';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="26" rx="12" ry="2.5" fill="#000" opacity="0.4" />
      <ellipse cx="16" cy="20" rx="11" ry="7" fill={main} stroke={rim} strokeWidth="1" />
      <ellipse cx="11" cy="18" rx="2" ry="2.4" fill="#f5e8c8" />
      <ellipse cx="16" cy="18" rx="2" ry="2.4" fill="#f5e8c8" />
      <ellipse cx="21" cy="18" rx="2" ry="2.4" fill="#f5e8c8" />
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
  return (
    <div className="rts-topbar">
      <div className="rts-brand">Frontline RTS</div>
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
          <span className="rts-res-label">Soldater</span>
        </div>
      </div>

      <div className="rts-res">
        <span className="rts-res-icon"><AntIcon kind="worker" /></span>
        <div className="rts-res-stack">
          <ResValue value={s.player.workers} />
          <span className="rts-res-label">Arbeidere</span>
        </div>
      </div>

      <div className="rts-topbar-spacer" />

      <div className="rts-enemy-intel">
        <div className="rts-res">
          <span className="rts-res-icon"><MoundIcon faction="ai" /></span>
          <div className="rts-res-stack">
            <ResValue value={Math.max(0, s.enemy.baseHp)} />
            <span className="rts-res-label">Fiende-tue</span>
          </div>
        </div>
        <div className="rts-res">
          <span className="rts-res-icon"><AntIcon kind="soldier" faction="ai" /></span>
          <div className="rts-res-stack">
            <ResValue value={s.enemy.soldiers} />
            <span className="rts-res-label">Fiendesold</span>
          </div>
        </div>
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
          {/* subtle grid */}
          <g stroke="rgba(255,255,255,0.04)" strokeWidth={Math.max(1, mw / 400)}>
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={`vx${f}`} x1={mw * f} y1={0} x2={mw * f} y2={mh} />
            ))}
            {[0.25, 0.5, 0.75].map((f) => (
              <line key={`hy${f}`} x1={0} y1={mh * f} x2={mw} y2={mh * f} />
            ))}
          </g>
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

// ── Selection / Info ────────────────────────────────────────────────────

function hpClass(hp: number, max: number) {
  const pct = hp / max;
  if (pct > 0.6) return '';
  if (pct > 0.3) return 'med';
  return 'low';
}

function BuildingPortrait({ b }: { b: HudBuilding }) {
  if (b.kind === 'barracks') return <BarracksIcon size={72} faction={b.faction === 'ai' ? 'ai' : 'player'} />;
  if (b.kind === 'base') return <MoundIcon size={72} faction={b.faction === 'ai' ? 'ai' : 'player'} />;
  if (b.kind === 'tower') return <TowerIcon size={72} kind={b.towerType ?? 'stinger'} />;
  if (b.kind === 'farm') return <FarmIcon size={72} />;
  if (b.kind === 'wall') return <WallIcon size={72} />;
  if (b.kind === 'armory') return <ArmoryIcon size={72} />;
  return <FoodIcon size={72} />;
}

function buildingName(b: HudBuilding): string {
  if (b.kind === 'base') return b.faction === 'player' ? 'Maurtue (Hjem)' : 'Fiende-maurtue';
  if (b.kind === 'barracks') return b.faction === 'player' ? 'Barakke' : 'Fiende-barakke';
  if (b.kind === 'tower') {
    const tn: Record<TowerKind, string> = { stinger: 'Spydd-tårn', webber: 'Nett-tårn', spitter: 'Spytt-tårn' };
    return tn[b.towerType ?? 'stinger'];
  }
  if (b.kind === 'farm') return 'Avlsfarm';
  if (b.kind === 'wall') return 'Mur';
  if (b.kind === 'armory') return 'Våpenkammer';
  return 'Matkilde';
}

const BUILD_KIND_LABELS: Record<BuildKind, string> = {
  stinger: 'Spydd-tårn',
  webber: 'Nett-tårn',
  spitter: 'Spytt-tårn',
  farm: 'Avlsfarm',
  wall: 'Mur',
  armory: 'Våpenkammer',
  barracks: 'Barakke',
};

function BuildKindIcon({ size = 22, kind }: { size?: number; kind: BuildKind }) {
  if (kind === 'farm') return <FarmIcon size={size} />;
  if (kind === 'wall') return <WallIcon size={size} />;
  if (kind === 'armory') return <ArmoryIcon size={size} />;
  if (kind === 'barracks') return <BarracksIcon size={size} faction="player" />;
  return <TowerIcon size={size} kind={kind} />;
}

function InfoPanel({ s }: { s: HudState }) {
  const sel = s.selection;
  if (sel.kind === 'none') return null;

  return (
    <div className="rts-panel rts-info-panel" key={`${sel.kind}-${sel.kind === 'building' ? sel.building?.kind : sel.singleType ?? 'group'}`}>
      <div className="rts-section-title">Utvalg</div>

      {sel.kind === 'building' && sel.building && (
        <div className="rts-info-row">
          <div className="rts-portrait"><BuildingPortrait b={sel.building} /></div>
          <div className="rts-info-meta">
            <div className="rts-info-name">{buildingName(sel.building)}</div>
            <div className="rts-info-sub">
              {sel.building.underConstruction
                ? 'Under konstruksjon'
                : sel.building.kind === 'barracks' ? 'Soldat-trener'
                : sel.building.kind === 'base' ? 'Arbeider-trener'
                : ''}
            </div>
            <div className="rts-hp-bar">
              <div className={`rts-hp-fill ${hpClass(sel.building.hp, sel.building.maxHp)}`}
                style={{ width: `${Math.max(0, (sel.building.hp / sel.building.maxHp) * 100)}%` }} />
              <div className="rts-hp-label">{Math.max(0, sel.building.hp)} / {sel.building.maxHp} HP</div>
            </div>
            {sel.building.underConstruction && sel.building.buildProgress != null && (
              <div className="rts-hp-bar" style={{ marginTop: 4 }}>
                <div className="rts-hp-fill" style={{ width: `${Math.round(sel.building.buildProgress * 100)}%`, background: '#ddcc88' }} />
                <div className="rts-hp-label">Bygger: {Math.round(sel.building.buildProgress * 100)} %</div>
              </div>
            )}
            {sel.building.kind === 'barracks' && sel.building.faction === 'player' && !sel.building.underConstruction && (
              <div className="rts-info-sub" style={{ opacity: 0.85 }}>
                Høyreklikk i verdenen → setter rally-punkt for nye soldater
              </div>
            )}
          </div>
        </div>
      )}

      {sel.kind === 'units' && (
        <div className="rts-info-row">
          <div className="rts-portrait">
            <AntIcon size={68} kind={sel.singleType ?? (sel.soldiers && sel.soldiers > 0 ? 'soldier' : 'worker')} />
          </div>
          <div className="rts-info-meta">
            <div className="rts-info-name">
              {sel.singleType
                ? (sel.singleType === 'soldier' ? 'Soldat-maur' : 'Arbeider-maur')
                : `Tropp · ${(sel.soldiers ?? 0) + (sel.workers ?? 0)} enheter`}
            </div>
            <div className="rts-info-sub">
              {sel.singleType ? (sel.singleType === 'soldier' ? 'Krigerkaste' : 'Forsørgerkaste') : 'Blandet gruppe'}
            </div>

            {sel.singleHp != null && sel.singleMaxHp != null && (
              <div className="rts-hp-bar">
                <div className={`rts-hp-fill ${hpClass(sel.singleHp, sel.singleMaxHp)}`}
                  style={{ width: `${Math.max(0, (sel.singleHp / sel.singleMaxHp) * 100)}%` }} />
                <div className="rts-hp-label">{sel.singleHp} / {sel.singleMaxHp} HP</div>
              </div>
            )}

            {/* V5 — orders in progress (single unit) */}
            {sel.singleType && sel.currentAction && (
              <div className="rts-action-status">
                <span className={`rts-action-dot rts-action-${sel.currentAction.type}`} />
                <span className="rts-action-label">{sel.currentAction.label}</span>
                {sel.currentAction.progress != null && (
                  <div className="rts-action-progress">
                    <div
                      className="rts-action-progress-fill"
                      style={{ width: `${Math.round(sel.currentAction.progress * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            )}

            {!sel.singleType && (
              <div className="rts-roster">
                {(sel.soldiers ?? 0) > 0 && (
                  <span className="rts-roster-chip">
                    <span className="rts-mini-ant"><AntIcon size={14} kind="soldier" /></span>
                    {sel.soldiers} sold
                  </span>
                )}
                {(sel.workers ?? 0) > 0 && (
                  <span className="rts-roster-chip">
                    <span className="rts-mini-ant"><AntIcon size={14} kind="worker" /></span>
                    {sel.workers} arb
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Command card ───────────────────────────────────────────────────────

type CommandSlot = {
  key: string;
  label: string;
  icon: React.ReactNode;
  cost?: number;
  disabled?: boolean;
  cant?: boolean;
  onClick?: () => void;
};

function CmdButton({ slot }: { slot: CommandSlot | null }) {
  if (!slot) return <div className="rts-cmd rts-cmd-empty" aria-hidden />;
  const affordable = slot.cost != null && !slot.disabled && !slot.cant;
  return (
    <button
      className={`rts-cmd ${affordable ? 'affordable' : ''}`}
      disabled={slot.disabled}
      onClick={slot.onClick}
      title={`${slot.label}${slot.cost ? ` · ${slot.cost} mat` : ''} [${slot.key}]`}
    >
      <span className="rts-cmd-hotkey">{slot.key}</span>
      <span className="rts-cmd-icon">{slot.icon}</span>
      <span className="rts-cmd-label">{slot.label}</span>
      {slot.cost != null && (
        <span className={`rts-cmd-cost ${slot.cant ? 'cant' : ''}`}>{slot.cost}</span>
      )}
    </button>
  );
}

function CommandCard({ s }: { s: HudState }) {
  const sel = s.selection;
  const slots: (CommandSlot | null)[] = useMemo(() => {
    const arr: (CommandSlot | null)[] = new Array(12).fill(null);

    // Helpers — bygger slots kun når relevant for det aktive utvalget.
    // Blizzard-mønster: kortet bytter ut rad 1 etter selection, rad 2-3 er alltid bygg-knapper.
    const wCost = s.costs.worker;
    const sCost = s.costs.soldier;
    const defenseCost = 100; // matcher CONFIG.BASE_DEFENSE_COST

    const trainWorkerSlot = (idx: number) => {
      arr[idx] = {
        key: 'Q',
        label: 'Arbeider',
        icon: <AntIcon size={40} kind="worker" />,
        cost: wCost,
        cant: s.player.gold < wCost,
        disabled: s.player.gold < wCost,
        onClick: () => hudBridge.sendCommand({ type: 'train', unit: 'worker' }),
      };
    };
    const trainSoldierSlot = (idx: number) => {
      arr[idx] = {
        key: 'E',
        label: 'Soldat',
        icon: <AntIcon size={40} kind="soldier" />,
        cost: sCost,
        cant: s.player.gold < sCost,
        disabled: s.player.gold < sCost,
        onClick: () => hudBridge.sendCommand({ type: 'train', unit: 'soldier' }),
      };
    };

    const defenseSlot = (already: boolean, idx = 1) => {
      arr[idx] = {
        key: 'V',
        label: already ? 'Forsvar ✓' : 'Forsvar',
        icon: <ShieldIcon size={40} />,
        cost: already ? undefined : defenseCost,
        cant: !already && s.player.gold < defenseCost,
        disabled: already || s.player.gold < defenseCost,
        onClick: () => hudBridge.sendCommand({ type: 'upgrade-base-defense' }),
      };
    };

    const towerSlots = () => {
      const towers: { key: string; type: TowerKind; label: string; cost: number }[] = [
        { key: '1', type: 'stinger', label: 'Spydd',  cost: 80  },
        { key: '2', type: 'webber',  label: 'Nett',   cost: 100 },
        { key: '3', type: 'spitter', label: 'Spytt',  cost: 120 },
      ];
      towers.forEach((t, i) => {
        arr[4 + i] = {
          key: t.key,
          label: t.label,
          icon: <TowerIcon size={36} kind={t.type} />,
          cost: t.cost,
          cant: s.player.gold < t.cost,
          disabled: s.player.gold < t.cost,
          onClick: () => hudBridge.sendCommand({ type: 'build-start', kind: t.type }),
        };
      });
    };

    const buildingSlots = () => {
      const buildings: { key: string; kind: BuildKind; label: string; cost: number; icon: React.ReactNode }[] = [
        { key: '4', kind: 'barracks', label: 'Barakke', cost: 80, icon: <BarracksIcon size={36} faction="player" /> },
        { key: '5', kind: 'farm',     label: 'Avlsfarm', cost: 60,  icon: <FarmIcon size={36} /> },
        { key: '6', kind: 'wall',     label: 'Mur',     cost: 20,  icon: <WallIcon size={36} /> },
        { key: '7', kind: 'armory',   label: 'Vpn.kammer', cost: 100, icon: <ArmoryIcon size={36} /> },
      ];
      buildings.forEach((b, i) => {
        arr[7 + i] = {
          key: b.key,
          label: b.label,
          icon: b.icon,
          cost: b.cost,
          cant: s.player.gold < b.cost,
          disabled: s.player.gold < b.cost,
          onClick: () => hudBridge.sendCommand({ type: 'build-start', kind: b.kind }),
        };
      });
    };

    const formationSlot = (idx: number) => {
      arr[idx] = {
        key: 'F',
        label: 'Formasjon',
        icon: <span style={{ fontSize: 20, color: '#cfe3a3', letterSpacing: 2 }}>▫▫▫</span>,
        onClick: () => hudBridge.sendCommand({ type: 'formation' }),
      };
    };

    const selectAllSoldiers = (idx: number) => {
      arr[idx] = {
        key: 'Z',
        label: 'Alle sold',
        icon: <AntIcon size={36} kind="soldier" />,
        onClick: () => hudBridge.sendCommand({ type: 'select-all-soldiers' }),
      };
    };

    const selectAllWorkers = (idx: number) => {
      arr[idx] = {
        key: 'X',
        label: 'Alle arb',
        icon: <AntIcon size={36} kind="worker" />,
        onClick: () => hudBridge.sendCommand({ type: 'select-all-workers' }),
      };
    };

    const clearSlot = (idx: number) => {
      arr[idx] = {
        key: 'Esc',
        label: 'Rydd',
        icon: <span style={{ fontSize: 30, color: '#a89878', lineHeight: 1 }}>✕</span>,
        onClick: () => hudBridge.sendCommand({ type: 'clear-selection' }),
      };
    };

    // ── Regler ──────────────────────────────────────────────────────────
    // Rad 2-3: bygg-knapper alltid synlige
    towerSlots();
    buildingSlots();
    clearSlot(11);

    if (sel.kind === 'building' && sel.building?.faction === 'player') {
      // Bygning under konstruksjon kan ikke trene enheter.
      const isFunctional = !sel.building.underConstruction;
      if (sel.building.kind === 'base' && isFunctional) {
        // Maurtua trener workers (Starcraft-stil: town hall produserer arbeiderne).
        trainWorkerSlot(0);
        defenseSlot(!!sel.building.hasDefense);
      } else if (sel.building.kind === 'barracks' && isFunctional) {
        // Barakka trener kun soldater (workers kommer fra maurtua).
        trainSoldierSlot(0);
      }
    } else if (sel.kind === 'units') {
      const hasSoldiers = (sel.soldiers ?? 0) >= 1;
      const hasMultipleSoldiers = (sel.soldiers ?? 0) >= 2;
      const hasWorkers = (sel.workers ?? 0) >= 1;

      let slot = 0;
      if (hasMultipleSoldiers) { formationSlot(slot++); }
      if (hasSoldiers) { selectAllSoldiers(slot++); }
      if (hasWorkers) { selectAllWorkers(slot++); }
    }
    // sel.kind === 'none' → ingen rad-1-handlinger, men bygg-rader er fortsatt synlige

    return arr;
  }, [sel, s.player.gold, s.costs.worker, s.costs.soldier]);

  return (
    <div className="rts-panel rts-command-panel">
      <div className="rts-section-title">Kommandoer</div>
      <div className="rts-command-grid">
        {slots.map((slot, i) => <CmdButton key={i} slot={slot} />)}
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
        <div><span>Soldater trent</span><strong>{st.soldiersTrained}</strong></div>
        <div><span>Arbeidere trent</span><strong>{st.workersTrained}</strong></div>
        <div><span>Mat samlet</span><strong>{st.goldEarned}</strong></div>
        <div><span>Fiende-drap</span><strong>{st.enemyKills}</strong></div>
        <div><span>Egne tap</span><strong>{st.unitsLost}</strong></div>
        <div><span>Maks miner holdt</span><strong>{st.peakMines}</strong></div>
        <div><span>Tårn bygget</span><strong>{st.playerTowers}</strong></div>
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
    section: 'Kamera & seleksjon',
    keys: [
      ['WASD / piltaster', 'Panorér kamera'],
      ['Klikk minimap', 'Pan til punkt'],
      ['Shift / Høyreklikk minimap', 'Attack-move til punkt'],
      ['Klikk enhet', 'Velg enhet'],
      ['Dobbeltklikk enhet', 'Velg alle samme type på skjermen'],
      ['Dra', 'Box-select'],
      ['Shift+klikk', 'Legg til i seleksjon'],
      ['Esc', 'Rydd seleksjon / avbryt'],
    ],
  },
  {
    section: 'Trening & bygg',
    keys: [
      ['Q', 'Tren arbeider (fra maurtua)'],
      ['E', 'Tren soldat (fra barakka)'],
      ['B', 'Bygg-mode (barakke)'],
      ['T', 'Bygg-mode (stinger-tårn)'],
      ['1 / 2 / 3', 'Stinger / Webber / Spitter (i bygg-mode)'],
      ['4 / 5 / 6 / 7', 'Barakke / Farm / Mur / Smie (i bygg-mode)'],
      ['V', 'Forsvar-oppgradering (maurtua valgt)'],
    ],
  },
  {
    section: 'Kommandoer',
    keys: [
      ['Z', 'Velg alle soldater'],
      ['X', 'Velg alle arbeidere'],
      ['F', 'Linje-formasjon (med soldater valgt)'],
      ['Høyreklikk', 'Flytt / angrep / mine / rally'],
    ],
  },
  {
    section: 'Spill',
    keys: [
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
  const { current, total, nextInMs, active } = s.waveMode;
  const sec = Math.ceil(nextInMs / 1000);
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  const countdown = `${mm}:${ss.toString().padStart(2, '0')}`;
  return (
    <div className={`rts-wave-banner ${active ? 'active' : 'cooldown'}`}>
      <span className="rts-wave-label">Bølge</span>
      <span className="rts-wave-count">{Math.max(1, current)} / {total}</span>
      {!active && current < total && (
        <span className="rts-wave-next">Neste om <strong>{countdown}</strong></span>
      )}
      {active && <span className="rts-wave-next">Forsvarer base!</span>}
    </div>
  );
}

// ── Build-mode banner (M2.1) ──────────────────────────────────────────

function BuildModeBanner({ s }: { s: HudState }) {
  if (!s.buildMode) return null;
  return (
    <div className="rts-build-banner">
      <span className="rts-build-icon"><BuildKindIcon size={26} kind={s.buildMode.kind} /></span>
      <div className="rts-build-info">
        <div className="rts-build-title">Bygger {BUILD_KIND_LABELS[s.buildMode.kind]} — {s.buildMode.cost} mat</div>
        <div className="rts-build-hint">
          1/2/3 = tårn · 4 = barakke · 5/6/7 = farm/mur/våpenkammer · venstreklikk plasserer (worker bygger) · Esc avbryter
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
      <InfoPanel s={state} />
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
