#!/usr/bin/env bash
# Claude Code SessionStart hook (.claude/settings.json). In cloud sessions only (CLAUDE_CODE_REMOTE=true), installs the
# pinned Emscripten with scripts/setup-emsdk.sh and puts it on PATH for the session's later commands, through the
# CLAUDE_ENV_FILE that Claude Code sources before each Bash command. Local sessions are left alone: contributors
# install Emscripten once themselves (CLAUDE.md, "Commands").
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ] || [ -z "${CLAUDE_ENV_FILE:-}" ]; then
    exit 0
fi

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dir="${EMSDK_DIR:-$HOME/.local/share/emsdk}"
"$root/scripts/setup-emsdk.sh" "$dir" >&2

# emsdk_env.sh sets PATH, EMSDK and EMSDK_NODE; write the result out rather than sourcing it before every command.
# shellcheck disable=SC1091
source "$dir/emsdk_env.sh" >/dev/null 2>&1
{
    printf 'export PATH=%q\n' "$PATH"
    printf 'export EMSDK=%q\n' "$EMSDK"
    [ -n "${EMSDK_NODE:-}" ] && printf 'export EMSDK_NODE=%q\n' "$EMSDK_NODE"
} >> "$CLAUDE_ENV_FILE"

# Dependencies too, so a fresh cloud checkout can build and test straight away.
if [ ! -d "$root/node_modules" ]; then
    (cd "$root" && npm ci --no-audit --no-fund) >&2
fi
