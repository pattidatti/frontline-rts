export type UnitPriority = 'workers' | 'soldiers' | 'balanced';

export const CONFIG = {
  // Economy — Starcraft-aktig opener: 1 worker + 1 maurtue ved start, worker bygger
  // barakke før soldater kan trenes. STARTING_GOLD må dekke 1-2 ekstra workers og
  // sparing til en barakke for å lande en troverdig åpningssekvens.
  STARTING_GOLD: 50,
  GOLD_PER_TICK: 5,
  MINE_TICK_INTERVAL: 1500,

  // Units
  WORKER_COST: 25,
  WORKER_SPEED: 80,
  SOLDIER_COST: 50,
  SOLDIER_SPEED: 70,
  SOLDIER_HP: 100,
  SOLDIER_DAMAGE: 20,
  SOLDIER_ATTACK_RANGE: 40,
  SOLDIER_ATTACK_SPEED: 1000,

  // Buildings
  BASE_HP: 500,
  BARRACKS_COST: 80,
  BARRACKS_HP: 200,

  // Konstruksjonstid (ms) per bygning. Worker er låst i 'building'-state hele tida.
  BARRACKS_BUILD_TIME: 12000,
  FARM_BUILD_TIME: 8000,
  WALL_BUILD_TIME: 3000,
  ARMORY_BUILD_TIME: 10000,
  TOWER_BUILD_TIME: 7000,
  BRIDGE_BUILD_TIME: 6000,

  // Visningsnavn for bygninger / ressursnoder. Interne `kind`-strenger holdes uendret
  // så metric-attributter (data-*-base-hp) ikke brytes.
  LABELS: {
    base: 'Maurtue',
    barracks: 'Barakke',
    mine: 'Bladlusfarm',
  },

  // AI — these are the primary tuning targets for the playtest loop.
  // AGGRESSION_THRESHOLD hevet til 4 og WORKER_TARGET til 4 så AI også må
  // bygge økonomi før den angriper — gir player en ramp-up-fase.
  AI_DECISION_INTERVAL: 3500,
  AI_AGGRESSION_THRESHOLD: 2,
  AI_WORKER_TARGET: 4,
  AI_UNIT_PRIORITY: 'balanced' as UnitPriority,

  // World — faste verden-dimensjoner, uavhengig av viewport. Camera scroller over denne.
  MAP_WIDTH: 2560,
  MAP_HEIGHT: 1440,

  // Viewport (canvas) — settes av PhaserGame.syncConfigToViewport() ved oppstart/resize.
  VIEWPORT_WIDTH: 1280,
  VIEWPORT_HEIGHT: 720,

  // Camera
  CAMERA_SCROLL_SPEED: 600,    // px/s ved WASD eller edge-scroll
  CAMERA_EDGE_THRESHOLD: 24,   // px fra viewport-kant før edge-scroll triggrer

  // Mines — contested logikk
  MINE_CONTEST_RADIUS: 80,     // px — fiende-units innenfor blokkerer gull-tick
  /** V3 — antall ticks med kun-motstander-i-radius før kontroll flipper. Skaper "sticky" eierskap. */
  MINE_FLIP_TICKS: 3,

  // Broer (T1-C/T1-B)
  BRIDGE_HP: 150,
  BRIDGE_PASS_RADIUS: 50,      // px — units innenfor denne radius rundt en levende bro kan krysse elv

  // Demo / autonomous play — loop sets this to true, game restores to false
  DEMO_MODE: false,
  PLAYER_AGGRESSION_THRESHOLD: 3,
  PLAYER_WORKER_TARGET: 3,
  PLAYER_DECISION_INTERVAL: 3000,

  // M1 — pause + hastighet
  TIME_SCALES: [1, 2, 3] as const,
  DEFAULT_TIME_SCALE: 1,

  // M1 — fiende-varsel
  ENEMY_NEAR_RADIUS: 400,        // px — soldater innenfor denne distansen til player-base trigger varsel
  ENEMY_ALERT_INTERVAL: 500,     // ms — hvor ofte vi sjekker
  /** V4 — minimum ms mellom to alarm-bannere så vi ikke spammer ved AI-soldater som "skvulper" rundt grensa. */
  ENEMY_ALERT_COOLDOWN: 8000,

  // M1 — audio
  AUDIO_DEFAULT_VOLUME: 0.6,

  // M2.1 — Tower defence (towers)
  TOWER_BUILD_RADIUS: 350,        // px — towers må plasseres innenfor denne radius fra player-base
  TOWER_PLACE_CLEARANCE: 40,      // px — minimum avstand til andre bygninger
  TOWER_TYPES: {
    stinger: { cost: 80,  hp: 200, damage: 25, range: 200, fireRate: 1000, splash: 0,  slow: 0,    color: 0xb89048 },
    webber:  { cost: 100, hp: 150, damage: 5,  range: 180, fireRate: 1500, splash: 0,  slow: 0.5,  color: 0xc8c8e8 },
    spitter: { cost: 120, hp: 180, damage: 15, range: 160, fireRate: 1800, splash: 60, slow: 0,    color: 0x8acc6a },
  } as const,
  TOWER_SLOW_DURATION: 1800,       // ms — webber-effekten varer så lenge etter siste treff
  /** K5 — AI sitt mål for hvor mange tårn den skal ha. Bygges gradvis ved aiDecision-tick. */
  AI_TOWER_TARGET: 2,
  /** K5 — minimum ms mellom AI sine tårn-bygginger. */
  AI_TOWER_BUILD_INTERVAL: 60000,

  // M2.2 — Wave Defence
  WAVE_MODE: {
    enabled: false,
    // delay = ms etter forrige bølge før denne starter; soldiers = antall som spawnes
    waves: [
      { delay: 25000, soldiers: 3,  tank: false, boss: false },
      { delay: 30000, soldiers: 4,  tank: false, boss: false },
      { delay: 35000, soldiers: 5,  tank: false, boss: false },
      { delay: 40000, soldiers: 6,  tank: false, boss: false },
      { delay: 45000, soldiers: 7,  tank: false, boss: false },
      { delay: 45000, soldiers: 8,  tank: false, boss: false },
      { delay: 50000, soldiers: 9,  tank: false, boss: false },
      { delay: 55000, soldiers: 10, tank: false, boss: false },
      { delay: 60000, soldiers: 12, tank: false, boss: false },
      { delay: 70000, soldiers: 15, tank: false, boss: true  },
    ] as ReadonlyArray<{ delay: number; soldiers: number; tank: boolean; boss: boolean }>,
  },

  // M2.3 — Choke-formasjon (F-tast)
  FORMATION_SPACING: 28,           // px — avstand mellom soldater i linjen

  // M3.1 — Bygg (Farm / Wall / Armory). Bruker delt build-mode med towers.
  BUILD_RADIUS: 500,               // px — bygg må plasseres innenfor denne radius fra player-base
  BUILD_PLACE_CLEARANCE: 38,       // px — minimum avstand til andre bygninger
  BUILDING_TYPES: {
    farm:   { cost: 60,  hp: 100, w: 38, h: 32, color: 0x6ba84a, bonusGoldPerTick: 2 },
    wall:   { cost: 20,  hp: 300, w: 30, h: 30, color: 0x6c5a3a, bonusGoldPerTick: 0 },
    armory: { cost: 100, hp: 150, w: 40, h: 40, color: 0x9a7a3a, bonusGoldPerTick: 0 },
  } as const,
  WALL_BLOCK_RADIUS: 18,           // px — units kan ikke gå nærmere enn dette inn i en wall

  // M3.2 — Base "Forsvar"-oppgradering
  BASE_DEFENSE_COST: 100,          // mat
  BASE_DEFENSE_HP_BONUS: 200,
  BASE_DEFENSE_RANGE: 160,
  BASE_DEFENSE_DAMAGE: 10,
  BASE_DEFENSE_FIRE_RATE: 1500,    // ms
};

