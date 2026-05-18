# Implementeringsplan — Frontline RTS forbedringer

Plan dekker brukervennlighet, RTS-dybde, tower defence-elementer og incremental-loop, organisert i 8 milepæler. Hver milepæl er én leverbar `git`-branch som mergeS til main. Estimater er "Claude-økter" (~30–60 min interaksjon).

> **Mål-presisering:** Vi lager *ikke* en auto-battler. Vi stjeler *feelingen* fra sjangeren — pre-run-valg som forandrer hvordan armen din kjennes, ett hero-unit som vokser i kraft, synergier mellom enheter, og "se mauren din bli sterk"-power-spikes. Spilleren beholder full kontroll.

## Designprinsipper

1. **`config.ts` forblir sannhetskilden.** Alle nye tall (HP, cost, radius, multipliers) der.
2. **Ingen HMR-hacks.** Hver feature testes via `npx tsc --noEmit` + `browser_navigate`-reload.
3. **HUD-state utvides additivt.** `HudState` får nye felt, eksisterende kode brytes ikke.
4. **Loopen står stille mens vi bygger.** `phase="paused"` i `loop-state.json` til M4 — vi vil ikke at AI-tuneren skal tråkke på halvferdige features.
5. **Norsk UI** (bokmål) konsistent. Engelsk i typenavn og config-keys.
6. **Spilleren skal alltid føle seg i kontroll.** Auto-battler-feeling betyr "se hæren din vinne", ikke "se uten å kunne påvirke".

---

## M0 — Diagnose og loop-fix (PRE-WORK, kritisk)

**Hvorfor:** Siste 5 runs taper på nøyaktig 44 s med base HP 500 (= full HP). Det er en bug, ikke balanse. Vi må fikse før noen ny feature.

**Hypoteser å verifisere (i denne rekkefølgen):**
1. `data-state` blir satt til `"lost"` feilaktig — sjekk `setGameState`/`emitMetrics` i `GameScene.ts`
2. Player-base eksisterer ikke der den skal i nytt 2560×1440-kart (kollisjon med `MAP_WIDTH/2`-koordinater?)
3. AI når basen på 44 s fordi spawn-posisjoner er feil i nytt kart
4. Demo-mode-AI for spilleren (`PLAYER_*`-config) gjør ingenting fornuftig

**Leveranser:**
- `loop-state.json`: `phase="paused"`, `notes="paused for M0–M3 manual work"`
- Fix root cause (én patch i `GameScene.ts` eller `config.ts`)
- Manuell verifikasjon: 3 runs uten DEMO_MODE der spilleren faktisk kan vinne

**Estimat:** 1 økt

---

## M1 — Brukervennlighet (quick wins)

Branch: `feature/m1-ux-quick-wins`

### M1.1 Pause + speed (Space, +/-)

**Filer:** `GameScene.ts`, `HudOverlay.tsx`, `config.ts`

- `CONFIG.TIME_SCALES = [1, 2, 3]`
- Bruk `this.time.timeScale` og `this.physics.world.timeScale` (Phaser-native), unngå manuell skalering overalt
- `Space` toggler pause (`this.scene.pause()`/`resume()` eller egen `paused`-flag som gate i `update`)
- `+` / `-` cycler timeScale
- HUD: lite "▶ 1×" / "⏸" badge øverst i topbar, klikkbart

**Gotcha:** Custom timers (`this.time.addEvent`) påvirkes av `time.timeScale`. Sjekk at AI-decision-loopen og mine-tick-eventet ikke har egen klokke som omgår dette.

### M1.2 HP-bar-farger (backlog #1)

**Filer:** `GameScene.ts` (drawHpBar-funksjonen)

- `>66%` grønn (`0x4caf50`), `>33%` gul (`0xffc107`), ellers rød (`0xf44336`)
- Gjelder units og buildings
- Mark backlog #1 → `done`

### M1.3 Tutorial-overlay

**Filer:** ny `src/components/TutorialOverlay.tsx`, integreres i `HudOverlay.tsx`

