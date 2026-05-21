// Spline-baserte maurstier. Erstatter de gamle horisontale lane-båndene.
// Hver lane er en Phaser.Curves.Path bygget fra waypoints med variabel bredde,
// og units følger splinen via en t-parameter (0 = startsiden i vest, 1 = mot øst).

import Phaser from 'phaser';

export interface LaneWaypoint { x: number; y: number; }

export interface LaneDef {
  id: 0 | 1 | 2;
  label: string;
  /** Waypoints kontroll-punkter — splinen interpolerer mellom dem. */
  waypoints: LaneWaypoint[];
  /** Gjennomsnittlig sti-bredde (px). Faktisk bredde varierer langs splinen. */
  baseWidth: number;
}

export interface LaneGeometry {
  id: 0 | 1 | 2;
  label: string;
  path: Phaser.Curves.Path;
  /** Forhåndsberegnede punkter langs splinen (~hver 12 px). */
  samples: Phaser.Math.Vector2[];
  /** Total lengde i px. */
  length: number;
  /** Variabel bredde-funksjon (px) gitt t i [0,1]. */
  widthAt(t: number): number;
  /** Returner verdens-posisjon ved gitt t. */
  pointAt(t: number): Phaser.Math.Vector2;
  /** Returner enhetsvektor i marsj-retning (mot øst) ved t. */
  tangentAt(t: number): Phaser.Math.Vector2;
  /** Konverter en avstand i px til t-delta. */
  tFromDistance(d: number): number;
}

export interface LanesAll {
  lanes: LaneGeometry[];
  /** Sirkulær arena foran player-base hvor alle 3 lanes møtes (vest). */
  westArena: { x: number; y: number; r: number };
  /** Sirkulær arena foran fiende-spawn (øst). */
  eastArena: { x: number; y: number; r: number };
}

/**
 * Bygg LaneGeometry fra en LaneDef.
 * Bruker CatmullRom for myke kurver mellom waypoints.
 */
export function buildLane(def: LaneDef): LaneGeometry {
  const pts = def.waypoints.map((w) => new Phaser.Math.Vector2(w.x, w.y));
  const path = new Phaser.Curves.Path(pts[0].x, pts[0].y);
  // CatmullRom gjennom alle waypoints (inkluderer start)
  path.splineTo(pts.slice(1));
  const length = path.getLength();

  // Forhåndssample for raskere queries (~hver 12 px)
  const sampleCount = Math.max(32, Math.floor(length / 12));
  const samples: Phaser.Math.Vector2[] = [];
  for (let i = 0; i <= sampleCount; i++) {
    samples.push(path.getPoint(i / sampleCount));
  }

  // Variabel bredde: base ± wobble basert på t. Smalere midt på, bredere ved endene.
  const widthAt = (t: number): number => {
    const tt = Phaser.Math.Clamp(t, 0, 1);
    // Bredere ved endene (nær arena), smalere i midten
    const endTaper = 1.0 + 0.25 * (1 - Math.sin(tt * Math.PI));
    // Lett kaotisk wobble langs lanen
    const wobble = 1.0 + 0.12 * Math.sin(tt * Math.PI * 6 + def.id * 1.7);
    return def.baseWidth * endTaper * wobble;
  };

  return {
    id: def.id,
    label: def.label,
    path,
    samples,
    length,
    widthAt,
    pointAt: (t: number) => path.getPoint(Phaser.Math.Clamp(t, 0, 1)),
    tangentAt: (t: number) => {
      const eps = 0.005;
      const a = path.getPoint(Math.max(0, t - eps));
      const b = path.getPoint(Math.min(1, t + eps));
      const v = new Phaser.Math.Vector2(b.x - a.x, b.y - a.y);
      const m = Math.hypot(v.x, v.y) || 1;
      return new Phaser.Math.Vector2(v.x / m, v.y / m);
    },
    tFromDistance: (d: number) => d / length,
  };
}

/**
 * Sjekker om et punkt (x,y) er på noen av lanene eller i et arena-område.
 * Brukes til tower-placement (returnerer true = blokkert for tårn).
 */
export function isOnLaneOrArena(x: number, y: number, all: LanesAll): boolean {
  for (const lane of all.lanes) {
    const half = lane.widthAt(0.5) * 0.55;  // grov estimat — ok for placement-sjekk
    for (const s of lane.samples) {
      const dx = s.x - x, dy = s.y - y;
      if (dx * dx + dy * dy < half * half) return true;
    }
  }
  const dw = Math.hypot(x - all.westArena.x, y - all.westArena.y);
  if (dw < all.westArena.r) return true;
  const de = Math.hypot(x - all.eastArena.x, y - all.eastArena.y);
  if (de < all.eastArena.r) return true;
  return false;
}
