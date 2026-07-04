// Cosmetics catalog — purely visual unlockables (no gameplay effect). Everything renders from
// the existing procedural art (palette / shape / theme swaps), so no art assets are needed.
// Hive-native mix: witness / community / Actifit-flavoured looks alongside a few arcade themes.
// Unlocks are progression-based (account level) or milestone-based (lifetime bests).

export type CosmeticType = "skin" | "parcel" | "trail" | "theme";
export type Rarity = "common" | "rare" | "epic" | "legendary";

export type Unlock =
  | { kind: "start" }
  | { kind: "level"; level: number }
  | { kind: "milestone"; stat: "bestScore" | "totalRuns" | "maxLevel" | "maxStreak"; value: number };

export interface SkinParams { body: number; accent: number; skinTone: number; visor: number; }
export interface ParcelParams { box: number; twine: number; }
export type TrailKind =
  | "spark" | "ember" | "coin" | "ring" | "flame" | "hex"
  | "comet" | "confetti" | "smoke" | "bolt" | "petal" | "prism";
// Each kind has its own motion/behaviour (emit rate, gravity, spin, growth) baked into the engine;
// `color` tints it and `colors` supplies a palette for the multi-colour kinds (confetti / prism / flame).
export interface TrailParams { color: number; kind: TrailKind; colors?: number[]; }

export interface Cosmetic {
  id: string;
  type: CosmeticType;
  name: string;
  rarity: Rarity;
  unlock: Unlock;
  skin?: SkinParams;
  parcel?: ParcelParams;
  trail?: TrailParams | null;   // null = "no trail" option
  theme?: string;               // Background theme key
}

