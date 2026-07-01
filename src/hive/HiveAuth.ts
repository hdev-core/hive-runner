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

/**
 * Broadcast a score to the chain as a `hive-runner` custom_json (free, posting auth).
 * The `contest` week enters the weekly leaderboard; `community` reps the player's team.
 * The indexer re-derives the authoritative week from the block timestamp, so a spoofed
 * `contest` value can't place a score in a different week.
 */
export function postScore(
  username: string,
  community: string,
  score: number,
  game: string,
  contest: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const kc = keychain();
    if (!kc) return resolve({ ok: false, error: "Hive Keychain extension not found" });
    const json = JSON.stringify({
      app: "hive-runner/0.2", action: "score", game, community, score, contest,
      ts: Math.floor(Date.now() / 1000),
    });
    kc.requestCustomJson(username, "hive-runner", "Posting", json, `Post score: ${score}`,
      (r: KeychainResponse) => resolve({ ok: !!r.success, error: r.message || r.error }),
    );
  });
}
