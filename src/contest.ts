// Weekly sponsored score contest — configuration + shared time helpers.
//
// How it works end to end:
//   1. A player's run is posted on-chain as a `hive-runner` custom_json (see HiveAuth.postScore).
//   2. A scheduled GitHub Action (indexer/index.mjs) streams the chain, buckets each score into
//      the contest week of its BLOCK timestamp (tamper-resistant), keeps each account's best, and
//      commits data/leaderboard.json.
//   3. This client fetches that file (raw GitHub URL, CORS-enabled) and renders the standings.
//   4. Prizes are paid MANUALLY each week to the top scorers (no smart contract).

export const CONTEST = {
  prizeText: "🏆 Weekly prize pot — top 3 scorers, paid out manually each week.",
  topN: 10,
  // The indexer commits here; raw.githubusercontent serves it with CORS + a 5-min CDN cache.
  dataUrl: "https://raw.githubusercontent.com/hdev-core/hive-runner/main/data/leaderboard.json",
};

export interface LeaderRow { account: string; score: number; game: string; ts: number; }
export interface LeaderboardFile {
  updated: number;                         // ms epoch of the last indexer run
  current: string;                         // contest week id the indexer considers "now"
  contests: Record<string, LeaderRow[]>;   // weekId -> rows sorted by score desc
}

// ISO-week id in UTC, e.g. "2026-W27". Contests run Monday 00:00 → Sunday 24:00 UTC.
// Duplicated (in JS) inside indexer/index.mjs — keep the two in sync.
export function weekId(d: Date = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7;          // Mon=0 … Sun=6
  date.setUTCDate(date.getUTCDate() - day + 3);    // shift to the week's Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date.getTime() - firstThursday.getTime()) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ms remaining until the current contest closes (next Monday 00:00 UTC).
export function msUntilWeekEnd(d: Date = new Date()): number {
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (7 - day), 0, 0, 0);
  return next - d.getTime();
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "closing…";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h left`;
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
}
