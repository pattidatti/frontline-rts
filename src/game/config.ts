export type UnitPriority = 'workers' | 'soldiers' | 'balanced';

export const CONFIG = {
  // Economy
  STARTING_GOLD: 150,
  GOLD_PER_TICK: 5,
  MINE_TICK_INTERVAL: 1500,

  // Units
  WORKER_COST: 30,
  WORKER_SPEED: 80,
  SOLDIER_COST: 50,
  SOLDIER_SPEED: 70,
  SOLDIER_HP: 100,
  SOLDIER_DAMAGE: 20,
  SOLDIER_ATTACK_RANGE: 40,
  SOLDIER_ATTACK_SPEED: 1000,

  // Buildings
  BASE_HP: 500,

  // AI — these are the primary tuning targets for the playtest loop
  AI_DECISION_INTERVAL: 3000,
  AI_AGGRESSION_THRESHOLD: 2,
  AI_WORKER_TARGET: 2,
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

  // Broer (T1-C/T1-B)
  BRIDGE_HP: 150,
  BRIDGE_PASS_RADIUS: 50,      // px — units innenfor denne radius rundt en levende bro kan krysse elv

  // Demo / autonomous play — loop sets this to true, game restores to false
  DEMO_MODE: false,
  PLAYER_AGGRESSION_THRESHOLD: 5,
  PLAYER_WORKER_TARGET: 3,
  PLAYER_DECISION_INTERVAL: 3000,

  // M1 — pause + hastighet
  TIME_SCALES: [1, 2, 3] as const,
  DEFAULT_TIME_SCALE: 1,

  // M1 — fiende-varsel
  ENEMY_NEAR_RADIUS: 400,        // px — soldater innenfor denne distansen til player-base trigger varsel
  ENEMY_ALERT_INTERVAL: 500,     // ms — hvor ofte vi sjekker

  // M1 — audio
  AUDIO_DEFAULT_VOLUME: 0.6,
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
