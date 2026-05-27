export type UnitPriority = 'workers' | 'soldiers' | 'balanced';
export type UnitKind = 'light' | 'medium' | 'heavy' | 'sumo' | 'wasp' | 'termite';

export const CONFIG = {
  // Økonomi — bounty-system. Mat fra kills + liten passiv inntekt så spilleren ikke
  // sitter på 0 hvis det skjer lite. Ingen mines, ingen farms.
  STARTING_GOLD: 250,
  GOLD_PER_TICK: 5,             // (legacy — beholdt for kompat med loop-state)
  MINE_TICK_INTERVAL: 1500,

  // Buildings
  BASE_HP: 500,
  ENEMY_BASE_HP: 500,

  // Visningsnavn for bygninger
  LABELS: {
    base: 'Maurtue',
  },

  // AI — fortsatt brukt av wave-mode, men ikke aktivt for symmetrisk AI lenger.
  AI_DECISION_INTERVAL: 4000,
  AI_AGGRESSION_THRESHOLD: 2,
  AI_WORKER_TARGET: 4,
  AI_UNIT_PRIORITY: 'balanced' as UnitPriority,

  // World — krympet så hele kartet passer på 1920×1080 uten kamera-pan.
  MAP_WIDTH: 1920,
  MAP_HEIGHT: 1080,

  // ───── Lane-spline-geometri ─────
  // 3 maurstier som svinger seg gjennom gressplenen. Alle starter ved player-arena
  // i vest og ender ved fiende-arena i øst.
  // (Lane-geometrien bygges i lanes.ts; CONFIG har bare ID/label + spline-waypoints.)
  LANES: [
    {
      id: 0 as const,
      label: 'Nord',
      baseWidth: 56,
      waypoints: [
        { x: 220, y: 500 }, { x: 380, y: 380 }, { x: 600, y: 240 },
        { x: 880, y: 200 }, { x: 1180, y: 260 }, { x: 1420, y: 360 },
        { x: 1620, y: 460 }, { x: 1700, y: 540 },
      ],
    },
    {
      id: 1 as const,
      label: 'Midt',
      baseWidth: 60,
      waypoints: [
        { x: 220, y: 540 }, { x: 440, y: 580 }, { x: 720, y: 510 },
        { x: 980, y: 580 }, { x: 1260, y: 500 }, { x: 1500, y: 560 },
        { x: 1700, y: 540 },
      ],
    },
    {
      id: 2 as const,
      label: 'Sør',
      baseWidth: 56,
      waypoints: [
        { x: 220, y: 580 }, { x: 380, y: 700 }, { x: 600, y: 840 },
        { x: 880, y: 880 }, { x: 1180, y: 820 }, { x: 1420, y: 720 },
        { x: 1620, y: 620 }, { x: 1700, y: 540 },
      ],
    },
  ] as ReadonlyArray<{
    id: 0 | 1 | 2;
    label: string;
    baseWidth: number;
    waypoints: ReadonlyArray<{ x: number; y: number }>;
  }>,

  // Arena-radier — der lanene konvergerer foran hver maurtue.
  ARENA_RADIUS: 110,
  PLAYER_BASE_X: 150,
  PLAYER_BASE_Y: 540,
  ENEMY_SPAWN_X: 1770,
  ENEMY_SPAWN_Y: 540,

  // ───── Unit-typer (3 stk) ─────
  // Hver lane-knapp gir spilleren valg mellom disse. AI/waves bruker `medium` som default.
  UNITS: {
    light: {
      label: 'Maur',
      cost: 15,
      hp: 60,
      damage: 10,
      speed: 90,
      attackRange: 36,
      attackInterval: 700,
      bounty: 16,
      bodyScale: 0.85,
    },
    medium: {
      label: 'Larve',
      cost: 30,
      hp: 120,
      damage: 20,
      speed: 70,
      attackRange: 40,
      attackInterval: 1000,
      bounty: 32,
      bodyScale: 1.0,
    },
    heavy: {
      label: 'Humle',
      cost: 60,
      hp: 250,
      damage: 40,
      speed: 50,
      attackRange: 44,
      attackInterval: 1400,
      bounty: 64,
      bodyScale: 1.25,
    },
    sumo: {
      label: 'Sumo',
      cost: 90,
      hp: 480,
      damage: 55,
      speed: 38,
      attackRange: 46,
      attackInterval: 1600,
      bounty: 96,
      bodyScale: 1.7,
    },
    wasp: {
      label: 'Veps',
      cost: 70,
      hp: 80,
      damage: 60,
      speed: 115,
      attackRange: 50,
      attackInterval: 750,
      bounty: 56,
      bodyScale: 0.95,
    },
    termite: {
      label: 'Termitt',
      cost: 8,
      hp: 25,
      damage: 6,
      speed: 105,
      attackRange: 30,
      attackInterval: 600,
      bounty: 8,
      bodyScale: 0.7,
    },
  } as const,

  // Passiv inntekt (liten — bounty er hovedkilden).
  PASSIVE_INCOME_PER_TICK: 6,
  KILL_GOLD_FALLBACK: 16,        // hvis unit ikke har bounty
  WAVE_PREP_MS: 25000,           // legacy — ikke i bruk lenger
  /** Lengde på 3-2-1-countdown før en bølge starter (ms). */
  WAVE_COUNTDOWN_MS: 3000,

  // Viewport (canvas) — settes av PhaserGame.syncConfigToViewport() ved oppstart/resize.
  VIEWPORT_WIDTH: 1280,
  VIEWPORT_HEIGHT: 720,

  // Kamera — siden hele kartet passer på skjermen er pan/edge-scroll nå deaktivert.
  // Beholdt for kompat, men brukes ikke fra GameScene.
  CAMERA_SCROLL_SPEED: 0,
  CAMERA_EDGE_THRESHOLD: 0,

  // Demo / autonomous play
  DEMO_MODE: false,
  PLAYER_AGGRESSION_THRESHOLD: 3,
  PLAYER_WORKER_TARGET: 3,
  PLAYER_DECISION_INTERVAL: 3000,

  // M1 — pause + hastighet
  TIME_SCALES: [1, 2, 3] as const,
  DEFAULT_TIME_SCALE: 1,

  // M1 — fiende-varsel
  ENEMY_NEAR_RADIUS: 400,
  ENEMY_ALERT_INTERVAL: 500,
  ENEMY_ALERT_COOLDOWN: 8000,

  // Audio
  AUDIO_DEFAULT_VOLUME: 0.6,

  // ───── Tower defence ─────
  // Tårn plasseres i gress-områder (utenfor lane/arena-polygoner).
  TOWER_BUILD_RADIUS: 350,
  TOWER_PLACE_CLEARANCE: 40,
  // Gratis start-tårn — plasseres automatisk ved spillstart. Fem tårn: to stingere nord+midt,
  // én webber mellom midt og sør, én stinger ved sør-lane-inngangen, én spitter for splash på sør.
  FREE_STARTER_TOWERS: [
    { type: 'stinger' as const, x: 400, y: 440 },  // nord + midt ved x=400
    { type: 'stinger' as const, x: 320, y: 490 },  // nord + midt ved x=320 — andre ildpunkt nærmere basen
    { type: 'webber'  as const, x: 420, y: 620 },  // midt + sør — slow-sone for bølge 5-7
    { type: 'stinger' as const, x: 300, y: 770 },  // sør — dekker sør-lane-inngang (bølge 8+)
    { type: 'spitter' as const, x: 350, y: 800 },  // sør — splash AoE mot tunge enheter i klynge (bølge 8)
  ] as const,
  TOWER_TYPES: {
    stinger: { cost: 80,  hp: 200, damage: 25, range: 220, fireRate: 1000, splash: 0,  slow: 0,    color: 0xb89048 },
    webber:  { cost: 100, hp: 150, damage: 5,  range: 180, fireRate: 1500, splash: 0,  slow: 0.5,  color: 0xc8c8e8 },
    spitter: { cost: 120, hp: 180, damage: 15, range: 160, fireRate: 1800, splash: 60, slow: 0,    color: 0x8acc6a },
  } as const,
  TOWER_SLOW_DURATION: 1800,
  TOWER_SELL_REFUND: 0.5,   // andel av opprinnelig byggekost refundert ved salg
  AI_TOWER_TARGET: 2,
  AI_TOWER_BUILD_INTERVAL: 60000,

  // ───── Stages (progresjon av åpne laner) ─────
  // Spilleren starter med bare MIDT-lanen åpen. Nord åpnes ved wave 3, Sør ved wave 5.
  // Selve lane-geometrien forblir identisk — det er bare hvilke som *finnes* på kartet
  // som endres. Tårn allerede plassert beholdes (de står i gress).
  STAGES: [
    { unlockAtWave: 1, activeLanes: [1]       as ReadonlyArray<0 | 1 | 2>, newLane: null      as null | 0 | 1 | 2 },
    { unlockAtWave: 3, activeLanes: [0, 1]    as ReadonlyArray<0 | 1 | 2>, newLane: 0         as null | 0 | 1 | 2 },
    { unlockAtWave: 5, activeLanes: [0, 1, 2] as ReadonlyArray<0 | 1 | 2>, newLane: 2         as null | 0 | 1 | 2 },
  ] as ReadonlyArray<{
    unlockAtWave: number;
    activeLanes: ReadonlyArray<0 | 1 | 2>;
    /** Hvilken lane som nettopp åpnet på dette stage-skiftet (for banner). */
    newLane: null | 0 | 1 | 2;
  }>,

  // ───── Waves (TD-modus) ─────
  // `lane` styrer hvor creeps spawner. Må respektere hvilken stage som er aktiv:
  //   waves 1-2 → kun lane 1 (midt)
  //   waves 1-4 → lett (light) for å gi spilleren tid til å bygge tårn
  //   waves 5-6 → medium på én lane (introduksjon)
  //   waves 7+  → alle laner, eskalerende unit-typer
  WAVE_MODE: {
    enabled: true,
    waves: [
      { soldiers: 4,  spawnInterval: 1300, lane: 1     as const, unitKind: 'light'  as const, boss: false },
      { soldiers: 5,  spawnInterval: 1200, lane: 1     as const, unitKind: 'light'  as const, boss: false },
      { soldiers: 6,  spawnInterval: 1100, lane: 'all' as const, unitKind: 'light'  as const, boss: false },
      { soldiers: 7,  spawnInterval: 1050, lane: 0     as const, unitKind: 'light'  as const, boss: false },
      { soldiers: 4,  spawnInterval: 1000, lane: 1     as const, unitKind: 'medium' as const, boss: false },
      { soldiers: 4,  spawnInterval: 950,  lane: 0     as const, unitKind: 'medium' as const, boss: false },
      { soldiers: 5,  spawnInterval: 900,  lane: 'all' as const, unitKind: 'medium' as const, boss: false },
      { soldiers: 2,  spawnInterval: 850,  lane: 2     as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 8,  spawnInterval: 800,  lane: 'all' as const, unitKind: 'medium' as const, boss: false },
      { soldiers: 3,  spawnInterval: 800,  lane: 1     as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 9,  spawnInterval: 750,  lane: 'all' as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 14, spawnInterval: 700,  lane: 'all' as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 16, spawnInterval: 650,  lane: 'all' as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 18, spawnInterval: 620,  lane: 'all' as const, unitKind: 'heavy'  as const, boss: false },
      { soldiers: 20, spawnInterval: 600,  lane: 'all' as const, unitKind: 'heavy'  as const, boss: true },
    ] as ReadonlyArray<{
      soldiers: number; spawnInterval: number;
      lane: 0 | 1 | 2 | 'all';
      unitKind: UnitKind;
      boss: boolean;
    }>,
  },

  // M2.3 — Choke-formasjon (ikke i bruk lenger, beholdt for kompat).
  FORMATION_SPACING: 28,

  // ───── Liv i kartet (ambient wildlife) ─────
  // Mariehøner krabber rundt i gresset, sommerfugler flyr over, og én frosk sitter
  // og venter på å snappe en creep med tunga. Rene atmosfære-elementer (utenom
  // frosken som faktisk dreper én creep av og til).
  WILDLIFE: {
    LADYBUG_COUNT: 8,
    LADYBUG_SPEED: 18,            // px/s krabbe-fart
    LADYBUG_PAUSE_MIN_MS: 1500,
    LADYBUG_PAUSE_MAX_MS: 4000,
    LADYBUG_WANDER_RADIUS: 80,    // hvor langt et nytt mål-punkt kan ligge fra nåværende
    BUTTERFLY_COUNT: 3,
    BUTTERFLY_SPEED: 70,          // px/s flygefart
    BUTTERFLY_BOB_AMP: 18,        // px vertikal bølge
    BUTTERFLY_FLAP_HZ: 6,         // vinge-flapp-frekvens
    FROG_STRIKE_RANGE: 160,       // hvor langt frosken kan slå med tunga
    FROG_COOLDOWN_MIN_MS: 22000,
    FROG_COOLDOWN_MAX_MS: 38000,
    FROG_RELOCATE_MIN_MS: 60000,
    FROG_RELOCATE_MAX_MS: 110000,
    FROG_BASE_CLEARANCE: 280,     // hold deg unna player-basen
    FROG_LANE_CLEARANCE: 22,      // minst så langt fra en lane
  },
};

