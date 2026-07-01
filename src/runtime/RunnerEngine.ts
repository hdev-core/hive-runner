// RunnerEngine — the `runner` archetype: a side-scrolling endless runner.
// Character runs in place on the ground; the world scrolls right→left. Tap / Space / ↑ to JUMP.
// Jump OVER ground obstacles (hazards) and jump UP to grab floating pickups.
// Progression: survive T seconds per level; difficulty ramps scroll speed.
// Spec-driven like the others (the safety model); avatar.jump sets jump strength (hook-scalable).

import { Application, Container, Graphics, Text } from "pixi.js";
import type { GameSpec, EntityDef } from "../types/spec.ts";
import type { EngineState } from "./engineState.ts";
import { Background } from "./Background.ts";
import { attachAvatar } from "./avatar.ts";
import type { HiveFeed, BlockInfo } from "../hive/HiveFeed.ts";
import type { PostFeed, HivePost } from "../hive/PostFeed.ts";

interface Obstacle {
  gfx: Graphics;
  vx: number;
  kind: "pickup" | "hazard";
  value: number;
  w: number;
  h: number;
  special?: boolean; // block/whale coin — show a +points popup on collect
  post?: HivePost;   // post-coin — surface author + title on collect
}

interface Billboard { node: Container; vx: number; w: number; }

const GRAVITY = 1.0;

export class RunnerEngine {
  private background!: Background;
  private bg = new Graphics();
  private scene = new Container();   // billboards (post scenery), behind the gameplay layer
  private layer = new Container();
  private avatar = new Graphics();
  private hud = new Container();
  private obstacles: Obstacle[] = [];
  private billboards: Billboard[] = [];
  private billboardTimer = 1200;   // ms until the next post-billboard drifts in
  private postCoinTimer = 4200;    // ms until the next collectible post-coin
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

  private state: EngineState;
  private sx: number;
  private sy: number;
  private charX: number;
  private charY: number;
  private vy = 0;
  private grounded = true;
  private groundY: number;         // feet line
  private groundCenterY: number;   // avatar center when grounded
  private jumpV: number;
  private runPhase = 0;            // leg animation
  private runAnimAcc = 0;
  private scrollOffset = 0;

  private levelTimeMs = 0;
  private scoreExact = 0;
  private rampParamBase: number;
  private speedMult = 1;
  private spawnMult = 1;

