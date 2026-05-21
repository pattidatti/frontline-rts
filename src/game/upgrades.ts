// Slay-the-Spire-aktige oppgraderinger som tilbys mellom hver bølge.

import type { UnitKind } from './config';

export type UpgradeRarity = 'common' | 'rare' | 'epic' | 'cursed' | 'silly';

export type UpgradeId =
  | 'queen' | 'sharp_mandibles' | 'fever' | 'mound' | 'granary' | 'looting'
  | 'glass_cannon' | 'sumo' | 'berserk' | 'forge' | 'caffeine' | 'tiny_ants'
  | 'snake_tongue' | 'explosion' | 'sacrifice';

export interface UpgradeModifiers {
  playerHpMul: number;
  playerDmgMul: number;
  playerSpeedMul: number;
  playerCostMul: number;
  playerAtkIntervalMul: number;
  bountyMul: number;
  /** Damage multiplier som gjelder når en player-maur har <50 % HP. */
  berserkDmgMul: number;
  towerCostMul: number;
  passiveBonus: number;
  aiHpMul: number;
  lightCostMul: number;
  lightHpMul: number;
  /** Player-maur eksploderer ved død (radius 60, dmg 30). */
  deathExplosion: boolean;
  /** Player-maur som dør helbreder nærmeste alliert 30 HP. */
  deathHealAlly: boolean;
  /** Unit-typer som er låst opp via oppgraderinger (utenom standard light/medium/heavy). */
  unlockedUnits: UnitKind[];

  // ── Bananas-flag — alle defaulter til "av" (0/false) ─────────────────
  /** Sjanse (0–1) for at en bestilt maur kloner seg gratis. */
  cloneSpawnChance: number;
  /** Andel (0–1) av skade som heler angriperen. */
  lifestealPct: number;
  /** Hvis sann: ved base-HP < 30 % får dine maur +100 % dmg og +50 % speed. */
  adrenalineEnabled: boolean;
  /** Multiplier på første angrep en maur gjør i livet. */
  firstStrikeMul: number;
  /** Sann: hvert 60. sek øker playerDmgMul med 10 % permanent. */
  doomsdayActive: boolean;
  /** Sjanse (0–1) for at en bestilt maur spawnes som BOSS-versjon. */
  cosmicBossChance: number;
  /** 0–1: fraksjon av lanen player-maur starter etter (snarvei). */
  tunnelStartT: number;
  /** ms mellom torden-slag på tilfeldig fiende. 0 = av. */
  thunderstormIntervalMs: number;
  /** Drepte AI-maur etterlater en sopp-sky som gir DoT. */
  deathSporeCloud: boolean;
}

export function defaultModifiers(): UpgradeModifiers {
  return {
    playerHpMul: 1, playerDmgMul: 1, playerSpeedMul: 1, playerCostMul: 1,
    playerAtkIntervalMul: 1, bountyMul: 1,
    berserkDmgMul: 1, towerCostMul: 1, passiveBonus: 0,
    aiHpMul: 1, lightCostMul: 1, lightHpMul: 1,
    deathExplosion: false, deathHealAlly: false,
    unlockedUnits: [],
    cloneSpawnChance: 0,
    lifestealPct: 0,
    adrenalineEnabled: false,
    firstStrikeMul: 1,
    doomsdayActive: false,
    cosmicBossChance: 0,
    tunnelStartT: 0,
    thunderstormIntervalMs: 0,
    deathSporeCloud: false,
  };
}

export interface UpgradeSceneAPI {
  giveGold: (amount: number) => void;
  healBase: (amount: number) => void;
  raiseBaseMaxHp: (amount: number) => void;
  /** Spawn en kjempe-sumo (boss-versjon) i midt-lane. */
  summonKing: () => void;
}

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  description: string;
  flavor: string;
  rarity: UpgradeRarity;
  icon: string;
  apply: (mods: UpgradeModifiers, api: UpgradeSceneAPI) => void;
}

