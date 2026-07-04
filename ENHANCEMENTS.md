# Hive Runner — Enhancements & Roadmap

A living backlog of ideas for the game. See [README.md](./README.md) for what's already shipped.

**Guiding principle — "lucrative to Hive users" needs a real value _inflow_.** You can't pay players
sustainably out of pocket. On Hive there are three real inflows, and every earning idea below maps to one:

- **Reward pool** — upvotes on content the game generates.
- **Sponsors** — Hive projects / Actifit paying to be in the game.
- **A token / asset market** — Hive Engine.

**Non-negotiable constraint:** everything is **skill / effort / content based**. No betting, wagering, or
games of chance for money — ever.

**Status legend:** ✅ shipped · 🔨 building · 📋 planned (chosen) · 💡 considered

---

## 1. Earning & monetization

| Idea | Status | Notes |
|---|---|---|
| **Weekly on-chain contest** (signed score → Action indexer → leaderboard) | ✅ | Manual payout. The rails for everything below. |
| **Sponsor-funded contests** | 📋 | Data-driven contests with **sponsor slots**: a sponsor funds the pot, their logo appears in-game (coin / backdrop / banner), app shows pot + winners. Daily + weekly windows. Sponsorships are the sustainable inflow (Actifit, Hive dApps, witnesses). |
| **Play-to-post + curation** | 💡 | Finishing a run one-taps a real Hive post (a "run card": score, level, witnesses passed, posts discovered) that earns from upvotes; a curation account upvotes the best daily runs → real HIVE/HBD, and the curator earns curation rewards back. |
| **Curation-through-play** | 💡 | At run's end, upvote the post-coins you collected (your vote, or a shared curation vote if you delegate). The game becomes a content-discovery + curation engine — authors earn, curators earn, players get a reason to collect. |
| **Hive Engine token + cosmetic NFTs** | 💡 | Earn a tradable token / cosmetic NFTs (runner skins, parcel designs, witness cards) by hitting skill milestones; spend on cosmetics (the sink). Real market value — needs careful sink design to avoid the StepN faucet-drain trap. |
| **Delegation-for-boosts** | 📋 | Delegate HP to the game account → in-game perks (energy / multiplier); that same HP powers the curation votes that pay players back. Gives idle stake a reason to engage. |

## 2. Retention & engagement

| Idea | Status | Notes |
|---|---|---|
| **Real on-chain energy** (RC/mana + 24h ops + Actifit steps) | ✅ | "Be active on Hive → power up." |
| **Daily streaks + quests** | 🔨 | Consecutive-day play streak + 3 rotating daily objectives; completing them grants in-game boosts. Deterministic daily quest set (no backend). |
| **Achievements / badges** | 💡 | Lifetime milestones (first 1k run, 100 witnesses passed, 30-day streak). Later mintable as Hive-Engine NFTs. |
| **Seasons / ladders** | 💡 | Monthly seasons with a reset ladder and season-end rewards; ties naturally to sponsor cycles. |
| **Power-ups & special blocks** | 💡 | Temporary boosts (shield, magnet, 2×) and "boss blocks" tied to big on-chain events (a whale transfer spawns a mini-boss). |

## 3. Social & growth

| Idea | Status | Notes |
|---|---|---|
| **Ghost racers** (race the accounts you follow) | ✅ | Pace derived from real Hive activity. |
| **Community teams** | ✅ | Represent a subscribed community when posting a score. |
| **Referrals + team pots** | 📋 | Referral credit carried in the score op; indexer credits the referrer. Community-team pooled leaderboards & prizes → viral growth. |
| **Guilds / tournaments** | 💡 | Bracketed tournaments between communities; guild leaderboards. |
| **Shareable run cards** | 💡 | Auto-generated image of your run for sharing (feeds play-to-post). |

## 4. Gameplay & content

| Idea | Status | Notes |
|---|---|---|
| **Runner archetype + levels + activity boosts** | ✅ | Flagship. |
| **More archetypes** | 💡 | `reaction`, `maze` engines to broaden variety (spec model already supports it). |
| **Cosmetics / skins** | 💡 | Alternate courier skins, parcel designs, trails — earned or sponsored; the sink for a token economy. |
| **Difficulty modes / endless leaderboard** | 💡 | Casual vs. hardcore; a permanent all-time board alongside the weekly. |

## 5. Hive-native depth

| Idea | Status | Notes |
|---|---|---|
| **Live block feed + witness avatars** | ✅ | The world is driven by real Hive activity. |
| **Posts as billboards + collectible post-coins** | ✅ | Discovery toast opens the real post on peakd. |
| **Official Hive logo + on-chain-city visuals** | ✅ | Rendered from the brand SVG. |
| **Witness-support / DHF quests** | 💡 | Optional quests that nudge engagement with the ecosystem (e.g. explore a witness's page) — informational, never vote-buying. |
| **On-chain achievements as NFTs** | 💡 | Mint milestone badges as Hive-Engine NFTs (status + tradability). |

## 6. Technical & infrastructure

| Idea | Status | Notes |
|---|---|---|
| **Scheduled Action score indexer** | ✅ | Zero-server leaderboard aggregation. |
| **Keychain login + persistent session** | ✅ | |
| **Self-hosted CORS image proxy** | 💡 | Replace the `wsrv.nl` dependency for avatars/logos in production. |
| **HAF-based indexer** | 💡 | If score volume outgrows block-streaming in an Action, move to a HAF app / small service; add all-time aggregates. |
| **Server-side score validation / anti-cheat** | 💡 | Scores are currently self-reported (signed, but not gameplay-verified). For real prizes, add replay/seed verification or a trusted scoring path. |
| **Sound & music** | 💡 | Chiptune SFX/music (spec already carries an `audioTheme`). |

---

## Near-term sequence (chosen)

1. ✅ **Real Keychain login + energy** — the identity + on-chain-read foundation.
2. 🔨 **Daily streaks + quests** — daily retention.
3. 📋 **Sponsor-funded contests** — the earning engine (the money piece).
4. 📋 **Referrals + team pots** — viral growth.
5. 📋 **Delegation-for-boosts** — engage idle HP.

_Add new ideas here as they come up; move rows between sections and update the status as they ship._
