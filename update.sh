#!/bin/bash
# Bulk tracker update: progress.json (local, untracked) is the source of truth.
# cli.mjs writes via the GitHub API, so always sync to origin before seeding.
set -euo pipefail
cd "$(dirname "$0")"
git fetch -q origin
git reset --hard -q origin/main   # progress.json is untracked and survives this
export TRACKER_PASS="$(security find-generic-password -s tracker-passphrase -w)"
node seed.mjs
unset TRACKER_PASS
git add data.json
git commit -m "tracker: update $(date +%Y-%m-%d)" || true
git push
echo "Tracker updated."
