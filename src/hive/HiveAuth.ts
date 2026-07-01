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

/** Broadcast a score to the chain as a custom_json (free, posting auth). */
export function postScore(
  username: string,
  community: string,
  score: number,
  game: string,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const kc = keychain();
    if (!kc) return resolve({ ok: false, error: "Hive Keychain extension not found" });
    const json = JSON.stringify({ app: "hive-runner/0.1", action: "score", game, community, score });
    kc.requestCustomJson(username, "hive-runner", "Posting", json, `Post score: ${score}`,
      (r: KeychainResponse) => resolve({ ok: !!r.success, error: r.message || r.error }),
    );
  });
}
