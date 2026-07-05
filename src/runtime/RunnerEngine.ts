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
import { makeHiveLogo } from "./hiveLogo.ts";
import type { HiveFeed, BlockInfo } from "../hive/HiveFeed.ts";
import type { PostFeed, HivePost } from "../hive/PostFeed.ts";
import type { CosmeticRender } from "../cosmetics/progression.ts";
import type { TrailParams, TrailPerk } from "../cosmetics/catalog.ts";

interface Obstacle {
  gfx: Graphics;
  vx: number;
  kind: "pickup" | "hazard";
  value: number;
  w: number;
  h: number;
  special?: boolean; // block/whale coin — show a +points popup on collect
  post?: HivePost;   // post-coin — surface author + title on collect
  heal?: boolean;    // heart — restores a life (up to the run's starting max) instead of scoring
}

interface Billboard { node: Container; vx: number; w: number; }

// A ghost racer target: a REAL score to chase (your personal best, or a leaderboard rival).
// Rendered in-world as a translucent runner whose position tracks your score vs their score.
export interface RaceGhost { id: string; label: string; avatar: string; score: number; color?: number; }
interface GhostRunner { def: RaceGhost; node: Container; passed: boolean; offsetY: number; phase: number; }

const GRAVITY = 1.0;
const HIVE_RED = 0xe31337;

// Story: the run reads as a descent deeper into the chain (see docs/story.md). Level names cycle,
// each loop "deeper". Shown on level-up banners; level-complete is a Witness handoff.
const LEVEL_ARC: { name: string; sub: string }[] = [
  { name: "The Mempool", sub: "unconfirmed — keep it moving" },
  { name: "Witness Row", sub: "hand off, don't drop it" },
  { name: "The Fast Lane", sub: "the blocks are tightening" },
  { name: "Consensus Gorge", sub: "faster · busier" },
  { name: "The Deep Chain", sub: "no machine can follow you here" },
  { name: "The Long Fork", sub: "hold the line" },
];
function levelArc(level: number): { name: string; sub: string } {
  const base = LEVEL_ARC[(level - 1) % LEVEL_ARC.length];
  const loop = Math.floor((level - 1) / LEVEL_ARC.length);
  return loop === 0 ? base : { name: `${base.name} ▾${loop + 1}`, sub: "deeper into the chain" };
}

const DEFAULT_COS: CosmeticRender = {
  skin: { body: 0x2a3255, accent: HIVE_RED, skinTone: 0xf1cba2, visor: 0x74e0ff },
  parcel: { box: 0xcaa46a, twine: 0x8a6a3a },
  trail: null,
  theme: "city run",
};

// pointy-top hexagon points (the Hive motif), centered at (cx,cy)
function hexPts(cx: number, cy: number, r: number): number[] {
  const p: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    p.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  return p;
}

// per-kind emit cadence (ms between emissions) — denser for fine effects, sparser for heavy ones
const TRAIL_RATE: Record<string, number> = {
  spark: 42, ember: 48, coin: 120, ring: 120, flame: 36, hex: 80,
  comet: 26, confetti: 95, smoke: 68, bolt: 55, petal: 150, prism: 55,
};

