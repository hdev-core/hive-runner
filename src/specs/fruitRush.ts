import type { GameSpec } from "../types/spec.ts";

// The hardcoded "Fruit Rush" catcher spec from game-spec-schema.md §9.
// This is exactly the kind of JSON the AI generator will emit in a later step.
export const fruitRush: GameSpec = {
  specVersion: 1,
  meta: { title: "Fruit Rush", archetype: "catcher", theme: "orchard", author: "alice" },
  world: { width: 480, height: 800, palette: ["#3aa24a", "#ffd23f", "#1b1b24"], audioTheme: "arcade" },
  entities: [
    {
      id: "basket", role: "avatar", sprite: "basket",
      controls: "swipe_lateral", movement: "player", speed: 12, width: 86, hitbox: "normal",
    },
    {
      id: "fruit", role: "pickup", sprite: "orb", movement: "fall_down", speed: 4.2,
      spawn: { pattern: "timed", rate: 1.0, from: "top" },
      onCollect: "score_add", value: 10,
    },
    {
      id: "rock", role: "hazard", sprite: "block", movement: "fall_down", speed: 4.2,
      spawn: { pattern: "timed", rate: 0.45, from: "top" },
      onHit: "lose_life",
    },
  ],
  rules: {
    lives: 3,
    win: null,
    lose: "lives==0",
    scoring: { primary: "pickups", leaderboard: "per_game" },
    difficulty: { curve: "linear", rampPerSec: 0.012, param: "fruit.speed" },
  },
  activityHooks: [
    // Hive energy (RC baseline + on-chain activity + Actifit bonus) => a few bonus lives
    { source: "energy", effect: "grants_lives", ratio: 0.34 },
    // overall Hive vitality (0..1) => WIDER basket: directly felt — you catch more easily
    { source: "activity_rank", effect: "scales", target: "basket.width", curve: "linear", min: 1.0, max: 1.8 },
    // Hive vitality => visible SCORE multiplier
    { source: "activity_rank", effect: "multiplier", target: "score", curve: "linear", min: 1.0, max: 2.0 },
  ],
};
