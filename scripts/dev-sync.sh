#!/bin/bash
# Copy the mod into Claude Code's hot-reload folder so a running session loads and reloads it.
# usage: scripts/dev-sync.sh [dev-mods-session-dir]
#   default target: the newest session folder under ~/.claude/dev-mods/
# The engine writes .claude-plugin/types/ itself, so it is never copied. The folder is a copy:
# edit the repo, then run this again (or `claude --plugin-dir ./mods/okf-loop` to load it directly).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/mods/okf-loop"
BASE="${HOME}/.claude/dev-mods"
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  TARGET="$(ls -td "$BASE"/*/ 2>/dev/null | head -1)"
  TARGET="${TARGET%/}"
fi
[ -n "$TARGET" ] && [ -d "$TARGET" ] || { echo "no dev-mods session folder found under $BASE" >&2; exit 1; }
mkdir -p "$TARGET/okf-loop"
rsync -a --delete \
  --exclude '.claude-plugin/types/' --exclude '.dev/' --exclude 'node_modules/' --exclude '.DS_Store' \
  "$SRC/" "$TARGET/okf-loop/"
echo "synced $SRC -> $TARGET/okf-loop"
