#!/bin/bash
# Autonom loop-iterasjon for Frontline RTS
# Kjøres av crontab hver 4. time

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="/home/irik/.local/bin:/home/irik/.nvm/versions/node/v22.22.1/bin:$PATH"

cd /home/irik/turtle

echo "=== Loop start: $(date) ===" >> /home/irik/turtle/loop.log

# Drep stale Playwright/Chrome fra forrige sesjon
pkill -f "playwright-mcp" 2>/dev/null || true
pkill -f "chrome-for-testing" 2>/dev/null || true
sleep 2

/home/irik/.local/bin/claude --print \
  "Kjør én autonom spill-loop-iterasjon for Frontline RTS. Les CLAUDE.md for protokollen (seksjonen LOOP PROTOCOL). Bruk alle nødvendige verktøy: les loop-state.json, naviger til http://localhost:5173, vent på at spillet er ferdig, les metrics fra #game-metrics, bestem neste handling (balance-patch eller feature), implementer den, og commit til git." \
  >> /home/irik/turtle/loop.log 2>&1

echo "=== Loop slutt: $(date) ===" >> /home/irik/turtle/loop.log