// Ant-tema visuell palett — alle rendering-konstanter samlet her
export const THEME = {
  // Maur-kropper
  PLAYER_WORKER_COLOR: 0x2a2a2a,
  PLAYER_SOLDIER_COLOR: 0x141414,
  AI_WORKER_COLOR: 0x8b3a1f,
  AI_SOLDIER_COLOR: 0x6e2a14,
  ANT_LEG_COLOR_PLAYER: 0x444444,
  ANT_LEG_COLOR_AI: 0x5a2010,
  ANT_HEAD_HIGHLIGHT_PLAYER: 0x4a4a4a,
  ANT_HEAD_HIGHLIGHT_AI: 0xb35030,
  ANT_MANDIBLE_COLOR_PLAYER: 0xddccaa,
  ANT_MANDIBLE_COLOR_AI: 0xeebb88,

  // Maurtue (base + barracks)
  BASE_COLOR_PLAYER: 0x6b4a2a,
  BASE_COLOR_AI: 0x7a3a1a,
  BASE_RIM_PLAYER: 0x3a2614,
  BASE_RIM_AI: 0x401a0a,
  BASE_HIGHLIGHT_PLAYER: 0x8e6638,
  BASE_HIGHLIGHT_AI: 0xa05528,
  BASE_ENTRANCE_COLOR: 0x140a04,
  BARRACKS_EGG_COLOR: 0xf5e8c8,
  // Maurtue tekstur — granulat, kvist, barnåler, forstyrret jord
  SOIL_GRAIN_PLAYER: [0x8a6638, 0x5a3a1c, 0xa07a44, 0x4a2c14],
  SOIL_GRAIN_AI: [0x9a4a22, 0x5a2010, 0xb86238, 0x4a1808],
  PINE_NEEDLE_COLOR: 0x4a3a1a,
  PINE_NEEDLE_LIGHT: 0x7a5a2a,
  TWIG_COLOR: 0x3a2410,
  DISTURBED_SOIL_PLAYER: 0x4a3220,
  DISTURBED_SOIL_AI: 0x5a2818,

  // Småblomster / kløver-tuer
  CLOVER_LEAF: 0x4a8a3a,
  FLOWER_WHITE: 0xf0eed8,
  FLOWER_YELLOW: 0xf0d048,
  FLOWER_PINK: 0xd884a0,

  // Bladlus-farm
  APHID_LEAF_COLOR: 0x3a7a2a,
  APHID_LEAF_HIGHLIGHT: 0x5aa044,
  APHID_LEAF_VEIN: 0x2a5a1f,
  APHID_COLOR: 0x88dd66,
  APHID_HIGHLIGHT: 0xccff99,

  // Gressmark
  GRASS_COLOR_TOP: 0x4a7a3a,
  GRASS_COLOR_BOTTOM: 0x355a28,
  GRASS_BLADE_COLOR: 0x6a9a4a,
  GRASS_BLADE_DARK: 0x3a5a28,
  PEBBLE_COLORS: [0x8c8478, 0xa09080, 0x6e604c],
  PHEROMONE_TRAIL_COLOR: 0xddcc88,
  NOISE_TINT: 0xc8b87a,

  // VFX
  ATTACK_PROJECTILE_PLAYER: 0xccff66,
  ATTACK_PROJECTILE_AI: 0xff9944,
  DUST_TINTS: [0x6a5a3a, 0x8a7a5a, 0x4a3a22],
  SPARK_TINTS: [0xccff88, 0xddee99, 0xffffff],

  // HP-bar farger (Phaser-rendered bars over units/buildings). Matcher CSS-paletten i HudOverlay.
  HP_BAR_HIGH: 0x4caf50,   // > 66%
  HP_BAR_MED:  0xffc107,   // 33–66%
  HP_BAR_LOW:  0xf44336,   // < 33%

  // Camera postFX — applied once i GameScene.create(). Hold bloom lav så
  // ant-temaet ikke blir overstrålt; vignett gir cinematisk innramming.
  FX_BLOOM_THRESHOLD: 0.55,
  FX_BLOOM_BLUR_RADIUS: 6,
  FX_BLOOM_BLUR_STEPS: 4,
  FX_BLOOM_BLUR_QUALITY: 1,
  FX_BLOOM_BLEND_AMOUNT: 0.65,
};
