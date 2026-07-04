import { Application } from "pixi.js";
import type { GameSpec } from "./types/spec.ts";
import { runnerDash } from "./specs/runnerDash.ts";
import { makeActivity, type ActivityInputs } from "./activity/mockActivity.ts";
import { applyHooks } from "./runtime/hooks.ts";
import { createEngine, type ArchetypeEngine } from "./runtime/createEngine.ts";
import type { RaceGhost } from "./runtime/RunnerEngine.ts";
import type { EngineState } from "./runtime/FallingEngine.ts";
import { HiveFeed } from "./hive/HiveFeed.ts";
import { PostFeed, type HivePost } from "./hive/PostFeed.ts";
import { getGhosts, getCommunities, getCommunityRacers } from "./hive/HiveSocial.ts";
import { postScore, login, hasKeychain } from "./hive/HiveAuth.ts";
import { getEnergyInputs } from "./hive/HiveEnergy.ts";
import { CONTEST, weekId, msUntilWeekEnd, formatCountdown, type LeaderboardFile } from "./contest.ts";
import { markPlayed, recordRun, getStreak, getQuests, getDailyBonusLives } from "./daily.ts";
import { resolveCosmetics, applyRun, getLevelInfo, ownedIds, getEquipped, equip, getMilestones } from "./cosmetics/progression.ts";
import { byType, byId, unlockLabel, TYPES, type CosmeticType } from "./cosmetics/catalog.ts";

const $ = (id: string) => document.getElementById(id)!;

const currentSpec: GameSpec = runnerDash; // single flagship game

// --- DOM refs ---------------------------------------------------------------
const host = $("stage-host");
const manaSlider = $("mana-slider") as HTMLInputElement;
const opsSlider = $("ops-slider") as HTMLInputElement;
const stepsSlider = $("steps-slider") as HTMLInputElement;
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
const loginBtn = $("login-btn") as HTMLButtonElement;
const logoutBtn = $("logout") as HTMLButtonElement;
const energyEl = $("energy");
const hiveStatus = $("hive-status");
const teamRow = $("team-row");
const toast = $("toast");

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

// --- wardrobe (cosmetics/progression) ---------------------------------------
const wardrobeEl = $("wardrobe");
const wardrobeLevel = $("wardrobe-level");
const wardrobeXp = $("wardrobe-xp");
const wardrobeXpFill = $("wardrobe-xpfill");
const wardrobeTabs = $("wardrobe-tabs");
const wardrobeGrid = $("wardrobe-grid");
let wardrobeTab: CosmeticType = "skin";
const TAB_LABELS: Record<CosmeticType, string> = { skin: "Skins", parcel: "Parcels", trail: "Trails", theme: "Themes" };
$("wardrobe-toggle").addEventListener("click", () => wardrobeEl.classList.toggle("open"));

function renderWardrobe() {
  const li = getLevelInfo();
  wardrobeLevel.textContent = `Lv ${li.level}`;
  wardrobeXp.textContent = `${li.intoLevel}/${li.forNext} XP`;
  wardrobeXpFill.style.width = `${Math.round((li.intoLevel / li.forNext) * 100)}%`;
  wardrobeTabs.innerHTML = "";
  for (const t of TYPES) {
    const b = document.createElement("button");
    b.className = "wtab" + (t === wardrobeTab ? " active" : "");
    b.textContent = TAB_LABELS[t];
    b.onclick = () => { wardrobeTab = t; renderWardrobe(); };
    wardrobeTabs.appendChild(b);
  }
  const owned = ownedIds();
  const eq = getEquipped();
  wardrobeGrid.innerHTML = "";
  for (const c of byType(wardrobeTab)) {
    const isOwned = owned.has(c.id);
    const isEq = eq[wardrobeTab] === c.id;
    const d = document.createElement("div");
    d.className = `witem ${c.rarity}${isEq ? " equipped" : ""}${isOwned ? "" : " locked"}`;
    d.innerHTML = `<span class="wname">${c.name}</span><span class="wmeta">${isEq ? "✓ equipped" : isOwned ? "tap to equip" : "🔒 " + unlockLabel(c.unlock)}</span>`;
    if (!isOwned) {
      d.onclick = () => showToast(`🔒 ${c.name} — unlock: ${unlockLabel(c.unlock)}`); // explain why nothing changed
    } else if (!isEq) {
      d.onclick = () => {
        if (!equip(wardrobeTab, c.id)) return;
        renderWardrobe();
        // apply immediately when not mid-run (ready OR game-over → rebuild the preview);
        // mid-run it takes effect on the next run
        if (!started || lastGameOver) { start(false); showToast(`Equipped ${c.name}`); }
        else showToast(`Equipped ${c.name} — applies next run`);
      };
    }
    wardrobeGrid.appendChild(d);
  }
}
renderWardrobe();

