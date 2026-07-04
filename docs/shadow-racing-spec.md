# Shadow / Ghost Racing — Redesign Spec

How the "race your Hive friends" feature should work. Replaces the current DOM race strip with
**in-world ghost runners driven by real scores**. Research-backed (see §6).

> Status: **P0 shipped** (§5). The DOM strip is retired; rivals now render in-world as
> real-score ghosts. Remaining phases (P1 replay ghosts, P2 shareable/community) still planned.

---

## 1. What we have today, and why it's weak

`src/race/RaceStrip.ts` renders a **separate DOM bar below the canvas**. Each rival is an avatar
that slides left→right on the bar. You advance by `score / 300`; each rival advances by a fabricated
`pace` value.

Two structural problems:

1. **It's disconnected from the game.** The race lives *outside* the play area, in a widget most
   players never look at while dodging. The thing you're doing (jumping blocks) and the thing you're
   "racing" (a bar below) have no visual or mechanical link. It reads as a decoration, not a race.
2. **The pace is fake.** `paceFromPosts(post_count)` turns a rival's *lifetime post count* into a
   made-up speed (`HiveSocial.getGhosts`). So "🏁 Passed @alice!" doesn't mean you beat anything
   Alice actually did — it's a number invented from her posting history. There's no real stake, so
   overtakes feel hollow.

The research is blunt about the fix: the durable version of this mechanic is an **in-world ghost of a
real run** — the pattern every successful endless runner uses (§6).

---

## 2. Design goals

- **In the world, not beside it.** The rivals run **on the same track as you**, in the Pixi scene, so
  you *see* yourself pull ahead of / fall behind them as you play.
- **Real stakes.** A ghost represents a **real score** — your own personal best, or a real player on
  the weekly leaderboard — so overtaking it means something.
- **Legible at a glance.** At most ~3 visible ghosts; clear "ahead of you" vs "behind you" reading;
  never clutters the dodging lane.
- **Zero new backend.** Reuse data we already have: the weekly `leaderboard.json`, the player's own
  best (localStorage), and follows/community accounts. No servers, no realtime.
- **Cosmetic-only stakes** (house rule): racing is for status/streaks, never money — no stake, no loss.

---

## 3. The model: distance-based in-world ghosts

Our runner sits at a fixed `charX` while the world scrolls left. So "how far you've run" is a virtual
**distance** = a function of score/time, not an on-screen x. Give every racer a distance and place
them relative to you:

```
myDistance    = f(myScore)                 // e.g. score itself, or survival metres
ghostDistance = f(ghostTargetScore * (elapsed / ghostFinishTime))   // pace toward their real score
screenX(g)    = charX + (ghostDistance - myDistance) * PX_PER_UNIT   // ahead → right, behind → left
```

- A ghost **ahead** of you renders **in front** (further right, toward the finish), semi-transparent,
  running the same leg animation. As your score climbs, it drifts back toward you; when you pass, it
  slides off the left edge and a "🏁 Passed @x" toast fires (keep the existing overtake feedback).
- A ghost **behind** you renders to your left (or as a small "catching up" indicator at the screen
  edge if off-view).
- Ghosts **never collide** with anything — they're translucent pacers, not obstacles. They ignore the
  procedural block field (which differs from the run that set their score), so they just *run*; they
  don't fake-jump at your obstacles.
- Cap on-screen ghosts to **2–3 nearest** (the ones just ahead / just behind), so the lane stays
  readable. Everyone else is summarised in a tiny corner "P3 / 6" rank pill.

