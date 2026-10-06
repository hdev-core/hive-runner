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

To get a dependable cadence, trigger the workflow from outside GitHub. Any machine with a cron and a
fine-grained token scoped to this repo (Actions: read and write) can do it:

```
*/10 * * * * GH_TOKEN=<token> gh workflow run "Contest indexer" --repo hdev-core/hive-runner
```

Runs are serialised by the workflow's concurrency group, so overlapping triggers are safe.

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
