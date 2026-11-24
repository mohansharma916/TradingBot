#!/bin/sh
# Written by project-track-init. Facts only: the judgment goes in status.json.
set -e
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)
commit=$(git rev-parse --short HEAD 2>/dev/null || echo none)
uncommitted=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
printf '{"ts":"%s","event":"session_end","actor":"claude-code","branch":"%s","commits":["%s"],"uncommitted":%s}\n' \
  "$ts" "$branch" "$commit" "$uncommitted" >> .project-track/activity.jsonl
