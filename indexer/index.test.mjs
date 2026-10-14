// Tests for the indexer's pure functions. Run with `npm test` (node --test, no dependencies).
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkScore, plausibleScore, processBlocks, finalize, blockNumFromId, minTimeForLevel, weekIdFromDate } from "./index.mjs";

const T0 = 1_790_000_000;              // block time of the post, seconds
const N0 = 110_000_000;                // block number of the post
const ctx = { blockNum: N0, blockTs: T0 };
// a legitimate 90 s, level-4 run that started 40 blocks (120 s) before it was posted
const legit = { action: "score", score: 3200, level: 4, durationMs: 90_000, startBlock: N0 - 40, startTs: T0 - 120 };

const blockId = (n) => n.toString(16).padStart(8, "0") + "0".repeat(32);
const iso = (sec) => new Date(sec * 1000).toISOString().slice(0, 19);
function block(n, sec, ops) {
  return { block_id: blockId(n), timestamp: iso(sec), transactions: [{ operations: ops }] };
}
const scoreOp = (account, payload) => ({
  type: "custom_json_operation",
  value: { id: "hive-runner", required_auths: [], required_posting_auths: [account], json: JSON.stringify(payload) },
});
const fresh = () => ({ lastBlock: 0, weeks: {}, lastRun: {} });

test("accepts a legitimate run", () => {
  assert.equal(checkScore(legit, ctx).ok, true);
});

test("rejects forged scores that used to pass", () => {
  const forged = [
    { score: 9_999_999 },                                                        // over the hard cap
    { score: 500_000, durationMs: 1_665_000 },                                   // hard cap, no level
    { score: 100_000, durationMs: 400_000, level: -50, startBlock: N0 - 200 },   // negative level skipped the level check
    { score: "0x7A120", durationMs: 1_665_000, level: 20, startBlock: N0 - 600 }, // string coerced to 500000
    { score: [500_000], durationMs: 1_665_000, level: 20, startBlock: N0 - 600 }, // array coerced to 500000
    { score: 2_000, durationMs: 1_000, level: 1, startBlock: N0 - 1 },           // 2000 points in one second
    { score: 5_000, level: 20, durationMs: 8_000, startBlock: N0 - 10 },         // level 20 in 8 seconds
    { score: -5, level: 1, durationMs: 1_000, startBlock: N0 - 1 },
  ];
  for (const p of forged) assert.equal(plausibleScore({ action: "score", ...p }, ctx), false, JSON.stringify(p));
});

test("a long run cannot be claimed without the time having passed", () => {
  // 27-minute run "started" 10 blocks (30 s) ago
  const p = { ...legit, score: 400_000, level: 20, durationMs: 1_620_000, startBlock: N0 - 10 };
  assert.match(checkScore(p, ctx).reason, /longer than the time since it started/);
  // start block in the future
  assert.equal(plausibleScore({ ...legit, startBlock: N0 + 5 }, ctx), false);
  // no anchor at all: only tiny scores get through
  const { startBlock, startTs, ...noAnchor } = legit;
  assert.equal(plausibleScore(noAnchor, ctx), false);
  assert.equal(plausibleScore({ ...noAnchor, score: 300 }, ctx), true);
});

test("falls back to the wall-clock anchor when the block feed was down", () => {
  assert.equal(plausibleScore({ ...legit, startBlock: 0 }, ctx), true);
  assert.equal(plausibleScore({ ...legit, startBlock: 0, startTs: T0 + 3600 }, ctx), false);
  assert.equal(plausibleScore({ ...legit, startBlock: 0, durationMs: 600_000, startTs: T0 - 120 }, ctx), false);
});

test("context-less submissions can only post tiny scores", () => {
  assert.equal(plausibleScore({ score: 300 }, ctx), true);
  assert.equal(plausibleScore({ score: 2063 }, ctx), false);
});

test("processBlocks records a real wire-format score and keeps the best per account", () => {
  const state = fresh();
  const n = processBlocks(state, [
    block(N0, T0, [scoreOp("alice", legit)]),
    block(N0 + 100, T0 + 300, [scoreOp("alice", { ...legit, score: 1500, startBlock: N0 + 60 })]),
  ]);
  assert.equal(n, 2);
  const week = weekIdFromDate(new Date(T0 * 1000));
  assert.equal(state.weeks[week].alice.score, 3200);
  assert.equal(state.weeks[week].alice.level, 4);
});

test("rejects a run that overlaps the account's previous run", () => {
  const state = fresh();
  const n = processBlocks(state, [
    block(N0, T0, [scoreOp("mallory", legit)]),
    // posted 30 s later, but claims to have started 5 minutes earlier — while the first run was live
    block(N0 + 10, T0 + 30, [scoreOp("mallory", { ...legit, score: 60_000, level: 8, durationMs: 290_000, startBlock: N0 - 90 })]),
  ]);
  assert.equal(n, 1);
  assert.equal(state.weeks[weekIdFromDate(new Date(T0 * 1000))].mallory.score, 3200);
});

test("survives hostile and malformed input", () => {
  const state = fresh();
  const bad = (json) => ({ type: "custom_json_operation", value: { id: "hive-runner", required_posting_auths: ["eve"], json } });
  const blocks = [
    null,
    { block_id: blockId(N0), timestamp: "not a date", transactions: [{ operations: [scoreOp("eve", legit)] }] },
    { block_id: blockId(N0), timestamp: iso(T0), transactions: [null, { operations: [null, 7, bad("null"), bad("42"), bad("[1,2]"), bad("{oops")] }] },
    block(N0, T0, [{ type: "custom_json_operation", value: { id: "hive-runner", required_posting_auths: [{}], json: JSON.stringify(legit) } }]),
  ];
  assert.equal(processBlocks(state, blocks), 0);
});

test("an account named like an Object.prototype key is recorded", () => {
  const state = fresh();
  assert.equal(processBlocks(state, [block(N0, T0, [scoreOp("constructor", legit)])]), 1);
  const out = finalize(state, N0, false);
  assert.equal(out.contests[weekIdFromDate(new Date(T0 * 1000))][0].account, "constructor");
});

test("helpers", () => {
  assert.equal(blockNumFromId("05f5e100ac3678bffba47c0d194680d6d933b3b7"), 100_000_000);
  assert.equal(minTimeForLevel(10), 270);
  assert.equal(weekIdFromDate(new Date("2026-07-06T12:00:00Z")), "2026-W28");
});
