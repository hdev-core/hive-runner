// FallingEngine — fixed runtime for the "moving obstacles + dodging/catching avatar" family.
// Drives catcher + dodger from the spec, in EITHER orientation:
//   - world.orientation "vertical"  : objects fall top→bottom, avatar moves left↔right (bottom).
//   - world.orientation "horizontal": objects travel right→left, avatar moves up↕down (left side).
// Progression: scoring.primary "pickups" -> catch N; "survival_time" -> survive T seconds.
// The spec only PARAMETERIZES this engine (the safety model).

import { Application, Container, Graphics, Text } from "pixi.js";
import type { GameSpec, EntityDef } from "../types/spec.ts";
import type { EngineState } from "./engineState.ts";
import { Background } from "./Background.ts";
import { attachAvatar } from "./avatar.ts";
import type { HiveFeed, BlockInfo } from "../hive/HiveFeed.ts";
export type { EngineState };

interface Falling {
  gfx: Graphics;
  vx: number;
  vy: number;
  kind: "pickup" | "hazard";
  value: number;
  w: number;
  h: number;
  special?: boolean; // block/whale coin — show a +points popup on collect
}

export class FallingEngine {
  private background!: Background;
  private layer = new Container();
  private hud = new Container();
  private avatar = new Graphics();
  private falling: Falling[] = [];
  private spawnTimers = new Map<string, number>();
  private scoreText!: Text;
  private livesText!: Text;
  private levelText!: Text;
  private blockText!: Text;
  private overlay?: Container;
  private banner?: Container;
  private bannerTimer = 0;
  private bannerPersist = false;
  private phase: "play" | "draining" | "complete" = "play";
  private completeTimer = 0;

  private mode: "count" | "time";
  private horizontal: boolean;
  private levelTimeMs = 0;
  private scoreExact = 0;

  private state: EngineState;
  private sx: number;            // avatar footprint width
  private sy: number;            // avatar footprint height
  private isCharacter: boolean;
  private avatarX: number;
  private avatarY: number;
  private rampParamBase: number;
  private spawnMult = 1;
  private speedMult = 1;

