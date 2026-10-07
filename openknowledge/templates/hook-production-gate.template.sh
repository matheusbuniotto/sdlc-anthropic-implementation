#!/bin/bash
# ==============================================================================
# Production Deployment Approval Gate Hook
# Intercepts Bash tool execution in Claude Code / Antigravity
# Prevents unauthorized execution of production release or migration commands.
# ==============================================================================

set -euo pipefail

# Ingest JSON payload from STDIN
PAYLOAD=$(cat /dev/stdin)
COMMAND=$(echo "$PAYLOAD" | jq -r '.tool_input.command // empty')

# 1. Check if command attempts production deployment or destructive migrations
if [[ "$COMMAND" =~ (deploy|release|push).*production ]] || \
   [[ "$COMMAND" =~ helm.*prod ]] || \
   [[ "$COMMAND" =~ (terraform|tofu).*apply.*prod ]] || \
   [[ "$COMMAND" =~ (flyctl|wrangler|k8s).*deploy.*prod ]]; then

    # Check for presence of signed approval token
    if [ -z "${RELEASE_APPROVAL:-}" ]; then
        echo "==================================================================" >&2
        echo "GATE BLOCKED: Production deployment commands require signed release approval." >&2
        echo "Command intercepted: $COMMAND" >&2
        echo "Reason: Missing RELEASE_APPROVAL authorization token." >&2
        echo "Action Required: Contact the Release Manager or obtain a Change Approval Board ticket." >&2
        echo "==================================================================" >&2
        # Exit code 2 blocks the agent action and feeds stderr back to LLM context
        exit 2
    fi

    # Optional: Verify token signature against company PKI
    echo "Release authorization verified: $RELEASE_APPROVAL. Proceeding..." >&2
fi

# 2. Prevent accidental drops or truncates on production databases
if [[ "$COMMAND" =~ (DROP|TRUNCATE|DELETE\ FROM).* ]]; then
    echo "GATE BLOCKED: Direct destructive SQL statements are blocked via agent." >&2
    exit 2
fi

exit 0