- Vises kun ved første run (`localStorage.frontline_tutorial_seen`)
- 3 bobler med pek-pil, klikk-for-next:
  1. "Høyreklikk på en mine for å sende arbeideren dit"
  2. "Trykk **E** eller klikk på Barakka for å lage soldater"
  3. "Dra med musa for å velge flere — høyreklikk på fienden for å angripe"
- "Hopp over"-knapp setter flag og lukker

### M1.4 Lyd (Phaser-native audio)

**Filer:** ny `src/game/audio.ts`, hooks i `GameScene.ts`

- Bruk Phaser's innebygde `this.sound` (ingen nye deps)
- Public assets i `public/sfx/`: `click.mp3`, `train.mp3`, `attack.mp3`, `unit-die.mp3`, `base-alarm.mp3`, `victory.mp3`, `defeat.mp3`
- **Asset-strategi:** Bruk freesound.org CC0-lyder — last ned manuelt, bruker bekrefter
- Volume-slider i HUD-topbar (localStorage-lagret)
- Hooks: `trainUnit()`, attack-treff, base-HP < 50% (looping alarm), state-transition til won/lost

### M1.5 Fiende-varsel + auto-rally pil

**Filer:** `GameScene.ts`, `HudOverlay.tsx`

- Hver 500 ms: sjekk nærmeste fiende til `playerBase`. Hvis `< 400px` og ikke pågående alarm, push transient HUD-event "FIENDE NÆR!"
- HUD viser stort blinkende rødt banner top-center i 3 s + lyd-trigger
- Rally-pil: tegn stiplet linje fra barracks til rally-punkt i Phaser (`Graphics` med dash-pattern)

**Estimat M1:** 2–3 økter.

---

## M2 — Tower defence-kjerne

Branch: `feature/m2-towers-and-waves`

### M2.1 Tower-bygging (backlog #4 utvidet)

**Nye typer i `config.ts`:**
```ts
TOWER_TYPES: {
  stinger:  { cost: 80,  hp: 200, damage: 25, range: 200, fireRate: 1000, splash: 0  },
  webber:   { cost: 100, hp: 150, damage: 5,  range: 180, fireRate: 1500, slow: 0.5  },
  spitter:  { cost: 120, hp: 180, damage: 15, range: 160, fireRate: 1800, splash: 60 },
}
```

**Filer:** `GameScene.ts` (TowerData type), `HudOverlay.tsx` (build-mode command-slots)

- Trykk `T` → entrer build-mode for towers
- Mus-cursor får ghost-preview (grønn = OK, rød = okkupert/utenfor "near-base"-radius 350px)
- Klikk plasserer; venstreklikk avbryter
- Tower er en ny `BuildingData` med `kind: 'tower'`
- Auto-fire i `update()`: finn nærmeste fiende-unit innenfor range, fire projektil (gjenbruk `attack-projectile`-VFX)
- Backlog #4 → `done`

### M2.2 Wave-modus (Wave Defence)

Ny modus i menu (M7); for nå: trigger med URL-param `?mode=wave` for testing.

**Filer:** ny `src/game/modes/WaveMode.ts` (eller flag i `GameScene.ts`), `config.ts`

```ts
WAVE_MODE: {
  enabled: false,
  waves: [
    { delay: 30, ai_soldiers: 3 },
    { delay: 60, ai_soldiers: 5 },
    { delay: 90, ai_soldiers: 7, includes_tank: false },
    // ... 10 bølger totalt, eskalerende
    { delay: 360, ai_soldiers: 15, includes_tank: true, boss: true },
  ],
  victory_on_wave_clear: 10,
}
```

- I wave-mode: AI har ingen base, ingen workers. Bare spawner soldater fra `MAP_WIDTH` edge på timer.
- Player-mål: overlev til wave 10 ferdig.
- HUD-topbar viser "Wave 3/10 — neste om 0:24"

### M2.3 Choke-point-formasjoner (backlog #18 enklere variant)

- Trykk `F` med soldater valgt → arranger i line perpendikulært på avg. movement-vektor
- Brukes naturlig på broer
- Backlog #18 → `done`

**Estimat M2:** 3 økter

---

## M3 — RTS-dybde: bygg, oppgraderinger, enhetstyper

