---
id: okf-play-03-plan-mode
title: "Play 03: Plan Mode as the Default Starting Point"
type: play
stage: stage-3-build
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-02-requirements-and-design]]"
outputs:
  - "plans/plan.md"
last_updated: "2026-10-06"
tags:
  - build
  - plan-mode
  - architecture
  - verification-targets
summary: How engineers utilize Claude Code plan mode to interrogate the codebase, formulate a rigorous plan.md, and eliminate implementation rework.
related_links:
  - "[[openknowledge/stages/03-build]]"
  - "[[openknowledge/plays/play-04-auto-mode-and-worktrees]]"
  - "[[openknowledge/plays/play-05-agent-context-claude-md]]"
  - "[[openknowledge/templates/plan.template]]"
---

# Play 03: Plan Mode as the Default Starting Point

## 1. What Changes

*   **Before:** An engineer reads the specification and starts coding immediately. The mental architecture, sequence of file modifications, and planned test assertions remain in the engineer's head or a brief ticket comment. Nobody reviews the approach until a massive diff is opened in PR.
*   **After:** Work begins with a structured, written plan that Claude produces in **plan mode** (read-only exploration). The engineer interrogates the plan, iterates on edge cases, and commits `plan.md` to Git *before any source code is touched*.

---

## 2. Getting Started

*   **Prerequisites:** An approved `intent.md` and `spec.md` (Play 02), and an established `CLAUDE.md` (Play 05).
*   **Infrastructure:** Claude Code CLI installed with read and bash execution access to the repository.

---

## 3. Concrete Steps for Implementation

1.  **Launch Session in Plan Mode:**
    Start Claude Code in read-only plan mode:
    ```bash
    claude --plan
    ```
    In plan mode, the agent can inspect directory structures, read source files, run searches, and run non-mutating shell queries without writing to disk.
2.  **Provide Specification Artifacts:**
    Feed the approved `intent.md` and `spec.md` into the prompt:
    ```
    Review intent.md and spec.md. Explore the codebase and draft a detailed
    implementation plan that specifies:
    1. Exact files to create or modify.
    2. The chronological order of work.
    3. Potential risks and architectural constraints.
    4. Exact test proofs that demonstrate completion.
    ```
3.  **Socratically Interrogate the Plan:**
    Challenge the agent with critical questions:
    *   *What could this change break in existing downstream modules?*
    *   *Which step carries the highest latency or concurrency risk?*
    *   *What other design alternatives did you evaluate and reject?*
4.  **Refine to Standalone Clarity:**
    Iterate until an engineer who was not part of the conversation could implement the change solely from the document.
5.  **Commit `plan.md`:**
    Commit the agreed plan to version control (`plans/claims-status.plan.md`).
6.  **Switch to Execution:**
    Approve the plan and instruct Claude to implement. With a rigorous plan, implementation typically succeeds in a single autonomous pass.
7.  **Maintain Plan Synchronization:**
    If unexpected implementation constraints force a deviation, update `plan.md` in the exact same commit.

---

## 4. Worked Example: `plan.md`

```markdown
# Plan: claims status self-service (from intent.md 2026-06-02)

## Files that change
- portal/src/claims/StatusPanel.tsx (new)
- claims-api/routes/status.py
- claims-api/tests/test_status.py

## Order of work
1. Add the /v2/claims/{id}/status endpoint behind existing JWT auth.
2. Build StatusPanel component against the mock endpoint response.
3. Wire StatusPanel into portal navigation and claims list.

## Risks
The claims-core upstream API rate-limits at 50 rps; the backend route must implement Redis caching with 30s TTL.

## Proof
- `claims-api/tests/test_status.py` passes all 4 claim state assertions.
- Playwright visual regression screenshot matches approved Figma design mock.
```

---

## 5. Governance Considerations

*   **Pre-Implementation Design Review:** Architectural decisions are evaluated when changing course is as simple as editing a Markdown sentence.
*   **Audit Trail:** The committed `plan.md` joins Git history. When the eventual PR is reviewed (Stage 5), the diff is explicitly diffed against `plan.md`.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | First-Pass PR Merge Share | GitHub PR metadata | $\ge 85\%$ of PRs merge without requiring structural redesign. |
| **Lagging Indicator** | Implementation Plan Drift | PR diff analysis | The merged diff matches the committed `plan.md` without unexpected modified files. |
