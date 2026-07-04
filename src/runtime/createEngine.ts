// Engine factory — maps a spec's archetype to its fixed runtime engine.
// catcher + dodger share FallingEngine (same family, different spec-driven progression).
// reaction / maze will get their own engines later.

import type { Application } from "pixi.js";
import type { GameSpec } from "../types/spec.ts";
import { FallingEngine, type EngineState } from "./FallingEngine.ts";
import { RunnerEngine, type RaceGhost } from "./RunnerEngine.ts";
import type { HiveFeed } from "../hive/HiveFeed.ts";
import type { PostFeed, HivePost } from "../hive/PostFeed.ts";
import type { CosmeticRender } from "../cosmetics/progression.ts";

export interface ArchetypeEngine {
  mount(): void;
  update(deltaMS: number): void;
  destroy(): void;
}

export function createEngine(
  app: Application,
  spec: GameSpec,
  bonusLives: number,
  scoreMultiplier: number,
  onState?: (s: EngineState) => void,
  hiveFeed?: HiveFeed,
  postFeed?: PostFeed,
  onPost?: (post: HivePost) => void,
  cosmetics?: CosmeticRender,
  ghosts?: RaceGhost[],
  onGhostPass?: (label: string) => void,
  onRaceWon?: () => void,
  perksEnabled = false,
): ArchetypeEngine {
  switch (spec.meta.archetype) {
    case "catcher":
    case "dodger":
      return new FallingEngine(app, spec, bonusLives, scoreMultiplier, onState, hiveFeed);
    case "runner":
      return new RunnerEngine(app, spec, bonusLives, scoreMultiplier, onState, hiveFeed, postFeed, onPost, cosmetics, ghosts ?? [], onGhostPass, onRaceWon, perksEnabled);
    default:
      throw new Error(`archetype "${spec.meta.archetype}" not implemented yet`);
  }
}