export class RunnerEngine {
  private background!: Background;
  private bg = new Graphics();
  private scene = new Container();   // billboards (post scenery), behind the gameplay layer
  private layer = new Container();
  private avatar = new Graphics();
  private hud = new Container();
  private obstacles: Obstacle[] = [];
  private billboards: Billboard[] = [];
  private ghostLayer = new Container();  // in-world ghost racers (behind obstacles + player)
  private ghosts: GhostRunner[] = [];
  private ghostDefs: RaceGhost[];
  private raceWonFired = false;
  private trail: { gfx: Graphics; life: number; max: number; vx: number; vy: number; grav: number; spin: number; grow: number; baseAlpha: number }[] = [];
  private trailAcc = 0;
  private billboardTimer = 1200;   // ms until the next post-billboard drifts in
  private postCoinTimer = 4200;    // ms until the next collectible post-coin
  private heartTimer = 32000;      // ms until the next (rare) life-restoring heart
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
  private maxLives: number;        // heart pickups heal up to this (the run's starting life count)
  // Free-play trail perks (all no-ops in ranked/contest runs — see constructor):
  private perk: TrailPerk | null = null;
  private perkScoreMult = 1;       // scoreBonus → multiplies time score + pickups
  private perkCoinMult = 1;        // coinBonus → multiplies pickup values
  private magnetR = 0;             // magnet → pickup attraction radius (px)
  private shieldCd = 0;            // shield → recharge time (ms); 0 = no shield perk
  private shieldTimer = 0;         // ms until the shield recharges
  private shieldReady = false;     // is a hit-block available right now?
  private heartFactor = 1;         // heartBoost → scales heart spawn intervals (<1 = more often)
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
    private onPost?: (post: HivePost) => void, // fired when a post-coin is collected
    private cos: CosmeticRender = DEFAULT_COS, // equipped cosmetics (skin/parcel/trail/theme)
    ghosts: RaceGhost[] = [],                  // real-score rivals to race in-world
    private onGhostPass?: (label: string) => void,
    private onRaceWon?: () => void,
    perksEnabled = false,                      // Free-play: apply the equipped trail's perk
  ) {
    this.onState = onState;
    this.ghostDefs = ghosts;
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
    this.maxLives = this.state.lives;
    const rampParam = spec.rules.difficulty?.param;
    this.rampParamBase = rampParam ? this.readParam(rampParam) : 0;

    // Resolve the equipped trail's perk — only in Free-play; ranked runs keep everything neutral.
    this.perk = perksEnabled ? (this.cos.trail?.perk ?? null) : null;
    const p = this.perk;
    if (p?.kind === "scoreBonus") this.perkScoreMult = 1 + p.value / 100;
    else if (p?.kind === "coinBonus") this.perkCoinMult = 1 + p.value / 100;
    else if (p?.kind === "magnet") this.magnetR = p.radius;
    else if (p?.kind === "shield") { this.shieldCd = p.cooldownMs; this.shieldReady = true; }
    else if (p?.kind === "heartBoost") this.heartFactor = p.factor;
    this.heartTimer *= this.heartFactor;
  }

  mount() {
    const { app, spec } = this;
    this.background = new Background(spec, this.cos.theme);
    app.stage.addChild(this.background.container, this.bg, this.scene, this.ghostLayer, this.layer, this.avatar, this.hud);

    this.buildGhosts();
    this.drawRunner();
    this.avatar.position.set(this.charX, this.charY);
    // Hive logo on the courier parcel — a persistent child (survives the per-frame redraw),
    // positioned over the visible (left) face of the back parcel.
    const emblem = makeHiveLogo(this.sx * 0.2);
    emblem.position.set(this.sx * -0.34, this.sy * -0.055);
    this.avatar.addChild(emblem);

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

    // faint "HIVE" brand watermark (official logo + wordmark), top-right of the play field
    const wm = new Container();
    const wmMark = makeHiveLogo(22);
    wmMark.position.set(11, 8);
    const wmText = new Text({ text: "HIVE", style: { fontFamily: "system-ui", fontSize: 12, fontWeight: "800", fill: 0xffffff } });
    wmText.position.set(26, 1);
    wm.addChild(wmMark, wmText);
    wm.alpha = 0.42;
    wm.position.set(spec.world.width - 92, 42); // top-right, clear of gameplay
    this.hud.addChild(wm);

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
    this.updateGhosts();
    this.background.update(dt, this.currentScrollSpeed());
    this.drawGround();
    this.moveBillboards(f); // post scenery scrolls whether playing or draining
    this.trailTick(dt, f);  // equipped cosmetic trail

    this.shieldTick(dt); // perk shield recharges regardless of phase
    if (this.phase === "play") {
      this.spawnTick(dt);
      this.postSceneryTick(dt);
      this.heartTick(dt);
      this.magnetTick(f);
      this.moveAndCollide(f);
      this.levelTimeMs += dt;
      this.scoreExact += (dt / 100) * this.scoreMultiplier * this.perkScoreMult;
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

  // Equipped cosmetic trail: emit particles from behind the runner. Each kind has its own emit
  // cadence and per-particle motion (gravity, spin, growth), so trails feel genuinely different.
  private trailTick(dt: number, f: number) {
    const t = this.cos.trail;
    if (t) {
      this.trailAcc += dt;
      const rate = TRAIL_RATE[t.kind] ?? 45;
      if (this.trailAcc >= rate) { this.trailAcc = 0; this.emitTrail(t); }
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const p = this.trail[i];
      p.life -= dt;
      p.vy += p.grav * f;
      p.gfx.position.x += p.vx * f;
      p.gfx.position.y += p.vy * f;
      if (p.spin) p.gfx.rotation += p.spin * f;
      if (p.grow !== 1) { const s = Math.pow(p.grow, f); p.gfx.scale.set(p.gfx.scale.x * s, p.gfx.scale.y * s); }
      p.gfx.alpha = Math.max(0, (p.life / p.max) * p.baseAlpha);
      if (p.life <= 0) { p.gfx.destroy(); this.trail.splice(i, 1); }
    }
  }

  // Spawn one emission of the given trail (may be several particles for burst kinds).
  private emitTrail(t: TrailParams) {
    const bx = this.charX - this.sx * 0.36;
    const by = this.charY + this.sy * 0.15;
    const scroll = this.currentScrollSpeed();
    const rnd = () => Math.random() - 0.5;
    // push a particle: pos = base + (dx,dy), with motion + look opts
    const add = (
      gfx: Graphics, vx: number, vy: number, life: number,
      o: { dx?: number; dy?: number; grav?: number; spin?: number; grow?: number; alpha?: number; rot?: number } = {},
    ) => {
      gfx.position.set(bx + (o.dx ?? 0), by + (o.dy ?? 0));
      if (o.rot) gfx.rotation = o.rot;
      this.layer.addChildAt(gfx, 0); // behind obstacles + runner
      this.trail.push({ gfx, life, max: life, vx, vy, grav: o.grav ?? 0, spin: o.spin ?? 0, grow: o.grow ?? 1, baseAlpha: o.alpha ?? 1 });
    };
    const pick = (arr?: number[], fb = t.color) => (arr && arr.length ? arr[Math.floor(Math.random() * arr.length)] : fb);

    switch (t.kind) {
      case "ember": { // small motes that drift UP and flicker warm
        const c = Math.random() < 0.5 ? t.color : 0xffc060;
        add(new Graphics().circle(0, 0, 1.6 + Math.random() * 1.5).fill(c),
          -scroll * 0.4 + rnd() * 0.7, -0.6 - Math.random() * 0.7, 520,
          { grav: 0.006, dy: rnd() * this.sy * 0.3, alpha: 0.6 + Math.random() * 0.4 });
        break;
      }
      case "coin": { // pops up, then falls under gravity while spinning
        const g = new Graphics().circle(0, 0, 3.4).fill(t.color).circle(0, 0, 3.4).stroke({ width: 1, color: 0x8a5a10, alpha: 0.8 });
        g.circle(-1.1, -1.1, 1.3).fill({ color: 0xffffff, alpha: 0.4 });
        add(g, -scroll * 0.5, -0.7 - Math.random() * 0.4, 720, { grav: 0.08, spin: 0.12, dy: -this.sy * 0.05 });
        break;
      }
      case "ring": { // rings that expand and fade
        add(new Graphics().circle(0, 0, 3).stroke({ width: 1.6, color: t.color, alpha: 0.9 }),
          -scroll * 0.45, 0, 520, { grow: 1.045, dy: rnd() * this.sy * 0.3, alpha: 0.9 });
        break;
      }
      case "flame": { // overlapping warm blobs that rise and shrink → a lick of fire
        for (let k = 0; k < 2; k++)
          add(new Graphics().circle(0, 0, 3 + Math.random() * 3).fill({ color: pick(t.colors), alpha: 0.75 }),
            -scroll * 0.3 + rnd() * 0.9, -0.9 - Math.random() * 0.6, 340,
            { grow: 0.965, dy: rnd() * this.sy * 0.25, alpha: 0.85 });
        break;
      }
      case "hex": { // slow-spinning Hive hexes
        add(new Graphics().poly(hexPts(0, 0, 4)).stroke({ width: 1.5, color: t.color, alpha: 0.9 }),
          -scroll * 0.55, -0.1, 520, { spin: 0.05, dy: rnd() * this.sy * 0.35 });
        break;
      }
      case "comet": { // bright core + soft glow, streaking fast backward
        const g = new Graphics().circle(0, 0, 5.2).fill({ color: t.color, alpha: 0.3 }).circle(0, 0, 3).fill({ color: 0xffffff, alpha: 0.95 });
        add(g, -scroll * 0.95, -0.04, 680, { dy: rnd() * this.sy * 0.12, grow: 0.99 });
        break;
      }
      case "confetti": { // a burst of colour chips that tumble and fall
        for (let k = 0; k < 3; k++) {
          const g = new Graphics().rect(-2, -1.3, 4, 2.6).fill(pick(t.colors));
          add(g, -scroll * 0.5 + rnd() * 1.3, -0.9 - Math.random() * 0.5, 720,
            { grav: 0.07, spin: rnd() * 0.35, dy: rnd() * this.sy * 0.2, rot: Math.random() * Math.PI });
        }
        break;
      }
      case "smoke": { // expanding, slowly rising grey puffs
        add(new Graphics().circle(0, 0, 4 + Math.random() * 2).fill({ color: t.color, alpha: 0.22 }),
          -scroll * 0.5, -0.3, 780, { grow: 1.03, dy: rnd() * this.sy * 0.2, alpha: 0.9 });
        break;
      }
      case "bolt": { // short jagged lightning flickers
        const g = new Graphics();
        g.moveTo(0, 0);
        let x = 0;
        for (let s = 0; s < 4; s++) { x += 2 + Math.random() * 2.5; g.lineTo(x, rnd() * 7); }
        g.stroke({ width: 1.4, color: t.color, alpha: 0.95 });
        add(g, -scroll * 0.6, rnd() * 0.4, 190, { dy: rnd() * this.sy * 0.4 });
        break;
      }
      case "petal": { // petals that flutter down and rotate
        const g = new Graphics().ellipse(0, 0, 3.2, 1.7).fill({ color: t.color, alpha: 0.85 });
        add(g, -scroll * 0.5 + rnd() * 0.9, 0.25 + Math.random() * 0.3, 900,
          { grav: 0.004, spin: rnd() * 0.07, dy: -this.sy * 0.1, rot: Math.random() * Math.PI });
        break;
      }
      case "prism": { // a small rainbow burst with glow
        for (let k = 0; k < 2; k++) {
          const c = (t.colors ?? [t.color])[(this.trail.length + k) % (t.colors?.length ?? 1)];
          add(new Graphics().circle(0, 0, 4.4).fill({ color: c, alpha: 0.25 }).circle(0, 0, 2.7).fill(c),
            -scroll * 0.6 + rnd() * 0.9, -0.3 - Math.random() * 0.5, 520, { dy: rnd() * this.sy * 0.3 });
        }
        break;
      }
      default: { // "spark" — quick fading motes
        add(new Graphics().circle(0, 0, 2.6).fill(t.color),
          -scroll * 0.6, -0.2 - Math.random() * 0.3, 460, { dy: rnd() * this.sy * 0.4 });
      }
    }
  }

  private moveBillboards(f: number) {
    for (let i = this.billboards.length - 1; i >= 0; i--) {
      const b = this.billboards[i];
      // keep billboards in step with the current world speed (they may outlive a level ramp)
      b.node.position.x += -this.currentScrollSpeed() * f;
      if (b.node.position.x + b.w < -20) { b.node.destroy({ children: true }); this.billboards.splice(i, 1); }
    }
  }

  // --- in-world ghost racers -------------------------------------------------

  // Build a translucent runner + avatar + score label for each real-score rival.
  private buildGhosts() {
    const gw = this.sx * 0.92, gh = this.sy * 0.92;
    this.ghostDefs.forEach((def, i) => {
      const color = def.color ?? 0x9fd3ff;
      const node = new Container();
      const body = new Graphics();
      drawGhostRunner(body, gw, gh, color);
      const av = new Graphics().circle(0, 0, 13).fill(0x1a2036).circle(0, 0, 13).stroke({ width: 2, color, alpha: 0.85 });
      av.position.set(0, -gh * 0.95);
      attachAvatar(av, def.avatar, 13);
      const label = new Text({
        text: `${def.label} · ${def.score}`,
        style: { fontFamily: "system-ui", fontSize: 10, fontWeight: "700", fill: color, stroke: { color: 0x081426, width: 3 } },
      });
      label.anchor.set(0.5, 0); label.position.set(0, -gh * 0.95 + 15);
      node.addChild(body, av, label);
      this.ghostLayer.addChild(node);
      this.ghosts.push({ def, node, passed: false, offsetY: -i * 15, phase: i * 1.7 });
    });
    this.updateGhosts(); // place them for the ready scene (score 0 → all out ahead)
  }

  // Position by real score: a ghost sits far ahead when you trail its score and drifts back to
  // you as you climb; when your score passes theirs it slides off to the left (an overtake).
  private updateGhosts() {
    if (!this.ghosts.length) return;
    const laneStart = this.charX;
    const laneEnd = this.spec.world.width - 70;
    for (const g of this.ghosts) {
      const ratio = g.def.score > 0 ? this.state.score / g.def.score : 2;
      const clamped = Math.min(1.3, Math.max(0, ratio));
      g.node.position.x = laneStart + (1 - clamped) * (laneEnd - laneStart);
      g.node.position.y = this.groundCenterY + g.offsetY + Math.sin(this.state.elapsed / 160 + g.phase) * 3;
      if (!g.passed && ratio >= 1) {
        g.passed = true;
        this.onGhostPass?.(g.def.label);
        this.checkRaceWon();
      }
    }
  }

  private checkRaceWon() {
    if (this.raceWonFired || !this.ghosts.length) return;
    if (this.ghosts.every((g) => g.passed)) { this.raceWonFired = true; this.onRaceWon?.(); }
  }

  // An occasional floating heart that restores a lost life (or a few points if you're already full).
  private heartTick(dt: number) {
    this.heartTimer -= dt;
    if (this.heartTimer <= 0) {
      this.spawnHeart();
      this.heartTimer = (48000 + Math.random() * 32000) * this.heartFactor; // 48–80s (× heartBoost perk)
    }
  }

  private spawnHeart() {
    const r = 16;
    const gfx = new Graphics();
    drawHeart(gfx, r, 0xff5a7a);
    gfx.position.set(this.spec.world.width + r + 20, this.groundY - 118);
    this.layer.addChild(gfx);
    this.obstacles.push({ gfx, vx: -this.currentScrollSpeed(), kind: "pickup", value: 15, w: r * 2, h: r * 2, special: true, heal: true });
  }

  // Free-play magnet perk: nearby pickups drift toward the runner.
  private magnetTick(f: number) {
    if (!this.magnetR) return;
    for (const o of this.obstacles) {
      if (o.kind !== "pickup") continue;
      const dx = this.charX - o.gfx.position.x, dy = this.charY - o.gfx.position.y;
      const d = Math.hypot(dx, dy);
      if (d < this.magnetR && d > 1) {
        const pull = 2.8 * f;
        o.gfx.position.x += (dx / d) * pull;
        o.gfx.position.y += (dy / d) * pull;
      }
    }
  }

  // Free-play shield perk: recharge the hit-block over the cooldown.
  private shieldTick(dt: number) {
    if (!this.shieldCd || this.shieldReady) return;
    this.shieldTimer -= dt;
    if (this.shieldTimer <= 0) this.shieldReady = true;
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
      // the engine may be destroyed (Play Again / level change / game over) mid-animation,
      // which destroys `t`; bail before touching its now-null transform
      if (t.destroyed) { this.app.ticker.remove(tick); return; }
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
      if (g.destroyed) { this.app.ticker.remove(tick); return; }
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
    this.showBanner("Block delivered!", `handed off to the Witness · ${levelArc(this.state.level).name} cleared`, true);
  }

  private beginNextLevel() {
    this.phase = "play";
    this.state.level += 1;
    this.levelTimeMs = 0;
    this.state.target = this.targetForLevel(this.state.level);
    this.speedMult *= 1.08;
    this.spawnMult *= 1.12;
    for (const e of this.spawnables()) this.spawnTimers.set(e.id, this.spawnIntervalMs(e));
    const arc = levelArc(this.state.level);
    this.showBanner(arc.name, arc.sub);
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
    if (isPickup) { drawCoin(gfx, w / 2); gfx.addChild(makeHiveLogo(w * 0.62)); }
    else drawBlock(gfx, w, h);
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
      if (o.heal && this.state.lives < this.maxLives) {
        this.state.lives += 1; // replenish a lost life
        this.flash(0xff6b9a);
        this.floatPoints(o.gfx.position.x, o.gfx.position.y, "+1 ♥");
      } else {
        const mult = this.scoreMultiplier * this.perkScoreMult * this.perkCoinMult; // perks apply in Free-play only
        const gained = Math.round(o.value * mult);
        this.scoreExact += o.value * mult;
        this.state.score = Math.floor(this.scoreExact);
        this.flash(0x6cff8a);
        if (o.special) this.floatPoints(o.gfx.position.x, o.gfx.position.y, `+${gained}`);
        if (o.post) this.onPost?.(o.post);
      }
    } else if (this.shieldReady && this.shieldCd) {
      // Free-play shield perk: absorb the hit and start recharging
      this.shieldReady = false; this.shieldTimer = this.shieldCd;
      this.flash(0x8fe6ff);
      this.floatPoints(this.charX, this.charY - this.sy * 0.6, "shield!");
    } else {
      this.state.lives -= 1;
      this.flash(0xff5a5a);
      if (this.state.lives <= 0) this.gameOver();
    }
    this.syncHud();
  }

  private removeObstacle(i: number) { this.obstacles[i].gfx.destroy({ children: true }); this.obstacles.splice(i, 1); }

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

  // A dark "on-chain ledger" strip: slate band, crisp Hive-red rim + glow, a faint hex
  // grid, and scrolling cyan dashes for motion.
  private drawGround() {
    const { width, height } = this.spec.world;
    const g = this.bg;
    const gy = this.groundY;
    g.clear();
    // land band (two tones for depth)
    g.rect(0, gy, width, height - gy).fill(0x151a2e);
    g.rect(0, gy, width, 26).fill(0x1c2340);
    // crisp Hive-red rim + soft glow above it
    g.rect(0, gy - 2, width, 3).fill(HIVE_RED);
    g.rect(0, gy - 6, width, 4).fill({ color: HIVE_RED, alpha: 0.22 });
    // faint honeycomb ticks along the rim (Hive motif), scrolling with the world
    for (let x = -60; x < width + 60; x += 60) {
      const px = x - this.scrollOffset * 1.5;
      g.poly(hexPts(px, gy + 46, 12)).stroke({ width: 1.5, color: 0x3a63b0, alpha: 0.35 });
    }
    // scrolling motion dashes
    for (let x = -40; x < width + 40; x += 40) {
      const px = x - this.scrollOffset;
      g.rect(px, gy + 22, 22, 3).fill({ color: 0x6fd3ff, alpha: 0.35 });
    }
  }

  // The "Hive courier": a crisp, outlined runner carrying a Hive-branded parcel on their
  // back (a block being delivered across the chain). Legs alternate while running.
  private drawRunner() {
    const g = this.avatar;
    g.clear();
    const W = this.sx, H = this.sy, ox = -W / 2, oy = -H / 2;
    // equipped skin/parcel palette (cosmetic-only)
    const NAVY = this.cos.skin.body, ACCENT = this.cos.skin.accent, SKIN = this.cos.skin.skinTone, VISOR = this.cos.skin.visor;
    const OUT = 0x0b0e1c;
    const airborne = !this.grounded;
    const bob = Math.sin(this.state.elapsed / 90) * (H * 0.01); // subtle parcel bob

    // courier parcel on the back (drawn behind the torso) — the Hive logo sits on it (mount child)
    const px = ox + W * 0.02, py = oy + H * 0.24 + bob, pw = W * 0.36, ph = H * 0.36;
    g.roundRect(px, py, pw, ph, 3).fill(this.cos.parcel.box).stroke({ width: 2, color: OUT, alpha: 0.75 });
    g.rect(px, py + ph * 0.44, pw, 2.5).fill({ color: this.cos.parcel.twine, alpha: 0.85 });   // twine (h)
    g.rect(px + pw * 0.5 - 1, py, 2.5, ph).fill({ color: this.cos.parcel.twine, alpha: 0.85 }); // twine (v)

    // legs + Hive-red shoes
    const leg = (x: number, yTop: number, len: number) => {
      g.roundRect(x, oy + yTop, W * 0.17, len, 3).fill(NAVY).stroke({ width: 1.5, color: OUT, alpha: 0.55 });
      g.roundRect(x - 1, oy + yTop + len - 2, W * 0.24, H * 0.07, 2).fill(ACCENT).stroke({ width: 1, color: OUT, alpha: 0.5 });
    };
    if (airborne) { leg(ox + W * 0.30, H * 0.62, H * 0.22); leg(ox + W * 0.54, H * 0.58, H * 0.22); }
    else if (this.runPhase === 0) { leg(ox + W * 0.22, H * 0.66, H * 0.28); leg(ox + W * 0.56, H * 0.70, H * 0.22); }
    else { leg(ox + W * 0.30, H * 0.70, H * 0.22); leg(ox + W * 0.50, H * 0.66, H * 0.28); }

    // torso (jacket) with a Hive-red sash
    g.roundRect(ox + W * 0.26, oy + H * 0.32, W * 0.50, H * 0.42, 6).fill(NAVY).stroke({ width: 2, color: OUT, alpha: 0.7 });
    g.roundRect(ox + W * 0.42, oy + H * 0.34, W * 0.10, H * 0.38, 3).fill(ACCENT);
    // shoulder strap holding the parcel, crossing the chest
    g.moveTo(ox + W * 0.34, oy + H * 0.34).lineTo(ox + W * 0.66, oy + H * 0.66).stroke({ width: W * 0.08, color: 0x171b30, cap: "round" });

    // forward arm (swings with the run)
    const armY = airborne ? H * 0.36 : (this.runPhase === 0 ? H * 0.40 : H * 0.46);
    g.roundRect(ox + W * 0.64, oy + armY, W * 0.26, H * 0.13, 4).fill(NAVY).stroke({ width: 1.5, color: OUT, alpha: 0.6 });
    g.circle(ox + W * 0.90, oy + armY + H * 0.06, W * 0.09).fill(SKIN).stroke({ width: 1, color: OUT, alpha: 0.5 });

    // head: skin + Hive-red cap + cyan visor (facing right)
    const hx = W * 0.08, hy = oy + H * 0.18, hr = W * 0.25;
    g.circle(hx, hy, hr).fill(SKIN).stroke({ width: 2, color: OUT, alpha: 0.6 });
    g.roundRect(hx - hr - 1, hy - hr * 0.95, hr * 2 + 2, hr * 0.95, 4).fill(ACCENT).stroke({ width: 1.5, color: OUT, alpha: 0.6 });
    g.roundRect(hx - hr * 0.35, hy - hr * 0.12, hr * 1.35, hr * 0.5, 3).fill(VISOR).stroke({ width: 1, color: OUT, alpha: 0.5 });

    // Free-play shield perk: a faint aura when a hit-block is ready
    if (this.shieldReady && this.shieldCd) {
      g.ellipse(0, 0, W * 0.78, H * 0.66).stroke({ width: 2, color: 0x8fe6ff, alpha: 0.45 });
    }
  }

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
    const boost = this.scoreMultiplier > 1 ? `standing ×${this.scoreMultiplier} · ` : "";
    this.showBanner("Block sealed — run!", `${boost}deliver it to the Witness before it fades`);
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
      if (g.destroyed) { this.app.ticker.remove(tick); return; }
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
    this.ghosts = []; // ghost nodes are children of ghostLayer, destroyed below
    this.trail = []; // particle gfx are children of `layer`, destroyed below
    this.banner?.destroy();
    this.overlay?.destroy();
    this.background?.destroy();
    this.bg.destroy();
    this.scene.destroy({ children: true });
    this.ghostLayer.destroy({ children: true });
    this.layer.destroy({ children: true });
    this.avatar.destroy();
    this.hud.destroy({ children: true });
  }
}

