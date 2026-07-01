// Read-only Hive social data (no auth): who you follow (→ ghost racers) and your
// communities (→ team). All via public nodes, browser-friendly.

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

export interface Ghost { name: string; pace: number; } // pace = virtual points/sec
export interface Community { name: string; title: string; }

/** Accounts the user follows (capped). */
export async function getFollowing(account: string, limit = 8): Promise<string[]> {
  const r = await rpc("condenser_api.get_following", [account, "", "blog", limit]);
  return (r ?? []).map((f: any) => f.following);
}

/** Ghost racers: followed accounts + a pace derived from their real Hive reputation. */
export async function getGhosts(account: string, limit = 6): Promise<Ghost[]> {
  const following = await getFollowing(account, limit);
  if (!following.length) return [];
  const accts = await rpc("condenser_api.get_accounts", [following]);
  return (accts ?? []).map((a: any) => ({ name: a.name, pace: paceFromPosts(a.post_count) }));
}

/** Communities the user is subscribed to; falls back to the top communities. */
export async function getCommunities(account?: string): Promise<Community[]> {
  if (account) {
    try {
      const subs = await rpc("bridge.list_all_subscriptions", { account });
      const list: Community[] = (subs ?? []).map((s: any[]) => ({ name: s[0], title: s[1] }));
      if (list.length) return list;
    } catch { /* fall through to top communities */ }
  }
  const top = await rpc("bridge.list_communities", { limit: 15, sort: "rank" });
  return (top ?? []).map((c: any) => ({ name: c.name, title: c.title }));
}

// A followed account's lifetime post/comment count -> a race pace of ~5..14 pts/sec.
// (log scale: more active Hive users are faster ghosts.)
function paceFromPosts(postCount: number | string): number {
  const n = Number(postCount) || 0;
  const norm = Math.max(0, Math.min(1, (Math.log10(Math.max(1, n)) - 2) / 4)); // ~100..1M posts
  return 5 + norm * 9;
}
