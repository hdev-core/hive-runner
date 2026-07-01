import type { GameSpec } from "../types/spec.ts";

// "Meteor Dodge" — the `dodger` archetype. Same GameSpec shape as catcher,
// but scoring.primary = "survival_time" flips FallingEngine into survive-to-advance mode.
// Note the hooks map differently per game: here activity makes your ship SMALLER (nimbler),
// the opposite of catcher's wider basket — same vocabulary, game-appropriate effect.
export const meteorDodge: GameSpec = {
  specVersion: 1,
  meta: { title: "Meteor Dodge", archetype: "dodger", theme: "deep space", author: "alice" },
  world: { width: 480, height: 800, palette: ["#5a7bd8", "#ffd23f", "#0a0a16"], audioTheme: "chiptune" },
  entities: [
    {
      id: "ship", role: "avatar", sprite: "runner",
      controls: "swipe_lateral", movement: "player", speed: 12, width: 42, hitbox: "tight",
    },
    {
      id: "meteor", role: "hazard", sprite: "block", movement: "fall_down", speed: 4.6,
      spawn: { pattern: "timed", rate: 1.1, from: "top" },
      onHit: "lose_life",
    },
    {
      id: "star", role: "pickup", sprite: "orb", movement: "fall_down", speed: 4.6,
      spawn: { pattern: "timed", rate: 0.3, from: "top" },
      onCollect: "score_add", value: 25,
    },
  ],
  rules: {
    lives: 3,
    win: "survive_time",
    lose: "lives==0",
    scoring: { primary: "survival_time", leaderboard: "per_game" },
    difficulty: { curve: "linear", rampPerSec: 0.02, param: "meteor.speed" },
  },
  activityHooks: [
    { source: "energy", effect: "grants_lives", ratio: 0.34 },
    // more Hive vitality => SMALLER ship = harder to hit (min>max shrinks it)
    { source: "activity_rank", effect: "scales", target: "ship.width", curve: "linear", min: 1.0, max: 0.7 },
    { source: "activity_rank", effect: "multiplier", target: "score", curve: "linear", min: 1.0, max: 2.0 },
  ],
};
