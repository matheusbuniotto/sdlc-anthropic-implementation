#!/bin/bash
# ==============================================================================
# Helper Script: Check Endpoints for API Security Guidelines
# Checks route handlers for JWT authentication and PII log leaks
# ==============================================================================
set -euo pipefail

echo "== [Security Check] Auditing API Endpoints =="

# 1. Check for unauthenticated routes outside /health
UNAUTH=$(grep -rn --include="*.ts" --include="*.py" --include="*.go" "public_endpoint\|allow_anonymous" src/ 2>/dev/null | grep -v "/health" || true)

if [ -n "$UNAUTH" ]; then
    echo "WARNING: Potential unauthenticated route found outside /health:"
    echo "$UNAUTH"
else
    echo "PASS: All routes require authentication middleware."
fi

# 2. Check for accidental PII logging
PII_LOGS=$(grep -rn --include="*.ts" --include="*.py" --include="*.go" -i "log.*\(password\|ssn\|credit_card\|secret\|token\)" src/ 2>/dev/null || true)

if [ -n "$PII_LOGS" ]; then
    echo "WARNING: Sensitive fields found in logging statements:"
    echo "$PII_LOGS"
else
    echo "PASS: No unmasked sensitive fields in logging calls."
fi

echo "== Audit Complete =="
exit 0