export const ALL_UPGRADES: UpgradeDef[] = [
  {
    id: 'queen', name: 'Krigsdronning', icon: '👑', rarity: 'rare',
    description: '+30 % HP til alle dine maur',
    flavor: 'Hun lukter blod, og koloniens unger merker det.',
    apply: (m) => { m.playerHpMul *= 1.3; },
  },
  {
    id: 'sharp_mandibles', name: 'Skarpe mandibler', icon: '🦷', rarity: 'common',
    description: '+25 % skade til alle dine maur',
    flavor: 'Slipt på flint. Polert med døde insekter.',
    apply: (m) => { m.playerDmgMul *= 1.25; },
  },
  {
    id: 'fever', name: 'Maurefeber', icon: '💨', rarity: 'common',
    description: '+30 % bevegelseshastighet',
    flavor: 'Soppspore-overdose. Alle løper.',
    apply: (m) => { m.playerSpeedMul *= 1.3; },
  },
  {
    id: 'mound', name: 'Forsterket tue', icon: '🏰', rarity: 'common',
    description: '+250 maks-HP til maurtua, og fyll opp',
    flavor: 'Tre tonn ekstra jord. Tunnelene tåler en støytur.',
    apply: (_m, api) => { api.raiseBaseMaxHp(250); api.healBase(999999); },
  },
  {
    id: 'granary', name: 'Fôrlagre', icon: '🌾', rarity: 'common',
    description: '+3 mat per tick (passiv inntekt)',
    flavor: 'Tre bladlus permanent ansatt som leverandører.',
    apply: (m) => { m.passiveBonus += 3; },
  },
  {
    id: 'looting', name: 'Likplyndring', icon: '💰', rarity: 'common',
    description: '+50 % mat fra fiende-drap',
    flavor: 'Det er noe surt i bladlus-likene som lukter rikdom.',
    apply: (m) => { m.bountyMul *= 1.5; },
  },
  {
    id: 'glass_cannon', name: 'Glasskanoner', icon: '💎', rarity: 'epic',
    description: '+100 % skade, men −40 % HP',
    flavor: 'Død i ett slag. Dødelige før det slaget kommer.',
    apply: (m) => { m.playerDmgMul *= 2; m.playerHpMul *= 0.6; },
  },
  {
    id: 'sumo', name: 'Sumo-maur', icon: '🐘', rarity: 'epic',
    description: 'Låser opp Sumo-maur i lane-menyene — kjempestor, dyrere, treig, knuser fronten',
    flavor: 'De spiser kun proteinrike rådne hjelmpansrede biller.',
    apply: (m) => { if (!m.unlockedUnits.includes('sumo')) m.unlockedUnits.push('sumo'); },
  },
  {
    id: 'berserk', name: 'Berserkergang', icon: '😡', rarity: 'rare',
    description: 'Maur under 50 % HP gjør 2× skade',
    flavor: 'Smerte er bare et signal til mandiblene.',
    apply: (m) => { m.berserkDmgMul = 2; },
  },
  {
    id: 'forge', name: 'Tårnsmed', icon: '🛠️', rarity: 'rare',
    description: 'Tårn koster 30 % mindre',
    flavor: 'Smeden tar betalt i pollen og blikk-kontakt.',
    apply: (m) => { m.towerCostMul *= 0.7; },
  },
  {
    id: 'caffeine', name: 'Maur-på-koffein', icon: '☕', rarity: 'silly',
    description: '+50 % angrepshastighet for alle dine maur',
    flavor: 'Tre dråper espresso per tarmsystem. Forskning pågår.',
    apply: (m) => { m.playerAtkIntervalMul *= 0.67; },
  },
  {
    id: 'tiny_ants', name: 'Bittesmå maur', icon: '🐜', rarity: 'silly',
    description: 'Lette maur koster bare 5 mat — men har 50 % HP',
    flavor: 'Vi sender mengden. Sjefen tegner ikke gravstein.',
    apply: (m) => { m.lightCostMul *= 0.34; m.lightHpMul *= 0.5; },
  },
  {
    id: 'snake_tongue', name: 'Slangetunge', icon: '🐍', rarity: 'cursed',
    description: '+100 mat NÅ. Men fiender får +25 % HP resten av spillet',
    flavor: 'Den hvisker av seg selv. Det er aldri godt nytt.',
    apply: (m, api) => { api.giveGold(100); m.aiHpMul *= 1.25; },
  },
  {
    id: 'explosion', name: 'Eksplosjons-rom', icon: '💥', rarity: 'epic',
    description: 'Dine døde maur eksploderer — 30 skade i radius 60',
    flavor: 'Hver kropp er en eske dynamitt med bein.',
    apply: (m) => { m.deathExplosion = true; },
  },
  {
    id: 'sacrifice', name: 'Selvoppofring', icon: '🤝', rarity: 'silly',
    description: 'Når en maur dør, helbreder nærmeste alliert 30 HP',
    flavor: 'De siste ordene er alltid "spis meg".',
    apply: (m) => { m.deathHealAlly = true; },
  },

  // ── Bananas: nye enhetstyper ─────────────────────────────────────────
  {
    id: 'wasp_unlock', name: 'Vepsesverm', icon: '🐝', rarity: 'epic',
    description: 'Låser opp Veps — rask flyver, glass-kanon, høy skade',
    flavor: 'Stikket smerter mer enn det burde, hver eneste gang.',
    apply: (m) => { if (!m.unlockedUnits.includes('wasp')) m.unlockedUnits.push('wasp'); },
  },
  {
    id: 'termite_unlock', name: 'Termitt-koloni', icon: '🪳', rarity: 'rare',
    description: 'Låser opp Termitt — 8 mat, masse svermer, eter alt levende',
    flavor: 'Du sender hundre. Femti kommer fram. Det holder.',
    apply: (m) => { if (!m.unlockedUnits.includes('termite')) m.unlockedUnits.push('termite'); },
  },

  // ── Bananas: passive triggere ────────────────────────────────────────
  {
    id: 'clone_spawn', name: 'Søsterkull', icon: '👯', rarity: 'epic',
    description: '25 % sjanse for at hver bestilling spawner en gratis tvilling',
    flavor: 'Dronningen er produktiv. Iblant glemmer hun å stoppe.',
    apply: (m) => { m.cloneSpawnChance = Math.max(m.cloneSpawnChance, 0.25); },
  },
  {
    id: 'vampire', name: 'Vampyrstikk', icon: '🩸', rarity: 'rare',
    description: 'Dine maur helbreder seg selv 15 % av skaden de gjør',
    flavor: 'Mandibler dyppet i noe blankt. Det smaker liv.',
    apply: (m) => { m.lifestealPct = Math.max(m.lifestealPct, 0.15); },
  },
  {
    id: 'first_strike', name: 'Embuskemaur', icon: '🗡️', rarity: 'rare',
    description: 'Første angrep hver maur gjør i livet sitt: 3× skade',
    flavor: 'De har øvd hele oppveksten på det første slaget.',
    apply: (m) => { m.firstStrikeMul = Math.max(m.firstStrikeMul, 3); },
  },
  {
    id: 'tunnel', name: 'Maurganger', icon: '🕳️', rarity: 'rare',
    description: 'Dine bestilte maur starter 35 % inn i lanen',
    flavor: 'Vi tunnelerte under gresset. Det tok all natten.',
    apply: (m) => { m.tunnelStartT = Math.max(m.tunnelStartT, 0.35); },
  },
  {
    id: 'adrenaline', name: 'Krigsraseri', icon: '🩹', rarity: 'epic',
    description: 'Under 30 % base-HP: alle dine maur +100 % skade og +50 % speed',
    flavor: 'Når tua brenner, smaker mandiblene jern.',
    apply: (m) => { m.adrenalineEnabled = true; },
  },
  {
    id: 'cosmic', name: 'Mutasjon', icon: '🧬', rarity: 'silly',
    description: '12 % sjanse for at bestilte maur spawnes som BOSS-versjoner',
    flavor: 'Du ber om Maur. Iblant kommer Noe Annet.',
    apply: (m) => { m.cosmicBossChance = Math.max(m.cosmicBossChance, 0.12); },
  },

  // ── Bananas: tikkende verdens-effekter ───────────────────────────────
  {
    id: 'doomsday', name: 'Evolusjonshjul', icon: '⏳', rarity: 'epic',
    description: 'Hvert 60. sekund: +10 % skade permanent til alle dine maur',
    flavor: 'Mandiblene blir hardere for hver generasjon. Vi har god tid.',
    apply: (m) => { m.doomsdayActive = true; },
  },
  {
    id: 'thunderstorm', name: 'Tordenstorm', icon: '⚡', rarity: 'epic',
    description: 'Hvert 12. sek: lyn slår ned på en tilfeldig fiende — 80 skade',
    flavor: 'Værgudene har bladlus-allergi.',
    apply: (m) => { m.thunderstormIntervalMs = 12000; },
  },
  {
    id: 'spore', name: 'Sopp-spore', icon: '🍄', rarity: 'rare',
    description: 'Drepte fiender etterlater en sky som gir 10 dmg/sek i radius 70 (5 sek)',
    flavor: 'Soppen vokser inn i alt som puster. Også ditt eget. Vi ignorerer det.',
    apply: (m) => { m.deathSporeCloud = true; },
  },

  // ── Bananas: engangs-spawn ───────────────────────────────────────────
  {
    id: 'ant_king', name: 'Maurkongen', icon: '🤴', rarity: 'epic',
    description: 'NÅ: tilkalle en gigantisk Sumo-konge i midt-lane',
    flavor: 'Han spør ikke. Han kommer. Du betaler.',
    apply: (_m, api) => { api.summonKing(); },
  },
];

/** Plukk 3 tilfeldige unike oppgraderinger som ikke allerede er tatt. */
export function pickThreeUpgrades(taken: Set<UpgradeId>, rng: () => number = Math.random): UpgradeDef[] {
  const fresh = ALL_UPGRADES.filter((u) => !taken.has(u.id));
  // Hvis vi går tom for unike, fyll på med tatte slik at backlog-runs også får valg.
  const candidates = fresh.length >= 3 ? fresh : [...fresh, ...ALL_UPGRADES.filter((u) => taken.has(u.id))];
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, 3);
}

export function findUpgrade(id: string): UpgradeDef | undefined {
  return ALL_UPGRADES.find((u) => u.id === id);
}
