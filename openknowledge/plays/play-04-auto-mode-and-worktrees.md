---
id: okf-play-04-auto-mode-worktrees
title: "Play 04: Auto Mode, Parallel Sessions & Worktrees"
type: play
stage: stage-3-build
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-03-plan-mode]]"
  - "[[openknowledge/plays/play-08-verification-feedback-loop]]"
outputs:
  - "git-worktrees"
  - "multi-session-branches"
last_updated: "2026-10-06"
tags:
  - build
  - auto-mode
  - parallelism
  - git-worktrees
  - subagents
summary: How engineers run multiple autonomous agent sessions in parallel using Git worktrees, shifting their role from line-by-line typing to orchestration.
related_links:
  - "[[openknowledge/stages/03-build]]"
  - "[[openknowledge/plays/play-03-plan-mode]]"
  - "[[openknowledge/templates/verifier-agent.template]]"
---

# Play 04: Auto Mode, Parallel Sessions & Worktrees

## 1. What Changes

*   **Before:** An engineer works on a single task linearly. Waiting on builds, test suites, or reviewers consumes huge swaths of time. Task switching incurs severe mental context fatigue.
*   **After:** An engineer drives multiple independent Claude Code instances concurrently. Each session executes in its own isolated Git worktree, applying approved plans in auto mode. The engineer acts as orchestrator and reviewer.

---

## 2. Getting Started

*   **Prerequisites:** A validated `CLAUDE.md` (Play 05) and a deterministic verification feedback loop (Play 08).
*   **Infrastructure:** A Git repository configured with worktree support, and terminal multiplexers (tmux, iTerm tabs, or VS Code splits).

---

## 3. Concrete Steps for Implementation

1.  **Decompose Work into Orthogonal File Boundaries:**
    Review the tasks scheduled for the sprint. Split work into features or bug fixes that touch distinct directories or services.
2.  **Spin Up Isolated Git Worktrees:**
    Do not run multiple agents in the same working directory to avoid file write race conditions. Create a dedicated worktree per feature:
    ```bash
    # Terminal 1: Authentication Feature
    claude --worktree feature-auth

    # Terminal 2: Rate Limit Caching Fix
    claude --worktree fix-rate-limit

    # Terminal 3: Prometheus Instrumentation
    claude --worktree add-metrics
    ```
    Each worktree is an isolated physical directory checked out to its own branch.
3.  **Approve Plan & Enable Auto Mode:**
    Once the engineer approves the generated `plan.md` in each terminal, engage autonomous execution:
    ```bash
    claude --dangerously-skip-permissions
    # Or in managed environments with tuned permissions allowlists
    ```
    The agent applies edits, executes test commands, and iterates against failures without prompting for confirmation on routine operations.
4.  **Cap Concurrency at Human Review Capacity:**
    Start with **2 to 3 parallel sessions** per engineer. The operational bottleneck is how many PR diffs a human can rigorously inspect and verify.
5.  **Delegate Repetitive Tasks to Subagents:**
    Create scoped subagents (`.claude/agents/<name>.md`) with isolated context windows to offload routine subtasks:
    *   **Verifier:** Starts the application, triggers test curls, and compares behavior to `plan.md`.
    *   **Code Simplifier:** Runs after the main agent to eliminate over-engineered abstractions.
    *   **Codebase Researcher:** Gathers reference patterns across the repository without bloating the primary conversation window.

---

## 4. Subagent Specification Example (`.claude/agents/verifier.md`)

```markdown
---
name: verifier
description: Runs the app and verifies behavioral compliance before the session finishes
tools: Bash, Read
---

Start the application with `make run`. 
Exercise the changed behavior and the two nearest neighboring flows.
Report what was executed, what responses were returned, and any deviations
from `plan.md`. 
DO NOT modify any code; report findings only.
```

---

## 5. Governance Considerations

*   **Centralized Repo Guardrails:** Because agents run autonomously in worktrees, all guardrails must reside in version-controlled repository configs (`.claude/settings.json`).
*   **Audit Logging:** Every session run is logged via OpenTelemetry, attributing changes to the supervising engineer.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Concurrent Active Sessions | OpenTelemetry export | 2–3 active streams per engineer while maintaining review quality. |
| **Lagging Indicator** | Throughput per Engineer | PR history | 3x to 5x increase in merged PRs/week without increase in rework rate. |
