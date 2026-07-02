// The Hive logo mark, drawn from primitives: a flat-top hexagon with the signature
// downward notch cut into its top edge (the "fold" that makes it read as Hive, not a
// plain hexagon). Used for the character emblem, HUD watermark, and background hints.

import { Graphics } from "pixi.js";

export const HIVE_RED = 0xe31337;

export function drawHiveMark(g: Graphics, cx: number, cy: number, r: number, color = HIVE_RED, alpha = 1) {
  const s = r * 0.866; // half-height of a flat-top hexagon
  const n = r * 0.22;  // notch half-width
  g.poly([
    cx + r, cy,            // right
    cx + r / 2, cy + s,    // lower-right
    cx - r / 2, cy + s,    // lower-left
    cx - r, cy,            // left
    cx - r / 2, cy - s,    // upper-left
    cx - n, cy - s,        // notch: left shoulder
    cx, cy - r * 0.30,     // notch: valley (the fold)
    cx + n, cy - s,        // notch: right shoulder
    cx + r / 2, cy - s,    // upper-right
  ]).fill({ color, alpha });
}

/** Outline-only variant, for faint background hints. */
export function strokeHiveMark(g: Graphics, cx: number, cy: number, r: number, color: number, alpha: number, width = 2) {
  const s = r * 0.866, n = r * 0.22;
  g.poly([
    cx + r, cy, cx + r / 2, cy + s, cx - r / 2, cy + s, cx - r, cy,
    cx - r / 2, cy - s, cx - n, cy - s, cx, cy - r * 0.30, cx + n, cy - s, cx + r / 2, cy - s,
  ]).stroke({ width, color, alpha });
}
