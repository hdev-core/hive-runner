#!/usr/bin/env bash
# Trigger the Hive Runner contest indexer from outside GitHub.
#
# WHY THIS EXISTS
# The workflow asks for every 15 minutes via `schedule:`, but GitHub runs scheduled
# workflows best-effort and deprioritises low-activity free repos. Measured over 8
# consecutive runs in October 2026 the real gaps were 2.9-7.5 hours, averaging 5.5 — about
# a 20x shortfall. A player posts a score and sees nothing for half a day, which makes the
# project's headline feature feel broken even when every component works.
#
# `workflow_dispatch` is a USER-INITIATED event and is not throttled the same way, so
# triggering it from a machine you control gives a cadence you can actually rely on.
#
# INSTALL (any always-on box with bash, cron and gh)
#
#   1. Create a fine-grained PAT at https://github.com/settings/personal-access-tokens
#      - Repository access: only `hdev-core/hive-runner`
#      - Permissions: Actions → Read and write. Nothing else.
#      - Set an expiry you will actually remember to rotate.
#
#   2. Put it somewhere only your user can read:
#        install -m 600 /dev/null ~/.hive-runner-indexer.env
#        echo 'GH_TOKEN=github_pat_...' > ~/.hive-runner-indexer.env
#
#   3. Install this script and add the cron entry:
#        crontab -e
#        */10 * * * * /path/to/indexer-cron.sh >> /var/log/hive-runner-indexer.log 2>&1
#
# The workflow declares `concurrency: group: indexer, cancel-in-progress: false`, so an
# overlapping trigger queues rather than stacking. Even so this script skips a trigger when
# a run is already active, to keep the Actions history readable.

set -euo pipefail

REPO="${HIVE_RUNNER_REPO:-hdev-core/hive-runner}"
WORKFLOW="${HIVE_RUNNER_WORKFLOW:-Contest indexer}"
ENV_FILE="${HIVE_RUNNER_ENV:-$HOME/.hive-runner-indexer.env}"

log() { printf '%s  %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"; }

# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

if [ -z "${GH_TOKEN:-}" ]; then
  log "ERROR: GH_TOKEN is not set. Expected it in $ENV_FILE — see the header of this script."
  exit 1
fi
export GH_TOKEN

if ! command -v gh >/dev/null 2>&1; then
  log "ERROR: gh is not on PATH. https://cli.github.com"
  exit 1
fi

# Already running? Leave it alone — a queued duplicate tells us nothing and clutters the log.
active="$(gh run list --repo "$REPO" --workflow "$WORKFLOW" --status in_progress --limit 1 --json databaseId --jq 'length' 2>/dev/null || echo 0)"
if [ "$active" != "0" ]; then
  log "skip: a run is already in progress"
  exit 0
fi

if gh workflow run "$WORKFLOW" --repo "$REPO" >/dev/null 2>&1; then
  log "triggered $WORKFLOW on $REPO"
else
  # Non-zero exit here is usually an expired token, a revoked scope, or the workflow being
  # disabled by GitHub after 60 days of repo inactivity. Say so rather than failing silently.
  log "ERROR: could not trigger $WORKFLOW on $REPO — check the token's Actions scope and expiry,"
  log "       and that the workflow is not disabled (gh workflow list --repo $REPO)"
  exit 1
fi
