// PostFeed — read-only stream of real Hive posts, used for two in-game features:
//   • background "billboards" (fresh posts drift by as scenery signposts)
//   • collectible "post-coins" (grab one to surface a real author + title)
// Default source is the global fresh-post firehose (bridge.get_ranked_posts,
// sort:"created"). Once a player loads their account we switch to THEIR feed
// (bridge.get_account_posts, sort:"feed") so the run scrolls through posts from
// the accounts they follow. All public nodes, no auth.

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

export interface HivePost {
  author: string;
  permlink: string;
  title: string;
  community?: string; // human-readable community/category, if any
}

export class PostFeed {
  private queue: HivePost[] = [];
  private idx = 0;
  private account = "";
  private timer: number | null = null;

  /** Begin polling the global fresh-post firehose. */
  start() {
    if (this.timer !== null) return;
    void this.refresh();
    this.timer = window.setInterval(() => void this.refresh(), 30000);
  }

  stop() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  /** Switch the source to a specific account's personalised feed (posts from their follows). */
  setAccount(account: string) {
    if (account === this.account) return;
    this.account = account;
    void this.refresh();
  }

  /** Are we currently showing a personalised feed vs. the global firehose? */
  get isPersonal() { return !!this.account; }

  /** Round-robin the next post to display; null while the queue is still empty. */
  next(): HivePost | null {
    if (!this.queue.length) return null;
    const p = this.queue[this.idx % this.queue.length];
    this.idx++;
    return p;
  }

  private async refresh() {
    try {
      const raw: any[] = this.account
        ? await rpc("bridge.get_account_posts", { sort: "feed", account: this.account, limit: 20, observer: this.account })
        : await rpc("bridge.get_ranked_posts", { sort: "created", tag: "", observer: "" });
      const mapped: HivePost[] = (raw ?? [])
        .filter((p) => p && p.author && p.title)
        .map((p) => ({
          author: String(p.author),
          permlink: String(p.permlink ?? ""),
          title: clean(String(p.title)),
          community: p.community_title || p.category || undefined,
        }));
      if (mapped.length) { this.queue = mapped; this.idx = 0; }
    } catch {
      /* keep the previous queue on failure */
    }
  }
}

function clean(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 90 ? t.slice(0, 88) + "…" : t;
}
