# Cosmetics & Progression — Design & Scope

The **durable, ownable reward layer** — the research's #1 answer for retention that isn't cash
([rewards-strategy.md](./rewards-strategy.md)). Earn XP + a soft currency by playing; unlock and equip
**cosmetics** (skins, parcels, trails, themes); optional path to **tradable Hive-Engine NFTs** later.

> Status: **scoping**. Purely visual — **no gameplay advantage** (fairness is a proven retention factor;
> players prefer cosmetics-only over pay-to-win).

---

## 1. Design principles (from the research)

- **Cosmetic-only, never pay-to-win.** Boosts stay in the *activity/energy/streak* systems (earned), not
  purchasable. Cosmetics change looks, not stats.
- **Earn-first, not buy-first.** Progression + play unlock most cosmetics; a soft-currency shop adds
  *choice*, not a paywall.
- **Three-tier goals** (daily / mid-term / long-term) — the durable retention shape, not one-off rewards.
- **Soft currency is non-cashable** (closed faucet→sink loop) → no tokenomics/inflation/gambling risk.
- **Chain is optional & hidden.** Works fully off-chain; on-chain ownership/trading is a later add-on.
- **Actifit tie-in:** real-world steps grant bonus XP/coins → reinforces move-**to-play** + the Type-3 moat.

---

## 2. The three sub-systems

### A. XP & Levels — the progression backbone
- **Earn XP per run**, e.g. `xp = floor(score/10) + level_reached*15 + postCoins*5 + questBonus`.
- **Account level** from cumulative XP on a rising curve (e.g. `xpForLevel(L) ≈ 120 * L^1.4`).
- Level is **status + the primary unlock gate** ("reach Lv 8 → Neon HUD theme"). XP is the connective,
  non-cashable currency (the Duolingo model: immediate positive feedback tying mechanics together).
- **Actifit bonus:** today's steps grant a capped XP top-up (activity → progress).

### B. Coins — soft currency for the shop
- **Earn coins by playing** (`coins = floor(score/50) + quest/streak bonuses`), with a **daily cap**
  (anti-grind, keeps the faucet bounded).
- **Sink = the cosmetics shop.** Closed loop (coins only buy cosmetics), so no inflation.
- Also awarded by streak milestones, quest completion, and weekly-contest placement.

### C. Cosmetics catalog — what you unlock/equip
All render from the existing **procedural** art (palette/shape swaps — cheap, no art assets needed):

| Type | Examples | How it renders |
|---|---|---|
| **Courier skins** | recolors + outfit variants; alt characters (e.g. "Whale Courier", "Witness") | palette + shape params in `RunnerEngine.drawRunner` |
| **Parcel designs** | crate colors, wrap styles, sponsor/community logos on the back parcel | parcel fill + logo swap |
| **Trails** | particle trail behind the runner (spark, coins, hex confetti) | a small particle emitter |
| **World themes** | day / neon / space / orchard palettes for sky + block-city | `Background` palette/decor variant |
| **Coin & FX skins** *(later)* | pickup/coin look, jump puff | draw params |

**Rarity tiers** (common / rare / epic / legendary) drive status + pricing + drop cadence.

---

## 3. How cosmetics are obtained (multiple paths = layered goals)

1. **Level unlocks** — reach level N → unlock cosmetic X (long-term progression).
2. **Achievement rewards** — milestone quests grant *exclusive* cosmetics (mastery; higher retention).
3. **Shop purchases** — spend earned coins (agency/choice; the sink).
4. **Seasonal / contest rewards** — top players & season pass get limited cosmetics (status, scarcity).
5. **Sponsor / community cosmetics** — a sponsor's or community's themed skin (ties into the sponsor model
   + a monetization channel; e.g., "Actifit Courier", "LeoFinance parcel").

---

## 4. Wardrobe / locker UI
- A collapsible **Wardrobe** panel (matches the contest/quests cards): tabs per cosmetic type, a grid of
  owned + locked items (locked show the unlock condition), **preview + Equip**.
- Header shows **level + XP bar + coin balance**.
- Equipped cosmetics persist and render in the next run.

---

## 5. Persistence & the NFT path

- **P0 (MVP): localStorage** — owned set, equipped set, XP, level, coins. Instant, zero backend.
- **P1: on-chain progression** — post XP/coin-earning events (or derive from the score `custom_json` the
  indexer already reads) so progression is **portable + verifiable** across devices and anti-cheat.
- **P2: tradable NFT cosmetics** — mint select **rare** cosmetics as **Hive-Engine NFTs** (`nftmarket`),
  tradable for status + a healthy sink. Strictly **optional add-on** — the game is fully playable and all
  *core* cosmetics remain earnable without ever touching NFTs (avoids the speculative treadmill).

**Trade-off note:** localStorage is fast but device-bound and forgeable; on-chain is portable/tradable but
needs indexer work. Start local, migrate the *ledger of ownership* on-chain when it matters.

---

## 6. Economy balance (faucet ↔ sink)

- **Faucets:** per-run coins/XP (capped daily), quest/streak/contest bonuses, Actifit steps.
- **Sinks:** cosmetics priced by rarity; keep catalog depth ahead of earning rate so there's always a next
  goal. Since coins are **non-cashable**, there's no market to inflate — balance is purely "time-to-unlock
  feels rewarding, not grindy."
- **Anti-grind / anti-bot:** daily coin cap, login-gated on-chain progression, min-score to earn.

---

## 7. Technical fit (our stack)

- Character/parcel/ground/background are **already procedural** (`RunnerEngine.drawRunner`, `drawBlock`,
  `drawGround`, `Background`, `hiveLogo`) — a **skin = a set of palette/shape params**, so cosmetics are
  cheap to add and need no external art.
- New modules: `src/cosmetics/catalog.ts` (cosmetic defs + render params + unlock rules),
  `src/cosmetics/progression.ts` (XP/level/coins/owned/equipped, localStorage), a `Wardrobe` UI in
  `main.ts`/`index.html`, plus a small trail **particle** system in `RunnerEngine`.
- Wire equipped skin → `RunnerEngine` palette; equipped theme → `Background`; equipped trail → emitter.

---

## 8. Phased delivery

- **P0 ✅ SHIPPED: earn-and-equip core.** XP + levels (localStorage) + a deep catalog (**16 skins, 11
  parcels, 10 trails, 10 themes** = 47 items) unlocked by **level (up to L20) / milestone**, a Wardrobe
  UI (scrollable grid), and in-game rendering of the equipped set (skin palette, parcel colors, trail
  particles incl. spark/coin/hex/ring/star/bubble kinds, and 10 world themes each with its own sky
  palette). Pure progression unlocks (no coin shop yet). `src/cosmetics/{catalog,progression}.ts`.
- **P1 (~2–3 days): the shop + depth.** Soft-currency shop (earn coins → buy), rarity tiers, more catalog,
  seasonal/contest cosmetic rewards, sponsor/community skins.
- **P2 (later): on-chain + NFTs.** Portable on-chain progression; tradable Hive-Engine NFT cosmetics;
  season pass.

---

## 9. Decisions needed
1. **Start with progression-only unlocks (P0)** or include the **coin shop** from the start?
2. **Persistence:** localStorage first (recommended) vs. straight to on-chain progression?
3. **Catalog theme direction** — how "Hive-branded" (witness/community/sponsor skins) vs. generic arcade
   (space/neon/retro)? A mix?
4. **NFT cosmetics** — in scope as a later phase, or keep everything non-tradable soft-cosmetics?