  private onState?: (s: EngineState) => void;
  private keys = new Set<string>();
  private boundKeyDown = (e: KeyboardEvent) => { this.keys.add(e.key); if (isJumpKey(e.key)) { e.preventDefault(); this.jump(); } };
  private boundKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key);
  private boundTap = () => this.jump();

  constructor(
    private app: Application,
    private spec: GameSpec,
    bonusLives: number,
    private scoreMultiplier: number,
    onState?: (s: EngineState) => void,
    private hiveFeed?: HiveFeed,
    private postFeed?: PostFeed,
    private onToast?: (msg: string) => void,
  ) {
    this.onState = onState;
    const avatarDef = spec.entities.find((e) => e.role === "avatar");
    const base = avatarDef?.width ?? 42;
    this.sx = base;
    this.sy = Math.round(base * 1.35);
    this.jumpV = avatarDef?.jump ?? 17;
    this.charX = 96;
    this.groundY = spec.world.height - 120;
    this.groundCenterY = this.groundY - this.sy / 2;
    this.charY = this.groundCenterY;

    this.state = {
      score: 0, lives: (spec.rules.lives ?? 3) + bonusLives, level: 1,
      target: this.targetForLevel(1), caught: 0, elapsed: 0, over: false,
    };
    const rampParam = spec.rules.difficulty?.param;
    this.rampParamBase = rampParam ? this.readParam(rampParam) : 0;
  }

  mount() {
    const { app, spec } = this;
    this.background = new Background(spec);
    app.stage.addChild(this.background.container, this.bg, this.scene, this.layer, this.avatar, this.hud);

    this.drawRunner();
    this.avatar.position.set(this.charX, this.charY);

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
    app.canvas.addEventListener("pointerdown", this.boundTap);
  }

  update(deltaMS: number) {
    if (this.state.over) return;
    const dt = deltaMS;
    const f = dt / 16.667;
    this.state.elapsed += dt;

    this.tickBanner(dt);
    this.pollHive();
    this.applyDifficultyRamp();
    this.physics(f);
    this.animateRun(dt, f);
    this.background.update(dt, this.currentScrollSpeed());
    this.drawGround();
    this.moveBillboards(f); // post scenery scrolls whether playing or draining

    if (this.phase === "play") {
      this.spawnTick(dt);
      this.postSceneryTick(dt);
      this.moveAndCollide(f);
      this.levelTimeMs += dt;
      this.scoreExact += (dt / 100) * this.scoreMultiplier;
      this.state.score = Math.floor(this.scoreExact);
      if (this.levelTimeMs >= this.state.target * 1000) this.phase = "draining";
      this.syncHud();
    } else if (this.phase === "draining") {
      this.moveAndCollide(f);
      if (this.obstacles.length === 0) this.enterComplete();
    } else {
      this.completeTimer -= dt;
      if (this.completeTimer <= 0) this.beginNextLevel();
    }

    this.onState?.(this.state);
  }

  // --- jump / physics --------------------------------------------------------

  private jump() {
    if (this.state.over) return;
    if (this.grounded) { this.vy = -this.jumpV; this.grounded = false; }
  }

  // --- Hive integration: run across the chain --------------------------------

  private pollHive() {
    if (!this.hiveFeed) return;
    this.blockText.text = this.hiveFeed.blockNum ? `⛓ Hive #${this.hiveFeed.blockNum}` : "⛓ connecting…";
    const nb = this.hiveFeed.pollNewBlock();
    if (nb && this.phase === "play") this.onNewBlock(nb);
  }

  // Each real Hive block => a pulse + a floating "block coin"; a big real transfer => a golden whale coin.
  private onNewBlock(info: BlockInfo) {
    this.pulse();
    // block coin grows with the number of ops in the block (busier block = bigger reward)
    const r = Math.min(46, 15 + info.opCount * 0.9);
    const label = info.witness ? `#${info.num}\n@${info.witness}` : `#${info.num}`;
    this.spawnSpecial(30 + Math.round(info.opCount * 1.5), 0x5a9bff, label, r, this.groundY - 118, info.witness);
    if (info.topTransfer && info.topTransfer.amount >= 100) {
      const tt = info.topTransfer;
      this.spawnSpecial(160, 0xffcf3f, `TX ${Math.round(tt.amount)} ${tt.symbol}`, 22, this.groundY - 178);
    }
  }

  private spawnSpecial(value: number, color: number, label: string, r: number, y: number, avatar?: string) {
    const gfx = new Graphics().circle(0, 0, r).fill(color);
    gfx.circle(0, 0, r).stroke({ width: 2, color: 0xffffff, alpha: 0.7 });
    const t = new Text({ text: label, style: { fontFamily: "system-ui", fontSize: 12, fontWeight: "700", fill: 0xffffff, align: "center", stroke: { color: 0x081426, width: 3 } } });
    t.anchor.set(0.5); t.position.set(0, -r - 16);
    gfx.addChild(t);
    if (avatar) attachAvatar(gfx, avatar, r);
    gfx.position.set(this.spec.world.width + r + 20, y);
    this.layer.addChild(gfx);
    this.obstacles.push({ gfx, vx: -this.currentScrollSpeed(), kind: "pickup", value, w: r * 2, h: r * 2, special: true });
  }

  // --- posts in the world: billboards (scenery) + post-coins (collectible) ----

  private postSceneryTick(dt: number) {
    if (!this.postFeed) return;
    this.billboardTimer -= dt;
    if (this.billboardTimer <= 0) {
      this.spawnBillboard();
      this.billboardTimer = 4200 + Math.random() * 2600; // 4.2–6.8s apart (steadier variety)
    }
    this.postCoinTimer -= dt;
    if (this.postCoinTimer <= 0) {
      this.spawnPostCoin();
      this.postCoinTimer = 9000 + Math.random() * 5000;  // 9–14s apart
    }
  }

  // A drifting signpost showing a real fresh Hive post (or, once you log in, a post
  // from someone you follow). Pure scenery — it sits behind the action and never collides.
  private spawnBillboard() {
    const post = this.postFeed?.next();
    if (!post) return;
    const W = 194, boardH = 66;
    const boardTop = this.groundY - 214;
    const node = new Container();

    const pole = new Graphics().rect(-3, boardTop + boardH, 6, this.groundY - (boardTop + boardH)).fill({ color: 0x3a3320, alpha: 0.8 });
    const board = new Graphics()
      .roundRect(-W / 2, boardTop, W, boardH, 8).fill({ color: 0x121826, alpha: 0.9 })
      .roundRect(-W / 2, boardTop, W, boardH, 8).stroke({ width: 2, color: 0x5a9bff, alpha: 0.7 });
    node.addChild(pole, board);

    // author avatar (small) top-left of the board — draw a placeholder disc first so the
    // board looks intentional even before/if the profile image loads
    const av = new Graphics().circle(0, 0, 14).fill(0x2a3350).circle(0, 0, 14).stroke({ width: 2, color: 0x5a9bff, alpha: 0.7 });
    av.position.set(-W / 2 + 22, boardTop + 22);
    node.addChild(av);
    attachAvatar(av, post.author, 14);

    const handle = new Text({
      text: "@" + post.author + (post.community ? ` · ${post.community}` : ""),
      style: { fontFamily: "system-ui", fontSize: 10, fontWeight: "700", fill: 0x9fd3ff },
    });
    handle.position.set(-W / 2 + 42, boardTop + 8);
    const title = new Text({
      text: post.title,
      style: { fontFamily: "system-ui", fontSize: 12, fontWeight: "600", fill: 0xffffff, wordWrap: true, wordWrapWidth: W - 24, lineHeight: 15 },
    });
    title.position.set(-W / 2 + 12, boardTop + 26);
    node.addChild(handle, title);

    node.position.x = this.spec.world.width + W;
    node.alpha = 0.94;
    this.scene.addChild(node);
    this.billboards.push({ node, vx: -this.currentScrollSpeed(), w: W });
  }

  private moveBillboards(f: number) {
    for (let i = this.billboards.length - 1; i >= 0; i--) {
      const b = this.billboards[i];
      // keep billboards in step with the current world speed (they may outlive a level ramp)
      b.node.position.x += -this.currentScrollSpeed() * f;
      if (b.node.position.x + b.w < -20) { b.node.destroy(); this.billboards.splice(i, 1); }
    }
  }

  // A collectible coin carrying a real post — grab it for points and a peek at the post.
  private spawnPostCoin() {
    const post = this.postFeed?.next();
    if (!post) return;
    const r = 22;
    const gfx = new Graphics().circle(0, 0, r).fill(0xc86bff);
    gfx.circle(0, 0, r).stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
    const badge = new Text({ text: "📝", style: { fontFamily: "system-ui", fontSize: 16, align: "center" } });
    badge.anchor.set(0.5); badge.position.set(0, -r - 14);
    gfx.addChild(badge);
    attachAvatar(gfx, post.author, r);
    gfx.position.set(this.spec.world.width + r + 20, this.groundY - 118);
    this.layer.addChild(gfx);
    this.obstacles.push({ gfx, vx: -this.currentScrollSpeed(), kind: "pickup", value: 20, w: r * 2, h: r * 2, special: true, post });
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

  private physics(f: number) {
    if (!this.grounded) {
      this.vy += GRAVITY * f;
      this.charY += this.vy * f;
      if (this.charY >= this.groundCenterY) {
        this.charY = this.groundCenterY; this.vy = 0; this.grounded = true;
      }
    }
    this.avatar.position.set(this.charX, this.charY);
  }

  private animateRun(dt: number, f: number) {
    const scrollSpeed = this.currentScrollSpeed();
    this.scrollOffset = (this.scrollOffset + scrollSpeed * f) % 40;
    if (this.grounded) {
      this.runAnimAcc += dt;
      if (this.runAnimAcc >= 110) { this.runAnimAcc = 0; this.runPhase ^= 1; }
    }
    this.drawRunner();
  }

  // --- progression -----------------------------------------------------------

  private targetForLevel(level: number) { return 10 + level * 4; } // seconds

  private enterComplete() {
    this.phase = "complete";
    this.completeTimer = 1200;
    this.showBanner("Level Complete!", `Level ${this.state.level} cleared`, true);
  }

  private beginNextLevel() {
    this.phase = "play";
    this.state.level += 1;
    this.levelTimeMs = 0;
    this.state.target = this.targetForLevel(this.state.level);
    this.speedMult *= 1.08;
    this.spawnMult *= 1.12;
    for (const e of this.spawnables()) this.spawnTimers.set(e.id, this.spawnIntervalMs(e));
    this.showBanner(`Level ${this.state.level}`, "faster · busier");
  }

  // --- obstacles -------------------------------------------------------------

  private spawnables(): EntityDef[] {
    return this.spec.entities.filter((e) => e.spawn && e.spawn.pattern !== "none");
  }

  private spawnIntervalMs(e: EntityDef): number {
    const rate = Math.max(0.1, (e.spawn?.rate ?? 1) * this.spawnMult);
    return 1000 / rate;
  }

  private spawnTick(dt: number) {
    for (const e of this.spawnables()) {
      let t = (this.spawnTimers.get(e.id) ?? 0) - dt;
      if (t <= 0) {
        this.spawnObstacle(e);
        // jitter the gap (0.55x–1.8x) but never below a jump-clearable minimum for hazards
        let next = this.spawnIntervalMs(e) * (0.55 + Math.random() * 1.25);
        if (e.role === "hazard") next = Math.max(next, this.minHazardIntervalMs(e));
        t += next;
      }
      this.spawnTimers.set(e.id, t);
    }
  }

  // Minimum time between hazards so there is always room to land a jump before the next block.
  // Derived from jump air-time + the horizontal distance the player+block cover during it.
  private minHazardIntervalMs(e: EntityDef): number {
    const vx = Math.max(0.5, (e.speed ?? 4.5) * this.speedMult); // px/frame
    const airFrames = (2 * this.jumpV) / GRAVITY;                // up + down
    const clearanceFrames = airFrames + (34 + this.sx) / vx;     // + block + body widths
    return clearanceFrames * 16.667 * 1.15;                      // +15% safety buffer
  }

  private spawnObstacle(e: EntityDef) {
    const isPickup = e.role === "pickup";
    const w = isPickup ? 28 : 34;
    const h = isPickup ? 28 : 42;
    const gfx = new Graphics();
    if (isPickup) gfx.circle(0, 0, w / 2).fill(this.pickupColor());
    else gfx.roundRect(-w / 2, -h / 2, w, h, 4).fill(0x6b4a3a);
    // hazards sit on the ground; pickups float at jump height
    const y = isPickup ? this.groundY - 118 : this.groundY - h / 2;
    gfx.position.set(this.spec.world.width + w, y);
    this.layer.addChild(gfx);
    const speed = (e.speed ?? 4.5) * this.speedMult;
    this.obstacles.push({ gfx, vx: -speed, kind: isPickup ? "pickup" : "hazard", value: e.value ?? (isPickup ? 25 : 0), w, h });
  }

  private moveAndCollide(f: number) {
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const o = this.obstacles[i];
      o.gfx.position.x += o.vx * f;
      const dx = Math.abs(o.gfx.position.x - this.charX);
      const dy = Math.abs(o.gfx.position.y - this.charY);
      if (dx <= this.sx / 2 + o.w / 2 && dy <= this.sy / 2 + o.h / 2) {
        this.resolveHit(o);
        this.removeObstacle(i);
        continue;
      }
      if (o.gfx.position.x + o.w < 0) this.removeObstacle(i);
    }
  }

  private resolveHit(o: Obstacle) {
    if (o.kind === "pickup") {
      const gained = Math.round(o.value * this.scoreMultiplier);
      this.scoreExact += o.value * this.scoreMultiplier;
      this.state.score = Math.floor(this.scoreExact);
      this.flash(0x6cff8a);
      if (o.special) this.floatPoints(o.gfx.position.x, o.gfx.position.y, `+${gained}`);
      if (o.post) this.onToast?.(`📝 @${o.post.author}: ${o.post.title}`);
    } else {
      this.state.lives -= 1;
      this.flash(0xff5a5a);
      if (this.state.lives <= 0) this.gameOver();
    }
    this.syncHud();
  }

  private removeObstacle(i: number) { this.obstacles[i].gfx.destroy(); this.obstacles.splice(i, 1); }

  private gameOver() {
    this.state.over = true;
    const { width, height } = this.spec.world;
    this.overlay = new Container();
    const dim = new Graphics().rect(0, 0, width, height).fill({ color: 0x000000, alpha: 0.6 });
    const big = new Text({
      text: `Game Over\nLevel ${this.state.level} · Score ${this.state.score}`,
      style: { fill: 0xffffff, fontSize: 26, fontFamily: "system-ui", fontWeight: "800", align: "center" },
    });
    big.anchor.set(0.5); big.position.set(width / 2, height / 2);
    this.overlay.addChild(dim, big);
    this.app.stage.addChild(this.overlay);
    this.onState?.(this.state);
  }

  // --- drawing ---------------------------------------------------------------

  private currentScrollSpeed(): number {
    const haz = this.spec.entities.find((e) => e.role === "hazard");
    return (haz?.speed ?? 4.5) * this.speedMult;
  }

  private drawGround() {
    const { width, height, palette } = this.spec.world;
    const g = this.bg;
    g.clear();
    // land band
    const landColor = parseHex(palette?.[0]) ? shade(parseHex(palette![0])!, -0.35) : 0x2b3a20;
    g.rect(0, this.groundY, width, height - this.groundY).fill(landColor);
    g.rect(0, this.groundY - 3, width, 3).fill(0xffffff).alpha = 1;
    // scrolling dashes to convey motion
    for (let x = -40; x < width + 40; x += 40) {
      const px = x - this.scrollOffset;
      g.rect(px, this.groundY + 22, 20, 4).fill({ color: 0xffffff, alpha: 0.18 });
    }
  }

  private drawRunner() {
    const g = this.avatar;
    g.clear();
    const W = this.sx, H = this.sy, ox = -W / 2, oy = -H / 2;
    const body = parseHex(this.spec.world.palette?.[0]) ?? 0xe0863a;
    const skin = 0xf0c9a0, legc = 0x2c2c3a;
    const airborne = !this.grounded;
    // legs: alternate while running; tucked while airborne
    if (airborne) {
      g.roundRect(ox + W * 0.30, oy + H * 0.68, W * 0.16, H * 0.22, 3).fill(legc);
      g.roundRect(ox + W * 0.54, oy + H * 0.64, W * 0.16, H * 0.22, 3).fill(legc);
    } else if (this.runPhase === 0) {
      g.roundRect(ox + W * 0.22, oy + H * 0.70, W * 0.18, H * 0.28, 3).fill(legc);
      g.roundRect(ox + W * 0.58, oy + H * 0.72, W * 0.16, H * 0.24, 3).fill(legc);
    } else {
      g.roundRect(ox + W * 0.28, oy + H * 0.72, W * 0.16, H * 0.24, 3).fill(legc);
      g.roundRect(ox + W * 0.52, oy + H * 0.70, W * 0.18, H * 0.28, 3).fill(legc);
    }
    // torso + forward arm (running lean)
    g.roundRect(ox + W * 0.26, oy + H * 0.34, W * 0.50, H * 0.40, 5).fill(body);
    g.roundRect(ox + W * 0.66, oy + H * 0.40, W * 0.20, H * 0.14, 4).fill(body);
    // head + eyes facing right
    g.circle(W * 0.04, oy + H * 0.20, W * 0.24).fill(skin);
    g.circle(W * 0.10, oy + H * 0.17, W * 0.04).fill(0x1a1a22);
  }

  private pickupColor(): number { return parseHex(this.spec.world.palette?.[1]) ?? 0xffd23f; }

  // --- banners / hud ---------------------------------------------------------

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
    this.banner = c; this.bannerTimer = 1400; this.bannerPersist = persist;
  }

  private showBoostBanner() {
    const lines: string[] = [];
    if (this.scoreMultiplier > 1) lines.push(`score ×${this.scoreMultiplier}`);
    this.showBanner("Activity boost", lines.length ? `${lines.join("  ·  ")}  ·  higher jump` : "be active on Hive to power up");
  }

  private tickBanner(dt: number) {
    if (!this.banner) return;
    if (this.bannerPersist) { this.banner.alpha = 1; return; }
    this.bannerTimer -= dt;
    this.banner.alpha = Math.max(0, Math.min(1, this.bannerTimer / 400));
    if (this.bannerTimer <= 0) { this.banner.destroy(); this.banner = undefined; }
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

  private syncHud() {
    const mult = this.scoreMultiplier > 1 ? `  ×${this.scoreMultiplier}` : "";
    this.scoreText.text = `${this.state.score}${mult}`;
    const s = Math.floor(this.levelTimeMs / 1000);
    this.levelText.text = `Lvl ${this.state.level}  ·  ${Math.min(s, this.state.target)}/${this.state.target}s`;
    this.livesText.text = "♥".repeat(Math.max(0, this.state.lives));
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

  destroy() {
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("keyup", this.boundKeyUp);
    this.app.canvas.removeEventListener("pointerdown", this.boundTap);
    for (const o of this.obstacles) o.gfx.destroy();
    this.obstacles = [];
    for (const b of this.billboards) b.node.destroy();
    this.billboards = [];
    this.banner?.destroy();
    this.overlay?.destroy();
    this.background?.destroy();
    this.bg.destroy();
    this.scene.destroy({ children: true });
    this.layer.destroy({ children: true });
    this.avatar.destroy();
    this.hud.destroy({ children: true });
  }
}

function isJumpKey(k: string) { return k === " " || k === "ArrowUp" || k === "w" || k === "W"; }
function parseHex(s?: string): number | null {
  if (!s) return null;
  const m = s.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? null : n;
}
function shade(hex: number, amt: number): number {
  const r = Math.max(0, Math.min(255, ((hex >> 16) & 255) + amt * 255));
  const g = Math.max(0, Math.min(255, ((hex >> 8) & 255) + amt * 255));
  const b = Math.max(0, Math.min(255, (hex & 255) + amt * 255));
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