Rendering: a stripped, tinted version of `drawRunner` (or the ghost's palette at ~45% alpha) with the
rival's Hive avatar as a floating disc above them (`attachAvatar`, already used for coins/billboards).

---

## 4. Where the ghosts come from (real data, layered)

Priority order — each is a real, meaningful target:

1. **Your personal-best ghost** ("beat your best"). Always available, even offline/solo. Distance
   paced from your stored best score. This alone is the single highest-value ghost (self-competition
   drives retention with zero social dependency).
2. **The leaderboard rival just above you** (the *Trials Fusion* pattern). Read this week's
   `leaderboard.json`, find the player one rank above you, race their **real score**. Beating them =
   a real position change you can then claim by posting a higher score. Most motivating social ghost.
3. **Follows / community best** (optional flavour). For logged-in players, one or two accounts you
   follow (or from the selected community) whose *real* recent best we know — otherwise skip them
   rather than invent a pace. (This replaces `paceFromPosts`; if we have no real score for an account,
   they simply don't appear as a ghost.)

This also fixes the current "fake pace" problem: **no real score → no ghost.**

---

## 5. Phasing

- **P0 ✅ SHIPPED — In-world pace ghosts (real scores).** Race moved into the Pixi scene per §3.
  Ghosts = **personal best** (green) + the **leaderboard rival one rank above you** (blue) + the
  **top-scoring member of the selected Team pool** who's on the board (gold ⭐). Nearest target first,
  capped at 3; a neutral "Goal" line stands in only when a player has *no* real target yet. DOM strip
  retired (`src/race/RaceStrip.ts` deleted). Rendered by `RunnerEngine` (`buildGhosts`/`updateGhosts`,
  `RaceGhost`); targets assembled in `main.ts` `computeGhosts()`.
- **P1 — True replay ghost.** Record your best run's **vertical-position timeline** (sample `charY`
  every ~50 ms → a compact array in localStorage). Replay it as a ghost that reproduces your *actual
  jumps*. Because obstacles are procedural, pair this with a **seeded obstacle field** so a replay
  faces the same blocks it was recorded against (a "daily seed" / time-trial mode) — this is where a
  recorded ghost becomes truly honest. ~2–3 days.
- **P2 — Shareable & community ghosts.** After a run, share a link that lets a friend race *your*
  ghost 1v1 (encode seed + score, or the recorded timeline). Community "pace-setter" ghost = the top
  score in the selected community this week. Ties into referrals + the weekly contest.

---

## 6. Research basis

- **In-world ghosts of real runs are the proven pattern.** Endless runners (Subway Surfers, Hill
  Climb Racing) use recorded **ghost runs** to create competition without realtime opponents — and
  async play suits casual/low-DAU games because there's no wait for a live match. ([Udonis][udonis],
  [Segwise][segwise])
- **Race the player above you on the leaderboard.** Trials Fusion lets you race the **ghost of the
  person one rank above you** — a concrete, escalating target — cited as a standout leaderboard
  design. ([Game Developer][gd])
- **Ghost = recorded performance data.** In racing games a "ghost" is stored performance data (the
  player's timeline + metadata) replayed on a later run; you can even share your ghost so a friend
  races it 1v1. ([Real Racing 3 / Pocket Gamer][pg], [Ghost Pro Racing][ghn])
- **Leaderboards + async rivalry drive return visits.** Async PvP, friendly rivalry and leaderboards
  motivate players to come back and beat a rank — strong for retention, especially casual mobile.
  ([Melior Games][melior], [Skillz][skillz])

Takeaway: our instinct (race friends) is right; the *implementation* (a fabricated-pace bar beside the
game) is the weak part. Put a **real-score ghost inside the world**, starting with your own best and
the rival just above you.

---

## 7. Open decisions

1. ~~**P0 scope**~~ — **decided:** personal-best + leaderboard-rival + Team-pool leader (keeps the
   Team dropdown meaningful, honestly — only members with real scores appear).
2. ~~**Keep or kill the DOM strip**~~ — **decided:** killed; ghosts are fully in-world.
3. **Time-trial mode (P1):** is a **seeded/daily obstacle field** (needed for honest replay ghosts)
   worth adding as its own mode alongside the endless mode? *(still open)*

[udonis]: https://www.blog.udonis.co/mobile-marketing/mobile-games/social-features-mobile-games
[segwise]: https://segwise.ai/blog/boost-mobile-game-retention-strategies
[gd]: https://www.gamedeveloper.com/design/leaderboards---the-original-and-best-social-feature-
[pg]: https://www.pocketgamer.com/real-racing-3/real-racing-3s-asynchronous-multiplayer-turns-ghosts-into-ai-competitors/
[ghn]: https://news.ycombinator.com/item?id=45490844
[melior]: https://meliorgames.com/game-development/game-mechanics-that-drive-player-retention/
[skillz]: https://www.skillz.com/news/competitive-multiplayer-mobile-games-synchronous-vs-asynchronous/
