import type { GameSpec } from "../types/spec.ts";

// "Runner Dash" — a HORIZONTAL dodger. Same engine, same spec shape as Meteor Dodge;
// only world.orientation = "horizontal" flips it: obstacles come from the right moving
// left, and the character dodges UP/DOWN. Demonstrates one engine, two layouts.
export const runnerDash: GameSpec = {
  specVersion: 1,
  meta: { title: "Runner Dash", archetype: "runner", theme: "city run" },
  world: {
    // landscape 4:3 — a side-scroller reads far better wide than tall, and it lets the
    // canvas render wider than the cards below it (coords are relative to these dims).
    width: 640, height: 480, orientation: "horizontal",
    palette: ["#e0863a", "#ffd23f", "#141018"], audioTheme: "chiptune",
  },
  entities: [
    {
      id: "runner", role: "avatar", sprite: "runner",
      controls: "tap_position", movement: "player", speed: 12, width: 42, jump: 16, hitbox: "tight",
    },
    {
      id: "rock", role: "hazard", sprite: "block", movement: "drift", speed: 4.6,
      spawn: { pattern: "timed", rate: 1.1, from: "right" },
      onHit: "lose_life",
    },
    {
      id: "coin", role: "pickup", sprite: "orb", movement: "drift", speed: 4.6,
      spawn: { pattern: "timed", rate: 0.3, from: "right" },
      onCollect: "score_add", value: 25,
    },
  ],
  rules: {
    lives: 3,
    win: "survive_time",
    lose: "lives==0",
    scoring: { primary: "survival_time", leaderboard: "per_game" },
    difficulty: { curve: "linear", rampPerSec: 0.02, param: "rock.speed" },
  },
  activityHooks: [
    { source: "energy", effect: "grants_lives", ratio: 0.34 },
    // more Hive vitality => higher jump (clear obstacles + reach coins more easily)
    { source: "activity_rank", effect: "scales", target: "runner.jump", curve: "linear", min: 1.0, max: 1.18 },
    { source: "activity_rank", effect: "multiplier", target: "score", curve: "linear", min: 1.0, max: 2.0 },
  ],
};