// live countdown to Monday 00:00 UTC
function tickCountdown() { contestCountEl.textContent = formatCountdown(msUntilWeekEnd()); }
tickCountdown();
setInterval(tickCountdown, 30000);
void loadLeaderboard();

// --- daily streaks + quests -------------------------------------------------
const questsEl = $("quests");
const streakChip = $("streak-chip");
const questsCountEl = $("quests-count");
const questsListEl = $("quests-list") as HTMLUListElement;
const questsNote = $("quests-note");
$("quests-toggle").addEventListener("click", () => questsEl.classList.toggle("open"));

function renderQuests() {
  const streak = getStreak();
  streakChip.textContent = `🔥 ${streak}`;
  streakChip.title = `${streak}-day streak`;
  const quests = getQuests();
  const done = quests.filter((q) => q.done).length;
  questsCountEl.textContent = `${done}/${quests.length}`;
  questsListEl.innerHTML = "";
  for (const q of quests) {
    const li = document.createElement("li");
    li.className = "quest" + (q.done ? " done" : "");
    const pct = Math.round((q.progress / q.target) * 100);
    li.innerHTML =
      `<span class="qx">${q.done ? "✅" : "◻️"}</span>` +
      `<span class="qlabel">${q.label}</span>` +
      `<span class="qbar"><span class="qfill" style="width:${pct}%"></span></span>` +
      `<span class="qnum">${Math.min(q.progress, q.target)}/${q.target}</span>`;
    questsListEl.appendChild(li);
  }
  const bonus = getDailyBonusLives();
  questsNote.textContent = bonus > 0
    ? `Streak + quests give you +${bonus} bonus ${bonus === 1 ? "life" : "lives"} each run 🎁`
    : "Keep a daily streak and finish quests to earn bonus lives.";
}
renderQuests();

let hiveAccount = "";
let realEnergy: ActivityInputs | null = null; // live on-chain energy inputs when logged in
let postCoinsThisRun = 0; // for the "collect N post-coins" daily quest
let lastScore = 0;
let lastGameOver = false;
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
  postCoinsThisRun++; // a post-coin was just collected (drives a daily quest)
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
function beginPlay() {
  started = true; paused = false; setOverlay("none"); updatePauseBtn();
  const { streak, increased } = markPlayed(); // count today's play toward the streak
  if (increased) { showToast(`🔥 ${streak}-day streak!`); renderQuests(); }
}
function resumePlay() { paused = false; setOverlay("none"); updatePauseBtn(); }
function togglePause() {
  if (!started || lastGameOver) return;
  paused = !paused;
  setOverlay(paused ? "resume" : "none");
  updatePauseBtn();
}

// In-world ghost racing: you chase REAL scores rendered as translucent runners on the track —
// your personal best + the leaderboard rival one rank above you, plus (when a Team is picked)
// the top-scoring member of that pool who's on the weekly board. Overtakes fire these toasts.
const FOLLOWS_OPT = "__follows__";
const onGhostPass = (label: string) => showToast(`🏁 Passed ${label}!`);
const onRaceWon = () => showToast("🏆 You beat every rival's score!");
let teamMembers: string[] = []; // accounts in the selected Team pool (follows or a community)

// Assemble up to 3 real-score ghosts to chase, nearest target first. No real score → no ghost.
function computeGhosts(): RaceGhost[] {
  const out: RaceGhost[] = [];
  const seen = new Set<string>();
  const add = (g: RaceGhost) => { if (!seen.has(g.id)) { seen.add(g.id); out.push(g); } };

  const best = getMilestones().bestScore;
  if (best > 0) add({ id: "pb", label: "Your best", avatar: hiveAccount || "null", score: best, color: 0x8dff9e });

  const rows = leaderboard?.contests?.[weekId()] ?? [];
  if (rows.length) {
    // the rival one rank above you (or the lowest entry, if you're not yet on the board / a guest)
    const idx = hiveAccount ? rows.findIndex((r) => r.account === hiveAccount) : -1;
    const rival = idx > 0 ? rows[idx - 1] : rows[rows.length - 1];
    if (rival && rival.account !== hiveAccount) add({ id: "lb:" + rival.account, label: "@" + rival.account, avatar: rival.account, score: rival.score, color: 0x5a9bff });
    // the top-scoring member of the selected Team pool (the Team dropdown's real effect)
    if (teamMembers.length) {
      const top = rows.find((r) => teamMembers.includes(r.account) && r.account !== hiveAccount);
      if (top) add({ id: "lb:" + top.account, label: "@" + top.account + " ⭐", avatar: top.account, score: top.score, color: 0xffcf3f });
    }
  }
  // first-timer with no real targets yet: a neutral goal line (not a fabricated person)
  if (!out.length) add({ id: "goal", label: "Goal", avatar: "null", score: 250, color: 0x9fd3ff });

  return out.sort((a, b) => a.score - b.score).slice(0, 3);
}