// Ant-tema visuell palett
export const THEME = {
  // Maur-kropper
  PLAYER_SOLDIER_COLOR: 0x141414,
  AI_SOLDIER_COLOR: 0x6e2a14,
  ANT_LEG_COLOR_PLAYER: 0x444444,
  ANT_LEG_COLOR_AI: 0x5a2010,
  ANT_HEAD_HIGHLIGHT_PLAYER: 0x4a4a4a,
  ANT_HEAD_HIGHLIGHT_AI: 0xb35030,
  ANT_MANDIBLE_COLOR_PLAYER: 0xddccaa,
  ANT_MANDIBLE_COLOR_AI: 0xeebb88,

  // Maurtue (base + spawner)
  BASE_COLOR_PLAYER: 0x6b4a2a,
  BASE_COLOR_AI: 0x7a3a1a,
  BASE_RIM_PLAYER: 0x3a2614,
  BASE_RIM_AI: 0x401a0a,
  BASE_HIGHLIGHT_PLAYER: 0x8e6638,
  BASE_HIGHLIGHT_AI: 0xa05528,
  BASE_ENTRANCE_COLOR: 0x140a04,
  SOIL_GRAIN_PLAYER: [0x8a6638, 0x5a3a1c, 0xa07a44, 0x4a2c14],
  SOIL_GRAIN_AI: [0x9a4a22, 0x5a2010, 0xb86238, 0x4a1808],
  DISTURBED_SOIL_PLAYER: 0x4a3220,
  DISTURBED_SOIL_AI: 0x5a2818,

  // Larve (medium) — gulgrønn segmentert klump. Faction-tint legges på toppen.
  LARVA_BODY_PLAYER: 0x9ab84a,
  LARVA_BODY_AI: 0xc88a3a,
  LARVA_SHEEN_PLAYER: 0xd0e89a,
  LARVA_SHEEN_AI: 0xf4cc88,
  LARVA_SEG_RIM_PLAYER: 0x4a6a20,
  LARVA_SEG_RIM_AI: 0x6a3a14,

  // Humle (heavy) — knubbete kropp med striper og vinger.
  BEE_BODY_PLAYER: 0x1a1a1a,
  BEE_BODY_AI: 0x5a2010,
  BEE_STRIPE_PLAYER: 0xe8c64a,
  BEE_STRIPE_AI: 0xf0a040,
  BEE_WING: 0xf4f8ff,

  // Småblomster / kløver-tuer
  CLOVER_LEAF: 0x4a8a3a,
  FLOWER_WHITE: 0xf0eed8,
  FLOWER_YELLOW: 0xf0d048,
  FLOWER_PINK: 0xd884a0,

  // Gressmark
  GRASS_COLOR_TOP: 0x3f6f30,
  GRASS_COLOR_BOTTOM: 0x325828,
  GRASS_BLADE_COLOR: 0x6a9a4a,
  GRASS_BLADE_DARK: 0x3a5a28,
  PEBBLE_COLORS: [0x8c8478, 0xa09080, 0x6e604c],
  NOISE_TINT: 0xc8b87a,

  // Jord-sti (maursti)
  LANE_DIRT: 0x7a5230,
  LANE_DIRT_LIGHT: 0x8c6238,
  LANE_DIRT_DARK: 0x5a3a1c,
  LANE_PEBBLE: 0x4a3220,
  LANE_EDGE: 0x3a2614,

  // VFX
  ATTACK_PROJECTILE_PLAYER: 0xccff66,
  ATTACK_PROJECTILE_AI: 0xff9944,
  DUST_TINTS: [0x6a5a3a, 0x8a7a5a, 0x4a3a22],
  SPARK_TINTS: [0xccff88, 0xddee99, 0xffffff],

  // HP-bar farger
  HP_BAR_HIGH: 0x4caf50,
  HP_BAR_MED:  0xffc107,
  HP_BAR_LOW:  0xf44336,

  // Wildlife (mariehøne / sommerfugl / frosk)
  LADYBUG_RED: 0xc8302a,
  LADYBUG_DARK: 0x141414,
  BUTTERFLY_WING_A: 0xf0d048,
  BUTTERFLY_WING_B: 0xd884a0,
  BUTTERFLY_WING_C: 0xeaeaf2,
  BUTTERFLY_BODY: 0x2a1a14,
  FROG_BODY: 0x4f8a3a,
  FROG_BODY_DARK: 0x355c24,
  FROG_BELLY: 0xc9d68a,
  FROG_EYE: 0xfaf7d0,
  FROG_PUPIL: 0x141414,
  FROG_TONGUE: 0xd44a6a,

  // Camera postFX
  FX_BLOOM_THRESHOLD: 0.55,
  FX_BLOOM_BLUR_RADIUS: 6,
  FX_BLOOM_BLUR_STEPS: 4,
  FX_BLOOM_BLUR_QUALITY: 1,
  FX_BLOOM_BLEND_AMOUNT: 0.65,
};
