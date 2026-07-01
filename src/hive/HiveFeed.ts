// HiveFeed — read-only live connection to the Hive blockchain (no auth, no signing).
// Polls the head block every ~3s and parses its real operations into a BlockInfo the
// game turns into events. This is the first genuine on-chain tie: the world is driven
// by what's actually happening on Hive right now.

const NODES = [
  "https://api.hive.blog",
  "https://api.deathwing.me",
  "https://api.openhive.network",
  "https://techcoderx.com",
];

export interface BlockInfo {
  num: number;
  witness: string;   // the account that produced this block
  opCount: number;
  transfers: number;
  posts: number;
  votes: number;
  customJsons: number;
  topTransfer?: { amount: number; symbol: string; from: string };
}

export class HiveFeed {
  blockNum = 0;
  ok = false;
  onBlock?: (info: BlockInfo) => void;

  private nodeIdx = 0;
  private lastFetched = 0;
  private pending: BlockInfo | null = null;
  private timer: number | null = null;
  private busy = false;

  start() {
    if (this.timer !== null) return;
    void this.tick();
    this.timer = window.setInterval(() => void this.tick(), 3000);
  }

  stop() {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  /** Returns a freshly-seen block once, then null until the next new block. */
  pollNewBlock(): BlockInfo | null {
    const p = this.pending;
    this.pending = null;
    return p;
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const gp = await this.rpc("condenser_api.get_dynamic_global_properties", []);
      const head: number = gp?.head_block_number ?? 0;
      if (!head) return;
      this.ok = true;
      if (!this.blockNum) this.blockNum = head;
      if (head > this.lastFetched) {
        const blk = await this.rpc("block_api.get_block", { block_num: head });
        const info = this.parse(head, blk?.block);
        this.blockNum = head;
        this.lastFetched = head;
        this.pending = info;
        this.onBlock?.(info);
      }
    } catch {
      this.ok = false;
      this.nodeIdx = (this.nodeIdx + 1) % NODES.length; // rotate on failure
    } finally {
      this.busy = false;
    }
  }

  private parse(num: number, block: any): BlockInfo {
    const info: BlockInfo = { num, witness: block?.witness ?? "", opCount: 0, transfers: 0, posts: 0, votes: 0, customJsons: 0 };
    const txs = block?.transactions ?? [];
    for (const tx of txs) {
      for (const rawOp of tx.operations ?? []) {
        const { type, value } = normalizeOp(rawOp);
        info.opCount++;
        if (type === "transfer") {
          info.transfers++;
          const a = parseAsset(value.amount);
          if (!info.topTransfer || a.amount > info.topTransfer.amount) {
            info.topTransfer = { amount: a.amount, symbol: a.symbol, from: value.from };
          }
        } else if (type === "comment") {
          if (value.parent_author === "" || value.parent_author == null) info.posts++;
        } else if (type === "vote") info.votes++;
        else if (type === "custom_json") info.customJsons++;
      }
    }
    return info;
  }

  private async rpc(method: string, params: unknown): Promise<any> {
    const node = NODES[this.nodeIdx];
    const res = await fetch(node, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: 1 }),
    });
    const j = await res.json();
    return j.result;
  }
}

// handle both appbase ({type:"transfer_operation", value:{...}}) and legacy ([ "transfer", {...} ])
function normalizeOp(op: any): { type: string; value: any } {
  if (Array.isArray(op)) return { type: op[0], value: op[1] };
  const t = String(op.type ?? "").replace(/_operation$/, "");
  return { type: t, value: op.value ?? {} };
}

function parseAsset(a: any): { amount: number; symbol: string } {
  if (typeof a === "string") {
    const [v, s] = a.split(" ");
    return { amount: parseFloat(v) || 0, symbol: s ?? "?" };
  }
  if (a && a.amount !== undefined) {
    const amount = Number(a.amount) / Math.pow(10, a.precision ?? 3);
    const symbol = a.nai === "@@000000013" ? "HBD" : a.nai === "@@000000021" ? "HIVE" : "?";
    return { amount, symbol };
  }
  return { amount: 0, symbol: "?" };
}