Branch: `feature/m3-build-upgrades-units` (kan splittes i M3a/b/c hvis stor)

### M3.1 Build-mode (backlog #10, T2-A)

**Bygg:**
- `Farm` — 60g, HP 100, +2g/tick (legges på til mine-tick-eventet)
- `Wall` — 20g, HP 300, ingen aksjon (kun blokkering — kollisjon mot units' movement)
- `Armory` — 100g, HP 150, låser opp Archer + Tank

`B` toggler build-menu. Ghost preview + plasseringsregler (innenfor `BUILD_RADIUS = 500px` fra player base). Backlog #10 → `done`.

### M3.2 Building-upgrades (backlog #11, T2-B)

- Høyreklikk barracks når selected: `Oppgrader (75g)` knapp i command-card
- Lvl1 → Lvl2: train-tid -30%, unlocks Archer
- Lvl2 → Lvl3: unlocks Tank
- Høyreklikk base: `Forsvar (100g)` → +200 HP, base får auto-attack (range 120, damage 10, rate 1500ms)
- Backlog #11 → `done`

### M3.3 Tre nye enhetstyper med counter-system (backlog #12-14)

**Filer:** `config.ts`, `GameScene.ts` (UnitData utvides), `HudOverlay.tsx`

```ts
UNIT_TYPES: {
  worker:  { cost: 30, speed: 80,  hp: 50,  damage: 0,  range: 0,   role: 'gather' },
  soldier: { cost: 50, speed: 70,  hp: 100, damage: 20, range: 40,  role: 'melee'  },
  archer:  { cost: 65, speed: 65,  hp: 70,  damage: 12, range: 150, role: 'ranged' },
  tank:    { cost: 90, speed: 40,  hp: 250, damage: 35, range: 30,  role: 'melee'  },
  scout:   { cost: 25, speed: 140, hp: 40,  damage: 5,  range: 30,  role: 'scout'  },
},
COUNTER_MATRIX: {
  // attacker → target → damage multiplier
  archer:  { soldier: 1.5, tank: 0.5, archer: 1.0, scout: 1.5 },
  tank:    { archer: 1.5, soldier: 1.0, tank: 1.0, scout: 1.5 },
  soldier: { tank: 1.5, archer: 1.0, soldier: 1.0, scout: 1.5 },
  scout:   { soldier: 0.5, archer: 0.5, tank: 0.3, scout: 1.0 },
},
```

- Archer: projektil-anim (gjenbruk attack-projectile-VFX, lengre range)
- Tank: kvadrat-sprite, langsom, høy HP
- Scout: liten sprite, lav HP, høy speed
- Counter-multiplier brukes i `applyDamage()`-funksjonen
- Train-knapper i barracks-panel viser unlocked-state basert på Armory + barracks-lvl
- Backlog #12, #13, #14 → `done`

### M3.4 Fog of war (backlog #5)

**Filer:** `GameScene.ts` (fog rendering med RenderTexture)

- Lag svart `RenderTexture` over hele kartet i egen depth-lag
- Hver tick: tegn lyse sirkler (BlendMode.ERASE) rundt alle player-units og buildings
- Vision-radius i `config.ts`: `VISION_RADIUS_DEFAULT: 150, VISION_RADIUS_SCOUT: 250`
- "Discovered"-areas forblir halvtransparent grå (memo-RenderTexture som ikke clearer)
- Backlog #5 → `done`

**Estimat M3:** 4–5 økter. Stor milepæl — vurder å splitte i M3a (build+upgrades), M3b (units+counter), M3c (fog).

---

## M4 — Loop fortsetter: balance med ny mekanikk

**Hvorfor her:** Etter M3 har spillet ekte taktiske valg. Loopen kan begynne å tune meningsfullt.

- Sett `loop-state.json`: `phase="balance"`, reset `history[]` (gammel data ikke sammenlignbar)
- Loopen kjører som vanlig, men nye tuning-parametere er nå tilgjengelige:
  - `AI_AGGRESSION_THRESHOLD` (gammelt)
  - `AI_UNIT_PRIORITY` (workers/soldiers/balanced — endre verdi diskret)
  - `WAVE_MODE.waves[*].ai_soldiers` (ikke i klassisk modus)
- Endre `LOOP PROTOCOL` i `CLAUDE.md` for å spesifisere: én parameter per run, AI må bygge minst én Armory før wave 5 ellers feiler den åpenbart

**Estimat:** 0.5 økt (config og protokoll, ingen kode)

---

## M5 — Auto-battler-feeling (uten å bli en auto-battler)

Branch: `feature/m5-meta-and-feel`

> **Viktig:** Vi lager IKKE en auto-battler-modus. Spilleren beholder full kontroll. Vi stjeler bare 4 ting fra sjangeren som gir den "power-fantasy"-feelingen.

### M5.1 Pre-run loadout (draft-feeling)

Stjålet fra: TFT/Hearthstone Battlegrounds drafting før en match.

**Filer:** ny `src/components/LoadoutScreen.tsx`, ny `src/game/loadout.ts`, `MenuScene.ts` (M7)

- Før hvert run: en kort skjerm der spilleren velger **2 av 5 perks** for kun denne kampen
- Perks rerolles ved hvert run (alltid 5 nye fra en pool på ~12)
- Eksempel-pool:
  - "Krigerkast" — soldater starter med +20% damage
  - "Tidlig økonomi" — +50 startgull, men workers tar 10g ekstra
  - "Tanken først" — Tank-units koster 30g mindre
  - "Snikangrep" — første 60s er Scouts dobbelt så raske
  - "Tornelinje" — towers er gratis å bygge i første 60s
  - "Bro-mester" — broer du krysser regenererer 5 HP/s
  - "Maurdronning" (se M5.2 — låser opp hero-mauren)
  - ...
- Føles som "denne runden skal jeg satse på Y" — gir variasjon mellom runs
- Vises også som chips i HUD-topbar under hele kampen

### M5.2 Hero-unit: Maurdronningen

Stjålet fra: hero-units fra Warcraft 3 / DotA / TFT-stars.

**Filer:** `GameScene.ts` (HeroData type), `config.ts`

- ÉN spesiell enhet, valgfri å trene (krever Armory + 200g)
- HP 300, damage 30, range 80, speed 60
- Får XP per fiende-kill (visning: liten progress-bar over hodet)
- Level 1 → 2 → 3 underveis i én kamp:
  - Lvl 2 (50 XP): +20% HP, +20% damage
  - Lvl 3 (150 XP): låser opp én aktiv ability (klikk eller `R`-tasten):
    - **Pheromone Roar** — alle player-units innenfor 250px får +30% speed i 8s
- Kun én hero per kamp; død = permanent borte
- Gir power-spike-feelingen ("dronningen min er level 3 nå, nå knuser vi dem")

### M5.3 Synergier (når enheter er nær hverandre)

Stjålet fra: TFT-traits og Battle Brothers-formasjoner.

**Filer:** `GameScene.ts` (i `update`-loopen, mellom hver decision-tick)

- Hver 1s, for hver player-unit: sjekk hva som er innenfor 100px-radius
- Bonuser (additivt, men capped):
  - **3+ soldater nær hverandre:** +10% damage hver ("formasjon")
  - **Archer + minst 1 tank innen 100px:** archer får +25% range (tank beskytter, archer skyter fra trygg avstand)
  - **Hero innen 150px:** alle player-units får +5% HP/s regeneration
- Visuell tilbakemelding: subtil glød (samme `THEME.SPARK_TINTS` farge) på enheter som har aktiv synergi
- HUD viser "Synergi aktiv: Formasjon (+10% dmg)" som chip når den slår inn
- Inviterer spilleren å holde enheter samlet — endrer hvordan kamper kjennes uten å fjerne kontrollen

### M5.4 Power-spike-meter ("se hæren din bli sterk")

Stjålet fra: Vampire Survivors / incremental-tickers.

**Filer:** `HudOverlay.tsx`, `GameScene.ts`

- Beregn en "Army Power"-tall hvert sekund:
  - `power = sum(unit.hp * unit.damage / 100) + (hero.level * 50)`
- Vis som stor tallindikator i HUD-topbar med pil ▲▼
- Hver gang power passerer en milestone (100, 250, 500, 1000, 2000) vises en flash + lyd ("Power-spike: Knusende styrke!")
- Power-graf nederst i end-screen (linjegraf over tid)
- Føles tilfredsstillende uten å endre noe ved gameplay

### M5.5 Meta-progression mellom runs

Stjålet fra: meta-progression i Slay the Spire / Hades.

**Filer:** ny `src/game/meta.ts`, ny `src/components/MetaScreen.tsx`

```ts
// localStorage key: frontline_meta
type MetaState = {
  totalWins: number;
  totalLosses: number;
  perkPoints: number;     // +1 per win
  unlocks: {
    archer: boolean;      // 1 perkPoint
    tank: boolean;        // 2 perkPoints (requires archer)
    scout: boolean;       // 1 perkPoint
    hero: boolean;        // 3 perkPoints (Maurdronningen)
    extraDraft: boolean;  // 2 perkPoints — vis 6 perks i loadout, velg 2
  };
};
```

- Vises på end-screen ("Du fikk +1 perk-point — bruk i menyen")
- Meny-skjerm med klikkbare unlock-noder; bekreft-knapp
- I `GameScene.create()`: les `meta` og påvirk hva som er tilgjengelig (units, hero, loadout-pool-størrelse)

**Estimat M5:** 3 økter

---

## M6 — Polish: VFX, audio, end-screen

Branch: `feature/m6-polish`

- Partikkel-VFX: støvsky på unit-død, gnist-burst på treff, røde "vibrations" på base når HP<25%
- End-screen utvidet (backlog #20): units trained/lost, mines holdt %, gold earned, peak soldiers, time, power-graf
- "Idle gold" mens tab er hidden (cap 5 min, vis "Du fikk +X mat mens du var borte")
- Combo-meter: 5 kills på 10s → "Swarm" buff +15% damage i 15s, vises som glød på soldater
- Day/night-cycle (backlog #19, T5-C): 3 min cycle, fog reduseres 30% om natten
- Backlog #19, #20 → `done`

**Estimat M6:** 2 økter

---

## M7 — MenuScene, levels, sprite-polish (lukker victory conditions)

Branch: `feature/m7-menu-levels`

### M7.1 MenuScene (backlog #15, T4-A)

**Filer:** ny `src/game/scenes/MenuScene.ts`, oppdater `BootScene.ts`

- Tittel "Frontline RTS — Maurkrigen"
- 2 store knapper: **Kampanje**, **Wave Defence**
- Sekundære: **Perks/Unlocks**, **Lyd**, **Lisens**
- Level-velger i Kampanje (5 levels, locked basert på `localStorage.frontline_progress`)
- Klikk "Start" → går til Loadout-skjerm (M5.1) → GameScene
- I `DEMO_MODE`: auto-start `GameScene` etter 500 ms uten loadout (skip-flag), CLAUDE.md-kontrakten
- `victory_conditions.menu_scene_done = true`

### M7.2 5 unike kart (backlog #16, T4-B)

- Level 1: Åpen mark, 3 mines, ingen elv (lett opplæring)
- Level 2: Elvedalen — 1 elv, 2 broer, 4 mines (= dagens kart)
- Level 3: To elver, 3 broer, 5 mines
- Level 4: Inselverden — 6 mines, mange små øyer + 4 broer
- Level 5: Boss-kart — AI har 2 baser, dobbel HP

Per-level config-overrides i `src/game/levels/level1.ts` osv. `GameScene.init({ levelId })` laster riktig.

### M7.3 AI-vansker (backlog #17, T4-C)

- Level 1: `AI_AGGRESSION_THRESHOLD=5` (mild), `AI_DECISION_INTERVAL=4500`
- Level 2-3: `threshold=3` (dagens)
- Level 4-5: `threshold=2`, `INTERVAL=2000`, AI bygger towers og Armory

### M7.4 Sprite-polish

- Tegn rikere sprites med `Phaser.Graphics`:
  - Base: maurtue med 3 lag (silhouette → midt-shading → top-highlight)
  - Soldater: kropp + 6 ben + mandibler animert
  - Towers: torn-form med fargevariasjon per type
  - Maurdronningen: større, gylden tinte, krone-element
- `victory_conditions.sprite_polish_done = true`

### M7.5 Backlog cleanup

- Markér: #2 (kan droppes — vi har 5 mines alt), #15-17 done, #21 (raiders → wave-modus dekker det)
- Backlog komplett. Sett `ai_features_generated = 0` (alle var planlagte features, ikke autonome).

**Estimat M7:** 4 økter (mest sprite-arbeid)

---

## M8 — Final balance + ship v1.0

- Loopen kjører til alle 6 victory conditions:
  1. Backlog #1-5 alle `done` (✓ etter M3.4 og M2.1)
  2. `ai_features_generated >= 3` — ENDRE GATE: krediter T2/T3/T5 som genererte, eller skip gate (oppdater CLAUDE.md)
  3. `menu_scene_done` (✓ M7)
  4. `sprite_polish_done` (✓ M7)
  5. Win rate 40-60% siste 10 (loopen tuner)
  6. avg_duration 120-180s (loopen tuner)
- `phase="done"` skrives av loopen
- Tag `v1.0` i git

**Estimat M8:** 1-3 økter avhengig av hvor lenge loopen trenger å balansere

---

## Filer som vil bli rørt

| Fil | M0 | M1 | M2 | M3 | M5 | M6 | M7 |
|---|---|---|---|---|---|---|---|
| `config.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `GameScene.ts` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `BootScene.ts` | | | | | | | ✓ |
| `MenuScene.ts` (ny) | | | | | | | ✓ |
| `hudBridge.ts` | | ✓ | ✓ | ✓ | ✓ | | |
| `HudOverlay.tsx` | | ✓ | ✓ | ✓ | ✓ | | |
| `HudOverlay.css` | | ✓ | ✓ | ✓ | | ✓ | |
| `audio.ts` (ny) | | ✓ | | | | | |
| `meta.ts` (ny) | | | | | ✓ | | |
| `loadout.ts` (ny) | | | | | ✓ | | |
| `LoadoutScreen.tsx` (ny) | | | | | ✓ | | |
| `levels/*.ts` (ny) | | | | | | | ✓ |
| `TutorialOverlay.tsx` (ny) | | ✓ | | | | | |
| `loop-state.json` | ✓ | | | | | | ✓ |
| `CLAUDE.md` | | | | | | | ✓ |

## Risiko og åpne spørsmål

| Risk | Mitigering |
|---|---|
| Fog of war (M3.4) er ofte performance-fiende | Bruk RenderTexture, ikke per-pixel mask. Test FPS underveis. |
| Counter-matrix kan gjøre balansering vanskelig for loopen | Hold M3 i `phase="paused"` til alt er manuelt verifisert |
| Sprite-polish (M7.4) er tidsugjennomtrengelig — kan ta dobbelt så lang tid | Sett en hardgrense: 1 økt per sprite-kategori, godt-nok-quality |
| Synergier (M5.3) kan bli usynlige for spilleren | HUD-chips + glød på enhetene må implementeres samtidig, ikke senere |
| Audio-assets — opphavsrett | Bare CC0 / Creative Commons fra freesound.org, dokumenter i `public/sfx/CREDITS.md` |
| `ai_features_generated >= 3`-gate kan ikke nås autonomt nå | Endre gate i M8 til "alle backlog T1-T5 done" — diskuter med bruker |
| Pre-run loadout (M5.1) legger til friksjon | "Hopp over loadout"-knapp tilgjengelig, default-perks brukes |

## Total estimat

| Milepæl | Økter |
|---|---|
| M0 | 1 |
| M1 | 2-3 |
| M2 | 3 |
| M3 | 4-5 |
| M4 | 0.5 |
| M5 | 3 |
| M6 | 2 |
| M7 | 4 |
| M8 | 1-3 |
| **Sum** | **20-24 økter** |

---

**Anbefalt neste steg:** Start M0 — diagnose hvorfor alle 5 siste runs taper på 44 s. Det er en bug-hunt på max 1 økt, og uten den fixet kan ingen balansetuning fungere.
