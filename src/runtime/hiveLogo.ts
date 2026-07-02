// The Hive logo mark, drawn from primitives to match the real brand: a solid diamond
// (rhombus) on the left followed by two bold chevrons pointing right ( ◆ » ). Used for
// the character emblem, the HUD watermark, and the drifting background hints.

import { Graphics } from "pixi.js";

export const HIVE_RED = 0xe31337;

export function drawHiveMark(g: Graphics, cx: number, cy: number, r: number, color = HIVE_RED, alpha = 1) {
  const hh = r * 0.66;   // half height of each element
  const t = r * 0.4;     // chevron stroke thickness (bold)
  const x = cx - r * 0.15; // nudge so the group looks visually centered on cx

  // diamond (left element)
  const dcx = x - r * 0.7, dw = r * 0.42;
  g.poly([dcx, cy - hh, dcx + dw, cy, dcx, cy + hh, dcx - dw, cy]).fill({ color, alpha });

  // two chevrons pointing right ( » )
  const chevron = (x0: number) =>
    g.moveTo(x0, cy - hh).lineTo(x0 + r * 0.5, cy).lineTo(x0, cy + hh)
      .stroke({ width: t, color, alpha, cap: "butt", join: "miter", miterLimit: 6 });
  chevron(x - r * 0.12);
  chevron(x + r * 0.5);
}
