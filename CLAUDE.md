# Frontline RTS

Sanntids-strategispill med maur-tema. Du styrer den mørke kolonien i sør og prøver å rive fiendebasen i nord. Phaser 4 + React 19 + TypeScript + Vite. Ingen Firebase, ingen multiplayer.

## Kjør

```bash
npm run dev      # Dev-server (port 5173 eller 5174)
npx tsc --noEmit # Typsjekk
npm run build    # Produksjonsbygg → dist/
```

## Arkitektur

```
src/
  game/
    config.ts        ← CONFIG (tunable params) + THEME (visuell palett)
    PhaserGame.ts    ← createGame() factory + viewport-sync (FIT-scale, fast verden)
    audio.ts         ← Phaser-native SFX, volum i localStorage, LoopingSfx-klasse
    vfx.ts           ← VFXManager: partikler, dust, victory-regn
    geom.ts          ← point-in-polygon, segment-crossings (river + cliffs)
    hudBridge.ts     ← Event-buss mellom GameScene og React-HUD (state + commands)
    scenes/
      BootScene.ts   ← Preloader SFX, genererer 'spark'-tekstur, starter GameScene
      GameScene.ts   ← All gameplay: kart, units, AI, input, towers, waves, metrics (~3500 linjer)
  components/
    GameCanvas.tsx   ← React-wrapper for Phaser (useEffect + cleanup)
    HudOverlay.tsx   ← Topbar, minimap, build-panel, selection-panel, alert-banner (~840 linjer)
    HudOverlay.css   ← HUD-styling
    Tutorial.tsx     ← 4-stegs tutorial vist første gang (localStorage frontline_tutorial_done)
  App.tsx            ← GameCanvas + HudOverlay + Tutorial + hidden #game-metrics
public/
  sfx/               ← MP3-er (probet ved load; spillet er funksjonelt uten lyd)
loop-state.json      ← Autonom loop-tilstand (phase, history, backlog, victory_conditions)
loop-run.sh          ← Entry-skript for cron-loopen
```

## Designregler