async function loadHive(user: string) {
  if (!user) return;
  hiveStatus.textContent = "loading…";
  try {
    const follows = await getGhosts(user, 6);
    teamMembers = follows.map((g) => g.name); // default Team pool = accounts you follow
    postFeed.setAccount(user); // billboards + post-coins now surface posts from accounts you follow
    hiveAccount = user;
    const comms = await getCommunities(user);
    communitySelect.innerHTML = "";
    // first option keeps the default pool (your follows); picking a community swaps the pool
    const followOpt = document.createElement("option");
    followOpt.value = FOLLOWS_OPT; followOpt.textContent = "My follows";
    communitySelect.appendChild(followOpt);
    for (const c of comms.slice(0, 20)) {
      const o = document.createElement("option");
      o.value = c.name; o.textContent = c.title;
      communitySelect.appendChild(o);
    }
    teamRow.style.display = "inline-flex";
    hiveStatus.textContent = `@${user} · racing your best + rivals`;
    localStorage.setItem("hiverunner_account", user); // persist session
    logoutBtn.style.display = "inline-block";
    renderContest(); // highlight the player's row / standing now that we know who they are
    updatePostBtn();
    void loadEnergy(user); // real on-chain energy powers the next run
  } catch {
    hiveStatus.textContent = "couldn't load @" + user;
  }
}

// Switching the Team dropdown swaps the rival pool: "My follows" → accounts you follow;
// a community → that community's recent active posters. Posting still targets the community.
// The pool's top-scoring member (if on the board) becomes a ghost you race next run.
async function switchTeam() {
  if (!hiveAccount) return;
  const val = communitySelect.value;
  const label = val === FOLLOWS_OPT ? "your follows" : (communitySelect.options[communitySelect.selectedIndex]?.text ?? val);
  hiveStatus.textContent = `loading ${label}…`;
  try {
    const pool = val === FOLLOWS_OPT ? await getGhosts(hiveAccount, 6) : await getCommunityRacers(val, 6);
    teamMembers = pool.map((g) => g.name);
    hiveStatus.textContent = `@${hiveAccount} · rivals from ${label}`;
    if (!started || lastGameOver) start(false); // refresh the ready-scene ghosts to the new pool
  } catch {
    hiveStatus.textContent = `couldn't load ${label}`;
  }
}
communitySelect.addEventListener("change", () => void switchTeam());

// Read the player's live Hive energy (RC/mana + 24h ops + Actifit steps) and show it.
async function loadEnergy(user: string) {
  try {
    energyEl.style.display = "inline-flex";
    energyEl.textContent = "⚡ …";
    realEnergy = await getEnergyInputs(user);
    const a = makeActivity(realEnergy);
    energyEl.textContent = `⚡ ${a.energy}/15 · ${Math.round(a.vitality * 100)}%`;
    energyEl.title = `Live Hive energy — RC/mana ${realEnergy.manaPct.toFixed(0)}% · ${realEnergy.ops24h} ops/24h · ${realEnergy.steps.toLocaleString()} Actifit steps → energy ${a.energy}/15. Powers bonus lives, jump & score multiplier.`;
  } catch { /* keep whatever we had */ }
}

const cleanName = (s: string) => s.trim().replace(/^@/, "").toLowerCase();

