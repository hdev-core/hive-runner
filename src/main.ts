import { Application } from "pixi.js";
import type { GameSpec } from "./types/spec.ts";
import { fruitRush } from "./specs/fruitRush.ts";
import { meteorDodge } from "./specs/meteorDodge.ts";
import { runnerDash } from "./specs/runnerDash.ts";
import { makeActivity } from "./activity/mockActivity.ts";
import { applyHooks } from "./runtime/hooks.ts";
import { createEngine, type ArchetypeEngine } from "./runtime/createEngine.ts";
import type { EngineState } from "./runtime/FallingEngine.ts";
import { HiveFeed } from "./hive/HiveFeed.ts";
import { PostFeed, type HivePost } from "./hive/PostFeed.ts";
import { getGhosts, getCommunities } from "./hive/HiveSocial.ts";
import { postScore } from "./hive/HiveAuth.ts";
import { RaceStrip } from "./race/RaceStrip.ts";
import { CONTEST, weekId, msUntilWeekEnd, formatCountdown, type LeaderboardFile } from "./contest.ts";

const $ = (id: string) => document.getElementById(id)!;

const SPECS: Record<string, GameSpec> = { fruitRush, meteorDodge, runnerDash };
let currentSpec: GameSpec = runnerDash; // flagship game opens by default

// --- DOM refs ---------------------------------------------------------------
const host = $("stage-host");
const manaSlider = $("mana-slider") as HTMLInputElement;
const opsSlider = $("ops-slider") as HTMLInputElement;
const stepsSlider = $("steps-slider") as HTMLInputElement;
const gameSelect = $("game-select") as HTMLSelectElement;
const vBlock = $("v-block");
const vOps = $("v-ops");

// live, read-only Hive block feed — drives the block ticker, pulse, and on-chain event spawns
const hiveFeed = new HiveFeed();
hiveFeed.onBlock = (info) => {
  vBlock.textContent = `#${info.num}`;
  vOps.textContent = `@${info.witness || "?"} · ${info.opCount} ops · ${info.transfers} xfer · ${info.posts} posts${info.topTransfer ? ` · top ${Math.round(info.topTransfer.amount)} ${info.topTransfer.symbol}` : ""}`;
};
hiveFeed.start();

// live, read-only stream of real Hive posts -> background billboards + collectible post-coins.
// Starts on the global fresh-post firehose; switches to the player's own feed once they log in.
const postFeed = new PostFeed();
postFeed.start();
const vBaseline = $("v-baseline");
const vActivity = $("v-activity");
const vBonusFeed = $("v-bonus");
const vEnergy = $("v-energy");
const vBonusLives = $("v-bonuslives");
const vBasket = $("v-basket");
const vScoreMult = $("v-scoremult");

// surface any fatal error on-screen instead of a blank canvas
function showFatal(msg: string) {
  host.innerHTML = `<div style="color:#ff9a9a;background:#1a1420;border:1px solid #402;border-radius:12px;padding:18px 20px;max-width:440px;font-size:13px;line-height:1.5">⚠️ ${msg}</div>`;
}
window.addEventListener("unhandledrejection", (e) => showFatal("Startup error: " + ((e.reason && e.reason.message) || e.reason)));
window.addEventListener("error", (e) => showFatal("Startup error: " + e.message));

// --- Hive social: ghost racers (#3) + community teams (#4) -------------------
const hiveUser = $("hive-user") as HTMLInputElement;
const communitySelect = $("community-select") as HTMLSelectElement;
const postScoreBtn = $("post-score") as HTMLButtonElement;
const overlayBtn = $("playagain") as HTMLButtonElement; // contextual: Start / Resume / Play again
const startBtn = $("start-btn") as HTMLButtonElement;
const pauseBtn = $("pause-btn") as HTMLButtonElement;
const hiveStatus = $("hive-status");
const teamRow = $("team-row");
const toast = $("toast");
const race = new RaceStrip($("race-strip"), 300);

