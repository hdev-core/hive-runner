// Hive Keychain integration for on-chain actions (login proof + posting a score).
// Keychain is a browser extension; only signs if the user owns the key, so a successful
// signature proves account ownership. No private keys ever touch our code.

type KeychainResponse = { success: boolean; message?: string; error?: string };

function keychain(): any | null {
  const w = window as any;
  return w && w.hive_keychain ? w.hive_keychain : null;
}

export function hasKeychain(): boolean {
  return keychain() !== null;
}

/** Prove ownership of `username` by signing a challenge (posting authority). */
export function login(username: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const kc = keychain();
    if (!kc) return resolve({ ok: false, error: "Hive Keychain extension not found" });
    const challenge = `Sign in to Hive Runner — ${new Date().toISOString()}`;
    kc.requestSignBuffer(username, challenge, "Posting", (r: KeychainResponse) =>
      resolve({ ok: !!r.success, error: r.message || r.error }),
    );
  });
}

export interface RunContext {
  level: number; durationMs: number; postCoins: number;
  startTs: number;    // wall-clock seconds when the run began
  startBlock: number; // chain head block when the run began (0 if the block feed was down)
}

/**
 * Broadcast a score to the chain as a `hive-runner` custom_json (free, posting auth).
 * The `contest` week enters the weekly leaderboard; `community` reps the player's team.
 * The indexer re-derives the authoritative week from the block timestamp, so a spoofed
 * `contest` value can't place a score in a different week.
 *
 * Anti-cheat note: a signature only proves *who* posted, never that the score is real —
 * a client-side game can't be fully trustless. We include run context (level, duration) so
 * the indexer can reject IMPOSSIBLE scores (plausibility layer), and prizes are reviewed
 * before payout. `startBlock`/`startTs` anchor the run to real time: the indexer rejects a run
 * whose claimed duration is longer than the time between its start and the block it was posted
 * in. Full deterministic-replay validation is the planned next layer — see docs/anti-cheat.md. The `nonce` is a per-run id for that future replay/dedup work.
 */
export function postScore(
  username: string,
  community: string,
  score: number,
  game: string,
  contest: string,
  run: RunContext,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const kc = keychain();
    if (!kc) return resolve({ ok: false, error: "Hive Keychain extension not found" });
    const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const json = JSON.stringify({
      app: "hive-runner/0.4", action: "score", game, community, score, contest,
      level: Math.max(1, Math.floor(run.level)),
      durationMs: Math.max(0, Math.round(run.durationMs)),
      postCoins: Math.max(0, Math.floor(run.postCoins)),
      startTs: Math.floor(run.startTs), startBlock: Math.max(0, Math.floor(run.startBlock)),
      nonce, ts: Math.floor(Date.now() / 1000),
    });
    kc.requestCustomJson(username, "hive-runner", "Posting", json, `Post score: ${score}`,
      (r: KeychainResponse) => resolve({ ok: !!r.success, error: r.message || r.error }),
    );
  });
}
