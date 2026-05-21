# Frontline TD

Tower-defense med maur-tema. Du forsvarer maurtua di i vest mot fiendebølger som kommer langs 3 maurstier gjennom gressplenen. Overlev 15 bølger for å vinne, og velg én av tre oppgraderinger (Slay-the-Spire-stil) mellom hver bølge. Phaser 4 + React 19 + TypeScript + Vite. Ingen Firebase, ingen multiplayer.

## Kjør

```bash
npm run dev      # Dev-server (port 5173-5177 — Vite velger ledig)
npx tsc --noEmit # Typsjekk
npm run build    # Produksjonsbygg → dist/
```

## Arkitektur

```
src/
  game/
    config.ts        ← CONFIG (tunable params) + THEME (visuell palett)
    lanes.ts         ← Spline-bygging fra waypoints, walkability for tårnplassering
    geom.ts          ← Geometri-hjelpere (point-in-polygon, segment-intersect)
    upgrades.ts      ← ALL_UPGRADES + UpgradeModifiers (Slay-the-Spire-kort)
    PhaserGame.ts    ← createGame() factory (viewport = MAP-størrelse, FIT-scale)
    audio.ts         ← Phaser-native SFX, volum i localStorage, LoopingSfx-klasse
    vfx.ts           ← VFXManager: partikler, dust, victory-regn
    hudBridge.ts     ← Event-buss mellom GameScene og React-HUD (state + commands)
    WaveManager.ts   ← Wave-state-machine (idle → countdown → spawning → mopUp → upgradeChoice)
    scenes/
      BootScene.ts   ← Preloader SFX, genererer 'spark'-tekstur, starter MenuScene
      MenuScene.ts   ← Start-meny med "Spill"-knapp (SPACE/ENTER); manuell start
      GameScene.ts   ← All gameplay: kart, lane-følgende units, tårn, waves, metrics
  components/
    GameCanvas.tsx   ← React-wrapper for Phaser (useEffect + cleanup)
    HudOverlay.tsx   ← Topbar, lane-portaler, tårn-panel, wave-/upgrade-modal, game-over
    HudOverlay.css   ← HUD-styling
    Tutorial.tsx     ← 5-stegs tutorial vist første gang (localStorage frontline_tutorial_td_done)
  App.tsx            ← GameCanvas + HudOverlay + Tutorial + hidden #game-metrics
public/
  sfx/               ← MP3-er (probet ved load; spillet er funksjonelt uten lyd)
loop-state.json      ← Autonom loop-tilstand (PAUSED — se "Playwright-loopen" nederst)
loop-run.sh          ← Entry-skript for cron-loopen
```

## Designregler

