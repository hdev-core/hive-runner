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
  image?: string;     // first image URL from the post, if any (raw, un-proxied)
}

export class PostFeed {
  private queue: HivePost[] = [];
  private imageQueue: HivePost[] = []; // posts that have an image (for full-scene backdrops)
  private idx = 0;
  private imgIdx = 0;
  private lastAuthor = "";
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

  /** Round-robin the next post to display; null while the queue is still empty.
   *  Skips an immediate repeat of the same author so consecutive billboards clearly differ. */
  next(): HivePost | null {
    if (!this.queue.length) return null;
    let p = this.queue[this.idx % this.queue.length];
    if (this.queue.length > 1 && p.author === this.lastAuthor) {
      this.idx++;
      p = this.queue[this.idx % this.queue.length];
    }
    this.idx++;
    this.lastAuthor = p.author;
    return p;
  }

  /** Next post that has an image — used for the per-level full-scene backdrop. */
  nextImage(): HivePost | null {
    if (!this.imageQueue.length) return null;
    const p = this.imageQueue[this.imgIdx % this.imageQueue.length];
    this.imgIdx++;
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
          image: firstImage(p),
        }));
      if (mapped.length) {
        // Shuffle so the stream isn't always the same "created" order (whose top slots are
        // recurring daily posts like Power-Up-Day). Keep `idx` advancing across refreshes —
        // resetting it to 0 was making every run restart on the same first post.
        for (let i = mapped.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [mapped[i], mapped[j]] = [mapped[j], mapped[i]];
        }
        this.queue = mapped;
        this.imageQueue = mapped.filter((p) => !!p.image);
      }
    } catch {
      /* keep the previous queue on failure */
    }
  }
}

function clean(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 90 ? t.slice(0, 88) + "…" : t;
}

// Pull the first usable image URL from a bridge post's json_metadata (object or string form).
function firstImage(p: any): string | undefined {
  let jm = p?.json_metadata;
  if (typeof jm === "string") { try { jm = JSON.parse(jm); } catch { jm = null; } }
  const arr = jm?.image ?? jm?.images;
  const url = Array.isArray(arr) ? arr[0] : typeof arr === "string" ? arr : undefined;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : undefined;
}
