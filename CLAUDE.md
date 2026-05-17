# Frontline RTS

Sanntids-strategispill. Phaser 3 + React + TypeScript + Vite. Ingen Firebase, ingen multiplayer.

## Kjør

```bash
npm run dev      # Dev-server (port 5173 eller 5174)
npx tsc --noEmit # Typsjekk
```

## Arkitektur

```
src/
  game/
    config.ts        ← Alle tunable parametere — Playwright-loopen patcher kun denne
    PhaserGame.ts    ← createGame() factory
    scenes/
      BootScene.ts   ← Tom preload, starter MenuScene (eller GameScene om MenuScene ikke finnes ennå)
      MenuScene.ts   ← Start-meny (lages i polish-fasen)
      GameScene.ts   ← All gameplay: kart, enheter, AI, input, metrics
  components/
    GameCanvas.tsx   ← React-wrapper for Phaser (useEffect + cleanup)
  App.tsx            ← Minimal app + #game-metrics div
```

## Designregler

- **config.ts er sannhetskilden** — ingen hardkodede verdier i GameScene
- Playwright-loopen leser `#game-metrics` og patcher `config.ts` mellom runs
- Nye spillparametere legges alltid i config.ts, ikke spredt i koden

## DOM Metrics Bridge

`#game-metrics` (hidden div) oppdateres hvert 500ms:

| Attributt | Beskrivelse |
|---|---|
| `data-state` | `running \| won \| lost` |
| `data-player-gold` | Spillerens gull |
| `data-player-soldiers` | Antall soldater |
| `data-player-workers` | Antall arbeidere |
| `data-player-base-hp` | Base-HP igjen |
| `data-ai-soldiers` | AI-soldater |
| `data-ai-base-hp` | AI-base-HP igjen |
| `data-game-time` | Sekunder siden start |

## Kontroller

| Input | Handling |
|---|---|
| Venstreklikk enhet | Velg |
| Dra | Box-select |
| Høyreklikk mine | Send workers dit |
| Høyreklikk fiende | Angrip |
| Høyreklikk bakke | Flytt |
| Klikk barracks | Åpne treningspanel |
| R | Restart etter game over |

## Playwright-loopen

`/loop` åpner spillet, spiller et run, leser metrics, Claude patcher `config.ts`, refresh, gjenta.
Primære tuning-parametere: `AI_AGGRESSION_THRESHOLD`, `AI_DECISION_INTERVAL`, `GOLD_PER_TICK`.

## MÅL — Frontline RTS v1.0

Loopen setter `phase="done"` og `victory_conditions` i `loop-state.json` når **alle 6** er oppfylt:

1. Alle 5 originale backlog-features har `status="done"`
2. `ai_features_generated >= 3` (AI-genererte og implementerte features)
3. `victory_conditions.menu_scene_done = true` (start-meny med Play-knapp eksisterer)
4. `victory_conditions.sprite_polish_done = true` (sprites erstatter placeholder-rektangler)
5. Win rate 40–60 % over siste 10 runs
6. Gjennomsnittlig spilletid (`avg_duration_last_10`) 120–180 sekunder

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