// --- weekly sponsored contest: leaderboard card (read-only, fed by the indexer) --------
const contestEl = $("contest");
const contestWeekEl = $("contest-week");
const contestCountEl = $("contest-count");
const contestPrizeEl = $("contest-prize");
const contestListEl = $("contest-list") as HTMLOListElement;
const contestEmptyEl = $("contest-empty");
const contestNote = $("contest-note");
let leaderboard: LeaderboardFile | null = null;

const openContest = () => contestEl.classList.add("open");
$("contest-toggle").addEventListener("click", () => contestEl.classList.toggle("open"));
contestPrizeEl.textContent = CONTEST.prizeText;

async function loadLeaderboard() {
  const override = new URLSearchParams(location.search).get("lb"); // dev: point at a test source
  const url = override || CONTEST.dataUrl;
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`, { cache: "no-store" });
    leaderboard = await res.json();
  } catch {
    leaderboard = null;
  }
  renderContest();
}

function renderContest() {
  const week = weekId();
  contestWeekEl.textContent = "· " + week;
  const rows = leaderboard?.contests?.[week] ?? [];
  contestListEl.innerHTML = "";
  contestEmptyEl.style.display = rows.length ? "none" : "block";
  rows.slice(0, CONTEST.topN).forEach((r, i) => {
    const li = document.createElement("li");
    li.className = "lb-row" + (hiveAccount && r.account === hiveAccount ? " me" : "");
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : String(i + 1);
    li.innerHTML =
      `<span class="lb-rank">${medal}</span>` +
      `<img src="https://images.hive.blog/u/${r.account}/avatar" alt="" loading="lazy" />` +
      `<span class="lb-name">@${r.account}</span>` +
      `<span class="lb-score">${r.score.toLocaleString()}</span>`;
    contestListEl.appendChild(li);
  });
  // if the player is logged in but off the visible top-N, show their standing
  if (hiveAccount && rows.length) {
    const idx = rows.findIndex((r) => r.account === hiveAccount);
    contestNote.textContent = idx >= 0
      ? `You're #${idx + 1} of ${rows.length} this week — best ${rows[idx].score.toLocaleString()}.`
      : "You're not on this week's board yet — post a score to enter.";
  }
}

// live countdown to Monday 00:00 UTC
function tickCountdown() { contestCountEl.textContent = formatCountdown(msUntilWeekEnd()); }
tickCountdown();
setInterval(tickCountdown, 30000);
void loadLeaderboard();

let hiveAccount = "";
let lastScore = 0;
let lastGameOver = false;
let lastRaceMs = -1;
let started = false;   // has the current run begun?
let paused = false;
let overlayMode: "start" | "resume" | "playagain" | "none" = "none";

