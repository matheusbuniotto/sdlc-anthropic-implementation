---
id: okf-play-07-guardrail-hooks
title: "Play 07: Hooks as Build-Time Guardrails"
type: play
stage: stage-3-build
entry_point: true
prerequisites: []
outputs:
  - ".claude/settings.json"
  - ".claude/hooks/*"
last_updated: "2026-10-06"
tags:
  - build
  - hooks
  - guardrails
  - security
  - deterministic-control
  - entry-point
summary: How to configure deterministic PreToolUse hooks that enforce hard technical boundaries during code construction without blocking flow.
related_links:
  - "[[openknowledge/stages/03-build]]"
  - "[[openknowledge/plays/play-06-skills-as-institutional-knowledge]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
---

# Play 07: Hooks as Build-Time Guardrails

## 1. What Changes

*   **Before:** Guardrails rely on human memory, linters run post-hoc, or PR reviewers manually spot forbidden edits (such as touching generated schemas, frozen packages, or embedding hardcoded keys).
*   **After:** **Deterministic hooks intercept agent actions before they execute**. If Claude attempts an unauthorized edit or invalid shell command, the hook intercepts the call, cancels execution, and feeds a clear explanation back into the agent context.

---

## 2. Skills vs. Hooks: The Core Distinction

| Feature | Agent Skill | Agent Hook |
| :--- | :--- | :--- |
| **Control Type** | Advisory / Generative guidance | Deterministic / Absolute enforcement |
| **Bypassable?** | Model may occasionally omit or misapply | Cannot be bypassed by prompt manipulation |
| **Purpose** | Teaches the agent the correct multi-step SOP | Hard boundaries: blocks illegal edits and command execution |
| **Execution Point** | Loaded into context at start of session | Executed as shell script on each tool call |

---

## 3. Concrete Build-Time Hook Responsibilities

Build-time hooks run on every tool action and must be fast (<100ms) and scoped to changed files:
1.  **Block Edits to Protected Paths:** Freeze generated protobufs, database migration histories, or core framework files.
2.  **Auto-Format & Lint On Save:** Automatically run `prettier` or `ruff` after file writes so code formatting never drifts.
3.  **Prevent Secret Leakage:** Block writes containing AWS access keys, private certificates, or `.env` secrets.
4.  **Protect Test Integrity:** Prevent agents from deleting or modifying test files during bug fixing (see Play 08).

---

## 4. Configuration and Script Implementation

### Repository Configuration: `.claude/settings.json`
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-paths.sh"
          }
        ]
      }
    ]
  }
}
```

### Hook Script: `.claude/hooks/protect-paths.sh`
```bash
#!/bin/bash
# Read tool input payload from STDIN
input=$(cat /dev/stdin)
target_file=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# 1. Protect generated code directories
if [[ "$target_file" =~ ^schemas/generated/.* || "$target_file" =~ ^api/v1/frozen/.* ]]; then
  echo "ERROR: Direct modifications to generated schemas or v1 legacy code are prohibited." >&2
  exit 2 # Exit code 2 blocks the agent and feeds STDERR into conversation
fi

# 2. Block direct modification of secret files
if [[ "$target_file" =~ \.env.* || "$target_file" =~ secrets/.* ]]; then
  echo "ERROR: Modifying environment secret files via agent is strictly forbidden." >&2
  exit 2
fi

exit 0
```

---

## 5. Governance Considerations

*   **Self-Explaining Blocks:** When a hook halts an action (exit code 2), the error message returned to Claude must clearly state *why* it was blocked and *what compliant alternative* to pursue.
*   **Tamper Resistance:** For enterprise environments, hook execution is enforced via managed MDM settings (`allowManagedHooksOnly: true`), preventing developers or agents from altering hook scripts.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Hook Interception Rate | Agent session telemetry | Intercepts 100% of illegal operations before disk write. |
| **Lagging Indicator** | Accidental Regressions / Leaks | Security scanning logs in CI | Zero secrets committed; zero unauthorized schema drift. |
