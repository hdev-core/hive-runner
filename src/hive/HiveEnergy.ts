// Real on-chain "energy" inputs — replaces the mock sliders with live reads so a player's
// actual Hive activity powers the game (the "be active on Hive → power up" loop).
//
//   manaPct : RC / mana %          (rc_api.find_rc_accounts)          — everyone has this floor
//   ops24h  : on-chain ops in 24h  (condenser get_account_history)    — rewards engagement
//   steps   : Actifit steps today  (latest Actifit report post)       — optional bonus feeder
//
// Feeds the existing hybrid formula in makeActivity(). All public nodes, read-only.

import type { ActivityInputs } from "../activity/mockActivity.ts";

const NODES = ["https://api.hive.blog", "https://api.deathwing.me", "https://api.openhive.network"];
let nodeIdx = 0;

async function rpc(method: string, params: unknown): Promise<any> {
  for (let attempt = 0; attempt < NODES.length; attempt++) {
    try {
      const res = await fetch(NODES[nodeIdx], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch {
      nodeIdx = (nodeIdx + 1) % NODES.length;
    }
  }
  throw new Error("all nodes failed");
}

/** RC / mana as a 0..100 percent. */
export async function getRcPercent(account: string): Promise<number> {
  const r = await rpc("rc_api.find_rc_accounts", { accounts: [account] });
  const a = r?.rc_accounts?.[0];
  if (!a) return 0;
  const max = Number(a.max_rc);
  const cur = Number(a.rc_manabar?.current_mana);
  if (!(max > 0) || !Number.isFinite(cur)) return 0;
  return Math.max(0, Math.min(100, (cur / max) * 100));
}

/** Count of the account's on-chain operations in the last 24h (scans recent history). */
export async function getOps24h(account: string): Promise<number> {
  const r = await rpc("condenser_api.get_account_history", [account, -1, 500]);
  if (!Array.isArray(r)) return 0;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let n = 0;
  for (const entry of r) {
    const op = entry?.[1];
    const t = op?.timestamp;
    if (t && new Date(t + "Z").getTime() >= cutoff) n++;
  }
  return n;
}

/** Today's Actifit steps from the account's most recent Actifit report (0 if none/stale). */
export async function getActifitSteps(account: string): Promise<number> {
  const posts = await rpc("bridge.get_account_posts", { sort: "posts", account, limit: 20, observer: account });
  for (const p of posts ?? []) {
    let jm: any = p?.json_metadata;
    if (typeof jm === "string") { try { jm = JSON.parse(jm); } catch { jm = {}; } }
    const raw = jm?.step_count;
    const val = Array.isArray(raw) ? raw[0] : raw;
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) {
      // only count recent reports (last ~2 days) — older steps are stale
      const age = Date.now() - new Date((p.created ?? "") + "Z").getTime();
      return age < 2 * 24 * 3600 * 1000 ? n : 0;
    }
  }
  return 0;
}

/** Live energy inputs for an account; each source degrades gracefully to a safe default. */
export async function getEnergyInputs(account: string): Promise<ActivityInputs> {
  const [manaPct, ops24h, steps] = await Promise.all([
    getRcPercent(account).catch(() => 60),
    getOps24h(account).catch(() => 0),
    getActifitSteps(account).catch(() => 0),
  ]);
  return { manaPct, ops24h, steps };
}
