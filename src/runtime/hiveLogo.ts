// The official Hive logo, rendered from its real brand SVG (from cryptologos.cc /
// seeklogo — viewBox 0 0 220 190). The source fill is swapped to white so each instance
// can be tinted to any colour (Graphics tint multiplies white → exact colour) and scaled
// freely. makeHiveLogo() returns a fresh Graphics that shares one parsed context (cheap).

import { Graphics, GraphicsContext } from "pixi.js";

export const HIVE_RED = 0xe31337;

// exact official paths; fill forced to white for tint-based recolouring
const HIVE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 190">' +
  '<path fill="#ffffff" d="M157.27,107.26a1,1,0,0,1,.82,1.42l-46.75,80.85a1,1,0,0,1-.82.47H81.94a.94.94,0,0,1-.81-1.42l46.75-80.85a.94.94,0,0,1,.81-.47ZM129.48,84.09a1,1,0,0,1-.82-.47L81.13,1.42A.94.94,0,0,1,81.94,0h28.58a1,1,0,0,1,.82.47l47.53,82.2a.94.94,0,0,1-.81,1.42Z"/>' +
  '<path fill="#ffffff" d="M135.13,1.42A.94.94,0,0,1,136,0h28.62a.93.93,0,0,1,.81.47l54.49,94.06a.93.93,0,0,1,0,.94l-54.49,94.06a.93.93,0,0,1-.81.47H136a.94.94,0,0,1-.82-1.42L189.34,95Zm-23.26,93.1a1,1,0,0,1,0,1L57.13,189.53a1,1,0,0,1-1.65,0L.13,95.48a1,1,0,0,1,0-1L54.87.47a1,1,0,0,1,1.65,0Z"/>' +
  "</svg>";

const VB_W = 220, VB_H = 190; // viewBox — logo fills it, centre ≈ (110, 95)

let sharedCtx: GraphicsContext | null = null;
function ctx(): GraphicsContext {
  if (!sharedCtx || (sharedCtx as any).destroyed) sharedCtx = new Graphics().svg(HIVE_SVG).context;
  return sharedCtx;
}

/** A Hive logo Graphics, `width` px wide, tinted `color`, centred on its own origin. */
export function makeHiveLogo(width: number, color: number = HIVE_RED, alpha = 1): Graphics {
  const g = new Graphics(ctx());
  g.pivot.set(VB_W / 2, VB_H / 2);
  g.scale.set(width / VB_W);
  g.tint = color;
  g.alpha = alpha;
  return g;
}
