// Background — themed, parallax decorative backdrop (gradient sky + moving decor).
// Cheap, art-asset-free (drawn from primitives). Themes picked from spec.meta.theme.
//   - space        -> deep gradient + drifting starfield
//   - city/run/hive -> dusk sky + Hive-red horizon glow + drifting Hive hexagons +
//                      windowed "block-tower" skyline (the flagship look — says "Hive")
//   - orchard/other -> sky gradient + drifting clouds

import { Container, Graphics } from "pixi.js";
import type { GameSpec } from "../types/spec.ts";

interface Layer { node: Container; factor: number; span: number; axis: "x" | "y"; }

const HIVE_RED = 0xe31337;

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

    const [top, mid, bot] = skyColors(theme);
    const sky = new Graphics();
    drawVGradient(sky, this.w, this.h, top, mid, bot);
    this.container.addChild(sky);

    if (theme.includes("space")) {
      this.addStars();
    } else if (theme.includes("city") || theme.includes("run") || theme.includes("hive")) {
      this.addGlow();       // Hive-red horizon sun
      this.addHexField();   // drifting Hive hexagons (far, faint)
      this.addBlockSkyline(0.18, 0x241a48, 60, 150, 0x6fd3ff); // far towers (cyan windows)
      this.addBlockSkyline(0.40, 0x130e28, 95, 250, 0xffcf6a); // near towers (amber windows)
    } else {
      this.addClouds();
    }
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

  // A soft Hive-red glow low on the horizon — the anchor of the flagship's identity.
  private addGlow() {
    const g = new Graphics();
    const cx = this.w * 0.62, cy = this.h * 0.7;
    for (let i = 7; i >= 1; i--) g.circle(cx, cy, i * 40).fill({ color: HIVE_RED, alpha: 0.045 });
    g.circle(cx, cy, 34).fill({ color: 0xff7a52, alpha: 0.55 });
    g.circle(cx, cy, 20).fill({ color: 0xffc9a0, alpha: 0.5 });
    this.container.addChild(g);
  }

  // Drifting Hive hexagons, far and faint — a quiet "blockchain honeycomb" motif.
  private addHexField() {
    const node = new Container();
    const g = new Graphics();
    for (let copy = 0; copy < 2; copy++) {
      for (let i = 0; i < 9; i++) {
        const cx = Math.random() * this.w + copy * this.w;
        const cy = 36 + Math.random() * this.h * 0.5;
        const r = 10 + Math.random() * 24;
        hexPath(g, cx, cy, r);
        g.stroke({ width: 2, color: i % 3 === 0 ? HIVE_RED : 0x6fa0ff, alpha: 0.14 });
      }
    }
    node.addChild(g);
    this.container.addChild(node);
    this.layers.push({ node, factor: 0.1, span: this.w, axis: "x" });
  }

  // A parallax row of block-towers with lit windows — reads as a stylized on-chain city.
  private addBlockSkyline(factor: number, color: number, minH: number, maxH: number, winColor: number) {
    const node = new Container();
    const g = new Graphics();
    const baseY = this.h - 120; // sit on the engine's ground line
    const seed: { x: number; w: number; h: number }[] = [];
    let x = 0;
    while (x < this.w) {
      const bw = 42 + Math.random() * 48;
      const bh = minH + Math.random() * (maxH - minH);
      seed.push({ x, w: bw, h: bh });
      x += bw + 8 + Math.random() * 26;
    }
    for (let copy = 0; copy < 2; copy++) {
      for (const b of seed) {
        const bx = b.x + copy * this.w, by = baseY - b.h;
        g.rect(bx, by, b.w, b.h).fill(color);
        g.rect(bx, by, b.w, 3).fill({ color: HIVE_RED, alpha: 0.55 }); // crisp lit roofline
        g.rect(bx, by, 2, b.h).fill({ color: 0xffffff, alpha: 0.06 }); // left edge sheen
        const cols = Math.max(2, Math.floor(b.w / 15));
        const rows = Math.max(3, Math.floor(b.h / 24));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            if (Math.random() < 0.5) continue;
            const wx = bx + 7 + c * ((b.w - 12) / cols);
            const wy = by + 10 + r * ((b.h - 14) / rows);
            g.rect(wx, wy, 4, 6).fill({ color: winColor, alpha: 0.3 + Math.random() * 0.45 });
          }
        }
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
    this.layers.push({ node, factor: 0.15, span: this.w, axis: "x" });
  }
}

function skyColors(theme: string): [number, number, number] {
  if (theme.includes("space")) return [0x0a0a24, 0x140a30, 0x241238];
  if (theme.includes("city") || theme.includes("run") || theme.includes("hive"))
    return [0x0b0e2a, 0x2a1746, 0x5a2440]; // indigo -> violet -> deep Hive-red horizon
  if (theme.includes("orchard")) return [0x74c4ff, 0xa8dcf0, 0xcdeaa4];
  return [0x141433, 0x20204a, 0x2a2a4a];
}

// hexagon path (pointy-top), used for the Hive honeycomb motif
function hexPath(g: Graphics, cx: number, cy: number, r: number) {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  g.poly(pts);
}

// smooth 3-stop vertical gradient (top -> mid at 55% -> bottom)
function drawVGradient(g: Graphics, w: number, h: number, top: number, mid: number, bot: number, bands = 60) {
  const midAt = 0.55;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1);
    const c = t < midAt ? lerpColor(top, mid, t / midAt) : lerpColor(mid, bot, (t - midAt) / (1 - midAt));
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
