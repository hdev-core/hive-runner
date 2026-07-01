// Applies activityHooks to a spec BEFORE a session starts.
// This is the heart of "your real-world activity powers play" — the differentiator.

import type { GameSpec, ActivityHook, HookCurve } from "../types/spec.ts";
import { type ActivitySnapshot, sourceValue, ENERGY_TOTAL_CAP } from "../activity/mockActivity.ts";

export interface AppliedHooks {
  effectiveSpec: GameSpec;     // spec with `scales` hooks baked in
  bonusLives: number;          // from `grants_lives` hooks
  scoreMultiplier: number;     // from `multiplier` hooks targeting score
  basketWidthFactor: number;   // how much wider the basket got (for the panel)
  notes: string[];             // human-readable summary for the debug panel
}

// Normalize a raw source value into 0..1 so curves are comparable across sources.
function normalize(source: string, raw: number): number {
  switch (source) {
    case "today_steps": return clamp01(raw / 12000);
    case "energy": return clamp01(raw / ENERGY_TOTAL_CAP);
    case "streak_days": return clamp01(raw / 30);
    case "activity_rank": return clamp01(raw);
    default: return 0;
  }
}

function shape(t: number, curve: HookCurve | undefined): number {
  switch (curve) {
    case "log": return Math.log10(1 + 9 * clamp01(t));       // concave: quick early gains
    case "step": return t < 0.34 ? 0 : t < 0.67 ? 0.5 : 1;
    case "linear":
    default: return clamp01(t);
  }
}

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }

// Resolve a dotted path like "fruit.spawn.rate" against the spec (first token = entity id).
function pathRef(spec: GameSpec, path: string): { get(): number; set(v: number): void } | null {
  const parts = path.split(".");
  const ent = spec.entities.find((e) => e.id === parts[0]);
  if (!ent) return null;
  // walk the remaining tokens
  let obj: any = ent;
  for (let i = 1; i < parts.length - 1; i++) {
    obj = obj?.[parts[i]];
    if (obj == null) return null;
  }
  const leaf = parts[parts.length - 1];
  if (typeof obj?.[leaf] !== "number") return null;
  return { get: () => obj[leaf], set: (v: number) => { obj[leaf] = v; } };
}

export function applyHooks(spec: GameSpec, activity: ActivitySnapshot): AppliedHooks {
  const effectiveSpec: GameSpec = structuredClone(spec);
  const baseBasketWidth = spec.entities.find((e) => e.role === "avatar")?.width ?? 86;
  let bonusLives = 0;
  let scoreMultiplier = 1;
  let basketWidthFactor = 1;
  const notes: string[] = [];

  for (const hook of effectiveSpec.activityHooks) {
    const raw = sourceValue(activity, hook.source);

    if (hook.effect === "grants_lives") {
      const add = Math.floor(raw * (hook.ratio ?? 1));
      bonusLives += add;
      notes.push(`+${add} lives (from ${raw} ${hook.source})`);
    } else if (hook.effect === "scales") {
      applyScale(effectiveSpec, hook, raw, notes, (mult, target) => {
        if (target.endsWith(".width") || target.endsWith(".jump")) basketWidthFactor = mult; // avatar size/jump
      });
    } else if (hook.effect === "multiplier" && hook.target === "score") {
      const min = hook.min ?? 1, max = hook.max ?? 1;
      scoreMultiplier = round2(min + (max - min) * shape(normalize(hook.source, raw), hook.curve));
      notes.push(`score ×${scoreMultiplier} (from ${hook.source})`);
    } else {
      // extend_time / widen_window / unlock_boost not used by catcher — ignore in proto.
      notes.push(`(${hook.effect} from ${hook.source}: not applicable to catcher)`);
    }
  }

  // make sure the engine reads a concrete width even if no scale hook ran
  const avatar = effectiveSpec.entities.find((e) => e.role === "avatar");
  if (avatar && avatar.width == null) avatar.width = baseBasketWidth;

  return { effectiveSpec, bonusLives, scoreMultiplier, basketWidthFactor, notes };
}

function applyScale(
  spec: GameSpec,
  hook: ActivityHook,
  raw: number,
  notes: string[],
  report: (mult: number, target: string) => void,
) {
  if (!hook.target) return;
  const ref = pathRef(spec, hook.target);
  if (!ref) { notes.push(`(scales target ${hook.target} not found)`); return; }
  const min = hook.min ?? 1;
  const max = hook.max ?? 1;
  const factor = min + (max - min) * shape(normalize(hook.source, raw), hook.curve);
  const before = ref.get();
  ref.set(round2(before * factor));
  report(round2(factor), hook.target);
  notes.push(`${hook.target} ×${round2(factor)} (${before} → ${ref.get()}) from ${hook.source}`);
}

function round2(x: number) { return Math.round(x * 100) / 100; }
