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
      BootScene.ts   ← Tom preload, starter GameScene
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
8. Append run-record til `history[]`. Beregn `win_rate_last_5` (siste 5 runs).

### Balance-fase

- Færre enn 5 runs i `history`: ingen patch, fortsett å samle data.
- `win_rate < 0.3` (AI for sterk): `AI_AGGRESSION_THRESHOLD` -1 (min 2).
- `win_rate > 0.7` (AI for svak): `AI_AGGRESSION_THRESHOLD` +1 (max 8).
- Sekundær parameter: `AI_DECISION_INTERVAL` ±500ms (min 1000 / max 6000).
- Maks én parameter-endring per run.
- `0.3–0.7` og `consecutive_balanced >= 5`: sett `phase="feature"`.

### Feature-fase

- Ta øverste `"pending"` item fra `backlog`.
- `git checkout -b feature/<slug>`
- Implementer feature i `GameScene.ts` og/eller `config.ts`.
- `npx tsc --noEmit` — feil: `git checkout main`, mark `"failed"`, tilbake til `balance`.
- Suksess: `git checkout main && git merge feature/<slug>`, mark `"done"`.
- Sett `phase="balance"`, reset `consecutive_balanced=0`.

### Avslutt iterasjon

```
git add src/game/config.ts src/game/scenes/GameScene.ts loop-state.json
git commit -m "loop run N: result=X game_time=Xs win_rate=X.X action=..."
```
Skriv `loop-state.json` med oppdatert tilstand.

### Stopp-betingelser

| Betingelse | Handling |
|---|---|
| `phase="done"` | Stopp — alle features ferdig |
| `run >= max_runs` | Stopp — skriv årsak til `last_error` |
| TypeScript-feil som ikke kan fikses | Skriv til `last_error`, stopp |
| Playwright navigate feiler 3× | Skriv til `last_error`, stopp |

### HMR-advarsel

Vite HMR oppdaterer **ikke** en kjørende Phaser-instans — `GameCanvas` sin `useEffect`-guard stopper re-mount. `browser_navigate` i steg 4 er den reelle config-reload-mekanismen.
