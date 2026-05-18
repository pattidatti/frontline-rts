# SFX-credits (Frontline RTS)

Alle lydfiler skal være CC0 / public domain — last ned manuelt fra freesound.org
og legg dem her med eksakt filnavn fra tabellen under.

Spillet kjører selv om filene mangler (Phaser logger en advarsel, ingen krasj).

| Filnavn          | Når den brukes                             | Anbefalt søk på freesound.org           |
|------------------|--------------------------------------------|------------------------------------------|
| `click.mp3`      | UI-klikk (reservert, foreløpig ikke brukt) | "ui click short"                         |
| `train.mp3`      | Ny maur trent fra barakka                  | "bubble pop short" / "egg crack soft"    |
| `attack.mp3`     | Maur treffer fiende                        | "bug squish short" / "blade hit soft"    |
| `unit-die.mp3`   | Maur dør                                   | "creature small death" / "pop weak"      |
| `base-alarm.mp3` | Base under 50 % HP (looping)               | "low alarm loop" / "tense buzz loop"     |
| `victory.mp3`    | Spilleren vinner                           | "victory fanfare short"                  |
| `defeat.mp3`     | Spilleren taper                            | "sad horn short" / "defeat low"          |

## Format

- MP3 (mest universelt) — Phaser laster også .ogg/.wav, men `audio.ts` peker på `.mp3`.
- Kort lyd: 200–800 ms (unntak: `base-alarm.mp3` skal være 1–3 s loop-friendly).
- Normalisert til ~-6 dBFS så ikke noen filer klipper ved volum 1.0.

## Lisens-dokumentasjon

For hver fil, legg en linje under (eksempel):

- `train.mp3` — freesound.org/people/USER/sounds/12345/ — CC0