- **config.ts er sannhetskilden** — alle tunable verdier (priser, HP, hastigheter, AI, kart, theme) ligger her. Ingen magiske tall i GameScene.
- **THEME-objektet** holder all rendering-palett samlet — endre fargen ett sted.
- Playwright-loopen patcher kun `config.ts` i balance-fasen; kode-endringer skjer i feature-fasen.
- Nye spillparametere legges alltid i config.ts.
- HUD-rendering går gjennom `hudBridge` — Phaser pusher state-snapshots, React leser og sender kommandoer tilbake. Ingen direkte DOM-manipulasjon fra Phaser (utenom #game-metrics).
- Spillets dimensjoner: verden er FAST `2560×1440` (CONFIG.MAP_WIDTH/HEIGHT); viewport følger vinduet via `Phaser.Scale.FIT`. Resize trigger scene-restart.

## DOM Metrics Bridge

`#game-metrics` (hidden div i App.tsx) oppdateres hvert 500 ms via `updateMetrics()`. Playwright-loopen poller dette:

| Attributt | Beskrivelse |
|---|---|
| `data-state` | `running \| won \| lost` |
| `data-player-gold` | Spillerens mat (interne navn beholdt for kompat — UI viser "Mat") |
| `data-player-soldiers` | Antall soldater |
| `data-player-workers` | Antall arbeidere |
| `data-player-base-hp` | Maurtue-HP igjen |
| `data-ai-soldiers` | AI-soldater |
| `data-ai-base-hp` | AI-maurtue-HP igjen |
| `data-game-time` | Sekunder siden start |

## Kontroller

### Mus
| Input | Handling |
|---|---|
| Venstreklikk enhet | Velg |
| Dobbel-venstreklikk enhet | Select-all-same-type på skjermen |
| Dra | Box-select |
| Høyreklikk bladlusfarm | Send workers dit (mining) |
| Høyreklikk fiende-enhet/bygning | Angrip |
| Høyreklikk bakke | Flytt valgte enheter |
| Høyreklikk byggested under konstruksjon | Worker resumer bygging |
| Klikk barakke (din egen) | Velg → HUD viser tren-knapper |
| Klikk maurtue (din egen) | Velg → HUD viser Forsvar-oppgradering |
| Venstreklikk minimap | Panorer kamera |
| Shift+klikk / høyreklikk minimap | Attack-move til punkt |
| Edge-scroll (musa i 24 px fra kant) | Panorer kamera |

### Tastatur
| Tast | Handling |
|---|---|
| WASD / piltaster | Panorer kamera |
| Q | Tren worker (fra maurtua) |
| E | Tren soldat (fra barakka) |
| Z | Velg alle soldater |
| X | Velg alle workers |
| SPACE | Pause / fortsett |
| `+` / `-` (også numpad) | Hastighet (1× → 2× → 3×) |
| B | Toggle build-mode (default barakke) |
| T | Toggle build-mode (default stinger-tårn) |
| 1 / 2 / 3 | I build-mode: stinger / webber / spitter |
| 4 / 5 / 6 / 7 | I build-mode: barakke / farm / wall / armory |
| F | Linje-formasjon for valgte soldater |
| ESC | Avbryt build-mode / fjern seleksjon |
| R | Restart etter game over |

## Game systems

### Kart
- Horisontal elv midt på kartet (y=720) — units kan ikke krysse uten å være i `BRIDGE_PASS_RADIUS` av en levende bro.
- 2 forhåndsplasserte broer (vest x=640, øst x=1920) — HP 150, kan ødelegges, blokkerer da kryssing.
- 2 platåer (SC-stil høyt land) med klipper og 3 ramper hver — én base-side, to mot broene. Cliffs blokkerer bevegelse.
- 6 bladlusfarmer (mines): 4 trygge ved basene + 2 omkjempete på platåene. Mine produserer kun mat når egen faction har units innenfor `MINE_CONTEST_RADIUS` (80 px) og motparten ikke har det.
- Steinformasjoner: 10 sirkulære obstacles for cover/flanker, blokkerer bevegelse.

### Økonomi
- Mat (intern: `gold`) start = 50. Per-tick gull skjer via `mineTick` hvert 1500 ms.
- Hver mine gir `GOLD_PER_TICK` til kontrollerende faction. Farms gir `bonusGoldPerTick=2` ekstra hvis bygd.
- Worker 25 mat, soldat 50 mat, barakke 80 mat.

### Enheter
- Worker: HP/speed/no-attack, kan minere og bygge.
- Soldat: HP 100, dmg 20, range 40, attack-speed 1000 ms.
- Begge tegnes som detaljerte maur-containers (kropp + thorax + hode + bein + mandibler + antenner). Bobber i idle.

### Bygninger
- **Maurtue (base)** — HP 500. Kan oppgraderes med Forsvar (`BASE_DEFENSE_COST` 100): +200 HP, auto-attack range 160, dmg 10, fireRate 1500 ms.
- **Barakke** — 80 mat, HP 200, bygd av worker. Trener soldater.
- **Tårn** — 3 typer, må plasseres innen `TOWER_BUILD_RADIUS` (350 px) fra egen base:
  - `stinger` 80 mat, single-target, dmg 25 range 200
  - `webber` 100 mat, slows fienden 50 % i 1800 ms, dmg 5 range 180
  - `spitter` 120 mat, splash 60 px, dmg 15 range 160
- **Farm** — 60 mat, HP 100, +2 mat/tick.
- **Wall** — 20 mat, HP 300, blokkerer bevegelse (`WALL_BLOCK_RADIUS` 18 px).
- **Armory** — 100 mat, HP 150 (placeholder for fremtidige unit-typer).
- Alle byggbare bygninger: bygges av worker (`BARRACKS_BUILD_TIME` 12 s, `FARM_BUILD_TIME` 8 s, `WALL_BUILD_TIME` 3 s, osv.). Worker er låst i `'building'`-state under konstruksjon; lerper HP 25 % → 100 %.

### AI
- `aiDecision()` kjører hvert `AI_DECISION_INTERVAL` (3000 ms).
- Sekvens: bygg barakke (hvis ingen + ≥2 workers + råd) → tren worker (under `AI_WORKER_TARGET` 4) → tren soldat → angrip når `AI_AGGRESSION_THRESHOLD` (4) soldater er nådd.
- Idle workers re-assignes til nærmeste vennlig/nøytrale mine (unngår fiende-kontrollerte og contested).

### DEMO_MODE (autonom loop)
- `CONFIG.DEMO_MODE = true` aktiverer `playerDecision()` som styrer player-siden symmetrisk med AI-siden (egen `PLAYER_AGGRESSION_THRESHOLD`, `PLAYER_WORKER_TARGET`, `PLAYER_DECISION_INTERVAL`).
- Player AI splitter soldater i defenders (2× trusler nær base) og surplus; surplus angriper AI-base når terskelen nås.
- Kameraet sentreres på midten av kartet i demo (ikke på player-base).
- I demo restarter spillet automatisk 2 s etter game over.

### Wave-modus (M2.2)
- `CONFIG.WAVE_MODE.enabled = false` som default. Når sann: AI-siden spawner forhåndsdefinerte bølger (10 stk, eskalerende soldater) i stedet for å kjøre `aiDecision`. Seier ved klart alle bølger + alle AI-units døde.

## HUD (React-overlay)

`HudOverlay.tsx` rendrer:
- **Topbar**: brand, hastighet/pause-badge, mat-teller, soldat/worker-tellere, fiende-intel (HP + soldater), volum, tid.
- **Minimap (Slagmark)**: SVG-render av units (sirkler) + buildings (farge etter faction/control), viewport-rektangel, klikk/shift-klikk for pan/attack-move.
- **Bygg-panel**: knapper for alle byggbare typer med pris og affordable-state. Aktiv build-mode vises som ghost over kartet.
- **Seleksjonspanel**: hvis units valgt → teller per type. Hvis bygning valgt → spesifikke handlinger (tren fra barakke, Forsvar fra base).
- **Alert-banner**: M1.5 — "FIENDE NÆR!" når AI-soldater er innenfor `ENEMY_NEAR_RADIUS` (400 px) av player-base. Vises ~3 s.

Tutorial vises på første load (4 trinn, lagrer `frontline_tutorial_done` i localStorage). HUD bruker `hudBridge.onState()` / `hudBridge.sendCommand()` — ingen Phaser-tilgang fra React.

## Audio

`audio.ts` håndterer Phaser-native SFX. Volum i localStorage (`frontline_volume`). Filer i `public/sfx/` probes med HEAD før load — manglende filer er tolerert (ingen decode-feil i konsollen). `LoopingSfx` brukes for base-alarm (under 50 % HP).

## Theme

Alt er maur/skog. `THEME` i config.ts samler farger for ant-kropper, maurtuer, bladlusfarmer, gress, småblomster, kløver-tuer, steinformasjoner, partikler, HP-bars, og bloom/vignette-FX. Bakken har lag-baserte detaljer (gress-blader, pebbler, pheromone-trails, blomstertuer).

## Playwright-loopen

`/loop` åpner spillet, kjører ett run i DEMO_MODE, leser `#game-metrics`, Claude patcher `config.ts` (balance) eller implementerer kode (feature/ai-feature/polish), refresh, gjenta. Loop-tilstand persisterer i `loop-state.json`. Primære tuning-parametere: `AI_AGGRESSION_THRESHOLD`, `AI_DECISION_INTERVAL`, `GOLD_PER_TICK`, `PLAYER_AGGRESSION_THRESHOLD`.

## MÅL — Frontline RTS v1.0

Loopen setter `phase="done"` i `loop-state.json` når **alle 6** er oppfylt:

1. Alle 5 originale backlog-features (id 1–5) har `status="done"`
2. `ai_features_generated >= 3` (AI-genererte og implementerte features)
3. `victory_conditions.menu_scene_done = true` (start-meny med Play-knapp eksisterer)
4. `victory_conditions.sprite_polish_done = true` (sprites erstatter placeholder-rektangler)
5. Win rate 40–60 % over siste 10 runs
6. Gjennomsnittlig spilletid (`avg_duration_last_10`) 120–180 sekunder

Backlog har siden vokst utover de originale 5 — se `loop-state.json` for fullstendig liste (T1–T5-tiers, totalt ~21 items). Items 6–9 (større kart, elver, broer, contested mines) og 18 (formasjon) er allerede `"done"`. Tower-building (id 4) er done; resten av id 1–5 er fortsatt pending.

## LOOP PROTOCOL — autonom iterasjon

Denne seksjonen er kontrakten for hver cron-kjøring. Følg protokollen nøyaktig.

### Én iterasjon

1. Les `loop-state.json`. Stopp hvis `phase="done"` eller `run >= max_runs`.
2. Inkrementer `run`-teller i `loop-state.json`.
3. Patch `config.ts`: sett `DEMO_MODE: true`.
4. `browser_navigate` til `http://localhost:5174` (full reload — ny config lastes inn).
5. Poll `#game-metrics` hvert 5s, timeout 120s. Vent til `data-state="won"` eller `data-state="lost"`.
6. Les alle `data-*` attributter. Beregn metrics.
7. Patch `config.ts`: sett `DEMO_MODE: false`.
8. Append run-record til `history[]`. Oppdater `win_rate_last_5` (siste 5 runs) og `avg_duration_last_10` (siste 10 runs).

### Balance-fase

- Færre enn 5 runs i `history`: ingen patch, fortsett å samle data.
- **Win rate:**
  - `win_rate < 0.3` (AI for sterk): `AI_AGGRESSION_THRESHOLD` -1 (min 2).
  - `win_rate > 0.7` (AI for svak): `AI_AGGRESSION_THRESHOLD` +1 (max 8).
- **Spilletid** (sekundær tuning når win rate allerede er 0.3–0.7):
  - `avg_duration_last_10 < 60s`: `GOLD_PER_TICK` -1 (min 2) — bremser eskalering.
  - `avg_duration_last_10 > 300s`: `GOLD_PER_TICK` +1 (max 10) — fremskynder eskalering.
  - Alternativt: `AI_DECISION_INTERVAL` ±500ms (min 1000 / max 6000).
- Maks én parameter-endring per run.
- `0.3–0.7` win rate OG `avg_duration_last_10` 60–300s OG `consecutive_balanced >= 5`: sett neste fase.

### Feature-fase (originale 5)

- Ta øverste `"pending"` item fra `backlog` med id 1–5.
- `git checkout -b feature/<slug>`
- Implementer feature i `GameScene.ts` og/eller `config.ts`.
- `npx tsc --noEmit` — feil: `git checkout main`, mark `"failed"`, tilbake til `balance`.
- Suksess: `git checkout main && git merge feature/<slug>`, mark `"done"`.
- Oppdater `victory_conditions.original_backlog_done = true` når alle 5 er `"done"`.
- Sett `phase="balance"`, reset `consecutive_balanced=0`.
- Når alle 5 er done og balance er stabil → `phase="ai-feature"`.

### AI-feature-fase (3+ genererte features)

- Les `GameScene.ts` og `loop-state.json` for å forstå spillets nåværende tilstand.
- Generer én konkret feature-idé som passer spillet slik det er nå (ikke generisk).
- Legg den til i `backlog` med et nytt id (6, 7, 8...) og `status="pending"`.
- Implementer feature akkurat som feature-fasen (branch → kode → tsc → merge).
- Inkrementer `ai_features_generated`.
- Oppdater `victory_conditions.ai_features_done = true` når `ai_features_generated >= 3`.
- Sett `phase="balance"` etter hver feature. Når 3 AI-features er done og balance er stabil → `phase="polish"`.

### Polish-fase

To delmål, utfør i rekkefølge:

**A. Meny-scene:**
- Lag `src/game/scenes/MenuScene.ts` med Phaser-tekst og Play-knapp.
- Oppdater `BootScene.ts` til å starte `MenuScene` i stedet for `GameScene`.
- `MenuScene` starter `GameScene` på klikk.
- I DEMO_MODE: `MenuScene` starter `GameScene` automatisk etter 500ms (unngå at loopen henger).
- Sett `victory_conditions.menu_scene_done = true`. Commit.

**B. Sprite-polish:**
- Erstatt placeholder-rektangler i `GameScene.ts` med Phaser Graphics-tegning: tykke former, outlines, fargegradienter.
- Minst: base (begge sider), barracks, soldater, workers — ikke bare fargede rektangler.
- `npx tsc --noEmit` — feil: reverter, sett `last_error`.
- Sett `victory_conditions.sprite_polish_done = true`. Commit.

Etter polish: kjør 5 balance-runs for å verifisere at win rate og spilletid fortsatt er innenfor mål. Sett `phase="done"` hvis alle 6 victory conditions er oppfylt.

### Avslutt iterasjon

```
git add src/game/config.ts src/game/scenes/GameScene.ts loop-state.json
git commit -m "loop run N: result=X game_time=Xs win_rate=X.X action=..."
```
Skriv `loop-state.json` med oppdatert tilstand.

### Stopp-betingelser

| Betingelse | Handling |
|---|---|
| `phase="done"` | Stopp — Frontline RTS v1.0 komplett |
| `run >= max_runs` | Stopp — skriv årsak til `last_error` |
| TypeScript-feil som ikke kan fikses | Skriv til `last_error`, stopp |
| Playwright navigate feiler 3× | Skriv til `last_error`, stopp |

### HMR-advarsel

Vite HMR oppdaterer **ikke** en kjørende Phaser-instans — `GameCanvas` sin `useEffect`-guard stopper re-mount. `browser_navigate` i steg 4 er den reelle config-reload-mekanismen.
