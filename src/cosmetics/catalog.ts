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
export interface TrailParams { color: number; kind: "spark" | "coin" | "hex"; }

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
  // --- skins (courier palettes) ---
  { id: "skin_default", type: "skin", name: "Hive Courier", rarity: "common", unlock: { kind: "start" },
    skin: { body: 0x2a3255, accent: 0xe31337, skinTone: 0xf1cba2, visor: 0x74e0ff } },
  { id: "skin_sky", type: "skin", name: "Sky Courier", rarity: "common", unlock: { kind: "start" },
    skin: { body: 0x1c4a7a, accent: 0x38b0e0, skinTone: 0xf1cba2, visor: 0xaef0ff } },
  { id: "skin_actifit", type: "skin", name: "Actifit Runner", rarity: "rare", unlock: { kind: "level", level: 3 },
    skin: { body: 0x1f6a3f, accent: 0x3aa66a, skinTone: 0xf1cba2, visor: 0xaaf0c0 } },
  { id: "skin_whale", type: "skin", name: "Whale Courier", rarity: "epic", unlock: { kind: "level", level: 6 },
    skin: { body: 0x1c3a5e, accent: 0xffcf3f, skinTone: 0xf1cba2, visor: 0x8de0ff } },
  { id: "skin_witness", type: "skin", name: "Witness", rarity: "epic", unlock: { kind: "level", level: 9 },
    skin: { body: 0x3a2a55, accent: 0x9b6bff, skinTone: 0xf1cba2, visor: 0x74e0ff } },
  { id: "skin_gold", type: "skin", name: "Golden Legend", rarity: "legendary", unlock: { kind: "milestone", stat: "bestScore", value: 1000 },
    skin: { body: 0x6a5210, accent: 0xffd23f, skinTone: 0xf1cba2, visor: 0xfff0b0 } },

  // --- parcels (the back parcel) ---
  { id: "parcel_kraft", type: "parcel", name: "Kraft Parcel", rarity: "common", unlock: { kind: "start" },
    parcel: { box: 0xcaa46a, twine: 0x8a6a3a } },
  { id: "parcel_red", type: "parcel", name: "Hive-Red Box", rarity: "rare", unlock: { kind: "level", level: 2 },
    parcel: { box: 0xc0303a, twine: 0x7a1820 } },
  { id: "parcel_actifit", type: "parcel", name: "Actifit Pack", rarity: "rare", unlock: { kind: "level", level: 5 },
    parcel: { box: 0x2f9e57, twine: 0x1f6a3f } },
  { id: "parcel_gift", type: "parcel", name: "Gift Crate", rarity: "epic", unlock: { kind: "milestone", stat: "totalRuns", value: 25 },
    parcel: { box: 0xd44a8a, twine: 0xffffff } },

  // --- trails (particles behind the runner) ---
  { id: "trail_none", type: "trail", name: "No Trail", rarity: "common", unlock: { kind: "start" }, trail: null },
  { id: "trail_spark", type: "trail", name: "Spark Trail", rarity: "rare", unlock: { kind: "level", level: 4 },
    trail: { color: 0xffcf3f, kind: "spark" } },
  { id: "trail_coin", type: "trail", name: "Coin Trail", rarity: "epic", unlock: { kind: "level", level: 7 },
    trail: { color: 0xffd23f, kind: "coin" } },
  { id: "trail_hex", type: "trail", name: "Honeycomb Trail", rarity: "epic", unlock: { kind: "level", level: 10 },
    trail: { color: 0xe31337, kind: "hex" } },

  // --- world themes (Background) ---
  { id: "theme_city", type: "theme", name: "On-Chain City", rarity: "common", unlock: { kind: "start" }, theme: "city run" },
  { id: "theme_neon", type: "theme", name: "Neon Grid", rarity: "rare", unlock: { kind: "level", level: 5 }, theme: "neon" },
  { id: "theme_space", type: "theme", name: "Deep Space", rarity: "epic", unlock: { kind: "level", level: 8 }, theme: "space" },
  { id: "theme_dawn", type: "theme", name: "Dawn Run", rarity: "epic", unlock: { kind: "milestone", stat: "maxStreak", value: 7 }, theme: "dawn" },
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
