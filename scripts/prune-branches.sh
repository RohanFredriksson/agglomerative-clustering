#!/usr/bin/env bash
# Deletes local branches whose remote branch is gone (merged branches are deleted on GitHub a week after their last
# commit, see .github/workflows/prune-stale-branches.yml). Uses `git branch -d`, which refuses anything not merged,
# so unmerged work is kept and listed instead; a branch whose tip is in a release tag (v*) is removed too. Never touches the current branch, master,
# or branches that were never pushed. Safe to run any time.
set -euo pipefail

git fetch --prune --quiet

current="$(git branch --show-current)"
removed=0
kept=()

while read -r branch; do
  case "$branch" in master | "$current") continue ;; esac
  # A released patch branch never merges into master, but its release tag keeps its commits.
  if git branch -d "$branch" >/dev/null 2>&1 ||
     { [ -n "$(git tag --list 'v*' --contains "$branch" | head -n 1)" ] && git branch -D "$branch" >/dev/null; }; then
    echo "removed $branch"
    removed=$((removed + 1))
  else
    kept+=("$branch")
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads | awk '$2 == "[gone]" { print $1 }')

echo "prune-branches: removed $removed"
if [ "${#kept[@]}" -gt 0 ]; then
  echo "prune-branches: kept (remote gone but not merged here; check, then 'git branch -D <name>' if truly done):"
  printf '  %s\n' "${kept[@]}"
fi
