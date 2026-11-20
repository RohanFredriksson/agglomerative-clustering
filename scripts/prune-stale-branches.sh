#!/usr/bin/env bash
# Deletes remote branches on origin that are both done and stale:
#   - done:  the branch tip is already in origin/master, or in a release tag (v*): a patch/x.y.z branch for an older
#            line never merges into master, but once its release is tagged the tag keeps its commits. Either way,
#            deleting the branch loses nothing;
#   - stale: its last commit is more than STALE_DAYS (default 7) days old.
# Never touches master or tags. Run by .github/workflows/prune-stale-branches.yml on every branch push; safe to run by
# hand too. Pass --dry-run to list what would go without deleting anything.
set -euo pipefail

dry_run=false
[ "${1:-}" = "--dry-run" ] && dry_run=true
days="${STALE_DAYS:-7}"
cutoff=$(( $(date +%s) - days * 86400 ))

git fetch --prune --quiet origin '+refs/heads/*:refs/remotes/origin/*'
git fetch --quiet --tags origin

deleted=0
while read -r ref when; do
  branch="${ref#origin/}"
  case "$branch" in HEAD | master | origin) continue ;; esac
  [ "$when" -lt "$cutoff" ] || continue
  if git merge-base --is-ancestor "$ref" origin/master 2>/dev/null; then
    why=merged
  else
    tag=$(git tag --list 'v*' --contains "$ref" | head -n 1)
    [ -n "$tag" ] || continue
    why="released in $tag"
  fi
  age=$(( ($(date +%s) - when) / 86400 ))
  if $dry_run; then
    echo "would delete $branch ($why, last commit ${age}d ago)"
  else
    git push --quiet origin --delete "$branch"
    echo "deleted $branch ($why, last commit ${age}d ago)"
  fi
  deleted=$((deleted + 1))
done < <(git for-each-ref --format='%(refname:short) %(committerdate:unix)' refs/remotes/origin)

echo "prune-stale-branches: $($dry_run && echo 'would delete' || echo 'deleted') $deleted (older than ${days}d and merged or released)"