function isJumpKey(k: string) { return k === " " || k === "ArrowUp" || k === "w" || k === "W"; }

// A hazard drawn as a crisp isometric "blockchain block": front + top + right faces,
// a Hive-red lit top edge and a cyan hex glyph — reads as an on-chain block.
function drawBlock(g: Graphics, w: number, h: number) {
  const x = -w / 2, y = -h / 2, d = 6;
  g.poly([x + w, y, x + w + d, y - d, x + w + d, y + h - d, x + w, y + h]).fill(0x151a30);         // right face
  g.poly([x, y, x + d, y - d, x + w + d, y - d, x + w, y]).fill(0x3a4472);                         // top face
  g.roundRect(x, y, w, h, 3).fill(0x272f56).stroke({ width: 2, color: 0x0b0e1c, alpha: 0.85 });    // front face
  g.rect(x + 1, y + 1, w - 2, 3).fill({ color: HIVE_RED, alpha: 0.85 });                           // lit top edge
  g.poly(hexPts(0, 2, 8)).stroke({ width: 1.5, color: 0x6fd3ff, alpha: 0.75 });                    // hex glyph
}

// A life-restoring heart: two lobes + a point, with a gloss highlight. Pink so it reads as
// distinct from the gold coins and blue block-coins.
function drawHeart(g: Graphics, r: number, color: number) {
  const k = r * 0.55;
  g.circle(-k, -k * 0.5, k).fill(color);
  g.circle(k, -k * 0.5, k).fill(color);
  g.poly([-2 * k, -k * 0.5, 2 * k, -k * 0.5, 0, r * 1.15]).fill(color);
  g.circle(-k * 0.55, -k * 0.75, k * 0.34).fill({ color: 0xffffff, alpha: 0.45 }); // gloss
}

