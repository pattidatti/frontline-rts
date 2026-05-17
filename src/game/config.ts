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
  AI_AGGRESSION_THRESHOLD: 4,
  AI_WORKER_TARGET: 2,
  AI_UNIT_PRIORITY: 'balanced' as UnitPriority,

  // Map
  MAP_WIDTH: 1280,
  MAP_HEIGHT: 720,

  // Demo / autonomous play — loop sets this to true, game restores to false
  DEMO_MODE: false,
  PLAYER_AGGRESSION_THRESHOLD: 4,
  PLAYER_WORKER_TARGET: 2,
  PLAYER_DECISION_INTERVAL: 3000,
};
