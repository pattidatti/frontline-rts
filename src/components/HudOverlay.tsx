import { useEffect, useState, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { hudBridge, type HudState, type TowerKind, type HudUpgradeRarity } from '../game/hudBridge';
import { getVolume, setVolume, onVolumeChange } from '../game/audio';
import { CONFIG, type UnitKind } from '../game/config';
import './HudOverlay.css';

// ── SVG icons ───────────────────────────────────────────────────────────

function AntIcon({ size = 22, faction = 'player', kind = 'medium' }: {
  size?: number; faction?: 'player' | 'ai'; kind?: UnitKind;
}) {
  if (kind === 'medium') return <LarvaIcon size={size} faction={faction} />;
  if (kind === 'heavy') return <BumblebeeIcon size={size} faction={faction} />;
  if (kind === 'wasp') return <WaspIcon size={size} faction={faction} />;
  if (kind === 'termite') return <TermiteIcon size={size} faction={faction} />;

  // Light + sumo + fallback: vanlig maur.
  const body = faction === 'player' ? '#1a1a1a' : '#7a2a14';
  const highlight = faction === 'player' ? '#3a3a3a' : '#a04428';
  const mandible = faction === 'player' ? '#d8c8a0' : '#e8b078';
  const scale = kind === 'light' ? 0.85 : kind === 'sumo' ? 1.4 : 1.0;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <g transform={`translate(16 16) scale(${scale}) translate(-16 -16)`}>
        <g stroke={body} strokeWidth="1.2" strokeLinecap="round">
          <line x1="13" y1="16" x2="6" y2="11" />
          <line x1="13" y1="16" x2="5" y2="16" />
          <line x1="13" y1="16" x2="6" y2="22" />
          <line x1="19" y1="16" x2="26" y2="11" />
          <line x1="19" y1="16" x2="27" y2="16" />
          <line x1="19" y1="16" x2="26" y2="22" />
        </g>
        <ellipse cx="22" cy="16" rx="6" ry="4.5" fill={body} />
        <ellipse cx="21" cy="14.5" rx="2.5" ry="1.2" fill={highlight} opacity="0.65" />
        <ellipse cx="15" cy="16" rx="3.2" ry="2.8" fill={body} />
        <ellipse cx="9" cy="16" rx="3.5" ry="3" fill={body} />
        <ellipse cx="8.5" cy="15" rx="1.4" ry="1" fill={highlight} opacity="0.7" />
        <line x1="6" y1="15" x2="3.5" y2="13.5" stroke={mandible} strokeWidth="1" strokeLinecap="round" />
        <line x1="6" y1="17" x2="3.5" y2="18.5" stroke={mandible} strokeWidth="1" strokeLinecap="round" />
        <path d="M 8 13 Q 5 9 7 6" stroke={body} strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M 10 13 Q 9 8 11 6" stroke={body} strokeWidth="1" fill="none" strokeLinecap="round" />
        {kind === 'sumo' && (
          <g>
            <ellipse cx="22" cy="17.5" rx="7" ry="5.5" fill={body} />
            <rect x="15" y="14" width="14" height="2.2" fill="#e8c060" stroke="#7a5a18" strokeWidth="0.5" />
            <circle cx="22" cy="15.1" r="0.9" fill="#ffd86a" />
          </g>
        )}
      </g>
    </svg>
  );
}

function LarvaIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const body = faction === 'player' ? '#9ab84a' : '#c88a3a';
  const rim = faction === 'player' ? '#4a6a20' : '#6a3a14';
  const sheen = faction === 'player' ? '#d0e89a' : '#f4cc88';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="22" rx="11" ry="2" fill="#000" opacity="0.32" />
      <ellipse cx="7"  cy="16" rx="3.4" ry="3"   fill={body} stroke={rim} strokeWidth="0.9" />
      <ellipse cx="12" cy="16" rx="4.4" ry="4.2" fill={body} stroke={rim} strokeWidth="0.9" />
      <ellipse cx="18" cy="16" rx="4.6" ry="4.4" fill={body} stroke={rim} strokeWidth="0.9" />
      <ellipse cx="24" cy="16" rx="3.5" ry="3.2" fill={body} stroke={rim} strokeWidth="0.9" />
      <ellipse cx="8"  cy="14.6" rx="1.6" ry="0.9" fill={sheen} opacity="0.75" />
      <ellipse cx="12" cy="14"   rx="2.4" ry="1.0" fill={sheen} opacity="0.75" />
      <ellipse cx="18" cy="13.7" rx="2.6" ry="1.1" fill={sheen} opacity="0.75" />
      <ellipse cx="24" cy="14.3" rx="1.7" ry="0.9" fill={sheen} opacity="0.75" />
      <circle cx="25" cy="15.2" r="0.6" fill="#0a0a0a" />
      <circle cx="25" cy="16.8" r="0.6" fill="#0a0a0a" />
    </svg>
  );
}

function BumblebeeIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const body = faction === 'player' ? '#1a1a1a' : '#5a2010';
  const stripe = faction === 'player' ? '#e8c64a' : '#f0a040';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="24" rx="11" ry="2" fill="#000" opacity="0.35" />
      <ellipse cx="11" cy="11" rx="7" ry="4" fill="#f4f8ff" stroke="#88aacc" strokeWidth="0.6" opacity="0.78" />
      <ellipse cx="11" cy="20" rx="7" ry="4" fill="#f4f8ff" stroke="#88aacc" strokeWidth="0.6" opacity="0.78" />
      <ellipse cx="14" cy="16" rx="9" ry="7" fill={body} stroke="#000" strokeWidth="0.9" />
      <ellipse cx="9"    cy="16" rx="1.5" ry="5.5" fill={stripe} />
      <ellipse cx="14"   cy="16" rx="1.6" ry="6.2" fill={stripe} />
      <ellipse cx="18.5" cy="16" rx="1.5" ry="5.7" fill={stripe} />
      <ellipse cx="24" cy="16" rx="4.2" ry="4" fill={body} stroke="#000" strokeWidth="0.85" />
      <circle cx="25"   cy="14.6" r="0.9" fill="#111" />
      <circle cx="25"   cy="17.4" r="0.9" fill="#111" />
      <circle cx="25.3" cy="14.3" r="0.3" fill="#fff" />
      <circle cx="25.3" cy="17.1" r="0.3" fill="#fff" />
      <line x1="26" y1="13" x2="29" y2="9"  stroke="#000" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="26" y1="19" x2="29" y2="23" stroke="#000" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx="29" cy="9"  r="0.7" fill="#000" />
      <circle cx="29" cy="23" r="0.7" fill="#000" />
    </svg>
  );
}

function WaspIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const body = faction === 'player' ? '#181818' : '#5a2010';
  const stripe = faction === 'player' ? '#ffd83a' : '#ff8030';
  const wing = '#dde8f4';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="25" rx="10" ry="1.6" fill="#000" opacity="0.32" />
      {/* Vinger: smale, spisse, diagonale */}
      <ellipse cx="11" cy="10" rx="6" ry="3" fill={wing} stroke="#88aacc" strokeWidth="0.5" opacity="0.78"
        transform="rotate(-18 11 10)" />
      <ellipse cx="11" cy="22" rx="6" ry="3" fill={wing} stroke="#88aacc" strokeWidth="0.5" opacity="0.78"
        transform="rotate(18 11 22)" />
      {/* Slankt abdomen + thorax */}
      <ellipse cx="13" cy="16" rx="5" ry="3.6" fill={body} stroke="#000" strokeWidth="0.8" />
      <rect x="9" y="14.3" width="8" height="1.4" fill={stripe} />
      <rect x="9" y="16.3" width="8" height="1.4" fill={stripe} />
      {/* Spiss "kniv"-abdomen-snabel bak */}
      <polygon points="4,16 8,14.5 8,17.5" fill={body} stroke="#000" strokeWidth="0.6" />
      {/* Hode */}
      <ellipse cx="22" cy="16" rx="3.8" ry="3.4" fill={body} stroke="#000" strokeWidth="0.8" />
      <circle cx="23" cy="14.8" r="0.8" fill="#fff" />
      <circle cx="23" cy="17.2" r="0.8" fill="#fff" />
      <circle cx="23.2" cy="14.8" r="0.4" fill="#000" />
      <circle cx="23.2" cy="17.2" r="0.4" fill="#000" />
      {/* Antenner */}
      <line x1="24" y1="13.5" x2="27" y2="9" stroke="#000" strokeWidth="0.85" strokeLinecap="round" />
      <line x1="24" y1="18.5" x2="27" y2="23" stroke="#000" strokeWidth="0.85" strokeLinecap="round" />
    </svg>
  );
}

function TermiteIcon({ size = 22, faction = 'player' }: { size?: number; faction?: 'player' | 'ai' }) {
  const body = faction === 'player' ? '#e8d4a8' : '#caa078';
  const rim = faction === 'player' ? '#9a8458' : '#7a4a28';
  const sheen = '#f6ecc8';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <ellipse cx="16" cy="23" rx="9" ry="1.6" fill="#000" opacity="0.28" />
      {/* Liten, segmentert, blek termitt */}
      <ellipse cx="9"  cy="16" rx="3.4" ry="2.4" fill={body} stroke={rim} strokeWidth="0.75" />
      <ellipse cx="14" cy="16" rx="3.0" ry="2.6" fill={body} stroke={rim} strokeWidth="0.75" />
      <ellipse cx="19" cy="16" rx="2.5" ry="2.2" fill={body} stroke={rim} strokeWidth="0.75" />
      <ellipse cx="9"  cy="14.6" rx="1.6" ry="0.6" fill={sheen} opacity="0.85" />
      <ellipse cx="14" cy="14.6" rx="1.4" ry="0.6" fill={sheen} opacity="0.85" />
      {/* Hode + mandibler */}
      <circle cx="22.5" cy="16" r="2.5" fill={body} stroke={rim} strokeWidth="0.75" />
      <line x1="24" y1="14.5" x2="27" y2="13" stroke={rim} strokeWidth="1" strokeLinecap="round" />
      <line x1="24" y1="17.5" x2="27" y2="19" stroke={rim} strokeWidth="1" strokeLinecap="round" />
      <circle cx="22" cy="15.4" r="0.45" fill="#0a0a0a" />
      <circle cx="22" cy="16.6" r="0.45" fill="#0a0a0a" />
    </svg>
  );
}

function FoodIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <path d="M 6 22 Q 6 6 22 6 Q 26 18 16 26 Q 8 26 6 22 Z"
        fill="#6ba84a" stroke="#3a5a28" strokeWidth="1" />
      <path d="M 6 22 Q 14 18 22 6" stroke="#3a5a28" strokeWidth="1.4" fill="none" />
      <path d="M 10 20 Q 13 17 16 14" stroke="#3a5a28" strokeWidth="0.7" fill="none" />
      <path d="M 8 18 Q 11 15 14 12" stroke="#3a5a28" strokeWidth="0.7" fill="none" />
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

// ── Topbar ──────────────────────────────────────────────────────────────

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
      <button type="button" className="rts-vol-icon" onClick={() => setVolume(muted ? 0.6 : 0)}>
        {icon}
      </button>
      <input
        className="rts-vol-slider"
        type="range" min={0} max={1} step={0.05}
        value={vol}
        onChange={(e) => setVolume(parseFloat(e.target.value))}
      />
    </div>
  );
}

function SpeedBadge({ s }: { s: HudState }) {
  const paused = s.gameSpeed === 0;
  const label = paused ? '⏸' : `▶ ${s.gameSpeed}×`;
  return (
    <button
      type="button"
      className={`rts-speed-badge ${paused ? 'paused' : ''}`}
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
  const baseHpPct = Math.max(0, (s.player.baseHp / s.player.baseMaxHp) * 100);
  const wave = s.waveMode;
  return (
    <div className="rts-topbar">
      <div className="rts-brand">Frontline TD</div>
      <SpeedBadge s={s} />

      <div className="rts-res">
        <span className="rts-res-icon"><FoodIcon size={28} /></span>
        <div className="rts-res-stack">
          <ResValue value={s.player.gold} />
          <span className="rts-res-label">Mat</span>
        </div>
      </div>

      <span className="rts-divider" />

      <div className="rts-res">
        <span className="rts-res-icon"><AntIcon size={28} kind="medium" /></span>
        <div className="rts-res-stack">
          <ResValue value={s.player.soldiers} />
          <span className="rts-res-label">På lanene</span>
        </div>
      </div>

      <div className="rts-topbar-spacer" />

      <div className="rts-enemy-intel">
        <div className="rts-res">
          <span className="rts-res-icon"><MoundIcon size={28} faction="player" /></span>
          <div className="rts-res-stack">
            <ResValue value={Math.max(0, s.player.baseHp)} />
            <span className="rts-res-label">Maurtue {Math.round(baseHpPct)}%</span>
          </div>
        </div>
        <div className="rts-res">
          <span className="rts-res-icon"><MoundIcon size={28} faction="ai" /></span>
          <div className="rts-res-stack">
            <ResValue value={Math.max(0, s.enemy.baseHp)} />
            <span className="rts-res-label">Fiendebase {Math.round(Math.max(0, (s.enemy.baseHp / Math.max(1, s.enemy.baseMaxHp)) * 100))}%</span>
          </div>
        </div>
        {wave && (
          <div className="rts-res">
            <span className="rts-res-icon"><AntIcon size={28} kind="medium" faction="ai" /></span>
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

// ── Lane portals (floating buttons over canvas) ─────────────────────────

const LANE_META: Array<{ lane: 0 | 1 | 2; hotkey: '1' | '2' | '3'; label: string }> = [
  { lane: 0, hotkey: '1', label: 'Nord' },
  { lane: 1, hotkey: '2', label: 'Midt' },
  { lane: 2, hotkey: '3', label: 'Sør' },
];

// Radial-menyen fanner ut 90° bort fra lane-retningen ved portalen,
// så den aldri dekker mauren som spawner ut langs lanen.
const LANE_MENU_CENTER_ANGLE: Record<0 | 1 | 2, number> = {
  0: -Math.PI / 2,   // Nord-portal: vifter opp
  1: Math.PI,        // Midt-portal: vifter vestover
  2: Math.PI / 2,    // Sør-portal: vifter ned
};
// Per lane: +1 betyr at hotkey 1 lander først (venstre/topp) i naturlig leseretning,
// -1 snur viften. Uten dette ville Midt og Sør lest motsatt vei av Nord.
const LANE_MENU_DIRECTION: Record<0 | 1 | 2, 1 | -1> = {
  0:  1,  // Nord: 1=venstre, 3=høyre
  1: -1,  // Midt: 1=topp, 3=bunn (uten flip leses den bottom→top)
  2: -1,  // Sør: 1=venstre, 3=høyre (uten flip leses den right→left)
};
const RADIAL_RADIUS = 118;
const RADIAL_ARC_PER_OPT = (52 * Math.PI) / 180;

const UNIT_OPTIONS: Array<{ kind: UnitKind; hotkey: '1' | '2' | '3'; label: string }> = [
  { kind: 'light',  hotkey: '1', label: 'Maur' },
  { kind: 'medium', hotkey: '2', label: 'Larve' },
  { kind: 'heavy',  hotkey: '3', label: 'Humle' },
];

const UNLOCKABLE_OPTIONS: Record<UnitKind, { hotkey: string; label: string } | undefined> = {
  light: undefined,
  medium: undefined,
  heavy: undefined,
  sumo: { hotkey: '4', label: 'Sumo' },
  wasp: { hotkey: '5', label: 'Veps' },
  termite: { hotkey: '6', label: 'Termitt' },
};

/**
 * Returner skjerm-koordinater (i CSS-piksler) for et verdens-punkt,
 * gitt at canvasen er sentrert med letterbox via Phaser.Scale.FIT.
 */
function projectWorldToScreen(
  canvas: HTMLCanvasElement,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  const sx = rect.left + (worldX / CONFIG.MAP_WIDTH) * rect.width;
  const sy = rect.top + (worldY / CONFIG.MAP_HEIGHT) * rect.height;
  return { x: sx, y: sy };
}

function LanePortals({ s }: { s: HudState }) {
  const [openLane, setOpenLane] = useState<0 | 1 | 2 | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [, force] = useState(0);

  // Finn canvasen og hold den oppdatert
  useLayoutEffect(() => {
    const find = () => {
      const c = document.querySelector('canvas');
      if (c instanceof HTMLCanvasElement) setCanvas(c);
    };
    find();
    const t = window.setInterval(find, 500);
    return () => window.clearInterval(t);
  }, []);

  // Re-render ved resize så posisjonene oppdateres
  useLayoutEffect(() => {
    if (!canvas) return;
    const ro = new ResizeObserver(() => force((n) => n + 1));
    ro.observe(canvas);
    window.addEventListener('resize', () => force((n) => n + 1));
    return () => ro.disconnect();
  }, [canvas]);

  // Bygg full opsjons-liste fra standard + de som er låst opp via oppgraderinger.
  const allOptions = useMemo(() => {
    const opts: Array<{ kind: UnitKind; hotkey: string; label: string }> = [...UNIT_OPTIONS];
    for (const k of s.unlockedUnits) {
      const meta = UNLOCKABLE_OPTIONS[k];
      if (meta && !opts.find((o) => o.kind === k)) {
        opts.push({ kind: k, hotkey: meta.hotkey, label: meta.label });
      }
    }
    return opts;
  }, [s.unlockedUnits]);

  // Hotkeys: 1/2/3 åpner lane-meny; i menyen velger 1/2/3/4 unit-type
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (s.upgradeChoice) return;  // upgrade-modalen eier 1/2/3 i den modusen
      const k = e.key;
      if (openLane === null) {
        if (k === '1' || k === '2' || k === '3') {
          const target = (parseInt(k, 10) - 1) as 0 | 1 | 2;
          // Bare åpne hvis lanen finnes som portal i nåværende stage.
          if (s.lanePortals.some((p) => p.lane === target)) {
            setOpenLane(target);
            e.preventDefault();
          }
        }
      } else {
        if (k === 'Escape') { setOpenLane(null); e.preventDefault(); return; }
        const opt = allOptions.find((o) => o.hotkey === k);
        if (opt) {
          hudBridge.sendCommand({ type: 'send-lane', lane: openLane, unitKind: opt.kind });
          setOpenLane(null);
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openLane, s.upgradeChoice, allOptions, s.lanePortals]);

  if (!canvas) return null;

  return (
    <>
      {/* Klikk-fanger som lukker menyen ved utenfor-klikk (under portalene, over alt annet) */}
      {openLane !== null && (
        <div
          className="rts-lane-portal-backdrop"
          onClick={() => setOpenLane(null)}
          onContextMenu={(e) => { e.preventDefault(); setOpenLane(null); }}
        />
      )}
      {s.lanePortals.map((portal) => {
        const meta = LANE_META[portal.lane];
        const pos = projectWorldToScreen(canvas, portal.worldX, portal.worldY);
        const isOpen = openLane === portal.lane;
        // Når en lane er åpen, skjul de to andre portalene helt
        const hideOthers = openLane !== null && !isOpen;
        if (hideOthers) return null;
        const soldiers = s.laneCounts[portal.lane];
        const preview = s.waveMode?.nextWavePreview;
        const isTargeted = !!(s.waveMode?.idle && preview &&
          (preview.lane === 'all' || preview.lane === portal.lane));
        const centerAngle = LANE_MENU_CENTER_ANGLE[portal.lane];
        const dirMul = LANE_MENU_DIRECTION[portal.lane];
        const n = allOptions.length;
        const arcSpan = RADIAL_ARC_PER_OPT * Math.max(0, n - 1);
        return (
          <div
            key={`portal-${portal.lane}`}
            className={`rts-lane-portal ${isOpen ? 'is-open' : ''}`}
            style={{ left: `${pos.x}px`, top: `${pos.y}px` }}
          >
            <button
              className={`rts-lane-portal-btn lane-${portal.lane} ${isOpen ? 'is-active' : ''} ${isTargeted ? 'is-threatened' : ''}`}
              onClick={() => setOpenLane(isOpen ? null : portal.lane)}
              title={isOpen ? 'Lukk meny' : `${meta.label}-lane — åpne meny [${meta.hotkey}]`}
            >
              <span className="rts-portal-hotkey">{meta.hotkey}</span>
              <span className="rts-portal-label">{meta.label}</span>
              <span className="rts-portal-count">
                <AntIcon size={16} kind="medium" /> {soldiers}
              </span>
              {isTargeted && preview && (
                <span className="rts-portal-threat" aria-label="Angripes av neste bølge">
                  <AntIcon size={14} faction="ai" kind={preview.unitKind} />
                </span>
              )}
            </button>
            {isOpen && (
              <div className="rts-lane-portal-radial" aria-label={`${meta.label}-meny`}>
                {allOptions.map((opt, i) => {
                  const t = n <= 1 ? 0 : i / (n - 1);
                  const angle = centerAngle + (t - 0.5) * arcSpan * dirMul;
                  const dx = Math.cos(angle) * RADIAL_RADIUS;
                  const dy = Math.sin(angle) * RADIAL_RADIUS;
                  const cost = s.costs[opt.kind];
                  const cant = s.player.gold < cost;
                  return (
                    <button
                      key={opt.kind}
                      className={`rts-portal-radial-opt ${cant ? 'cant-afford' : 'affordable'} unit-${opt.kind}`}
                      style={{
                        ['--dx' as never]: `${dx}px`,
                        ['--dy' as never]: `${dy}px`,
                        ['--i' as never]: i,
                      }}
                      onClick={() => {
                        hudBridge.sendCommand({ type: 'send-lane', lane: portal.lane, unitKind: opt.kind });
                        setOpenLane(null);
                      }}
                      title={`${opt.label} (${cost} mat) [${opt.hotkey}]`}
                    >
                      <span className="rts-portal-radial-hotkey">{opt.hotkey}</span>
                      <span className="rts-portal-radial-icon"><AntIcon size={48} kind={opt.kind} /></span>
                      <span className="rts-portal-radial-label">{opt.label}</span>
                      <span className={`rts-portal-radial-cost ${cant ? 'cant' : ''}`}>
                        <FoodIcon size={14} /> {cost}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ── Build panel (tårn) ──────────────────────────────────────────────────

const BUILD_OPTIONS: Array<{ id: TowerKind; hotkey: 'Q' | 'W' | 'E'; label: string; describe: string }> = [
  { id: 'stinger', hotkey: 'Q', label: 'Spydd', describe: 'Single-target — høy skade' },
  { id: 'webber',  hotkey: 'W', label: 'Nett',  describe: 'Sløver fienden 50 %' },
  { id: 'spitter', hotkey: 'E', label: 'Spytt', describe: 'Splash i område' },
];

function BuildPanel({ s }: { s: HudState }) {
  const buildActive = !!s.buildMode;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (s.upgradeChoice) return;
      const k = e.key.toUpperCase();
      const opt = BUILD_OPTIONS.find((o) => o.hotkey === k);
      if (opt) {
        if (s.player.gold >= s.towerCosts[opt.id]) {
          hudBridge.sendCommand({ type: 'build-start', kind: opt.id });
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [s.player.gold, s.towerCosts, s.upgradeChoice]);

  return (
    <div className="rts-panel rts-build-panel">
      <div className="rts-section-title">Tårn</div>
      <div className="rts-build-row">
        {BUILD_OPTIONS.map((opt, i) => {
          const cost = s.towerCosts[opt.id];
          const cant = s.player.gold < cost;
          const active = buildActive && s.buildMode?.kind === opt.id;
          return (
            <button
              key={opt.id}
              className={`rts-build-opt ${cant ? 'cant-afford' : 'affordable'} ${active ? 'active' : ''}`}
              style={{ ['--i' as never]: i }}
              onClick={() => hudBridge.sendCommand({ type: 'build-start', kind: opt.id })}
              title={`${opt.label} — ${opt.describe} (${cost} mat) [${opt.hotkey}]`}
            >
              <span className="rts-build-hotkey">{opt.hotkey}</span>
              <span className="rts-build-icon-wrap"><TowerIcon size={48} kind={opt.id} /></span>
              <span className="rts-build-label">{opt.label}</span>
              <span className={`rts-build-cost ${cant ? 'cant' : ''}`}>
                <FoodIcon size={13} /> {cost}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Game-over ──────────────────────────────────────────────────────────

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
        <div><span>Mat brukt</span><strong>{st.goldSpent}</strong></div>
        <div><span>Fiende-drap</span><strong>{st.enemyKills}</strong></div>
        <div><span>Egne tap</span><strong>{st.unitsLost}</strong></div>
        <div><span>Tårn bygget</span><strong>{st.playerTowers}</strong></div>
        <div><span>Base-HP igjen</span><strong>{Math.max(0, s.player.baseHp)}</strong></div>
      </div>
      {s.activeUpgrades && s.activeUpgrades.length > 0 && (
        <div className="rts-gameover-upgrades">
          <div className="rts-gameover-upgrades-title">Upgrades tatt</div>
          <div className="rts-gameover-upgrades-list">
            {s.activeUpgrades.map((u) => (
              <span
                key={u.id}
                className={`rts-gameover-upgrade-chip rarity-${u.rarity}`}
                style={{ ['--rarity-tone' as never]: RARITY_TONES[u.rarity] }}
                title={u.description}
              >
                <span>{u.icon}</span>
                <span>{u.name}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="rts-gameover-actions">
        <button className="rts-gameover-btn primary" onClick={() => hudBridge.sendCommand({ type: 'restart' })}>
          ↻ Spill igjen <kbd>R</kbd>
        </button>
        <button className="rts-gameover-btn" onClick={() => hudBridge.sendCommand({ type: 'to-menu' })}>
          Til hovedmeny
        </button>
      </div>
    </div>
  );
}

// ── Hotkeys cheat-sheet ───────────────────────────────────────────────

const HOTKEYS: Array<{ section: string; keys: Array<[string, string]> }> = [
  {
    section: 'Lane-portaler',
    keys: [
      ['1', 'Åpne Nord-lane meny'],
      ['2', 'Åpne Midt-lane meny'],
      ['3', 'Åpne Sør-lane meny'],
      ['1', 'I meny: send Maur (lett)'],
      ['2', 'I meny: send Larve (medium)'],
      ['3', 'I meny: send Humle (tung)'],
      ['Esc', 'Lukk meny'],
    ],
  },
  {
    section: 'Tårn',
    keys: [
      ['Q', 'Velg Spydd-tårn'],
      ['W', 'Velg Nett-tårn'],
      ['E', 'Velg Spytt-tårn'],
      ['Klikk gress', 'Plasser tårn (utenfor stier/arena)'],
      ['Shift+klikk', 'Plasser flere'],
      ['Esc / Høyreklikk', 'Avbryt'],
    ],
  },
  {
    section: 'Waves',
    keys: [['G', 'Start neste bølge (3-2-1-countdown)']],
  },
  {
    section: 'Spill',
    keys: [
      ['Mellomrom', 'Pause'],
      ['+ / −', 'Endre hastighet'],
      ['H', 'Vis / skjul hjelp'],
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
              {sec.keys.map(([k, desc], i) => (
                <div className="rts-hotkeys-row" key={`${k}-${i}`}>
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

// ── Alert / wave / build banners ──────────────────────────────────────

function AlertBanner({ s }: { s: HudState }) {
  if (!s.alert) return null;
  return (
    <div className={`rts-alert ${s.alert.urgency}`} role="alert">
      <span className="rts-alert-icon">⚠</span>
      <span className="rts-alert-msg">{s.alert.message}</span>
    </div>
  );
}

function WaveBanner({ s }: { s: HudState }) {
  if (!s.waveMode) return null;
  const { current, total, active, idle, inCountdown, remainingEnemies, choosingUpgrade } = s.waveMode;

  // Modal og sentrert start-meny eier skjermen i sine egne modi — banner blir distrahende.
  if (choosingUpgrade) return null;
  if (idle) return null;
  if (inCountdown) return null;

  return (
    <div className={`rts-wave-banner ${active ? 'active' : 'cooldown'}`}>
      <span className="rts-wave-label">Bølge</span>
      <span className="rts-wave-count">{Math.max(0, current)} / {total}</span>
      {active && (
        <span className="rts-wave-next">
          Forsvarer base — <strong>{remainingEnemies ?? 0}</strong> fiender igjen
        </span>
      )}
    </div>
  );
}

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
          Venstreklikk plasserer (på gress, utenfor stier) · Shift+klikk for flere · Esc avbryter
        </div>
      </div>
      <button className="rts-build-cancel" type="button" onClick={() => hudBridge.sendCommand({ type: 'build-cancel' })}>
        Avbryt
      </button>
    </div>
  );
}

// ── Upgrade choice modal (mellom hver bølge) ──────────────────────────

const RARITY_META: Record<HudUpgradeRarity, { label: string; tone: string }> = {
  common:  { label: 'Vanlig',   tone: '#9fb3a8' },
  rare:    { label: 'Sjelden',  tone: '#6ec0ff' },
  epic:    { label: 'Episk',    tone: '#c98aff' },
  cursed:  { label: 'Forbannet', tone: '#ff6b6b' },
  silly:   { label: 'Sprøtt',   tone: '#ffb84a' },
};

function UpgradeChoiceModal({ s }: { s: HudState }) {
  const choice = s.upgradeChoice;

  // Hotkeys: 1/2/3 plukker kortet på samme indeks
  useEffect(() => {
    if (!choice) return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const idx = ['1', '2', '3'].indexOf(e.key);
      if (idx >= 0 && idx < choice.options.length) {
        hudBridge.sendCommand({ type: 'select-upgrade', id: choice.options[idx].id });
        e.preventDefault();
        e.stopPropagation();
      }
    };
    // capture: true så vi vinner over lane-portalenes 1/2/3-handler
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [choice]);

  if (!choice || s.state !== 'running') return null;
  return (
    <div className="rts-upgrade-overlay" role="dialog" aria-modal="true">
      <div className="rts-upgrade-card-wrap">
        <div className="rts-upgrade-header">
          <div className="rts-upgrade-eyebrow">Bølge {choice.clearedWave} klar</div>
          <div className="rts-upgrade-title">Velg én oppgradering</div>
          <div className="rts-upgrade-subtitle">Bare ett kort. Velg klokt — eller dumt.</div>
          {choice.taken.length > 0 && (
            <div className="rts-upgrade-taken" title="Allerede valgt">
              {choice.taken.map((t) => (
                <span className="rts-upgrade-taken-chip" key={t.id} title={t.name}>
                  <span className="rts-upgrade-taken-icon">{t.icon}</span>
                  <span className="rts-upgrade-taken-name">{t.name}</span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="rts-upgrade-cards">
          {choice.options.map((opt, i) => {
            const meta = RARITY_META[opt.rarity];
            return (
              <button
                key={opt.id}
                className={`rts-upgrade-card rarity-${opt.rarity}`}
                style={{ ['--rarity-tone' as never]: meta.tone, ['--i' as never]: i }}
                onClick={() => hudBridge.sendCommand({ type: 'select-upgrade', id: opt.id })}
              >
                <span className="rts-upgrade-hotkey">{i + 1}</span>
                <span className="rts-upgrade-rarity" style={{ color: meta.tone, borderColor: meta.tone }}>
                  {meta.label}
                </span>
                <span className="rts-upgrade-icon">{opt.icon}</span>
                <span className="rts-upgrade-name">{opt.name}</span>
                <span className="rts-upgrade-desc">{opt.description}</span>
                <span className="rts-upgrade-flavor">"{opt.flavor}"</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Wave start (sentrert meny) + 3-2-1 countdown ──────────────────────

function WaveStartMenu({ s }: { s: HudState }) {
  const wave = s.waveMode;
  if (s.state !== 'running') return null;
  if (!wave || !wave.idle) return null;
  if (s.upgradeChoice) return null;  // upgrade-modalen eier skjermen først
  const next = wave.nextWavePreview;
  const upcoming = wave.upcomingWaveNumber ?? wave.current + 1;
  const laneLabel = (l: 0 | 1 | 2 | 'all') => l === 'all' ? 'alle 3' : l === 0 ? 'Nord' : l === 1 ? 'Midt' : 'Sør';
  const unitLabel = (k: UnitKind) =>
    k === 'light' ? 'maur' :
    k === 'medium' ? 'larver' :
    k === 'heavy' ? 'humler' :
    k === 'sumo' ? 'sumo-maur' :
    k === 'wasp' ? 'veps' :
    k === 'termite' ? 'termitter' : 'fiender';

  const isBoss = next?.boss === true;
  return (
    <div className="rts-wave-start-overlay" role="dialog" aria-modal="true">
      <div className={`rts-wave-start-card${isBoss ? ' boss' : ''}`}>
        <div className={isBoss ? 'rts-wave-start-boss-eyebrow' : 'rts-wave-start-eyebrow'}>
          {isBoss ? '⚠ BOSS-BØLGE' : 'Klar for neste runde'}
        </div>
        <div className="rts-wave-start-title">Bølge {upcoming}<span className="rts-wave-start-total"> / {wave.total}</span></div>
        {next && (
          <div className="rts-wave-start-preview">
            <span><strong>{next.soldiers}</strong> {unitLabel(next.unitKind)}</span>
            {isBoss && <span className="rts-wave-start-boss">BOSS · 4× HP · 2× skade</span>}
            <span className="rts-wave-start-lane">Lane: {laneLabel(next.lane)}</span>
          </div>
        )}
        {s.player.gold >= 300 && (
          <div className="rts-wave-start-gold-nudge">
            Du har <strong>{s.player.gold}</strong> mat — bygg et tårn! <kbd>Q</kbd> <kbd>W</kbd> <kbd>E</kbd>
          </div>
        )}
        <button
          type="button"
          className={`rts-wave-start-btn${isBoss ? ' boss' : ''}`}
          autoFocus
          onClick={() => hudBridge.sendCommand({ type: 'start-wave' })}
        >
          ▶ Start bølge <kbd>G</kbd>
        </button>
        <div className="rts-wave-start-hint">
          Du kan bare bygge og sende soldater <em>etter</em> at bølgen er i gang.
          <br />Begge sider starter samtidig.
        </div>
      </div>
    </div>
  );
}

function CountdownOverlay({ s }: { s: HudState }) {
  const wave = s.waveMode;
  if (!wave || !wave.inCountdown) return null;
  const ms = wave.countdownRemainingMs ?? 0;
  const isBoss = wave.nextWavePreview?.boss === true;
  // 3000–2001 → "3", 2000–1001 → "2", 1000–1 → "1", ≤0 → "GÅ!"
  let label: string;
  let key: string;
  if (ms > 2000) { label = '3'; key = '3'; }
  else if (ms > 1000) { label = '2'; key = '2'; }
  else if (ms > 0) { label = '1'; key = '1'; }
  else { label = 'GÅ!'; key = 'go'; }
  const upcoming = wave.upcomingWaveNumber ?? wave.current + 1;

  return (
    <div className={`rts-countdown-overlay${isBoss ? ' boss' : ''}`} aria-live="assertive">
      <div className="rts-countdown-eyebrow">
        {isBoss ? '⚠ BOSS-BØLGE' : `Bølge ${upcoming} starter`}
      </div>
      <div key={key} className={`rts-countdown-number${label === 'GÅ!' ? ' go' : ''}${isBoss && label !== 'GÅ!' ? ' boss' : ''}`}>{label}</div>
    </div>
  );
}

// ── Active upgrades strip ─────────────────────────────────────────────

const RARITY_TONES: Record<HudUpgradeRarity, string> = {
  common:  '#9fb3a8',
  rare:    '#6ec0ff',
  epic:    '#c98aff',
  cursed:  '#ff6b6b',
  silly:   '#ffb84a',
};

function ActiveUpgradesStrip({ s }: { s: HudState }) {
  if (!s.activeUpgrades || s.activeUpgrades.length === 0) return null;
  return (
    <div className="rts-active-upgrades" aria-label="Aktive oppgraderinger">
      <span className="rts-active-upgrades-label">Aktive:</span>
      <div className="rts-active-upgrades-chips">
        {s.activeUpgrades.map((u) => (
          <span
            key={u.id}
            className={`rts-active-upgrade rarity-${u.rarity}`}
            style={{ ['--rarity-tone' as never]: RARITY_TONES[u.rarity] }}
            title={`${u.name} — ${u.description}`}
          >
            <span className="rts-active-upgrade-icon">{u.icon}</span>
            <span className="rts-active-upgrade-name">{u.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Root ───────────────────────────────────────────────────────────────

export function HudOverlay() {
  const [state, setState] = useState<HudState | null>(null);
  const [showHotkeys, setShowHotkeys] = useState(false);

  const onState = useCallback((s: HudState) => setState(s), []);
  useEffect(() => hudBridge.onState(onState), [onState]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === 'h' || e.key === 'H' || e.key === '?') {
        setShowHotkeys((v) => !v);
        e.preventDefault();
      } else if (e.key === 'Escape' && showHotkeys) {
        setShowHotkeys(false);
        e.preventDefault();
      } else if ((e.key === 'g' || e.key === 'G') && state?.waveMode?.idle && !state?.upgradeChoice) {
        hudBridge.sendCommand({ type: 'start-wave' });
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHotkeys, state]);

  if (!state) return null;

  return (
    <div className="rts-hud">
      <TopBar s={state} />
      <ActiveUpgradesStrip s={state} />
      <WaveBanner s={state} />
      <AlertBanner s={state} />
      <BuildModeBanner s={state} />
      <BuildPanel s={state} />
      <LanePortals s={state} />
      <WaveStartMenu s={state} />
      <CountdownOverlay s={state} />
      <GameOver s={state} />
      <UpgradeChoiceModal s={state} />
      <button
        className="rts-help-fab"
        type="button"
        title="Hurtigtaster (H)"
        onClick={() => setShowHotkeys(true)}
      >?</button>
      {showHotkeys && <HotkeysPanel onClose={() => setShowHotkeys(false)} />}
    </div>
  );
}
