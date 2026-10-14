# Operations

How the live pieces run, and what to do when they don't.

## The leaderboard pipeline

1. A player posts a score: a `hive-runner` custom_json signed with Hive Keychain.
2. The **Contest indexer** workflow (`.github/workflows/indexer.yml`) scans new Hive blocks, validates
   each score (`indexer/index.mjs`, see [anti-cheat.md](./anti-cheat.md)) and commits
   `data/leaderboard.json` and `indexer/state.json` to `main`.
3. The game fetches `data/leaderboard.json` from raw.githubusercontent.com on load and every 5 minutes.
   Until the indexer has published a posted score, the game shows it as a "pending" row from the
   player's own browser storage.

## Indexer cadence

The workflow asks for a run every 15 minutes, but GitHub runs scheduled workflows on a best-effort
basis. Measured in October 2026, runs were 3 to 9 hours apart. A posted score therefore takes hours
to appear, and the game tells players so.

Measured again on 2026-10-14 across 8 consecutive runs: gaps of 2.9 to 7.5 hours, averaging 5.5 —
roughly a 20x shortfall against the requested cadence.

The `schedule:` cron was moved off the quarter hour (`7,22,37,52` rather than `*/15`) because almost
every cron on GitHub is written `*/15` or `*/5`, so :00 :15 :30 :45 are the most contended slots on
the platform. That is a mitigation, not a fix — scheduled events are best-effort by design.

For a cadence you can rely on, trigger `workflow_dispatch` from a machine you control. That event is
user-initiated and is not throttled the same way. Use **`scripts/indexer-cron.sh`**, which keeps the
token out of the crontab, skips a trigger when a run is already active, and reports the usual causes
of failure (expired token, missing Actions scope, workflow disabled after 60 days of repo inactivity)
rather than failing silently:

```
*/10 * * * * /path/to/indexer-cron.sh >> /var/log/hive-runner-indexer.log 2>&1
```

Install notes, including the exact token scope, are in the script's header. Runs are serialised by the
workflow's concurrency group, so an overlapping trigger queues rather than stacking.

### Why this matters more than it looks

On 2026-10-14 the first real score reached the leaderboard, after 1,301 indexer runs over 3.5 months
had found nothing. Until a second player arrives, every one of those runs is still a no-op — so the
thing worth watching is not whether the indexer runs, but whether it ever finds anything. A leaderboard
that reports `contests: {}` for N consecutive weeks should notify someone; nothing does that today.

## When the indexer fails

- **"state.json is unreadable / has an unexpected shape"**: the checkpoint is corrupt. The run stops on
  purpose so it cannot publish an empty leaderboard over the real one. Restore `indexer/state.json`
  from git history and re-run.
- **"short batch"** in the log: a node was behind the one that reported the head block. The run
  checkpoints only the blocks it received and the next run resumes from there. No action needed.
- **Push failed after 3 attempts**: `main` kept moving during the run. The next run rescans the same
  blocks (scanning is idempotent), so nothing is lost.

## Before paying prizes

The public standings carry each top run's `level` and `durationMs`. Review the top scorers before any
payout. Until replay validation exists (see anti-cheat.md), a score that fits the plausibility bounds
can still be forged, so the review and a small prize pool are the real protection.

## Tests

`npm test` runs the indexer's unit tests (`indexer/index.test.mjs`, no dependencies). The indexer
workflow runs them before every scan.
