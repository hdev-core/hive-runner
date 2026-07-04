# In-Game Giveaways ("Prize Drops") — Design & Scope

Free, sponsor-funded rewards (HIVE and Hive-Engine tokens — AFIT, SPORTS, …) that appear for
**random players during play**. A pooled account holds the prizes; players occasionally find a
**prize crate**, and winners receive a real on-chain transfer.

> Status: **scoping** (not yet built). See [../ENHANCEMENTS.md](../ENHANCEMENTS.md).

---

## 1. This must NOT be gambling (hard constraint)

Players **never stake or pay** anything to play or to receive a drop — no entry fee, no wager, no
loss. Prizes are **free promotional airdrops** funded by sponsors/donations (a sweepstakes/faucet,
not a bet). To stay clearly on this side:

- No paid entries, no "pay to boost your odds," no staking-to-play.
- Eligibility is earned only by **playing + real Hive activity**.
- Avoid slot-machine "spin and usually lose" UX (near-miss psychology). Crates should be **rare and
  mostly meaningful**; consolation is in-game points, never a "you lost" beat.

Given the project's no-gambling / haram constraint, this framing is load-bearing — the whole design
assumes **free giveaway, no stake, no loss**. Confirm you're comfortable it reads that way.

---

## 2. The core challenge (read first)

The game is a **static, client-side site** with no trusted server (only a scheduled GitHub Action).
Paying out tokens requires signing transfers with the **pool account's active key**, which **cannot
live in the browser** — anyone could extract it and drain the pool. Therefore:

- **Wins must be authoritative** — decided by whatever holds the key, not declared by the client. A
  malicious client must not be able to mint a win.
- **Truly "on the fly" (instant) payouts require an always-on backend hot wallet.** The current
  zero-backend model can instead do **near-real-time, batched** payouts.

Everything below follows from this trust boundary.

---

## 3. Architecture options

### Option A — Scheduled payout runner (extends the existing Action model) — **recommended MVP**
1. Player grabs a crate → client posts a **claim** `custom_json` (Hive Keychain, posting auth — proves
   identity, costs nothing but RC).