  private onState?: (s: EngineState) => void;
  private keys = new Set<string>();
  private boundKeyDown = (e: KeyboardEvent) => this.keys.add(e.key);
  private boundKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key);
  private boundPointer = (e: PointerEvent) => this.onPointer(e);

  constructor(
    private app: Application,
    private spec: GameSpec,
    bonusLives: number,
    private scoreMultiplier: number,
    onState?: (s: EngineState) => void,
    private hiveFeed?: HiveFeed,
  ) {
    this.onState = onState;
    this.mode = spec.rules.scoring.primary === "survival_time" ? "time" : "count";
    this.horizontal = spec.world.orientation === "horizontal";

    const avatarDef = spec.entities.find((e) => e.role === "avatar");
    this.isCharacter = (avatarDef?.sprite ?? "") !== "basket";
    const base = avatarDef?.width ?? (this.isCharacter ? 42 : 86);
    this.sx = base;
    this.sy = this.isCharacter ? Math.round(base * 1.35) : 26;

    // fixed vs moving coordinate depends on orientation
    if (this.horizontal) {
      this.avatarX = 56;
      this.avatarY = spec.world.height / 2;
    } else {
      this.avatarX = spec.world.width / 2;
      this.avatarY = spec.world.height - 46;
    }

    this.state = {
      score: 0,
      lives: (spec.rules.lives ?? 3) + bonusLives,
      level: 1,
      caught: 0,
      target: this.targetForLevel(1),
      elapsed: 0,
      over: false,
    };
    const rampParam = spec.rules.difficulty?.param;
    this.rampParamBase = rampParam ? this.readParam(rampParam) : 0;
  }

  mount() {
    const { app, spec } = this;
    this.background = new Background(spec);
    app.stage.addChild(this.background.container);
    app.stage.addChild(this.layer);
    app.stage.addChild(this.hud);

    this.drawAvatar();
    this.layer.addChild(this.avatar);

    const style = { fill: 0xffffff, fontSize: 18, fontFamily: "system-ui", fontWeight: "700" } as const;
    this.scoreText = new Text({ text: "0", style });
    this.scoreText.position.set(12, 10);
    this.levelText = new Text({ text: "", style: { ...style, fontSize: 14, fill: 0x9fd3ff } });
    this.levelText.anchor.set(0.5, 0);
    this.levelText.position.set(spec.world.width / 2, 12);
    this.livesText = new Text({ text: "", style: { ...style, fill: 0xff6b6b } });
    this.livesText.anchor.set(1, 0);
    this.livesText.position.set(spec.world.width - 12, 10);
    this.blockText = new Text({ text: "⛓ connecting…", style: { ...style, fontSize: 12, fill: 0x9fd3ff } });
    this.blockText.position.set(12, 34);
    this.hud.addChild(this.scoreText, this.levelText, this.livesText, this.blockText);

    for (const e of this.spawnables()) this.spawnTimers.set(e.id, this.spawnIntervalMs(e));
    this.syncHud();
    this.showBoostBanner();

    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("keyup", this.boundKeyUp);
    app.canvas.addEventListener("pointermove", this.boundPointer);
    app.canvas.addEventListener("pointerdown", this.boundPointer);
  }

  update(deltaMS: number) {
    if (this.state.over) return;
    const dt = deltaMS;
    const f = dt / 16.667;
    this.state.elapsed += dt;

    this.tickBanner(dt);
    this.pollHive();
    this.handleKeyboard(f);
    this.applyDifficultyRamp();
    this.background.update(dt, 1.5); // gentle drift (no world scroll in vertical games)

    if (this.phase === "play") {
      this.spawnTick(dt);
      this.moveAndCollide(f);
      if (this.mode === "time" && this.phase === "play") {
        this.levelTimeMs += dt;
        this.scoreExact += (dt / 100) * this.scoreMultiplier;
        this.state.score = Math.floor(this.scoreExact);
        if (this.levelTimeMs >= this.state.target * 1000) this.phase = "draining";
        this.syncHud();
      }
    } else if (this.phase === "draining") {
      this.moveAndCollide(f);
      if (this.falling.length === 0) this.enterComplete();
    } else {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.beginNextLevel();
    }

    this.onState?.(this.state);
  }

  // --- progression -----------------------------------------------------------

  private targetForLevel(level: number) {
    return this.mode === "time" ? 10 + level * 4 : 6 + level * 2;
  }

  private onCatch() {
    this.state.caught += 1;
    if (this.mode === "count" && this.phase === "play" && this.state.caught >= this.state.target) {
      this.phase = "draining";
    }
  }

  private enterComplete() {
    this.phase = "complete";
    this.completeTimer = 1200;
    this.showBanner("Level Complete!", `Level ${this.state.level} cleared`, true);
  }

  private beginNextLevel() {
    this.phase = "play";
    this.state.level += 1;
    this.state.caught = 0;
    this.levelTimeMs = 0;
    this.state.target = this.targetForLevel(this.state.level);
    this.speedMult *= 1.08;
    this.spawnMult *= 1.12;
    for (const e of this.spawnables()) this.spawnTimers.set(e.id, this.spawnIntervalMs(e));
    this.showBanner(`Level ${this.state.level}`, "faster · busier");
  }

  // --- helpers ---------------------------------------------------------------

  private spawnables(): EntityDef[] {
    return this.spec.entities.filter((e) => e.spawn && e.spawn.pattern !== "none");
  }

  private spawnIntervalMs(e: EntityDef): number {
    const rate = Math.max(0.1, (e.spawn?.rate ?? 1) * this.spawnMult);
    return 1000 / rate;
  }

  private applyDifficultyRamp() {
    const d = this.spec.rules.difficulty;
    if (!d) return;
    const sec = this.state.elapsed / 1000;
    let factor = 0;
    switch (d.curve) {
      case "flat": factor = 0; break;
      case "linear": factor = d.rampPerSec * sec; break;
      case "step": factor = d.rampPerSec * Math.floor(sec / 5) * 5; break;
      case "ease_in": factor = d.rampPerSec * sec * sec * 0.1; break;
    }
    this.writeParam(d.param, this.rampParamBase + factor);
  }

  private handleKeyboard(f: number) {
    const v = (this.spec.entities.find((e) => e.role === "avatar")?.speed ?? 10) * f;
    if (this.horizontal) {
      if (this.keys.has("ArrowUp")) this.avatarY -= v;
      if (this.keys.has("ArrowDown")) this.avatarY += v;
    } else {
      if (this.keys.has("ArrowLeft")) this.avatarX -= v;
      if (this.keys.has("ArrowRight")) this.avatarX += v;
    }
    this.clampAvatar();
  }

  private onPointer(e: PointerEvent) {
    const rect = this.app.canvas.getBoundingClientRect();
    if (this.horizontal) {
      const scaleY = this.spec.world.height / rect.height;
      this.avatarY = (e.clientY - rect.top) * scaleY;
    } else {
      const scaleX = this.spec.world.width / rect.width;
      this.avatarX = (e.clientX - rect.left) * scaleX;
    }
    this.clampAvatar();
  }

  private clampAvatar() {
    this.avatarX = Math.max(this.sx / 2, Math.min(this.spec.world.width - this.sx / 2, this.avatarX));
    this.avatarY = Math.max(this.sy / 2, Math.min(this.spec.world.height - this.sy / 2, this.avatarY));
    this.avatar.position.set(this.avatarX, this.avatarY);
  }

  private spawnTick(dt: number) {
    for (const e of this.spawnables()) {
      let t = (this.spawnTimers.get(e.id) ?? 0) - dt;
      if (t <= 0) { this.spawnFalling(e); t += this.spawnIntervalMs(e); }
      this.spawnTimers.set(e.id, t);
    }
  }

  // --- Hive integration ------------------------------------------------------

  private pollHive() {
    if (!this.hiveFeed) return;
    this.blockText.text = this.hiveFeed.blockNum ? `⛓ Hive #${this.hiveFeed.blockNum}` : "⛓ connecting…";
    const nb = this.hiveFeed.pollNewBlock();
    if (nb && this.phase === "play") this.onNewBlock(nb);
  }

  private onNewBlock(info: BlockInfo) {
    this.pulse();
    // block coin grows with the number of ops in the block (busier block = bigger reward)
    const r = Math.min(44, 15 + info.opCount * 0.9);
    const label = info.witness ? `#${info.num}\n@${info.witness}` : `#${info.num}`;
    this.spawnBlockItem(30 + Math.round(info.opCount * 1.5), 0x5a9bff, label, r, info.witness);
    if (info.topTransfer && info.topTransfer.amount >= 100) {
      const tt = info.topTransfer;
      this.spawnBlockItem(160, 0xffcf3f, `TX ${Math.round(tt.amount)} ${tt.symbol}`, 20);
    }
  }

  private spawnBlockItem(value: number, color: number, label: string, r: number, avatar?: string) {
    const gfx = new Graphics().circle(0, 0, r).fill(color);
    gfx.circle(0, 0, r).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
    const t = new Text({ text: label, style: { fontFamily: "system-ui", fontSize: 12, fontWeight: "700", fill: 0xffffff, align: "center", stroke: { color: 0x081426, width: 3 } } });
    t.anchor.set(0.5); t.position.set(0, -r - 16);
    gfx.addChild(t);
    if (avatar) attachAvatar(gfx, avatar, r);
    const { width, height } = this.spec.world;
    const speed = 4.5 * this.speedMult;
    if (this.horizontal) {
      gfx.position.set(width + r + 20, this.rand(r, height - r));
      this.falling.push({ gfx, vx: -speed, vy: 0, kind: "pickup", value, w: r * 2, h: r * 2, special: true });
    } else {
      gfx.position.set(this.rand(r, width - r), -r);
      this.falling.push({ gfx, vx: 0, vy: speed, kind: "pickup", value, w: r * 2, h: r * 2, special: true });
    }
    this.layer.addChild(gfx);
  }

  // floating "+points" so it's clear you earn game points (not the labeled HIVE amount)
  private floatPoints(x: number, y: number, text: string) {
    const t = new Text({ text, style: { fontFamily: "system-ui", fontSize: 18, fontWeight: "800", fill: 0x8dff9e, stroke: { color: 0x0a2010, width: 3 } } });
    t.anchor.set(0.5); t.position.set(x, y);
    this.hud.addChild(t);
    let life = 750;
    const tick = (d: { deltaMS: number }) => {
      life -= d.deltaMS;
      t.y -= 0.6 * (d.deltaMS / 16.667);
      t.alpha = Math.max(0, life / 750);
      if (life <= 0) { this.app.ticker.remove(tick); t.destroy(); }
    };
    this.app.ticker.add(tick);
  }

  private pulse() {
    const g = new Graphics()
      .rect(2, 2, this.spec.world.width - 4, this.spec.world.height - 4)
      .stroke({ width: 4, color: 0x5a9bff, alpha: 0.9 });
    this.hud.addChild(g);
    let life = 520;
    const tick = (d: { deltaMS: number }) => {
      life -= d.deltaMS; g.alpha = Math.max(0, life / 520);
      if (life <= 0) { this.app.ticker.remove(tick); g.destroy(); }
    };
    this.app.ticker.add(tick);
  }

  private spawnFalling(e: EntityDef) {
    const isPickup = e.role === "pickup";
    const w = isPickup ? 30 : 32;
    const h = isPickup ? 30 : 32;
    const gfx = new Graphics();
    const color = this.colorFor(e);
    if (isPickup) gfx.circle(0, 0, w / 2).fill(color);
    else gfx.roundRect(-w / 2, -h / 2, w, h, 5).fill(color);
    const speed = (e.speed ?? 4) * this.speedMult;
    const { width, height } = this.spec.world;
    if (this.horizontal) {
      gfx.position.set(width + w, this.rand(h, height - h));
      this.falling.push({ gfx, vx: -speed, vy: 0, kind: isPickup ? "pickup" : "hazard", value: e.value ?? (isPickup ? 10 : 0), w, h });
    } else {
      gfx.position.set(this.rand(w, width - w), -h);
      this.falling.push({ gfx, vx: 0, vy: speed, kind: isPickup ? "pickup" : "hazard", value: e.value ?? (isPickup ? 10 : 0), w, h });
    }
    this.layer.addChild(gfx);
  }

  private moveAndCollide(f: number) {
    const { width, height } = this.spec.world;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const o = this.falling[i];
      o.gfx.position.x += o.vx * f;
      o.gfx.position.y += o.vy * f;

      // AABB overlap with avatar (orientation-agnostic)
      const dx = Math.abs(o.gfx.position.x - this.avatarX);
      const dy = Math.abs(o.gfx.position.y - this.avatarY);
      if (dx <= this.sx / 2 + o.w / 2 && dy <= this.sy / 2 + o.h / 2) {
        this.resolveHit(o);
        this.removeFalling(i);
        continue;
      }
      // off the far edge
      const gone = this.horizontal ? o.gfx.position.x + o.w < 0 : o.gfx.position.y - o.h > height;
      if (gone || o.gfx.position.x - o.w > width) this.removeFalling(i);
    }
  }

  private resolveHit(o: Falling) {
    if (o.kind === "pickup") {
      const outcome = this.spec.entities.find((e) => e.role === "pickup")?.onCollect;
      if (outcome === "score_add") {
        this.scoreExact += o.value * this.scoreMultiplier;
        this.state.score = Math.floor(this.scoreExact);
        if (o.special) this.floatPoints(o.gfx.position.x, o.gfx.position.y, `+${Math.round(o.value * this.scoreMultiplier)}`);
      } else if (outcome === "gain_life") this.state.lives += 1;
      this.flash(0x6cff8a);
      this.onCatch();
    } else {
      const outcome = this.spec.entities.find((e) => e.role === "hazard")?.onHit;
      if (outcome === "lose_life") {
        this.state.lives -= 1;
        this.flash(0xff5a5a);
        if (this.state.lives <= 0) this.gameOver();
      }
    }
    this.syncHud();
  }

  private removeFalling(i: number) {
    this.falling[i].gfx.destroy();
    this.falling.splice(i, 1);
  }

  private gameOver() {
    this.state.over = true;
    const { width, height } = this.spec.world;
    this.overlay = new Container();
    const dim = new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.6 });
    const big = new Text({
      text: `Game Over\nLevel ${this.state.level} · Score ${this.state.score}`,
      style: { fill: 0xffffff, fontSize: 26, fontFamily: "system-ui", fontWeight: "800", align: "center" },
    });
    big.anchor.set(0.5);
    big.position.set(width / 2, height / 2);
    this.overlay.addChild(dim, big);
    this.app.stage.addChild(this.overlay);
    this.onState?.(this.state);
  }

  // --- banners ---------------------------------------------------------------

  private showBanner(title: string, sub: string, persist = false) {
    this.banner?.destroy();
    const { width, height } = this.spec.world;
    const c = new Container();
    const t = new Text({ text: title, style: { fill: 0xffffff, fontSize: 34, fontFamily: "system-ui", fontWeight: "800", align: "center" } });
    t.anchor.set(0.5); t.position.set(width / 2, height / 2 - 14);
    const s = new Text({ text: sub, style: { fill: 0x9fd3ff, fontSize: 15, fontFamily: "system-ui", align: "center" } });
    s.anchor.set(0.5); s.position.set(width / 2, height / 2 + 18);
    c.addChild(t, s);
    this.hud.addChild(c);
    this.banner = c;
    this.bannerTimer = 1400;
    this.bannerPersist = persist;
  }

  private showBoostBanner() {
    const lines: string[] = [];
    if (this.scoreMultiplier > 1) lines.push(`score ×${this.scoreMultiplier}`);
    this.showBanner("Activity boost", lines.length ? lines.join("  ·  ") : "be active on Hive to power up");
  }

  private tickBanner(dt: number) {
    if (!this.banner) return;
    if (this.bannerPersist) { this.banner.alpha = 1; return; }
    this.bannerTimer -= dt;
    this.banner.alpha = Math.max(0, Math.min(1, this.bannerTimer / 400));
    if (this.bannerTimer <= 0) { this.banner.destroy(); this.banner = undefined; }
  }

  // --- drawing / util --------------------------------------------------------

  private drawAvatar() {
    const g = this.avatar;
    const bodyColor = parseHex(this.spec.world.palette?.[0]) ?? 0x5a7bd8;
    if (this.isCharacter) {
      this.drawCharacter(g, this.sx, this.sy, bodyColor);
    } else {
      g.roundRect(-this.sx / 2, -this.sy / 2, this.sx, this.sy, 6).fill(bodyColor);
    }
    g.position.set(this.avatarX, this.avatarY);
  }

  // a simple humanoid drawn from primitives (no art assets in Stage 1)
  private drawCharacter(g: Graphics, W: number, H: number, body: number) {
    const ox = -W / 2, oy = -H / 2;
    const skin = 0xf0c9a0, legs = 0x2c2c3a;
    // legs
    g.roundRect(ox + W * 0.30, oy + H * 0.70, W * 0.16, H * 0.28, 3).fill(legs);
    g.roundRect(ox + W * 0.54, oy + H * 0.70, W * 0.16, H * 0.28, 3).fill(legs);
    // torso
    g.roundRect(ox + W * 0.24, oy + H * 0.34, W * 0.52, H * 0.42, 5).fill(body);
    // arms
    g.roundRect(ox + W * 0.10, oy + H * 0.36, W * 0.14, H * 0.32, 4).fill(body);
    g.roundRect(ox + W * 0.76, oy + H * 0.36, W * 0.14, H * 0.32, 4).fill(body);
    // head
    g.circle(0, oy + H * 0.20, W * 0.24).fill(skin);
    // eyes (face the play direction: right in horizontal, forward otherwise)
    const ex = this.horizontal ? W * 0.10 : 0;
    g.circle(ex - W * 0.06, oy + H * 0.18, W * 0.035).fill(0x1a1a22);
    g.circle(ex + W * 0.08, oy + H * 0.18, W * 0.035).fill(0x1a1a22);
  }

  private colorFor(e: EntityDef): number {
    const pal = this.spec.world.palette ?? [];
    if (e.role === "pickup") return parseHex(pal[1]) ?? 0xffd23f;
    if (e.role === "hazard") return 0x4a4a55;
    return 0xffffff;
  }

  private flash(color: number) {
    const g = new Graphics().rect(0, 0, this.spec.world.width, this.spec.world.height).fill({ color, alpha: 0.18 });
    this.hud.addChildAt(g, 0);
    let life = 160;
    const tick = (delta: { deltaMS: number }) => {
      life -= delta.deltaMS;
      g.alpha = Math.max(0, life / 160) * 0.18;
      if (life <= 0) { this.app.ticker.remove(tick); g.destroy(); }
    };
    this.app.ticker.add(tick);
  }

  private syncHud() {
    const mult = this.scoreMultiplier > 1 ? `  ×${this.scoreMultiplier}` : "";
    this.scoreText.text = `${this.state.score}${mult}`;
    if (this.mode === "time") {
      const s = Math.floor(this.levelTimeMs / 1000);
      this.levelText.text = `Lvl ${this.state.level}  ·  ${Math.min(s, this.state.target)}/${this.state.target}s`;
    } else {
      const prog = Math.min(this.state.caught, this.state.target);
      this.levelText.text = `Lvl ${this.state.level}  ·  ${prog}/${this.state.target}`;
    }
    this.livesText.text = "♥".repeat(Math.max(0, this.state.lives));
  }

  private readParam(path: string): number {
    const parts = path.split(".");
    let obj: any = this.spec.entities.find((e) => e.id === parts[0]);
    for (let i = 1; i < parts.length; i++) obj = obj?.[parts[i]];
    return typeof obj === "number" ? obj : 0;
  }

  private writeParam(path: string, value: number) {
    const parts = path.split(".");
    let obj: any = this.spec.entities.find((e) => e.id === parts[0]);
    for (let i = 1; i < parts.length - 1; i++) obj = obj?.[parts[i]];
    if (obj) obj[parts[parts.length - 1]] = value;
  }

  private rand(min: number, max: number) { return min + Math.random() * (max - min); }

  destroy() {
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.app.canvas.removeEventListener("pointermove", this.boundPointer);
    this.app.canvas.removeEventListener("pointerdown", this.boundPointer);
    for (const o of this.falling) o.gfx.destroy();
    this.falling = [];
    this.banner?.destroy();
    this.overlay?.destroy();
    this.background?.destroy();
    this.layer.destroy({ children: true });
    this.hud.destroy({ children: true });
  }
}

function parseHex(s?: string): number | null {
  if (!s) return null;
  const m = s.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? null : n;
}
