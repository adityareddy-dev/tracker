#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export TRACKER_PASS="$(security find-generic-password -s tracker-passphrase -w)"
node seed.mjs
git add data.json
git commit -m "tracker: update $(date +%Y-%m-%d)" || true
git push
unset TRACKER_PASS
echo "Tracker updated."