function showToast(msg: string) {
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

// Post-coin pickup → a distinct, clickable "you discovered a Hive post" toast.
// Clicking opens the real post on peakd in a new tab (content-discovery while you run).
const postToast = $("post-toast") as HTMLAnchorElement;
let postToastTimer: number | undefined;
function showPostToast(post: HivePost) {
  postToast.href = post.permlink
    ? `https://peakd.com/@${post.author}/${post.permlink}`
    : `https://peakd.com/@${post.author}`;
  postToast.innerHTML =
    `<img src="https://images.hive.blog/u/${post.author}/avatar" alt="" />` +
    `<span class="pt-txt">📝 <span class="pt-name">@${post.author}</span> · ${escapeHtml(post.title)}</span>` +
    `<span class="pt-go">open ↗</span>`;
  postToast.classList.add("show");
  clearTimeout(postToastTimer);
  postToastTimer = window.setTimeout(() => postToast.classList.remove("show"), 4000);
}
function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
// Opening a post steals focus — auto-pause a running game so the player doesn't die while reading.
$("post-toast").addEventListener("click", () => {
  if (started && !paused && !lastGameOver) togglePause();
});
function updatePostBtn() { postScoreBtn.disabled = !(lastGameOver && hiveAccount); }

function setOverlay(mode: "start" | "resume" | "playagain" | "none") {
  overlayMode = mode;
  if (mode === "none") { overlayBtn.style.display = "none"; return; }
  overlayBtn.textContent = mode === "start" ? "▶ Start" : mode === "resume" ? "▶ Resume" : "↻ Play again";
  overlayBtn.style.display = "block";
}
function updatePauseBtn() {
  pauseBtn.disabled = !started || lastGameOver;
  pauseBtn.textContent = paused ? "▶ Resume" : "⏸ Pause";
}
function beginPlay() { started = true; paused = false; setOverlay("none"); updatePauseBtn(); }
function resumePlay() { paused = false; setOverlay("none"); updatePauseBtn(); }
function togglePause() {
  if (!started || lastGameOver) return;
  paused = !paused;
  setOverlay(paused ? "resume" : "none");
  updatePauseBtn();
}

async function loadHive(user: string) {
  if (!user) return;
  hiveStatus.textContent = "loading…";
  try {
    const ghosts = await getGhosts(user, 6);
    race.setGhosts(
      ghosts,
      (name) => showToast(`🏁 Passed @${name}!`),
      () => showToast("🏆 You beat your Hive friends to the line!"),
    );
    race.setPlayerAvatar(user);
    postFeed.setAccount(user); // billboards + post-coins now surface posts from accounts you follow
    hiveAccount = user;
    const comms = await getCommunities(user);
    communitySelect.innerHTML = "";
    for (const c of comms.slice(0, 20)) {
      const o = document.createElement("option");
      o.value = c.name; o.textContent = c.title;
      communitySelect.appendChild(o);
    }
    teamRow.style.display = "inline-flex";
    hiveStatus.textContent = ghosts.length ? `@${user} · racing ${ghosts.length} rivals` : `@${user} · (no follows to race)`;
    renderContest(); // highlight the player's row / standing now that we know who they are
    updatePostBtn();
  } catch {
    hiveStatus.textContent = "couldn't load @" + user;
  }
}

const cleanName = (s: string) => s.trim().replace(/^@/, "").toLowerCase();
$("hive-load").addEventListener("click", () => loadHive(cleanName(hiveUser.value)));
hiveUser.addEventListener("keydown", (e) => { if (e.key === "Enter") loadHive(cleanName(hiveUser.value)); });
postScoreBtn.addEventListener("click", async () => {
  if (!hiveAccount) return;
  postScoreBtn.disabled = true;
  hiveStatus.textContent = "posting score…";
  const r = await postScore(hiveAccount, communitySelect.value, lastScore, currentSpec.meta.title, weekId());
  hiveStatus.textContent = r.ok ? "score posted on-chain ✓" : "post failed: " + (r.error ?? "");
  showToast(r.ok ? "✓ Score entered in this week's contest" : "Post failed");
  if (r.ok) {
    contestNote.textContent = "⏳ Your run is on-chain — you'll appear on the board within ~15 min (next indexer run).";
    openContest();
    setTimeout(() => void loadLeaderboard(), 20000); // optimistic re-check
  }
  updatePostBtn();
});
overlayBtn.addEventListener("click", () => {
  if (overlayMode === "playagain") start(true);
  else if (overlayMode === "resume") resumePlay();
  else beginPlay();
});
startBtn.addEventListener("click", () => { if (!started && !lastGameOver) beginPlay(); else start(true); });
pauseBtn.addEventListener("click", () => togglePause());
{
  const p = new URLSearchParams(location.search).get("hive");
  if (p) { hiveUser.value = p; void loadHive(cleanName(p)); }
}

// --- Pixi app + game lifecycle ---------------------------------------------
const app = new Application();
let engine: ArchetypeEngine | null = null;

// NOTE: no top-level await — that deadlocks Pixi's async init in the Vite prod bundle
// (works in dev, hangs in build). Boot is a fire-and-forget async function instead.
async function boot() {
  try {
    await app.init({
      width: currentSpec.world.width,
      height: currentSpec.world.height,
      background: parseBg(currentSpec.world.palette?.[2]) ?? 0x101018,
      antialias: true,
      preference: "webgl", // WebGL is universally stable; WebGPU can fail to init on some GPUs
    });
  } catch (err) {
    showFatal("Renderer failed to start: " + ((err as Error)?.message ?? String(err)));
    return;
  }
  host.appendChild(app.canvas);
  host.appendChild(overlayBtn); // keep the button in the host, layered above the canvas
  // tap the game to start / resume / restart (mobile-friendly); this listener runs before the
  // engine's jump listener, so stopImmediatePropagation prevents an accidental jump.
  app.canvas.addEventListener("pointerdown", (e) => {
    if (lastGameOver) { e.stopImmediatePropagation(); start(true); }
    else if (!started) { e.stopImmediatePropagation(); beginPlay(); }
    else if (paused) { e.stopImmediatePropagation(); resumePlay(); }
  });
  // canvas fits the remaining flex space automatically (CSS max-width/height keep aspect)

  // dev panel (mock activity sliders) is hidden from players; show with ?dev=1
  if (new URLSearchParams(location.search).get("dev") === "1") {
    $("panel").style.display = "block";
    $("app").style.height = "auto"; // let the page scroll to reach the dev panel
    contestEl.classList.add("open"); // show the contest card expanded while developing
  }

  // Pixi's RAF loop; the engine only advances when a run is started and not paused
  app.ticker.add((t) => { if (engine && started && !paused) engine.update(t.deltaMS); });

  $("apply-btn").addEventListener("click", () => start(true));
  $("restart-btn").addEventListener("click", () => start(true));
  gameSelect.addEventListener("change", () => {
    currentSpec = SPECS[gameSelect.value] ?? fruitRush;
    start(true);
  });

  start(false); // set up the flagship game in a "ready" state — press Start to play
  const qp = new URLSearchParams(location.search);
  if (qp.get("play") === "1") beginPlay(); // dev: skip the Start overlay
  if (qp.get("pt") === "1") showPostToast({ author: "yalloveme", permlink: "sample", title: "NOT EVERY CROWN BELONGS TO A KING", community: "Hive" }); // dev: preview the post toast
}

function start(autostart = false) {
  // tear down previous run
  engine?.destroy();
  app.stage.removeChildren();

  // reset the race for the new run
  race.reset();
  lastGameOver = false;
  lastRaceMs = -1;
  paused = false;
  started = autostart;
  updatePostBtn();

  $("game-title").textContent = currentSpec.meta.title;
  $("archetype-label").textContent = currentSpec.meta.archetype;
  $("hint").textContent = currentSpec.meta.archetype === "runner"
    ? "Tap, Space or ↑ to jump — clear rocks, grab coins"
    : "Move with pointer or ← → keys";
  app.renderer.background.color = parseBg(currentSpec.world.palette?.[2]) ?? 0x101018;

  const activity = makeActivity({
    ops24h: Number(opsSlider.value),
    manaPct: Number(manaSlider.value),
    steps: Number(stepsSlider.value),
  });
  const applied = applyHooks(currentSpec, activity);

  // update the live debug panel
  const b = activity.breakdown;
  vBaseline.textContent = `+${b.baseline}`;
  vActivity.textContent = `+${b.activity}`;
  vBonusFeed.textContent = `+${b.bonus}`;
  vEnergy.textContent = `${activity.energy}  ·  vitality ${(activity.vitality * 100).toFixed(0)}%`;
  vBonusLives.textContent = `+${applied.bonusLives}`;
  vBasket.textContent = `×${applied.basketWidthFactor}`;
  vScoreMult.textContent = `×${applied.scoreMultiplier}`;

  engine = createEngine(app, applied.effectiveSpec, applied.bonusLives, applied.scoreMultiplier, onState, hiveFeed, postFeed, showPostToast);
  engine.mount();

  setOverlay(autostart ? "none" : "start"); // show "▶ Start" over the ready scene
  updatePauseBtn();
}

function onState(s: EngineState) {
  if (s.over || s.elapsed - lastRaceMs >= 100) { race.update(s.score, s.elapsed); lastRaceMs = s.elapsed; }
  if (s.over && !lastGameOver) {
    lastGameOver = true;
    lastScore = s.score;
    setOverlay("playagain");
    updatePauseBtn();
    updatePostBtn();
  }
}

void boot();

function parseBg(s?: string): number | null {
  if (!s) return null;
  const n = parseInt(s.replace("#", ""), 16);
  return Number.isNaN(n) ? null : n;
}
