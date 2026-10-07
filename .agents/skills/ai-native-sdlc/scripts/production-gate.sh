#!/bin/bash
# ==============================================================================
# AI-Native SDLC Production Gate Hook
# ==============================================================================
set -euo pipefail

PAYLOAD=$(cat /dev/stdin)
COMMAND=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')

if [[ "$COMMAND" =~ (deploy|release).*production ]] || [[ "$COMMAND" =~ helm.*prod ]]; then
    if [ -z "${RELEASE_APPROVAL:-}" ]; then
        echo "GATE BLOCKED: Production release requires explicit human authorization token." >&2
        echo "Set RELEASE_APPROVAL=<token> or request release manager approval." >&2
        exit 2
    fi
fi

exit 0
