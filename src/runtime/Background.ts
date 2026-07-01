// Background — themed, parallax decorative backdrop (gradient sky + moving decor).
// Cheap, art-asset-free (drawn from primitives). Themes picked from spec.meta.theme.
//   - space   -> gradient + drifting starfield
//   - city/run -> sunset gradient + parallax skyline (scrolls with the world)
//   - orchard/other -> sky gradient + drifting clouds + hills

import { Container, Graphics } from "pixi.js";
import type { GameSpec } from "../types/spec.ts";

interface Layer { node: Container; factor: number; span: number; axis: "x" | "y"; }

export class Background {
  container = new Container();
  private layers: Layer[] = [];
  private w: number;
  private h: number;
  private vertical: boolean;

  constructor(spec: GameSpec) {
    this.w = spec.world.width;
    this.h = spec.world.height;
    this.vertical = spec.world.orientation !== "horizontal";
    const theme = (spec.meta.theme ?? "").toLowerCase();

    const [top, bot] = skyColors(theme);
    const sky = new Graphics();
    drawVGradient(sky, this.w, this.h, top, bot);
    this.container.addChild(sky);

    if (theme.includes("space")) this.addStars();
    else if (theme.includes("city") || theme.includes("run")) this.addSkyline();
    else this.addClouds();
  }

  update(dtMs: number, worldScroll: number) {
    const f = dtMs / 16.667;
    for (const L of this.layers) {
      if (L.axis === "x") {
        L.node.x -= worldScroll * L.factor * f;
        if (L.node.x <= -L.span) L.node.x += L.span;
      } else {
        L.node.y += L.factor * f; // constant drift for vertical themes
        if (L.node.y >= L.span) L.node.y -= L.span;
      }
    }
  }

  destroy() { this.container.destroy({ children: true }); }

  // --- decor builders --------------------------------------------------------

  private addStars() {
    const node = new Container();
    const g = new Graphics();
    // two vertically-stacked copies so it wraps as it drifts down
    for (let copy = 0; copy < 2; copy++) {
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * this.w;
        const y = Math.random() * this.h + copy * this.h;
        const r = Math.random() * 1.6 + 0.4;
        g.circle(x, y, r).fill({ color: 0xffffff, alpha: 0.35 + Math.random() * 0.5 });
      }
    }
    node.addChild(g);
    node.y = -this.h;
    this.container.addChild(node);
    this.layers.push({ node, factor: this.vertical ? 0.6 : 0.4, span: this.h, axis: "y" });
  }

  private addSkyline() {
    // far (slow, dark) then near (faster, darker) building rows
    this.addBuildingRow(0.20, 0x2b3566, 0.30, 120, 60);
    this.addBuildingRow(0.45, 0x1b2140, 0.42, 190, 80);
  }

  private addBuildingRow(factor: number, color: number, yFrac: number, maxH: number, minH: number) {
    const node = new Container();
    const g = new Graphics();
    const baseY = this.h * (1 - 0.15) - 20; // sit above the engine's ground band
    // one pattern across [0,w), duplicated at +w so it tiles seamlessly
    const seed: { x: number; w: number; h: number }[] = [];
    let x = 0;
    while (x < this.w) {
      const bw = 34 + Math.random() * 46;
      const bh = minH + Math.random() * (maxH - minH);
      seed.push({ x, w: bw, h: bh });
      x += bw + 6 + Math.random() * 22;
    }
    for (let copy = 0; copy < 2; copy++) {
      for (const b of seed) {
        g.rect(b.x + copy * this.w, baseY - b.h * yFrac * 4, b.w, b.h * yFrac * 4).fill(color);
      }
    }
    node.addChild(g);
    this.container.addChild(node);
    this.layers.push({ node, factor, span: this.w, axis: "x" });
  }

  private addClouds() {
    const node = new Container();
    const g = new Graphics();
    for (let copy = 0; copy < 2; copy++) {
      for (let i = 0; i < 5; i++) {
        const cx = Math.random() * this.w + copy * this.w;
        const cy = Math.random() * this.h * 0.5 + 30;
        const s = 22 + Math.random() * 26;
        g.circle(cx, cy, s).fill({ color: 0xffffff, alpha: 0.22 });
        g.circle(cx + s * 0.8, cy + 6, s * 0.75).fill({ color: 0xffffff, alpha: 0.22 });
        g.circle(cx - s * 0.8, cy + 6, s * 0.7).fill({ color: 0xffffff, alpha: 0.22 });
      }
    }
    node.addChild(g);
    this.container.addChild(node);
    // gentle horizontal drift regardless of orientation
    this.layers.push({ node, factor: 0.15, span: this.w, axis: "x" });
  }
}

function skyColors(theme: string): [number, number] {
  if (theme.includes("space")) return [0x0a0a24, 0x241238];
  if (theme.includes("city") || theme.includes("run")) return [0x223066, 0xef9a54];
  if (theme.includes("orchard")) return [0x74c4ff, 0xcdeaa4];
  return [0x141433, 0x2a2a4a];
}

function drawVGradient(g: Graphics, w: number, h: number, top: number, bot: number, bands = 40) {
  for (let i = 0; i < bands; i++) {
    const c = lerpColor(top, bot, i / (bands - 1));
    g.rect(0, Math.floor((i * h) / bands), w, Math.ceil(h / bands) + 1).fill(c);
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