2. A **payout runner** (a scheduled job that holds the pool's active key as a secret) streams claims,
   runs the **authoritative draw** (verifiable RNG + budget + caps + anti-fraud), and **signs payouts**
   (HIVE `transfer` / HE token `custom_json`). Results written to a public `payouts.json` (+ transfer memo).
3. Client polls the result → "🎉 You won 5 AFIT!" or "No prize this time."

- Cadence: every ~2–15 min (near-real-time), or continuous as a small always-on worker.
- ✅ No user-facing backend; reuses the indexer pattern; key isolated to the runner.
- ⚠️ Not sub-second. And a signer holding an active key is workable only for a **low-balance** pool.
  GitHub Actions *can* hold it as a secret, but that's riskier (secret exposure via workflow/PR edits) —
  a tiny dedicated worker (your VPS / serverless / a cron on your box) is safer. Both are viable.

### Option B — Hot-wallet backend (real-time)
An always-on service holds the pool key and, on a verified win, signs + broadcasts **instantly**.
Richest UX and true "on the fly," but needs hosting + an always-on hot wallet (bigger attack surface).
Overkill for MVP; graduate to it if latency/volume demand.

### Option C — Manual / curated (no automated key)
The runner only **records** winners; you pay eligible/random players **manually** (like today's contest
payouts). Zero key-in-automation risk, ships immediately, but manual and not instant.

**Recommendation:** ship **P0 with Option C** (validate the loop + UX with zero key risk), then automate
with **Option A** (low-balance hot pool, near-real-time). Reserve **B** for later.

---

## 4. Components

| Component | What |
|---|---|
| **Pool account** (e.g. `@hiverunner-pool`) | Holds HIVE + HE tokens. A **hot wallet** with a capped balance, topped up manually from a cold account. |
| **Funding** | Anyone sends HIVE/HE tokens to the pool (sponsors, donations, DHF, you). Memo can tag the sponsor. |
| **Pool-balance display** | Client reads HIVE + HE balances → "🎁 Prize pool: 42 HIVE · 5,000 AFIT · 1,200 SPORTS" + sponsor credits. A real draw to play. |
| **Drop config** (`data/drops.json`) | Budget/day, prize table + weights + per-token caps, drop rate, eligibility weights, per-user cap/cooldown, kill-switch. Client reads it to pace visuals; runner treats it as source of truth. |
| **Claim op** | Player's grab, as a signed `custom_json`. |
| **Payout runner** | Authoritative draw + signing + payout log. |
| **Result feed** (`data/payouts.json` + on-chain memo) | Client polls for the player's outcome. |

---

## 5. Display algorithm (how crates appear)

Two layers, **deliberately decoupled** — this is the key idea:

**(a) Visual crates — client-side, just UX.** During a run, spawn a rare prize crate with a small
per-second probability, weighted by **eligibility** so real users see more:

```
p_crate_per_sec = base_rate × eligibility(user)
eligibility = f(logged_in, activity_rank, streak, min_score_reached, account_age/RC) ∈ [0,1]
```
Guests (logged-out) get no crates — they can't be paid anyway; zero-activity accounts get near-zero weight.

**(b) Authoritative payout — runner-side, budget-limited, fair.** The grab is a *claim*, not a win. The
runner decides real prizes with a **token bucket paced to the budget**:

```
D = daily_budget / avg_prize_value              # target payouts/day
refill "prize credits" at D/day  (token bucket, capacity C)
for each claim, in block order:
    if ineligible / over per-user cap / duplicate → reject (consolation points, no token)
    else if no prize credit available            → "no prize this time" (budget-paced)
    else:
        prize = weighted_pick(prize_table, bounded by remaining per-token balance)
        seed  = hash(claim_block_id + account + nonce)   # verifiable, non-grindable RNG
        pay(account, prize); consume a credit; set user cooldown; log payout
```

- **Per-user cap + cooldown** (e.g. max 1 win/day/account) → spreads prizes to **many random users** (the
  stated goal), not a few farmers.
- **Global budget guard** (token bucket) → the day's giveaways ≈ the budget; the pool never drains in an hour.
- **Verifiable RNG** seeded from the claim's block id → reproducible/auditable; the player can't grind it.
- **Consolation** = in-game points (not tokens), so a no-prize crate still feels fine (no "you lost" beat).

Result: frequent, fun crates; real payouts that are fair, capped, budget-safe, and **unforgeable**.

---

## 6. Payout mechanics

- **HIVE / HBD:** `transfer` op (active auth), pool → winner, memo `"Hive Runner prize 🎁"`.
- **Hive-Engine tokens (AFIT / SPORTS / …):** `custom_json` id `ssc-mainnet-hive`,
  `{ contractName:"tokens", contractAction:"transfer", contractPayload:{ symbol, to, quantity, memo } }`
  (active auth).
- Batch payouts per run; respect RC/mana + HE tx limits; retry/backoff; **idempotency** (one payout per
  claim id, keyed in runner state).

---

## 7. Data model / schemas

- **Claim** (player → chain): `custom_json` id `hive-runner`, posting auth —
  `{ "action":"claim", "crate":"<runNonce>", "block":<n>, "game":"Runner Dash", "ts":<epoch> }`
- **Drop config** (`data/drops.json`, you edit):
  `{ enabled, budgetPerDay, dropBaseRate, prizes:[{symbol, amount, weight, maxPerDay}], eligibility:{…}, perUserCap, cooldownHours }`
- **Payout log** (`data/payouts.json`, committed by runner):
  `{ "<claimId>": { account, symbol, amount, txid, status, ts } }` → client polls for its result.
- **Runner state**: last processed block, prize credits, per-user counters, per-token spent.

---

## 8. Anti-fraud, abuse & security (must-haves)

- **Authoritative wins only** — the client cannot mint a win.
- **Login required to be payable** — the claim is posting-signed → a real account; RC gates spam.
- **Per-account daily cap + cooldown**, and a **global daily budget** (token bucket).
- **Eligibility weighted by real on-chain activity** (expensive to fake) + optional min account age / RC / score.
- **Sybil resistance:** caps + budget + activity-weighting; consider reputation/age gates; watch for clusters.
- **Replay/idempotency:** one payout per claim id; claim bound to a specific block/run.
- **Hot-wallet hygiene:** low pool balance; manual cold→hot top-ups; drain alerting; key only in the
  runner (never client); rotate if leaked; restrict who can edit the runner/secrets.
- **Kill switch:** `enabled:false` in the config pauses all drops instantly.

---

## 9. Phased delivery

- **P0 — Display + pool + claims, manual payout (Option C).** Pool account + balance display + visual
  crates + claim op + a "pending wins" list you pay by hand. Validates the loop/UX with **zero automated
  key risk**. (~1–2 days)
- **P1 — Automated runner (Option A).** Authoritative draw + budget/caps + auto HIVE + HE payouts +
  result feed, on a low-balance hot pool. (~3–5 days + ops)
- **P2 — Real-time (Option B) + sponsor-funding UI + prize-table admin**, if warranted. (~1–2 weeks)

---

## 10. Decisions needed from you

1. **Payout automation:** manual first (P0) → scheduled runner (A) → always-on backend (B)?
2. **Where the signer runs:** GitHub Action secret (low-balance) / your own VPS-cron / serverless?
3. **Prize tokens & budget:** which tokens (HIVE, AFIT, SPORTS, …), daily budget, prize table + caps?
4. **Pool account handle** + who funds it initially?
5. **Confirm** the free-giveaway (non-gambling) framing is acceptable.
