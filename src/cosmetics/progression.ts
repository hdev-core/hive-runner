// Progression — XP, account level, lifetime milestones, and the equipped/owned cosmetic set.
// Client-side (localStorage) for P0. Owned is DERIVED from level + milestones (no separate store),
// so unlocks can never drift out of sync. Purely cosmetic — nothing here affects gameplay.

import { CATALOG, DEFAULTS, byId, type Cosmetic, type CosmeticType, type SkinParams, type ParcelParams, type TrailParams } from "./catalog.ts";

export interface CosmeticRender { skin: SkinParams; parcel: ParcelParams; trail: TrailParams | null; theme: string; }

/** Resolve the currently-equipped cosmetics into concrete render params for the engine. */
export function resolveCosmetics(): CosmeticRender {
  const eq = getEquipped();
  return {
    skin: byId(eq.skin)?.skin ?? byId(DEFAULTS.skin)!.skin!,
    parcel: byId(eq.parcel)?.parcel ?? byId(DEFAULTS.parcel)!.parcel!,
    trail: byId(eq.trail)?.trail ?? null,
    theme: byId(eq.theme)?.theme ?? "city run",
  };
}

const KEY = "hiverunner_prog";

export interface Milestones { bestScore: number; totalRuns: number; maxLevel: number; maxStreak: number; }
interface ProgState {
  totalXp: number;
  milestones: Milestones;
  equipped: Record<CosmeticType, string>;
}

interface RunResult { score: number; level: number; postCoins: number; streak: number; }

function load(): ProgState {
  let s: ProgState | null = null;
  try { s = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { s = null; }
  const m: Partial<Milestones> = (s && s.milestones) || {};
  const e: Partial<Record<CosmeticType, string>> = (s && s.equipped) || {};
  return {
    totalXp: (s && s.totalXp) || 0,
    milestones: {
      bestScore: m.bestScore || 0, totalRuns: m.totalRuns || 0,
      maxLevel: m.maxLevel || 0, maxStreak: m.maxStreak || 0,
    },
    equipped: {
      skin: e.skin || DEFAULTS.skin, parcel: e.parcel || DEFAULTS.parcel,
      trail: e.trail || DEFAULTS.trail, theme: e.theme || DEFAULTS.theme,
    },
  };
}
function save(s: ProgState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }

// cost to advance FROM level L to L+1
const levelCost = (l: number) => 80 + l * 40;

export interface LevelInfo { level: number; intoLevel: number; forNext: number; }
export function levelInfo(totalXp: number): LevelInfo {
  let level = 1, rem = totalXp;
  while (rem >= levelCost(level)) { rem -= levelCost(level); level++; }
  return { level, intoLevel: rem, forNext: levelCost(level) };
}

export const getLevelInfo = (): LevelInfo => levelInfo(load().totalXp);
export const getMilestones = (): Milestones => load().milestones;

/** Is a cosmetic unlocked for the given progress? */
export function isUnlocked(c: Cosmetic, level: number, m: Milestones): boolean {
  const u = c.unlock;
  if (u.kind === "start") return true;
  if (u.kind === "level") return level >= u.level;
  return m[u.stat] >= u.value;
}

export function ownedIds(): Set<string> {
  const s = load();
  const level = levelInfo(s.totalXp).level;
  return new Set(CATALOG.filter((c) => isUnlocked(c, level, s.milestones)).map((c) => c.id));
}

export const getEquipped = (): Record<CosmeticType, string> => load().equipped;

/** Equip a cosmetic (only if owned). Returns true if applied. */
export function equip(type: CosmeticType, id: string): boolean {
  const c = byId(id);
  if (!c || c.type !== type || !ownedIds().has(id)) return false;
  const s = load();
  s.equipped[type] = id;
  save(s);
  return true;
}

/** XP earned for a run's results. */
export function xpForRun(r: RunResult): number {
  return Math.floor(r.score / 10) + r.level * 15 + r.postCoins * 5;
}

export interface RunProgress { xpGained: number; leveledUp: boolean; newLevel: number; newlyUnlocked: Cosmetic[]; }

/** Apply a finished run: add XP, update milestones, return level-ups + newly unlocked cosmetics. */
export function applyRun(r: RunResult): RunProgress {
  const s = load();
  const before = { level: levelInfo(s.totalXp).level, m: { ...s.milestones } };
  const ownedBefore = ownedIds();

  s.totalXp += xpForRun(r);
  s.milestones.bestScore = Math.max(s.milestones.bestScore, r.score);
  s.milestones.totalRuns += 1;
  s.milestones.maxLevel = Math.max(s.milestones.maxLevel, r.level);
  s.milestones.maxStreak = Math.max(s.milestones.maxStreak, r.streak);
  save(s);

  const after = levelInfo(s.totalXp).level;
  const ownedAfter = ownedIds();
  const newlyUnlocked = CATALOG.filter((c) => ownedAfter.has(c.id) && !ownedBefore.has(c.id));
  return { xpGained: xpForRun(r), leveledUp: after > before.level, newLevel: after, newlyUnlocked };
}
