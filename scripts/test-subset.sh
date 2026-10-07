#!/bin/bash
# Run only the named test files of the mod (claude plugin test runs every test under a dir).
# usage: scripts/test-subset.sh tests/guards.test.ts [tests/spc.test.ts ...]
set -euo pipefail
MOD="$(cd "$(dirname "$0")/../mods/okf-loop" && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/okf-test.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT
rsync -a --exclude tests "$MOD/" "$TMP/"
mkdir -p "$TMP/tests"
find "$MOD/tests" -maxdepth 1 -type f ! -name "*.test.*" -exec cp {} "$TMP/tests/" \;
for f in "$@"; do mkdir -p "$TMP/$(dirname "$f")"; cp "$MOD/$f" "$TMP/$f"; done
(cd "$TMP" && claude plugin test .)
