// Mock activity provider — stands in for a real read of on-chain Hive signals (via HAF).
// HYBRID model (generic to any Hive account; Actifit is only an optional bonus feeder):
//
//   energy = baseline(RC/voting-mana regen)      // everyone has this floor
//          + activity(on-chain ops in last 24h)  // rewards Hive engagement
//          + bonus(Actifit steps, if any)        // your unfair-advantage extra
//
// RC also acts as the natural anti-spam cap on how much activity you can generate.
// In production these come from the chain; here they're mocked so we can feel the loop.

export interface ActivityInputs {
  ops24h: number;   // on-chain operations in the last 24h (posts, comments, votes, transfers, custom_json)
  manaPct: number;  // RC / voting mana, 0..100 (regenerating native meter)
  steps: number;    // Actifit steps today (optional bonus)
}

export interface ActivitySnapshot {
  inputs: ActivityInputs;
  breakdown: { baseline: number; activity: number; bonus: number };
  energy: number;       // total, capped
  vitality: number;     // energy normalized 0..1 (smooth scaling signal)
  streakDays: number;
}

export const ENERGY_TOTAL_CAP = 15;
const BASELINE_CAP = 3;   // from mana
const ACTIVITY_CAP = 10;  // from on-chain ops
const BONUS_CAP = 5;      // from steps
const OPS_PER_ENERGY = 3; // 3 on-chain ops = 1 energy
const STEPS_PER_ENERGY = 2000;

export function makeActivity(inputs: ActivityInputs): ActivitySnapshot {
  const baseline = Math.round((clamp01(inputs.manaPct / 100)) * BASELINE_CAP);
  const activity = Math.min(ACTIVITY_CAP, Math.floor(inputs.ops24h / OPS_PER_ENERGY));
  const bonus = Math.min(BONUS_CAP, Math.floor(inputs.steps / STEPS_PER_ENERGY));
  const energy = Math.min(ENERGY_TOTAL_CAP, baseline + activity + bonus);
  return {
    inputs,
    breakdown: { baseline, activity, bonus },
    energy,
    vitality: energy / ENERGY_TOTAL_CAP,
    streakDays: 1,
  };
}

/** Resolve a hook `source` to its raw numeric value. */
export function sourceValue(a: ActivitySnapshot, source: string): number {
  switch (source) {
    case "energy": return a.energy;
    case "activity_rank": return a.vitality;   // 0..1 combined Hive vitality
    case "today_steps": return a.inputs.steps;
    case "streak_days": return a.streakDays;
    default: return 0;
  }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
