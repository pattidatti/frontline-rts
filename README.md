# Frontline RTS

Sanntids-strategispill som bygger seg selv. Phaser 3 + React + TypeScript + Vite.

**Spill det live:** https://pattidatti.github.io/frontline-rts/

---

## Hva er dette?

Et RTS-spill med en autonom loop som kjører i bakgrunnen. Claude spiller runder via Playwright, analyserer utfallet, og patcher enten balanse-parametere eller implementerer nye features — uten manuell input.

## Kjør lokalt

```bash
npm install
npm run dev        # http://localhost:5173
npx tsc --noEmit   # typsjekk
```

## Kontroller

| Input | Handling |
|---|---|
| Venstreklikk enhet | Velg |
| Dra | Box-select |
| Høyreklikk mine | Send workers dit |
| Høyreklikk fiende/bygning | Angrip |
| Høyreklikk bakke | Flytt |
| Klikk barracks | Åpne treningspanel |
| R | Restart etter game over |

## Arkitektur

```
src/game/config.ts        ← Alle tunable parametere (sannhetskilde)
src/game/scenes/GameScene.ts  ← Gameplay, AI, metrics-bridge
src/App.tsx               ← #game-metrics (hidden div, leses av loopen)
```

## Den autonome loopen

En crontab-jobb kjører hvert 4. time:

```
cron → loop-run.sh → claude --print → spiller runde → analyserer → patcher/implementerer → git commit → git push → GitHub Actions → GitHub Pages
```

### Sjekk hva som har skjedd

```bash
git log --oneline -10          # hva loopen har gjort
cat loop-state.json | jq '.'   # fase, vinn-rate, backlog-status
cat loop.log | tail -30        # siste kjøring
```

### loop-state.json

| Felt | Beskrivelse |
|---|---|
| `run` | Antall fullførte iterasjoner |
| `phase` | `balance` eller `feature` |
| `win_rate_last_5` | Spillers vinn-rate siste 5 runder (mål: 0.3–0.7) |
| `consecutive_balanced` | Runder med stabil balanse (trigger feature ved 5) |
| `history` | Alle runs med metrics |
| `backlog` | Features som skal implementeres |

### Balance-logikk

Loopen tuner `AI_AGGRESSION_THRESHOLD` basert på vinn-rate:
- Vinn-rate < 30 % → AI lempes (threshold ned)
- Vinn-rate > 70 % → AI skjerpes (threshold opp)
- Stabil 5 runder → neste feature fra backlog implementeres

## DEMO_MODE

`CONFIG.DEMO_MODE = true` gjør begge faksjonene AI-styrt — brukes av loopen for autonome testrunder. Settes automatisk av loopen, aldri manuelt.

## Deploy

Hvert `git push` til `master` trigger GitHub Actions → produksjonsbygg → GitHub Pages.
