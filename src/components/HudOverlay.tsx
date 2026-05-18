import { useEffect, useState, useCallback, useMemo } from 'react';
import { hudBridge, type HudState, type HudBuilding } from '../game/hudBridge';
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

function TopBar({ s }: { s: HudState }) {
  return (
    <div className="rts-topbar">
      <div className="rts-brand">Frontline RTS</div>
      <SpeedBadge s={s} />

      <div className="rts-res">
        <span className="rts-res-icon"><FoodIcon /></span>
        <div className="rts-res-stack">
          <span className="rts-res-value">{s.player.gold}</span>
          <span className="rts-res-label">Mat</span>
        </div>
      </div>

      <span className="rts-divider" />

      <div className="rts-res">
        <span className="rts-res-icon"><AntIcon kind="soldier" /></span>
        <div className="rts-res-stack">
          <span className="rts-res-value">{s.player.soldiers}</span>
          <span className="rts-res-label">Soldater</span>
        </div>
      </div>

      <div className="rts-res">
        <span className="rts-res-icon"><AntIcon kind="worker" /></span>
        <div className="rts-res-stack">
          <span className="rts-res-value">{s.player.workers}</span>
          <span className="rts-res-label">Arbeidere</span>
        </div>
      </div>

      <div className="rts-topbar-spacer" />

      <div className="rts-enemy-intel">
        <div className="rts-res">
          <span className="rts-res-icon"><MoundIcon faction="ai" /></span>
          <div className="rts-res-stack">
            <span className="rts-res-value">{Math.max(0, s.enemy.baseHp)}</span>
            <span className="rts-res-label">Fiende-tue</span>
          </div>
        </div>
        <div className="rts-res">
          <span className="rts-res-icon"><AntIcon kind="soldier" faction="ai" /></span>
          <div className="rts-res-stack">
            <span className="rts-res-value">{s.enemy.soldiers}</span>
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
    <div className="rts-section rts-minimap-section">
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
            // Mines fargelegges etter kontroll (T1-D). Broer er nøytrale, brun trefarge.
            // Andre buildings etter faksjon.
            let color: string;
            if (b.kind === 'mine') {
              color = b.control === 'player' ? '#6ec8ff'
                : b.control === 'ai' ? '#ff7c5a'
                : b.control === 'contested' ? '#ff3333'
                : '#e6c45a';
            } else if (b.kind === 'bridge') {
              color = '#8a6638';
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
                stroke="#000" strokeWidth={Math.max(1, mw / 400)}
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
  return <FoodIcon size={72} />;
}

function buildingName(b: HudBuilding): string {
  if (b.kind === 'base') return b.faction === 'player' ? 'Maurtue (Hjem)' : 'Fiende-tue';
  if (b.kind === 'barracks') return b.faction === 'player' ? 'Larvekammer' : 'Fiende-larvekammer';
  return 'Matkilde';
}

function InfoPanel({ s }: { s: HudState }) {
  const sel = s.selection;

  return (
    <div className="rts-section rts-info-section">
      <div className="rts-section-title">Utvalg</div>

      {sel.kind === 'none' && (
        <div className="rts-info-empty">
          Ingen valgt — venstreklikk en enhet, dra for boks-velg, eller klikk larvekammeret for å trene.
        </div>
      )}

      {sel.kind === 'building' && sel.building && (
        <div className="rts-info-row">
          <div className="rts-portrait"><BuildingPortrait b={sel.building} /></div>
          <div className="rts-info-meta">
            <div className="rts-info-name">{buildingName(sel.building)}</div>
            <div className="rts-info-sub">
              {sel.building.kind === 'barracks' ? 'Treningsstruktur' : sel.building.kind === 'base' ? 'Hovedstruktur' : ''}
            </div>
            <div className="rts-hp-bar">
              <div className={`rts-hp-fill ${hpClass(sel.building.hp, sel.building.maxHp)}`}
                style={{ width: `${Math.max(0, (sel.building.hp / sel.building.maxHp) * 100)}%` }} />
              <div className="rts-hp-label">{Math.max(0, sel.building.hp)} / {sel.building.maxHp} HP</div>
            </div>
            {sel.building.kind === 'barracks' && sel.building.faction === 'player' && (
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
  return (
    <button
      className="rts-cmd"
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
    const arr: (CommandSlot | null)[] = new Array(8).fill(null);

    const showTrain =
      sel.kind === 'building' && sel.building?.kind === 'barracks' && sel.building.faction === 'player';

    if (showTrain || sel.kind === 'none' || sel.kind === 'units') {
      const wCost = s.costs.worker;
      const sCost = s.costs.soldier;
      arr[0] = {
        key: 'Q',
        label: 'Arbeider',
        icon: <AntIcon size={44} kind="worker" />,
        cost: wCost,
        cant: s.player.gold < wCost,
        disabled: !showTrain || s.player.gold < wCost,
        onClick: () => hudBridge.sendCommand({ type: 'train', unit: 'worker' }),
      };
      arr[1] = {
        key: 'E',
        label: 'Soldat',
        icon: <AntIcon size={44} kind="soldier" />,
        cost: sCost,
        cant: s.player.gold < sCost,
        disabled: !showTrain || s.player.gold < sCost,
        onClick: () => hudBridge.sendCommand({ type: 'train', unit: 'soldier' }),
      };
    }

    // Group-select shortcuts (always available, useful). Z/X — unngår WASD-konflikt.
    arr[4] = {
      key: 'Z',
      label: 'Alle sold',
      icon: <AntIcon size={40} kind="soldier" />,
      onClick: () => hudBridge.sendCommand({ type: 'select-all-soldiers' }),
    };
    arr[5] = {
      key: 'X',
      label: 'Alle arb',
      icon: <AntIcon size={40} kind="worker" />,
      onClick: () => hudBridge.sendCommand({ type: 'select-all-workers' }),
    };
    arr[7] = {
      key: 'Esc',
      label: 'Rydd',
      icon: <span style={{ fontSize: 36, color: '#a89878', lineHeight: 1 }}>✕</span>,
      onClick: () => hudBridge.sendCommand({ type: 'clear-selection' }),
    };

    return arr;
  }, [sel, s.player.gold, s.costs.worker, s.costs.soldier]);

  return (
    <div className="rts-section rts-command-section">
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
  return (
    <div className="rts-gameover">
      <div className={`rts-gameover-title ${s.state}`}>
        {s.state === 'won' ? 'SEIER' : 'TAPT'}
      </div>
      <div className="rts-gameover-stats">
        <span>Tid <strong>{formatTime(s.time)}</strong></span>
        <span>Maur trent <strong>{s.stats.trained}</strong></span>
        <span>Mat samlet <strong>{s.stats.goldEarned}</strong></span>
      </div>
      <div className="rts-gameover-hint">
        Trykk <kbd>R</kbd> for å starte på nytt
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

// ── Root ───────────────────────────────────────────────────────────────

export function HudOverlay() {
  const [state, setState] = useState<HudState | null>(null);

  const onState = useCallback((s: HudState) => setState(s), []);
  useEffect(() => hudBridge.onState(onState), [onState]);

  if (!state) return null;

  return (
    <div className="rts-hud">
      <TopBar s={state} />
      <AlertBanner s={state} />
      <div className="rts-bottom">
        <Minimap s={state} />
        <InfoPanel s={state} />
        <CommandCard s={state} />
      </div>
      <GameOver s={state} />
    </div>
  );
}
