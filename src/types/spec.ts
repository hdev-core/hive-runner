// Game-spec types — a TypeScript subset of game-spec-schema.md (v1).
// Stage 1 prototype: only the fields the `catcher` archetype needs are fully modeled,
// but the shape matches the full schema so it generalizes to the other archetypes.

export type Archetype = "dodger" | "catcher" | "lane_shooter" | "reaction" | "maze" | "runner";

export type Role =
  | "avatar" | "hazard" | "pickup" | "target"
  | "enemy" | "projectile" | "wall" | "goal";

export type Movement =
  | "static" | "fall_down" | "rise_up" | "approach_lane"
  | "drift" | "chase_avatar" | "patrol" | "player";

export type Controls =
  | "swipe_lateral" | "tilt_lateral" | "tap_position"
  | "tap_target" | "dpad_4way" | "auto";

export type SpawnPattern = "none" | "timed" | "lanes" | "random_pos" | "grid_fixed";

export type Outcome =
  | "lose_life" | "gain_life" | "score_add" | "score_mult"
  | "destroy_self" | "destroy_other" | "bounce" | "speed_up"
  | "slow_down" | "end_win" | "end_lose" | "none";

export type DifficultyCurve = "flat" | "linear" | "step" | "ease_in";
export type ScoringPrimary = "survival_time" | "pickups" | "hits" | "reaction_score" | "completion";
export type Hitbox = "tight" | "normal" | "loose";

export type HookSource = "energy" | "today_steps" | "streak_days" | "activity_rank";
export type HookEffect =
  | "grants_lives" | "scales" | "multiplier"
  | "unlock_boost" | "extend_time" | "widen_window";
export type HookCurve = "linear" | "log" | "step";

export interface SpawnDef {
  pattern: SpawnPattern;
  rate?: number;     // spawns/sec (0.1..4)
  lanes?: number;    // 1..5
  from?: "top" | "bottom" | "left" | "right" | "edges" | "anywhere";
  layout?: string;   // maze layout id
}

export interface EntityDef {
  id: string;
  role: Role;
  sprite: string;
  hitbox?: Hitbox;
  movement?: Movement;
  speed?: number;        // 0..20
  width?: number;        // avatar/base width in px (scalable by hooks)
  jump?: number;         // runner jump impulse (scalable by hooks)
  controls?: Controls;
  spawn?: SpawnDef;
  onHit?: Outcome;
  onCollect?: Outcome;
  onMiss?: Outcome;
  value?: number;        // 0..1000
}

export interface DifficultyDef {
  curve: DifficultyCurve;
  rampPerSec: number;    // 0..0.2
  param: string;         // dotted path to one numeric field, e.g. "fruit.speed"
}

export interface ScoringDef {
  primary: ScoringPrimary;
  leaderboard?: "per_game" | "none";
  winScore?: number;
  missLimit?: number;
}

export interface RulesDef {
  lives?: number | null;        // 1..9
  timeLimitSec?: number | null; // 10..180
  win?: "collect_all" | "reach_goal" | "survive_time" | "score_target" | null;
  lose: "lives==0" | "time_up" | "miss_limit";
  scoring: ScoringDef;
  difficulty?: DifficultyDef;
}

export interface ActivityHook {
  source: HookSource;
  effect: HookEffect;
  target?: string;   // dotted path (required when effect === "scales")
  ratio?: number;
  curve?: HookCurve;
  min?: number;
  max?: number;
}

export interface WorldDef {
  width: number;
  height: number;
  orientation?: "vertical" | "horizontal"; // vertical: fall top→bottom, avatar moves X.
                                            // horizontal: come right→left, avatar moves Y.
  palette?: string[];
  background?: string;
  audioTheme?: "arcade" | "calm" | "chiptune" | "none";
}

export interface MetaDef {
  title: string;
  archetype: Archetype;
  theme?: string;
  author?: string;
  description?: string;
}

export interface GameSpec {
  specVersion: 1;
  meta: MetaDef;
  world: WorldDef;
  entities: EntityDef[];
  rules: RulesDef;
  activityHooks: ActivityHook[];
}