// Keychain login: prove ownership by signing a challenge, then load the account.
// (Score posts are Keychain-signed too, so the leaderboard is tamper-proof either way;
// this just gives a real verified session + persists it.)
async function doLogin() {
  const user = cleanName(hiveUser.value);
  if (!user) { hiveStatus.textContent = "enter your @username first"; return; }
  if (!hasKeychain()) { hiveStatus.textContent = "no Keychain — using read-only"; await loadHive(user); return; }
  hiveStatus.textContent = "check Hive Keychain…";
  const r = await login(user);
  if (!r.ok) { hiveStatus.textContent = "login failed: " + (r.error ?? ""); return; }
  localStorage.setItem("hiverunner_verified", user);
  await loadHive(user);
}
loginBtn.addEventListener("click", () => void doLogin());
logoutBtn.addEventListener("click", () => {
  localStorage.removeItem("hiverunner_account");
  localStorage.removeItem("hiverunner_verified");
  location.reload();
});
$("hive-load").addEventListener("click", () => loadHive(cleanName(hiveUser.value)));
hiveUser.addEventListener("keydown", (e) => { if (e.key === "Enter") void doLogin(); });
postScoreBtn.addEventListener("click", async () => {
  if (!hiveAccount) return;
  postScoreBtn.disabled = true;
  hiveStatus.textContent = "posting score…";
  const community = communitySelect.value === FOLLOWS_OPT ? "" : communitySelect.value;
  const r = await postScore(hiveAccount, community, lastScore, currentSpec.meta.title, weekId());
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
  const p = new URLSearchParams(location.search).get("hive") || localStorage.getItem("hiverunner_account");
  if (p) { hiveUser.value = p; void loadHive(cleanName(p)); } // restore session (or ?hive= override)
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
    questsEl.classList.add("open");
    wardrobeEl.classList.add("open");
  }

  // Pixi's RAF loop; the engine only advances when a run is started and not paused
  app.ticker.add((t) => { if (engine && started && !paused) engine.update(t.deltaMS); });

  $("apply-btn").addEventListener("click", () => start(true));
  $("restart-btn").addEventListener("click", () => start(true));
  const qp = new URLSearchParams(location.search);
  // dev: force-equip cosmetics for preview/sharing, e.g. ?equip=skin_sky,theme_neon (owned only)
  const eq = qp.get("equip");
  if (eq) for (const id of eq.split(",")) { const c = byId(id.trim()); if (c) equip(c.type, c.id); }
  start(false); // set up the flagship game in a "ready" state — press Start to play
  if (qp.get("play") === "1") beginPlay(); // dev: skip the Start overlay
  if (qp.get("pt") === "1") showPostToast({ author: "yalloveme", permlink: "sample", title: "NOT EVERY CROWN BELONGS TO A KING", community: "Hive" }); // dev: preview the post toast
}

function start(autostart = false) {
  // tear down previous run
  engine?.destroy();
  app.stage.removeChildren();

  lastGameOver = false;
  paused = false;
  started = autostart;
  postCoinsThisRun = 0;
  updatePostBtn();

  $("game-title").textContent = currentSpec.meta.title;
  $("archetype-label").textContent = currentSpec.meta.archetype;
  $("hint").textContent = currentSpec.meta.archetype === "runner"
    ? "Tap, Space or ↑ to jump — clear rocks, grab coins"
    : "Move with pointer or ← → keys";
  app.renderer.background.color = parseBg(currentSpec.world.palette?.[2]) ?? 0x101018;

  // real on-chain energy when logged in; otherwise the dev sliders (defaults for guests)
  const inputs: ActivityInputs = realEnergy ?? {
    ops24h: Number(opsSlider.value),
    manaPct: Number(manaSlider.value),
    steps: Number(stepsSlider.value),
  };
  const activity = makeActivity(inputs);
  const applied = applyHooks(currentSpec, activity);
  applied.bonusLives += getDailyBonusLives(); // streak + completed-quest bonus lives

  // update the live debug panel
  const b = activity.breakdown;
  vBaseline.textContent = `+${b.baseline}`;
  vActivity.textContent = `+${b.activity}`;
  vBonusFeed.textContent = `+${b.bonus}`;
  vEnergy.textContent = `${activity.energy}  ·  vitality ${(activity.vitality * 100).toFixed(0)}%`;
  vBonusLives.textContent = `+${applied.bonusLives}`;
  vBasket.textContent = `×${applied.basketWidthFactor}`;
  vScoreMult.textContent = `×${applied.scoreMultiplier}`;

  engine = createEngine(app, applied.effectiveSpec, applied.bonusLives, applied.scoreMultiplier, onState, hiveFeed, postFeed, showPostToast, resolveCosmetics(), computeGhosts(), onGhostPass, onRaceWon);
  engine.mount();

  setOverlay(autostart ? "none" : "start"); // show "▶ Start" over the ready scene
  updatePauseBtn();
}

function onState(s: EngineState) {
  if (s.over && !lastGameOver) {
    lastGameOver = true;
    lastScore = s.score;
    // advance daily quests with this run's results
    const done = recordRun({ score: s.score, level: s.level, surviveSec: s.elapsed / 1000, postCoins: postCoinsThisRun });
    for (const label of done) showToast(`🎯 Quest complete: ${label}`);
    renderQuests(); // reflect updated progress (not just completions)
    // progression: award XP, surface level-ups + newly-unlocked cosmetics
    const prog = applyRun({ score: s.score, level: s.level, postCoins: postCoinsThisRun, streak: getStreak() });
    if (prog.leveledUp) showToast(`⭐ Level ${prog.newLevel}!`);
    for (const c of prog.newlyUnlocked) showToast(`🎁 Unlocked: ${c.name}`);
    renderWardrobe();
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