- **config.ts er sannhetskilden** — alle tunable verdier (priser, HP, hastigheter, AI, kart, unit-typer, theme, wave-definisjoner) ligger her. Ingen magiske tall i GameScene.
- **THEME-objektet** holder all rendering-palett samlet — endre fargen ett sted.
- **lanes.ts** bygger spline-geometri fra `CONFIG.LANES`-waypoints. Endrer du waypoints, endres stiene visuelt og bevegelse-mønsteret.
- **upgrades.ts** definerer ALL_UPGRADES og UpgradeModifiers — én modifier-struct på GameScene som påvirker alt: HP, dmg, speed, kostnader, passive trigger-flagg (lifesteal, eksplosjon, første-stikk, etc.). Nye upgrades legges til i ALL_UPGRADES-arrayet og leses automatisk av `pickThreeUpgrades()`.
- HUD-rendering går gjennom `hudBridge` — Phaser pusher state-snapshots, React leser og sender kommandoer tilbake. Ingen direkte DOM-manipulasjon fra Phaser (utenom #game-metrics).
- **Spillets dimensjoner**: verden er FAST `1920×1080` (CONFIG.MAP_WIDTH/HEIGHT). Viewport = hele verden, Phaser.Scale.FIT skalerer canvas til vinduet. Hele kartet er synlig samtidig — ingen kamera-pan eller edge-scroll.

## DOM Metrics Bridge

`#game-metrics` (hidden div i App.tsx) oppdateres hvert 500 ms via `updateMetrics()`. Playwright-loopen poller dette:

| Attributt | Beskrivelse |
|---|---|
| `data-state` | `running \| won \| lost` |
| `data-player-gold` | Spillerens mat (interne navn beholdt for kompat — UI viser "Mat") |
| `data-player-soldiers` | Antall soldater (sum av alle unit-typer) |
| `data-player-workers` | Alltid 0 (worker-system fjernet, beholdt for kompat) |
| `data-player-base-hp` | Maurtue-HP igjen |
| `data-player-towers` | Antall byggede tårn |
| `data-ai-soldiers` | AI-creeps på lanene |
| `data-ai-base-hp` | Alltid 0 (fiende har en invulnerable spawner, ikke en base) |
| `data-game-time` | Sekunder siden start |
| `data-current-wave` | Nåværende wave-nummer (1-indeksert) |
| `data-waves-cleared` | 1 hvis alle bølger klarte (= win-condition) |
| `data-total-waves` | Total antall waves |

## Kontroller

### Mus
| Input | Handling |
|---|---|
| Klikk lane-portal (NORD/MIDT/SØR) | Åpne unit-meny for lanen |
| Klikk Maur/Larve/Humle (+ opplåste) i menyen | Send unit ned lanen (trekker mat) |
| Klikk × eller utenfor meny | Lukk meny |
| Klikk tårn-knapp (Spydd/Nett/Spytt) | Start build-mode |
| Venstreklikk på gress (i build-mode) | Plasser tårn (må være utenfor stier/arena) |
| Shift+venstreklikk | Plasser tårn uten å gå ut av build-mode |
| Høyreklikk / ESC (i build-mode) | Avbryt |
| Klikk upgrade-kort (mellom bølger) | Velg én av tre |

### Tastatur
| Tast | Handling |
|---|---|
| 1 / 2 / 3 | Åpne NORD / MIDT / SØR lane-meny |
| 1 / 2 / 3 (i åpen meny) | Send Maur / Larve / Humle |
| 4 / 5 / 6 (i åpen meny) | Send Sumo / Veps / Termitt (hvis opplåst) |
| 1 / 2 / 3 (i upgrade-modal) | Velg upgrade-kort |
| ESC | Lukk meny / avbryt build-mode |
| Q / W / E | Start build: Spydd / Nett / Spytt-tårn |
| G | Start neste bølge (når idle — trigger 3-2-1-countdown) |
| SPACE | Pause / fortsett |
| `+` / `-` (også numpad) | Hastighet (1× → 2× → 3×) |
| H | Vis / skjul hurtigtaster |
| R | Restart (etter game over) |

## Game systems

### Kart
- **Fast 1920×1080 verden**, hele synlig samtidig — ingen kamera-pan.
- **3 jord-stier** (maurstier) som svinger seg gjennom gressplenen. Bygd som Catmull-Rom-splines fra `CONFIG.LANES[].waypoints`. Variabel bredde langs splinen.
- **Konvergens**: alle 3 stier møtes ved en arena-sirkel foran hver maurtue (vest = player, øst = fiende-spawn).
- **Gress blokkerer bevegelse** — units er låst til splinen via `laneT`-parameter (0 = vest, 1 = øst).
- **Tårn plasseres i gress-områder** (utenfor lane/arena-polygoner) — `isOnLaneOrArena()` i `lanes.ts` validerer (bruker `pointInPolygon` fra `geom.ts`).

### Økonomi (bounty-system)
- Mat (intern: `gold`) start = `STARTING_GOLD = 250`. Liten passiv inntekt (`PASSIVE_INCOME_PER_TICK = 6` hvert `MINE_TICK_INTERVAL = 1500 ms`). Granary-upgrade legger til ekstra passive bonus.
- **Hovedkilde**: bounty fra drepte fiender. Bounty multipliseres med `bountyMul` (modifier) og ×5 for bosser.
- Player-units koster `cost`-feltet i `CONFIG.UNITS` (multiplisert med `playerCostMul` og evt. `lightCostMul`).

### Enheter (6 typer — 3 standard + 3 opplåsbare via upgrades)
Definert i `CONFIG.UNITS` med cost / hp / damage / speed / attackRange / attackInterval / bounty / bodyScale.

| Type | Label | Pris | HP | Dmg | Speed | Bounty | Status |
|---|---|---|---|---|---|---|---|
| `light`   | Maur     | 15 | 60  | 10 | 90  | 16 | Standard |
| `medium`  | Larve    | 30 | 120 | 20 | 70  | 32 | Standard |
| `heavy`   | Humle    | 60 | 250 | 40 | 50  | 64 | Standard |
| `sumo`    | Sumo     | 90 | 480 | 55 | 38  | 96 | Opplåses via `sumo`-upgrade |
| `wasp`    | Veps     | 70 | 80  | 60 | 115 | 56 | Opplåses via `wasp_unlock` |
| `termite` | Termitt  | 8  | 25  | 6  | 105 | 8  | Opplåses via `termite_unlock` |

Alle tegnes som detaljerte maur-containers (kropp + thorax + hode + bein + mandibler + antenner) med variabel `bodyScale`. Larve har egen segmentert sprite, Humle har vinger og striper. Bobber i idle. Bevegelse følger lane-splinen via `laneT`/`laneDir` (`+1` for player, `-1` for AI).

### Bygninger
- **Maurtue (player base)** — HP 500 (kan heves med `mound`-upgrade). Game over når den når 0.
- **Spawner (fiende, øst)** — invulnerable. WaveManager spawner creeps her.
- **Tårn** — 3 typer, må plasseres utenfor stier/arena (begrenset av `TOWER_BUILD_RADIUS = 350` rundt player-basen, og minst `TOWER_PLACE_CLEARANCE = 40` fra lane):
  - `stinger` 80 mat, single-target, dmg 25, range 200, fireRate 1000 ms
  - `webber`  100 mat, slows fienden 50 % i 1800 ms, dmg 5, range 180, fireRate 1500 ms
  - `spitter` 120 mat, splash 60 px, dmg 15, range 160, fireRate 1800 ms
- Tårnkostnader multipliseres med `towerCostMul` (Forge-upgrade halverer dem).

### Upgrade-system (Slay-the-Spire-stil)
- Etter at hver bølge er klar (mopUp-fasen ferdig) går WaveManager til `upgradeChoice`-fasen.
- HUD viser modalen `UpgradeChoiceModal` med 3 tilfeldige kort fra `ALL_UPGRADES` (sjeldenheter: `common | rare | epic | cursed | silly`). Plukket via `pickThreeUpgrades(taken)` i `upgrades.ts`.
- Spilleren velger ett kort (klikk eller 1/2/3). GameScene kaller `def.apply(modifiers, sceneAPI)`, som muterer den globale `UpgradeModifiers`-structen og/eller kaller scene-API-er (`giveGold`, `healBase`, `raiseBaseMaxHp`, `summonKing`).
- Modifierne påvirker alle nye OG eksisterende enheter (HP, dmg, speed, atk-interval, kostnader, bounty), pluss flagg som `deathExplosion`, `lifestealPct`, `firstStrikeMul`, `adrenalineEnabled`, `doomsdayActive`, `thunderstormIntervalMs`, `cloneSpawnChance`, `cosmicBossChance`, `tunnelStartT`.
- Tatt kort lagres i `taken`-settet og vises som chips i header — samme kort kan ikke trekkes to ganger før alle er brukt opp.

### Wave-system
`WAVE_MODE.waves` i config.ts har 15 forhåndsdefinerte bølger med eskalerende vanskelighet. Hver wave-definisjon har `soldiers`, `spawnInterval`, `lane` (0/1/2/all), `unitKind` (light/medium/heavy), og `boss`. WaveManager kjører state-maskinen:

- `idle` — venter på at spilleren trykker "Start bølge" (G eller HUD-knapp)
- `countdown` — 3-2-1-tikker (`WAVE_COUNTDOWN_MS = 3000`)
- `spawning` — spawner creeps med fast intervall
- `mopUp` — venter til alle creeps er døde
- `upgradeChoice` — viser upgrade-modal; venter på `select-upgrade`-kommando
- `victory` — alle 15 bølger klart

`WAVE_PREP_MS` er nå **legacy** (beholdt i config for kompat, ikke i bruk). Spilleren styrer selv tempoet mellom bølgene via G/"Start bølge"-knappen.

Seier ved klart alle 15 bølger + alle creeps døde. Tap ved player-base HP ≤ 0.

### DEMO_MODE
- `CONFIG.DEMO_MODE = false` per default. Flagget brukes ikke aktivt nå — den gamle auto-start-pathen i MenuScene er fjernet. Hovedmenyen krever manuelt klikk / SPACE / ENTER.
- Player-siden er passiv hvis spilleren ikke sender units selv; spillet kjører som vanlig TD med kun creeps og evt. manuelt bygde tårn.

## HUD (React-overlay)

`HudOverlay.tsx` rendrer:
- **Topbar**: brand, hastighet/pause-badge, mat-teller, soldater på lanene, maurtue-HP, fiendebase, fiender-igjen, volum, tid.
- **Lane-portaler**: 3 floating knapper (NORD/MIDT/SØR) plassert radielt rundt player-basen. Klikk åpner unit-meny med Maur/Larve/Humle (+ opplåste typer som Sumo/Veps/Termitt med hotkeys 4/5/6).
- **Tårn-panel** (bunn høyre): 3 knapper for Spydd/Nett/Spytt med hotkeys Q/W/E.
- **Wave-banner** (topp høyre): bølge-status, neste bølge-preview, countdown, "Start bølge"-knapp (i idle).
- **Upgrade-modal**: vises i `upgradeChoice`-fasen — 3 kort med ikon, navn, rarity-badge, beskrivelse og flavor-tekst. 1/2/3 for å velge.
- **Aktive upgrades**: liten linje/chips med tatte kort, slik at spilleren ser hva som er aktivt.
- **Alert-banner**: kortvarig varsel når wave starter (3s).
- **Build-mode-banner** (topp midt): vises mens man plasserer tårn.
- **Game-over-skjerm**: stats + Spill igjen / Til hovedmeny.

Lane-portaler projiseres fra verdens-koord til skjerm-koord via `projectWorldToScreen(canvas, worldX, worldY)`. Krever at canvas-DOM-elementet eksisterer; oppdateres ved resize.

Tutorial vises på første load (5 trinn, lagrer `frontline_tutorial_td_done` i localStorage). HUD bruker `hudBridge.onState()` / `hudBridge.sendCommand()` — ingen Phaser-tilgang fra React.

## Audio

`audio.ts` håndterer Phaser-native SFX. Volum i localStorage (`frontline_volume`). Filer i `public/sfx/` probes med HEAD før load — manglende filer er tolerert (ingen decode-feil i konsollen). `LoopingSfx` brukes for base-alarm (under 50 % HP).

## Theme

Alt er maur/gressplen. `THEME` i config.ts samler farger for ant-kropper, larve/humle-sprites, maurtuer, gress (`GRASS_*`), jord-stier (`LANE_*`), småblomster, kløver-tuer, pebbler, partikler, HP-bars, og bloom-FX. Gresset rendres med tett gress-blader, blomster og kløver-tuer som dekor.

## Playwright-loopen (PAUSED)

`loop-state.json` har `phase: "paused"` siden 2026-05-20 da spillet pivoterte fra symmetrisk RTS til wave-basert TD. Loop-historikken (`history[]`) og det opprinnelige `backlog[]` er irrelevant for det nye designet og er ikke aktivt.

Hvis loopen skal startes opp igjen, må disse oppdateres for å matche TD-modusen:

- **Tunable parametere**: `UNITS.*.cost/hp/damage`, `PASSIVE_INCOME_PER_TICK`, `STARTING_GOLD`, `TOWER_TYPES.*.cost/damage/range`, wave-definisjoner i `WAVE_MODE.waves`.
- **MÅL/Victory-conditions**: det gamle `victory_conditions`-objektet (menu_scene_done, sprite_polish_done, etc.) reflekterer den gamle RTS-en. Et nytt sett må defineres for TD-balansering (typisk win rate 40–60 % og avg_duration 120–180 s over siste 10 runs).
- **Player-AI i DEMO_MODE**: den gamle auto-start-stien i MenuScene er fjernet. Hvis loopen skal kjøre autonomt, må enten MenuScene få tilbake auto-start, eller loopen må klikke "Spill"-knappen / sende SPACE/ENTER.

### HMR-advarsel

Vite HMR oppdaterer **ikke** en kjørende Phaser-instans — `GameCanvas` sin `useEffect`-guard stopper re-mount. `browser_navigate` til dev-server-URL er den reelle config-reload-mekanismen hvis/når loopen restartes.
