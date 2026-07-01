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
const MAX_BLOCKS_PER_RUN = 40000; // catch-up cap (~14h of chain) so a run stays bounded
const KEEP_WEEKS = 6;           // how many recent contest weeks to retain
const TOP_PER_WEEK = 100;       // rows per week in the public file

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
  if (Array.isArray(op)) return { type: op[0], value: op[1] };
  const t = String(op.type ?? "").replace(/_operation$/, "");
  return { type: t, value: op.value ?? {} };
}

function loadJson(path, fallback) {
  try { return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback; }
  catch { return fallback; }
}

function saveJson(path, obj) {
  const dir = dirname(path);
  if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

// state.weeks[week][account] = { score, game, ts }  (ts = block time, seconds)
export function recordScore(state, week, account, score, game, ts) {
  const w = (state.weeks[week] ||= {});
  const cur = w[account];
  if (!cur || score > cur.score) w[account] = { score, game, ts };
}

// Process a batch of blocks (as returned by block_api.get_block_range) into `state`.
// Returns the number of valid score ops recorded. Pure over `state` — unit-testable.
export function processBlocks(state, blocks) {
  let found = 0;
  for (const blk of blocks ?? []) {
    const ts = blk?.timestamp ? new Date(blk.timestamp + "Z") : null;
    const week = ts ? weekIdFromDate(ts) : null;
    const tsSec = ts ? Math.floor(ts.getTime() / 1000) : 0;
    for (const tx of blk?.transactions ?? []) {
      for (const rawOp of tx.operations ?? []) {
        const { type, value } = normalizeOp(rawOp);
        if (type !== "custom_json" || value.id !== CUSTOM_ID) continue;
        const account = value.required_posting_auths?.[0] ?? value.required_auths?.[0];
        if (!account || !week) continue;
        let payload;
        try { payload = JSON.parse(value.json); } catch { continue; }
        if (payload?.action !== "score") continue;
        const score = Number(payload.score);
        if (!Number.isFinite(score) || score < 0 || score > 10_000_000) continue;
        const game = typeof payload.game === "string" ? payload.game.slice(0, 40) : "";
        recordScore(state, week, account, Math.floor(score), game, tsSec);
        found++;
      }
    }
  }
  return found;
}

async function main() {
  const state = loadJson(STATE_PATH, { lastBlock: 0, weeks: {} });
  const head = (await rpc("condenser_api.get_dynamic_global_properties", [])).head_block_number;
  if (!head) throw new Error("no head block");

  // First run: start ~1h back so we don't rescan chain history that predates the game.
  let from = state.lastBlock ? state.lastBlock + 1 : Math.max(1, head - 1200);
  const to = Math.min(head, from + MAX_BLOCKS_PER_RUN - 1);
  if (from > head) { console.log("nothing new; head", head); return finalize(state, head); }

  let scanned = 0, found = 0;
  for (let start = from; start <= to; start += BATCH) {
    const count = Math.min(BATCH, to - start + 1);
    const r = await rpc("block_api.get_block_range", { starting_block_num: start, count });
    const blocks = r?.blocks ?? [];
    found += processBlocks(state, blocks);
    scanned += blocks.length;
  }

  state.lastBlock = to;
  console.log(`scanned ${scanned} blocks (${from}..${to} of head ${head}), found ${found} score ops`);
  finalize(state, head);
}

export function finalize(state, head) {
  // prune old weeks
  const weeks = Object.keys(state.weeks).sort();
  while (weeks.length > KEEP_WEEKS) delete state.weeks[weeks.shift()];

  // build the public standings file
  const contests = {};
  for (const [week, accounts] of Object.entries(state.weeks)) {
    contests[week] = Object.entries(accounts)
      .map(([account, v]) => ({ account, score: v.score, game: v.game, ts: v.ts }))
      .sort((a, b) => b.score - a.score || a.ts - b.ts)
      .slice(0, TOP_PER_WEEK);
  }
  const out = { updated: Date.now(), current: weekIdFromDate(new Date()), contests };

  saveJson(STATE_PATH, state);
  saveJson(OUT_PATH, out);
  console.log(`wrote ${OUT_PATH} · current ${out.current} · ${Object.keys(contests).length} week(s) · headBlock ${head}`);
}

// Only stream the chain when run directly (`node indexer/index.mjs`), not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("index.mjs")) {
  main().catch((e) => { console.error("indexer failed:", e); process.exit(1); });
}
