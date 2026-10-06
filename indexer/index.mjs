// Contest indexer — runs as a scheduled GitHub Action (see .github/workflows/indexer.yml).
//
// Streams new Hive blocks since the last checkpoint, extracts `hive-runner` score
// custom_jsons, buckets each into the contest week of its BLOCK timestamp (so a
// player can't backdate/forward-date a score), keeps each account's best per week,
// and writes:
//   - indexer/state.json      (checkpoint + full best-score map, committed)
//   - data/leaderboard.json   (public standings, served to the client via raw GitHub)
//
// No npm deps: uses Node 20+ global fetch. Idempotent and resumable.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://api.openhive.network",
  "https://techcoderx.com",
];
const CUSTOM_ID = "hive-runner";
const BATCH = 1000;              // blocks per get_block_range call
const MAX_BLOCKS_PER_RUN = 40000; // catch-up cap (~33h of chain) so a run stays bounded
const KEEP_WEEKS = 6;           // how many recent contest weeks to retain
const TOP_PER_WEEK = 100;       // rows per week in the public file
const RPC_TIMEOUT_MS = 90_000;  // a 1000-block batch is ~15 MB and can take 15–35 s

const STATE_PATH = "indexer/state.json";
const OUT_PATH = "data/leaderboard.json";

let nodeIdx = 0;
async function rpc(method, params) {
  let lastErr;
  for (let i = 0; i < NODES.length * 2; i++) {
    try {
      const res = await fetch(NODES[nodeIdx], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      const j = await res.json();
      if (j.error) throw new Error(JSON.stringify(j.error));
      return j.result;
    } catch (e) {
      lastErr = e;
      nodeIdx = (nodeIdx + 1) % NODES.length;
    }
  }
  throw lastErr;
}

// ISO-week id in UTC — MUST match src/contest.ts weekId().
export function weekIdFromDate(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function normalizeOp(op) {
  if (Array.isArray(op)) return { type: op[0], value: op[1] ?? {} };
  if (!op || typeof op !== "object") return { type: "", value: {} };
  const t = String(op.type ?? "").replace(/_operation$/, "");
  return { type: t, value: op.value ?? {} };
}

// A block's number is the first 4 bytes of its id.
export function blockNumFromId(id) {
  const n = parseInt(String(id ?? "").slice(0, 8), 16);
  return Number.isFinite(n) ? n : 0;
}

// --- anti-cheat: plausibility layer (the indexer is the authority; the client is never trusted) ---
// A signature proves WHO posted, not that a score is real. We can't fully validate a client-side
// game here (that's the planned deterministic-replay layer — see docs/anti-cheat.md), but we can
// reject the physically IMPOSSIBLE, and anchor a run to real chain time so a long run can't be
// claimed out of thin air more often than it could actually be played.
const MAX_RATE = 300;          // generous upper bound on points/second (time score + coins + chain)
const BASE_SLACK = 600;        // flat allowance for early pickups; also the cap for context-less runs
const MAX_DURATION_S = 1800;   // a single run realistically can't exceed ~30 min
const HARD_CAP = 500_000;      // absolute sanity ceiling
const BLOCK_SECONDS = 3;
const BLOCK_SLACK_S = 60;      // allowance on the startBlock anchor (block feed lag)
const CLOCK_SLACK_S = 180;     // allowance on the startTs anchor (client clock skew)

// Minimum seconds to legitimately REACH a level: you must survive each level's target first
// (targetForLevel(L) = 10 + 4*L in RunnerEngine). Keep in sync with the engine.
export function minTimeForLevel(level) {
  let t = 0;
  for (let i = 1; i < level; i++) t += 10 + 4 * i;
  return t;
}

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

// Checks a score payload against its own run context and against `ctx`, the block that carried
// it ({ blockNum, blockTs } — both from the chain, not the client). Types are strict on purpose:
// strings, arrays and negative levels used to slip through numeric coercion.
// Returns { ok, reason?, startSec? } where startSec is the run's start in chain time.
export function checkScore(payload, ctx) {
  const no = (reason) => ({ ok: false, reason });
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return no("not an object");
  const score = payload.score;
  if (!isNum(score) || score < 0 || score > HARD_CAP) return no("score out of range or not a number");

  // Without verifiable run context we can't bound the score, so only tiny scores are accepted:
  // a context-less (legacy or forged-minimal) submission can never top the board.
  const tiny = score <= BASE_SLACK;
  const { durationMs, level, startBlock, startTs } = payload;
  if (!isNum(durationMs) || !isNum(level)) return tiny ? { ok: true } : no("missing run context");

  if (durationMs < 0 || durationMs > MAX_DURATION_S * 1000) return no("duration out of range");
  if (!Number.isInteger(level) || level < 1 || level > 200) return no("bad level");
  const durS = durationMs / 1000;
  if (durS + 2 < minTimeForLevel(level) * 0.9) return no("level too high for time survived");
  if (score > MAX_RATE * durS + BASE_SLACK) return no("score too high for time survived");

  // Anchor to real time: the run must fit between its start and the block it was posted in.
  if (!ctx) return { ok: true };
  let windowS, startSec;
  if (isNum(startBlock) && startBlock > 0) {
    if (startBlock > ctx.blockNum) return no("start block is in the future");
    const elapsed = (ctx.blockNum - startBlock) * BLOCK_SECONDS;
    windowS = elapsed + BLOCK_SLACK_S;
    startSec = ctx.blockTs - elapsed;
  } else if (isNum(startTs) && startTs > 0) {
    if (startTs > ctx.blockTs + CLOCK_SLACK_S) return no("start time is in the future");
    windowS = ctx.blockTs - startTs + CLOCK_SLACK_S;
    startSec = startTs;
  } else {
    return tiny ? { ok: true } : no("missing start anchor");
  }
  if (durS > windowS) return no("run is longer than the time since it started");
  return { ok: true, startSec };
}

export const plausibleScore = (payload, ctx) => checkScore(payload, ctx).ok;

function loadState(path) {
  if (!existsSync(path)) return { lastBlock: 0, weeks: {}, lastRun: {} };
  // An unreadable checkpoint must stop the run. Falling back to an empty state here would
  // rescan from "an hour ago" and publish an empty leaderboard over the real one.
  let s;
  try { s = JSON.parse(readFileSync(path, "utf8")); }
  catch (e) { throw new Error(`${path} is unreadable (${e.message}) — refusing to overwrite standings`); }
  if (!s || typeof s !== "object" || typeof s.weeks !== "object" || s.weeks === null || !Number.isFinite(s.lastBlock)) {
    throw new Error(`${path} has an unexpected shape — refusing to overwrite standings`);
  }
  s.lastRun ||= {};
  return s;
}

function saveJson(path, obj) {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

// Own-property lookup: an account named "constructor" must not resolve to Object.prototype.
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);

// state.weeks[week][account] = { score, game, ts, level, durationMs }  (ts = block time, seconds)
// level/durationMs are retained for the manual pre-payout review of top scorers.
export function recordScore(state, week, account, score, game, ts, level = 0, durationMs = 0) {
  if (!Object.hasOwn(state.weeks, week)) state.weeks[week] = {};
  const w = state.weeks[week];
  const cur = own(w, account);
  if (!cur || score > cur.score) w[account] = { score, game, ts, level, durationMs };
}

// Process a batch of blocks (as returned by block_api.get_block_range) into `state`.
// Returns the number of valid score ops recorded. Pure over `state` — unit-testable.
export function processBlocks(state, blocks) {
  state.lastRun ||= {};
  let found = 0;
  for (const blk of blocks ?? []) {
    const ts = blk?.timestamp ? new Date(blk.timestamp + "Z") : null;
    const week = ts && !Number.isNaN(ts.getTime()) ? weekIdFromDate(ts) : null;
    if (!week) continue;
    const blockTs = Math.floor(ts.getTime() / 1000);
    const ctx = { blockNum: blockNumFromId(blk.block_id), blockTs };
    for (const tx of blk.transactions ?? []) {
      for (const rawOp of tx?.operations ?? []) {
        const { type, value } = normalizeOp(rawOp);
        if (type !== "custom_json" || value.id !== CUSTOM_ID) continue;
        const account = value.required_posting_auths?.[0] ?? value.required_auths?.[0];
        if (typeof account !== "string" || !account) continue;
        let payload;
        try { payload = JSON.parse(value.json); } catch { continue; }
        if (payload?.action !== "score") continue;
        const check = checkScore(payload, ctx); // reject the impossible (anti-cheat plausibility layer)
        if (!check.ok) continue;
        // One account can't be in two runs at once: a run that started before the account's
        // previous accepted run was posted is rejected. This is what makes a forged long run
        // cost real time — it can only be claimed once per that much wall-clock time.
        const prevEnd = own(state.lastRun, account);
        if (check.startSec !== undefined && prevEnd !== undefined && check.startSec < prevEnd - 5) continue;
        if (check.startSec !== undefined) state.lastRun[account] = blockTs;
        const game = typeof payload.game === "string" ? payload.game.slice(0, 40) : "";
        const level = Number.isInteger(payload.level) ? payload.level : 0;
        const durationMs = isNum(payload.durationMs) ? Math.floor(payload.durationMs) : 0;
        recordScore(state, week, account, Math.floor(payload.score), game, blockTs, level, durationMs);
        found++;
      }
    }
  }
  return found;
}

async function main() {
  const state = loadState(STATE_PATH);
  const head = (await rpc("condenser_api.get_dynamic_global_properties", [])).head_block_number;
  if (!head) throw new Error("no head block");

  // First run: start ~1h back so we don't rescan chain history that predates the game.
  const from = state.lastBlock ? state.lastBlock + 1 : Math.max(1, head - 1200);
  const to = Math.min(head, from + MAX_BLOCKS_PER_RUN - 1);
  if (from > head) { console.log("nothing new; head", head); return finalize(state, head); }

  let scanned = 0, found = 0;
  for (let start = from; start <= to; start += BATCH) {
    const count = Math.min(BATCH, to - start + 1);
    const r = await rpc("block_api.get_block_range", { starting_block_num: start, count });
    const blocks = r?.blocks ?? [];
    found += processBlocks(state, blocks);
    scanned += blocks.length;
    // A node that is behind the one that reported `head` returns a short batch with no error.
    // Stop here and checkpoint only what we actually received, so the rest is scanned next run
    // instead of being skipped for good.
    if (blocks.length < count) { console.log(`short batch at ${start}: got ${blocks.length}/${count}; resuming next run`); break; }
  }

  if (scanned > 0) state.lastBlock = from + scanned - 1;
  console.log(`scanned ${scanned} blocks (${from}..${from + scanned - 1} of head ${head}), found ${found} score ops`);
  finalize(state, head);
}

export function finalize(state, head, write = true) {
  // prune old weeks
  const weeks = Object.keys(state.weeks).sort();
  while (weeks.length > KEEP_WEEKS) delete state.weeks[weeks.shift()];
  // prune the per-account "last run" markers (only recent ones matter for the overlap check)
  const cutoff = Math.floor(Date.now() / 1000) - 2 * 86400;
  for (const [account, ts] of Object.entries(state.lastRun ?? {})) if (ts < cutoff) delete state.lastRun[account];

  // build the public standings file
  const contests = {};
  for (const [week, accounts] of Object.entries(state.weeks)) {
    contests[week] = Object.entries(accounts)
      .map(([account, v]) => ({ account, score: v.score, game: v.game, ts: v.ts, level: v.level ?? 0, durationMs: v.durationMs ?? 0 }))
      .sort((a, b) => b.score - a.score || a.ts - b.ts)
      .slice(0, TOP_PER_WEEK);
  }
  const out = { updated: Date.now(), current: weekIdFromDate(new Date()), contests };

  if (write) {
    saveJson(STATE_PATH, state);
    saveJson(OUT_PATH, out);
    console.log(`wrote ${OUT_PATH} · current ${out.current} · ${Object.keys(contests).length} week(s) · headBlock ${head}`);
  }
  return out;
}

// Only stream the chain when run directly (`node indexer/index.mjs`), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.mjs")) {
  main().catch((e) => { console.error("indexer failed:", e); process.exit(1); });
}
