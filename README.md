# Hive Runner 🏃‍⛓️

An arcade game that literally **runs across the Hive blockchain**. You play a Hive courier
delivering blocks while real on-chain activity streams past you — live blocks, real witnesses,
freshly-published posts, and the accounts you follow racing alongside you. Your **real Hive
activity powers your run**, and you compete on an **on-chain weekly leaderboard**.

**▶ Play the live demo: https://hdev-core.github.io/hive-runner/**

Built with Vite + TypeScript + PixiJS v8. 100% client-side (static site); the only "backend" is a
scheduled GitHub Action that indexes scores. No gambling — every reward is skill/effort/content based.

---

## Table of contents
- [Features](#features)
- [How it works](#how-it-works)
- [The weekly contest & indexer](#the-weekly-contest--indexer)
- [Project structure](#project-structure)
- [Running locally](#running-locally)
- [Deployment](#deployment)
- [URL parameters](#url-parameters-dev--sharing)
- [Configuration](#configuration)
- [Tech stack](#tech-stack)
- [Roadmap](#roadmap)

---

## Features

### 🎮 Gameplay
- **Endless runner** — tap / Space / ↑ to jump; clear "blockchain block" hazards and grab coins.
- **Levels** — survive N seconds to advance; each level ramps scroll speed and spawn density, with a
  graceful drain → "Level complete" → next-level flow (no items cut off mid-air).
- **Start / Pause / Play again** — the game loads in a *ready* state; a contextual overlay button and a
  control row handle Start, Pause/Resume, and restart. Tap the canvas also works (mobile-friendly).
- **Jump-clearable spawns** — hazard spacing has a computed minimum gap so every block is always
  clearable, with randomized jitter so it never feels metronomic.
- Three games ship behind the same engines: **Runner Dash** (flagship), **Fruit Rush** (catcher),
  **Meteor Dodge** (dodger).

### ⛓️ Live on-chain integration (read-only, no auth)
- **Live block feed** — polls the Hive head block every 3s, parses its real operations, and turns each
  new block into an in-game event: a screen pulse + a **block coin** whose size scales with the block's
  op count.
- **Witness avatars** — each block coin shows the **block producer's profile picture** (routed through a
  CORS image proxy for WebGL) and handle.
- **Whale coins** — a real large transfer (≥100 HIVE/HBD) spawns a golden coin labeled with the amount
  (points awarded are shown as a green `+N` so it's never confused with "earning" that transfer).

### 📝 Posts in the game
- **Billboards** — real freshly-published Hive posts drift by as background signposts (author avatar +
  title). Once you log in, the source switches to **posts from accounts you follow**.
- **Post-coins** — collectible coins carrying a real post; grabbing one pops a **clickable discovery
  toast** that opens the post on peakd (the game auto-pauses so you don't die while reading).

### 🏁 Social & competition
- **Ghost racers** — a DOM race strip pits **YOU** against the accounts you follow; each rival's pace is
  derived from their real Hive activity. Overtake toasts fire as you pass them; first to the finish
  (score 300) gets a celebration.
- **Community teams** — pick one of your subscribed communities to represent when you post a score.

### 🏆 Weekly contest (on-chain leaderboard)
- Posting a score writes a **signed `custom_json`** to Hive; a scheduled indexer aggregates all scores
  into a **weekly leaderboard** (see [below](#the-weekly-contest--indexer)).
- A collapsible **Weekly Contest** card shows the current week, a live UTC countdown, prize terms,
  medal-ranked standings with avatars, and your own rank.

### 🔑 Identity & real energy
- **Keychain login** — proves account ownership by signing a challenge, then **persists your session**
  (auto-restores on return). A read-only "Load" fallback works without Keychain.
- **Live energy** — your **RC/mana %**, **on-chain ops in the last 24h**, and **today's Actifit steps**
  are read from chain and combined into an **energy** score (⚡ N/15). Energy grants **bonus lives**, a
  **higher jump**, and a **score multiplier** — so being active on Hive genuinely powers your run.

### 🎨 Hive identity & visuals
- Dusk **on-chain city** background: Hive-red horizon glow, parallax windowed **block-towers**, and
  drifting **official Hive logos**.
- A dark **"ledger" ground** with a Hive-red rim, honeycomb ticks, and scrolling motion dashes.
- The **Hive courier** character: outlined runner carrying a Hive-branded **parcel** (a block being
  delivered), with a shoulder strap and running animation.
- The **official Hive logo** (rendered from its brand SVG, tinted/scaled) appears on the parcel, the
  pickup coins, drifting in the background, and as a "HIVE" watermark.

---

## How it works

The architecture is a clean split: **Hive is the live data source**, a **deterministic Pixi engine** is
the game, and the **DOM is just the shell** (HUD, buttons, race strip, contest card).

```
                 read-only public Hive nodes (JSON-RPC)
                 rc_api · condenser_api · block_api · bridge
                          │
   ┌──────────────────────┼───────────────────────────────┐
   │            │              │             │             │
 HiveFeed    PostFeed     HiveSocial     HiveEnergy     HiveAuth
 (blocks)    (posts)      (follows/     (RC/ops/       (Keychain
   │           │           communities)  steps)         login+post)
   │           │              │             │             │
   └─────► main.ts (orchestrator) ◄─────────┴─────────────┘
                          │
        makeActivity(energy) → applyHooks(spec) → createEngine(spec)
                          │
            ┌─────────────┴─────────────┐
        RunnerEngine              FallingEngine
        (runner)                  (catcher / dodger)
                          │
                     PixiJS canvas
```

- **Spec-driven engines.** Each game is a declarative `GameSpec` (`src/types/spec.ts`) interpreted by a
  fixed engine — no code generation, no `eval`. `createEngine()` maps an archetype to its engine.
- **Activity → gameplay.** `makeActivity()` turns energy inputs into an energy/vitality snapshot;
  `applyHooks()` maps that to concrete modifiers (lives, jump strength, score multiplier) before a run.
- **Energy source.** Logged in → **real** reads via `HiveEnergy.ts`. Guest / `?dev=1` → mock sliders.
- **Signing.** Only score posts and login use Hive Keychain (active/posting stays in the extension —
  no keys touch this code). Everything else is read-only.

---

## The weekly contest & indexer

The leaderboard is on-chain and aggregated with **zero dedicated server** — the "indexer" is a
scheduled GitHub Action that commits a JSON file the client reads.

1. **Submit** — "Post score" broadcasts a `custom_json` (id `hive-runner`, v0.2):
   ```json
   { "app": "hive-runner/0.2", "action": "score", "game": "Runner Dash",
     "community": "hive-1XXXXX", "score": 312, "contest": "2026-W27", "ts": 1782900000 }
   ```
2. **Index** — `.github/workflows/indexer.yml` runs `indexer/index.mjs` every ~15 min: it streams new
   blocks (`block_api.get_block_range`), extracts `hive-runner` score ops, buckets each into the contest
   week of its **block timestamp** (tamper-resistant — a spoofed `contest` field can't move a score), keeps
   each account's **best per week**, and commits `data/leaderboard.json` + `indexer/state.json`.
3. **Read** — the client fetches `data/leaderboard.json` via the raw GitHub URL (CORS-enabled, ~5-min
   cache) and renders the standings. Indexer commits use `[skip ci]` and `deploy.yml` ignores `data/**`,
   so leaderboard updates never trigger a site redeploy.
4. **Payout** — prizes are paid **manually** to the top scorers each week (no smart contract).

> Because scores are Keychain-signed `custom_json`, the leaderboard is tamper-proof by construction.

---

## Project structure

```
src/
  main.ts                 orchestrator: DOM shell, login/session, energy, contest card, lifecycle
  types/spec.ts           GameSpec types (the declarative game format)
  specs/                  game specs: runnerDash, fruitRush, meteorDodge
  runtime/
    createEngine.ts       archetype → engine factory
    RunnerEngine.ts       the `runner` archetype (jump physics, parcel courier, block hazards)
    FallingEngine.ts      the `catcher` + `dodger` archetypes (CatcherEngine.ts re-exports it)
    engineState.ts        shared EngineState
    Background.ts         themed parallax backdrop (block-city + Hive hexes/logos)
    hiveLogo.ts           official Hive logo, rendered from brand SVG (tintable/scalable)
    avatar.ts             witness/author avatars via CORS image proxy
    hooks.ts              maps activity → gameplay modifiers
  activity/mockActivity.ts  hybrid energy formula (+ guest/dev fallback inputs)
  hive/
    HiveFeed.ts           live head-block poller + op parser
    PostFeed.ts           real-post stream (firehose / your feed) for billboards + post-coins
    HiveSocial.ts         follows → ghost racers; communities → teams
    HiveEnergy.ts         real energy reads (RC/mana, 24h ops, Actifit steps)
    HiveAuth.ts           Keychain login + score custom_json
  race/RaceStrip.ts       DOM race vs the accounts you follow
  contest.ts              contest config + ISO-week/countdown helpers
indexer/
  index.mjs               block-streaming score indexer (runs in CI)
  state.json              checkpoint + best-score-per-week map (committed by CI)
data/leaderboard.json     public standings (committed by CI, fetched by the client)
.github/workflows/
  deploy.yml              build + deploy to GitHub Pages on push to main
  indexer.yml             scheduled contest indexer (cron */15m)
```

---

## Running locally

Requires Node 20+.

```bash
npm install
npm run dev       # Vite dev server (hot reload)
# or
npm run build     # type-check + production bundle → dist/
npm run preview   # serve the production build
```

Run the indexer once locally (streams the live chain, writes `data/leaderboard.json`):

```bash
node indexer/index.mjs
```

> ⚠️ Verify production behavior in a **real/headless browser**, not just `curl` — a top-level `await` on
> Pixi init works in dev but hangs in the prod bundle, and `curl` returns 200 even when the canvas is
> blank. Boot is a fire-and-forget async function for exactly this reason.

---

## Deployment

Pushing to `main` triggers `deploy.yml` → builds and publishes to **GitHub Pages**. `vite.config.ts`
sets `base: "./"` so it works from a subpath. The contest indexer runs on its own schedule and commits
data without redeploying the site.

---

## URL parameters (dev & sharing)

| Param | Effect |
|---|---|
| `?hive=<user>` | Auto-load a Hive account (overrides the saved session) — handy for sharing/verification |
| `?dev=1` | Show the mock-energy sliders panel and expand the contest card |
| `?play=1` | Skip the Start overlay and auto-start a run |
| `?pt=1` | Preview the post-discovery toast |
| `?lb=<url>` | Override the leaderboard data source (point at a staging/test file) |

---

## Configuration

- **Contest** — prize text, top-N, and the leaderboard data URL live in `src/contest.ts` (`CONTEST`).
- **Hive nodes** — each `hive/*.ts` module lists public API nodes and rotates on failure.
- **Energy formula** — caps and ratios (RC baseline, ops-per-energy, steps-per-energy) live in
  `src/activity/mockActivity.ts`.
- **Images** — avatars/logos are proxied through `wsrv.nl` for WebGL CORS. For production you should
  **self-host a CORS image proxy** rather than depend on a third party.

---

## Tech stack

- **[PixiJS v8](https://pixijs.com/)** — WebGL rendering (async `Application.init`, `Graphics`, SVG,
  `GraphicsContext` sharing, ticker loop).
- **[Vite 6](https://vitejs.dev/) + TypeScript 5** (strict, `esnext` target for top-level await support).
- **Hive** — public JSON-RPC (`rc_api`, `condenser_api`, `block_api`, `bridge`), Hive Keychain for
  signing, `custom_json` as a free on-chain event log.
- **GitHub Actions + Pages** — CI build/deploy and the scheduled score indexer.

---

## Roadmap

Making it genuinely **lucrative to Hive users** requires a real value inflow (reward pool, sponsors, or a
token market) — all skill/effort/content based, never wagering. Planned, in order:

1. **Sponsor-funded contests** — data-driven contest config with sponsor slots (logo in-game, funded
   pot, daily + weekly windows); sponsorships are the sustainable inflow. *(scores already indexed)*
2. **Daily streaks + quests** — consecutive-day play and simple on-chain quests with escalating rewards.
3. **Referrals + team pots** — referral credit in the score op; community-team pooled leaderboards.
4. **Delegation-for-boosts** — delegate HP for in-game perks; that stake also powers curation payouts.

Also considered: **play-to-post** (finishing posts an earning run-card) and **curation-through-play**
(upvote the posts you collect).

---

*Not affiliated with an official Hive team. "Hive" and the Hive logo belong to the Hive community.*