// A translucent "ghost" runner silhouette (a rival's pace marker) with a soft aura.
function drawGhostRunner(g: Graphics, W: number, H: number, color: number) {
  const ox = -W / 2, oy = -H / 2;
  g.roundRect(ox + W * 0.22, oy + H * 0.06, W * 0.56, H * 0.92, 10).fill({ color, alpha: 0.12 }); // aura
  g.roundRect(ox + W * 0.30, oy + H * 0.70, W * 0.16, H * 0.28, 3).fill({ color, alpha: 0.42 });  // back leg
  g.roundRect(ox + W * 0.54, oy + H * 0.70, W * 0.16, H * 0.28, 3).fill({ color, alpha: 0.42 });  // front leg
  g.roundRect(ox + W * 0.28, oy + H * 0.30, W * 0.44, H * 0.44, 6).fill({ color, alpha: 0.5 });   // torso
  g.circle(ox + W * 0.5, oy + H * 0.18, W * 0.2).fill({ color, alpha: 0.6 });                     // head
}

// A pickup drawn as a glossy gold coin; the Hive logo is added as a child (see spawnObstacle).
function drawCoin(g: Graphics, r: number) {
  g.circle(0, 0, r).fill(0xffcf3f).stroke({ width: 2, color: 0x8a5a10, alpha: 0.9 });
  g.circle(-r * 0.32, -r * 0.32, r * 0.5).fill({ color: 0xffffff, alpha: 0.28 }); // gloss
}