export const CATALOG: Cosmetic[] = [
  // --- skins (courier palettes) --- {body, accent, skinTone, visor} — pure palette swaps
  { id: "skin_default", type: "skin", name: "Hive Courier", rarity: "common", unlock: { kind: "start" },
    skin: { body: 0x2a3255, accent: 0xe31337, skinTone: 0xf1cba2, visor: 0x74e0ff } },
  { id: "skin_sky", type: "skin", name: "Sky Courier", rarity: "common", unlock: { kind: "start" },
    skin: { body: 0x1c4a7a, accent: 0x38b0e0, skinTone: 0xf1cba2, visor: 0xaef0ff } },
  { id: "skin_actifit", type: "skin", name: "Actifit Runner", rarity: "rare", unlock: { kind: "level", level: 3 },
    skin: { body: 0x1f6a3f, accent: 0x3aa66a, skinTone: 0xf1cba2, visor: 0xaaf0c0 } },
  { id: "skin_leo", type: "skin", name: "Leo Courier", rarity: "rare", unlock: { kind: "level", level: 4 },
    skin: { body: 0x123a6a, accent: 0x2f7ae0, skinTone: 0xd9a97a, visor: 0x9fd3ff } },
  { id: "skin_ember", type: "skin", name: "Ember Runner", rarity: "rare", unlock: { kind: "level", level: 5 },
    skin: { body: 0x5a1e1e, accent: 0xff6a3a, skinTone: 0xf1cba2, visor: 0xffd0a0 } },
  { id: "skin_whale", type: "skin", name: "Whale Courier", rarity: "epic", unlock: { kind: "level", level: 6 },
    skin: { body: 0x1c3a5e, accent: 0xffcf3f, skinTone: 0xf1cba2, visor: 0x8de0ff } },
  { id: "skin_pob", type: "skin", name: "Proof-of-Brain", rarity: "rare", unlock: { kind: "level", level: 7 },
    skin: { body: 0x3a2a55, accent: 0xc06bff, skinTone: 0xd9a97a, visor: 0xd9b6ff } },
  { id: "skin_splinter", type: "skin", name: "Splinter Knight", rarity: "epic", unlock: { kind: "level", level: 8 },
    skin: { body: 0x4a2a12, accent: 0xffb020, skinTone: 0xf1cba2, visor: 0xffe0a0 } },
  { id: "skin_witness", type: "skin", name: "Witness", rarity: "epic", unlock: { kind: "level", level: 9 },
    skin: { body: 0x3a2a55, accent: 0x9b6bff, skinTone: 0xf1cba2, visor: 0x74e0ff } },
  { id: "skin_frost", type: "skin", name: "Frost Courier", rarity: "epic", unlock: { kind: "level", level: 11 },
    skin: { body: 0x1a3a4a, accent: 0x6fe0ff, skinTone: 0xe8c8a8, visor: 0xcaf6ff } },
  { id: "skin_shadow", type: "skin", name: "Shadow Runner", rarity: "epic", unlock: { kind: "level", level: 13 },
    skin: { body: 0x14141c, accent: 0x8a8ab0, skinTone: 0xc9a98a, visor: 0x9a9aff } },
  { id: "skin_royal", type: "skin", name: "Royal Courier", rarity: "legendary", unlock: { kind: "level", level: 16 },
    skin: { body: 0x2a1a55, accent: 0xffd23f, skinTone: 0xf1cba2, visor: 0xe6c8ff } },
  { id: "skin_magma", type: "skin", name: "Magma Runner", rarity: "epic", unlock: { kind: "level", level: 20 },
    skin: { body: 0x3a0e0e, accent: 0xff3a1a, skinTone: 0xd9a97a, visor: 0xffb060 } },
  { id: "skin_gold", type: "skin", name: "Golden Legend", rarity: "legendary", unlock: { kind: "milestone", stat: "bestScore", value: 1000 },
    skin: { body: 0x6a5210, accent: 0xffd23f, skinTone: 0xf1cba2, visor: 0xfff0b0 } },
  { id: "skin_diamond", type: "skin", name: "Diamond Elite", rarity: "legendary", unlock: { kind: "milestone", stat: "maxLevel", value: 15 },
    skin: { body: 0x2a4a5a, accent: 0xbff0ff, skinTone: 0xf1cba2, visor: 0xffffff } },
  { id: "skin_veteran", type: "skin", name: "Veteran Courier", rarity: "epic", unlock: { kind: "milestone", stat: "totalRuns", value: 100 },
    skin: { body: 0x2a2a2a, accent: 0xff6b6b, skinTone: 0xd9a97a, visor: 0x9fd3ff } },

  // --- parcels (the back parcel) --- {box, twine}
  { id: "parcel_kraft", type: "parcel", name: "Kraft Parcel", rarity: "common", unlock: { kind: "start" },
    parcel: { box: 0xcaa46a, twine: 0x8a6a3a } },
  { id: "parcel_red", type: "parcel", name: "Hive-Red Box", rarity: "rare", unlock: { kind: "level", level: 2 },
    parcel: { box: 0xc0303a, twine: 0x7a1820 } },
  { id: "parcel_blue", type: "parcel", name: "Cobalt Crate", rarity: "rare", unlock: { kind: "level", level: 4 },
    parcel: { box: 0x2f5ae0, twine: 0x1a2f7a } },
  { id: "parcel_actifit", type: "parcel", name: "Actifit Pack", rarity: "rare", unlock: { kind: "level", level: 5 },
    parcel: { box: 0x2f9e57, twine: 0x1f6a3f } },
  { id: "parcel_leo", type: "parcel", name: "Leo Case", rarity: "rare", unlock: { kind: "level", level: 8 },
    parcel: { box: 0x123a6a, twine: 0x2f7ae0 } },
  { id: "parcel_night", type: "parcel", name: "Midnight Box", rarity: "epic", unlock: { kind: "level", level: 10 },
    parcel: { box: 0x1a1a2e, twine: 0x6fd3ff } },
  { id: "parcel_ice", type: "parcel", name: "Ice Crate", rarity: "epic", unlock: { kind: "level", level: 12 },
    parcel: { box: 0x8fdfff, twine: 0x2f8aaa } },
  { id: "parcel_neon", type: "parcel", name: "Neon Pack", rarity: "epic", unlock: { kind: "level", level: 15 },
    parcel: { box: 0xff2f8a, twine: 0x8a1a55 } },
  { id: "parcel_gift", type: "parcel", name: "Gift Crate", rarity: "epic", unlock: { kind: "milestone", stat: "totalRuns", value: 25 },
    parcel: { box: 0xd44a8a, twine: 0xffffff } },
  { id: "parcel_gold", type: "parcel", name: "Golden Cargo", rarity: "legendary", unlock: { kind: "milestone", stat: "bestScore", value: 1500 },
    parcel: { box: 0xffd23f, twine: 0x8a5a10 } },
  { id: "parcel_diamond", type: "parcel", name: "Diamond Case", rarity: "legendary", unlock: { kind: "milestone", stat: "maxLevel", value: 12 },
    parcel: { box: 0xbff0ff, twine: 0x5a9bff } },

  // --- trails (particles behind the runner) --- each `kind` has a distinct motion (see RunnerEngine)
  { id: "trail_none", type: "trail", name: "No Trail", rarity: "common", unlock: { kind: "start" }, trail: null },
  { id: "trail_spark", type: "trail", name: "Spark Trail", rarity: "rare", unlock: { kind: "level", level: 4 },
    trail: { color: 0xffcf3f, kind: "spark" } },                                  // quick fading sparks
  { id: "trail_ember", type: "trail", name: "Ember Trail", rarity: "rare", unlock: { kind: "level", level: 6 },
    trail: { color: 0xff7a3a, kind: "ember" } },                                  // embers that float UP + flicker
  { id: "trail_coin", type: "trail", name: "Coin Trail", rarity: "epic", unlock: { kind: "level", level: 7 },
    trail: { color: 0xffd23f, kind: "coin" } },                                   // coins that pop up then FALL + spin
  { id: "trail_ripple", type: "trail", name: "Ripple Trail", rarity: "rare", unlock: { kind: "level", level: 9 },
    trail: { color: 0x9fd3ff, kind: "ring" } },                                   // expanding rings
  { id: "trail_flame", type: "trail", name: "Flame Trail", rarity: "epic", unlock: { kind: "level", level: 10 },
    trail: { color: 0xff5a2a, kind: "flame", colors: [0xff2a12, 0xff7a2a, 0xffcf3f] } }, // rising fire blobs
  { id: "trail_hex", type: "trail", name: "Honeycomb Trail", rarity: "epic", unlock: { kind: "level", level: 12 },
    trail: { color: 0xe31337, kind: "hex" } },                                    // slow-spinning Hive hexes
  { id: "trail_comet", type: "trail", name: "Comet Trail", rarity: "epic", unlock: { kind: "level", level: 14 },
    trail: { color: 0x6fd3ff, kind: "comet" } },                                  // bright glowing streak
  { id: "trail_confetti", type: "trail", name: "Confetti Trail", rarity: "epic", unlock: { kind: "level", level: 16 },
    trail: { color: 0xffffff, kind: "confetti", colors: [0xff5a5a, 0x5a9bff, 0xffd23f, 0x6cff8a, 0xc86bff] } }, // multi-colour burst that falls
  { id: "trail_smoke", type: "trail", name: "Vapor Trail", rarity: "rare", unlock: { kind: "level", level: 18 },
    trail: { color: 0x9aa0b0, kind: "smoke" } },                                  // expanding grey puffs
  { id: "trail_bolt", type: "trail", name: "Electric Trail", rarity: "epic", unlock: { kind: "level", level: 20 },
    trail: { color: 0x8fe6ff, kind: "bolt" } },                                   // jagged lightning flickers
  { id: "trail_petal", type: "trail", name: "Sakura Petals", rarity: "epic", unlock: { kind: "milestone", stat: "totalRuns", value: 50 },
    trail: { color: 0xffb6d5, kind: "petal" } },                                  // petals that flutter down
  { id: "trail_prism", type: "trail", name: "Prismatic Trail", rarity: "legendary", unlock: { kind: "milestone", stat: "bestScore", value: 2000 },
    trail: { color: 0xff5ad0, kind: "prism", colors: [0xff5a5a, 0xffb03a, 0xffe23a, 0x6cff8a, 0x5ad0ff, 0xc86bff] } }, // rainbow burst

  // --- world themes (Background) --- theme key routes to a sky palette + decor
  { id: "theme_city", type: "theme", name: "On-Chain City", rarity: "common", unlock: { kind: "start" }, theme: "city run" },
  { id: "theme_neon", type: "theme", name: "Neon Grid", rarity: "rare", unlock: { kind: "level", level: 5 }, theme: "neon" },
  { id: "theme_forest", type: "theme", name: "Emerald Canopy", rarity: "rare", unlock: { kind: "level", level: 6 }, theme: "forest" },
  { id: "theme_space", type: "theme", name: "Deep Space", rarity: "epic", unlock: { kind: "level", level: 8 }, theme: "space" },
  { id: "theme_sunset", type: "theme", name: "Sunset Skyline", rarity: "rare", unlock: { kind: "level", level: 11 }, theme: "sunset" },
  { id: "theme_ocean", type: "theme", name: "Harbor Lights", rarity: "epic", unlock: { kind: "level", level: 14 }, theme: "ocean" },
  { id: "theme_midnight", type: "theme", name: "Midnight Run", rarity: "epic", unlock: { kind: "level", level: 18 }, theme: "midnight" },
  { id: "theme_dawn", type: "theme", name: "Dawn Run", rarity: "epic", unlock: { kind: "milestone", stat: "maxStreak", value: 7 }, theme: "dawn" },
  { id: "theme_sakura", type: "theme", name: "Sakura Night", rarity: "epic", unlock: { kind: "milestone", stat: "totalRuns", value: 50 }, theme: "sakura" },
  { id: "theme_aurora", type: "theme", name: "Aurora", rarity: "legendary", unlock: { kind: "milestone", stat: "maxLevel", value: 20 }, theme: "aurora" },
];

export const TYPES: CosmeticType[] = ["skin", "parcel", "trail", "theme"];
export const DEFAULTS: Record<CosmeticType, string> = { skin: "skin_default", parcel: "parcel_kraft", trail: "trail_none", theme: "theme_city" };

export const byId = (id: string): Cosmetic | undefined => CATALOG.find((c) => c.id === id);
export const byType = (t: CosmeticType): Cosmetic[] => CATALOG.filter((c) => c.type === t);

export function unlockLabel(u: Unlock): string {
  if (u.kind === "start") return "Starter";
  if (u.kind === "level") return `Reach level ${u.level}`;
  const names: Record<string, string> = { bestScore: "best score", totalRuns: "total runs", maxLevel: "max level", maxStreak: "day streak" };
  return `${names[u.stat]} ${u.value}`;
}
