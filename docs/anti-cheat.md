# Leaderboard Integrity / Anti-Cheat

How we keep the weekly on-chain leaderboard honest.

## The core problem

Scores are posted as a `hive-runner` **custom_json**, signed by the player's Keychain. But a signature
proves **who** posted — *never that the score is real*. Keychain signs whatever the client hands it, so
anyone can broadcast `{ "action":"score", "score": 9999999 }` from devtools or a 5-line script and, with a
naïve indexer, top the board.

Client-side "protection" (HMAC, obfuscation, encrypting the payload) does **not** help: the key lives in
the client, so it's extractable. **A 100% client-side game can never be fully trustless.** The realistic
goal is to make cheating *harder than actually playing*, and to **gate the prize money** so a forged score
can never quietly get paid.

## Strategy: layered, staged

### Layer 1 — Plausibility + gated payouts ✅ SHIPPED

Cheap, indexer-side, kills trivial forgery today.

- **Richer signed payload** (`HiveAuth.postScore`, `app: hive-runner/0.3`): now includes `level`,
  `durationMs`, `postCoins`, and a per-run `nonce` alongside `score`.
- **Indexer rejects the impossible** (`plausibleScore()` in `indexer/index.mjs`, the authority):
  - `score > MAX_RATE(300)·durationSec + BASE_SLACK(600)` → too many points for the time survived.
  - `level` inconsistent with `durationMs` (you can't be level 20 in 5 s — `minTimeForLevel`).
  - `durationMs > 30 min`, or `score > 500k` absolute cap.
  - **No verifiable duration → only tiny scores accepted**, so a context-less/forged-minimal payload
    can never top the board.
- **Best-per-account** already means spamming submissions can't inflate a standing.
- **Manual pre-payout review**: prizes are paid manually, and the public standings now carry
  `level`/`durationMs`, so top-N winners' runs are sanity-checked before any payout. This bounds the real
  financial risk to ~zero regardless of a cleverer forger.

Residual gap: a determined attacker can still craft a *plausible* fake (a score that fits the bounds).
Layer 2 closes that.

### Layer 2 — Deterministic replay validation (PLANNED, next)

The real integrity layer. Make a valid score require a valid *playthrough*, not just a number.

1. **Seed the engine** — replace `Math.random()` (spawn timing, jitter, trail) with a seeded PRNG, so a
   run is fully determined by `(seed, input timeline)`.
2. **Record the run** — capture the seed + the jump-input timeline (timestamps) and include them (or a
   hash + fetchable blob) with the submission.
3. **Re-simulate in CI** — a GitHub Action replays the recorded inputs headlessly and accepts the score
   **only if the replay reproduces it**. (Reuse the real engine in a headless browser, or extract a
   render-free sim core.)
4. **Ranked score = the deterministic part.** Live-chain bonuses (block/whale/post coins) are
   nondeterministic, so in **Ranked** they stay *visual only* and don't add to the postable score; the
   ranked score is the seeded, reproducible base. (Dovetails with the existing Ranked/Free-play split.)

**Shared foundation:** this seeded-determinism + input-recording is exactly what the shadow-racing **P1
replay-ghost** needs (see [shadow-racing-spec.md](./shadow-racing-spec.md) §5). One refactor, two features.

Residual after Layer 2: a **bot that actually plays well** (generates valid inputs) — the same hard
problem every skill leaderboard has, and far above today's bar. Mitigate with: rate limits, a minimum
on-chain **standing/age** requirement for *prize eligibility* (we already read RC/reputation/energy, which
raises Sybil cost), and the manual prize review from Layer 1.

## Non-goals / notes

- We deliberately do **not** try to hide the payload — transparency is fine; integrity comes from
  validation, not secrecy.
- The indexer already buckets by **block timestamp**, so the *week* a score lands in is tamper-proof even
  though the client sends a `contest` hint.
- Free-play runs are never postable, so their perks/inflated scores never touch the contest.
