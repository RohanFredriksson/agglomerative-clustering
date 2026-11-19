#!/usr/bin/env bash
# Deletes remote branches on origin that are both merged and stale:
#   - merged: the branch tip is already in origin/master, so deleting it loses nothing;
#   - stale:  its last commit is more than STALE_DAYS (default 7) days old.
# Never touches master, release/* branches (maintenance lines for older versions) or tags. Run by
# .github/workflows/prune-stale-branches.yml on every branch push; safe to run by hand too. Pass --dry-run to list
# what would go without deleting anything.
set -euo pipefail

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true
days="${STALE_DAYS:-7}"
cutoff=$(( $(date +%s) - days * 86400 ))

git fetch --prune --quiet origin '+refs/heads/*:refs/remotes/origin/*'

deleted=0
while read -r ref when; do
  branch="${ref#origin/}"
  case "$branch" in HEAD | master | origin | release/*) continue ;; esac
  [ "$when" -lt "$cutoff" ] || continue
  git merge-base --is-ancestor "$ref" origin/master 2>/dev/null || continue
  age=$(( ($(date +%s) - when) / 86400 ))
  if $dry_run; then
    echo "would delete $branch (merged, last commit ${age}d ago)"
  else
    git push --quiet origin --delete "$branch"
    echo "deleted $branch (merged, last commit ${age}d ago)"
  fi
  deleted=$((deleted + 1))
done < <(git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin)

echo "prune-stale-branches: $($dry_run && echo 'would delete' || echo 'deleted') $deleted (older than ${days}d and merged)"
