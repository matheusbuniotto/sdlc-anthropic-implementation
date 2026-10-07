---
id: okf-play-14-on-call-first-responder
title: "Play 14: Claude on Call (Incident Triage & Memory)"
type: play
stage: stage-6-maintain
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-13-closing-the-loop-control-bands]]"
outputs:
  - "lessons/<date>-<title>.md"
  - "evals/<incident-id>.json"
last_updated: "2026-10-06"
tags:
  - maintain
  - claude-on-call
  - claude-tag
  - incident-response
  - post-mortem
summary: How workplace bot integrations (Claude Tag) act as first responders in incident channels, correlating errors to diffs and recording organizational memory.
related_links:
  - "[[openknowledge/stages/06-maintain]]"
  - "[[openknowledge/plays/play-13-closing-the-loop-control-bands]]"
  - "[[openknowledge/plays/play-01-capture-intent]]"
---

# Play 14: Claude on Call (Incident Triage & Memory)

## 1. What Changes

*   **Before:** Urgent production issues arrive as stressful messages in Slack incident channels late at night. Responders scramble across multiple consoles, investigate recent PRs manually, argue over rollback plans, and write post-mortems weeks later that get forgotten.
*   **After:** Claude participates directly in the incident channel under its own identity (`Claude Tag`). It correlates anomalies against the most recent deploy diff, suggests rollback actions, executes them upon human confirmation, verifies metric recovery, and commits the post-mortem to Git as institutional memory.

---

## 2. The Interactive Incident Channel Pattern

```
#inc-checkout  ·  Claude is a member under its own identity

[22:04] R. Mehta:
Checkout 5xx rate has been climbing since the 21:40 deploy. @claude take a look?

[22:07] Claude:
On it — comparing error signatures against the deploy diff. 
Cause looks like the new cache key dropping the tenant_id in 
services/checkout/cache.py (commit 8f3b21a). 
The rollback was rehearsed in staging this morning; shall I run it?

[22:08] R. Mehta:
Go.

[22:12] Claude:
Rolled back. The 5xx rate is back inside its 1-sigma band (0.02%), 
and the post-mortem has been written to lessons/2026-06-checkout-cache.md.
```

---

## 3. Concrete Steps for Implementation

1.  **Deploy Claude to Workplace Incident Channels:**
    Integrate Claude into Slack or Microsoft Teams under its own identity with access to MCP monitoring and deployment tools.
2.  **Correlate Alerts to Deploy Diffs:**
    When tagged or triggered by an incident webhook:
    *   Query the monitoring API for stack traces and error signatures.
    *   Compare error timestamps against Git deployment history.
    *   Identify the exact commit and PR diff that introduced the regression.
3.  **Propose Rehearsed Mitigation:**
    Rather than guessing a fix in high-stress production conditions, Claude verifies whether a rollback is available and requests human approval.
4.  **Execute & Verify Baseline Recovery:**
    Upon receiving human authorization (`"Go"`), Claude triggers the rollback MCP tool, continuously polls the metric until it re-enters its baseline band, and confirms resolution in the channel.
5.  **Write Post-Mortem into Git (`lessons/*.md`):**
    Immediately write a structured retrospective:
    *   Root cause analysis.
    *   Timeline of events.
    *   Deploy commit SHA.
    *   Preventative actions needed.
6.  **Close the Loop:**
    *   If a quick fix is obvious and small: Claude opens a PR with unit tests into the PR review gate.
    *   If the issue requires structural architectural work: Claude drafts an `intent.md` for Stage 1 Plan!

---

## 4. Governance Considerations

*   **The Channel is the Audit Trail:** Every request, agent diagnosis, human authorization, and execution timestamp is preserved in the persistent chat record and synced to Git.
*   **Human Remains Above the Loop:** Claude cannot execute Tier 3 production commands (rollback, restart, traffic shift) without explicit, auditable human confirmation in the thread.

---

## 5. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Mean Time to Diagnosis (MTTD) | Channel timestamps (page to diagnosis) | Under 3 minutes. |
| **Lagging Indicator** | Mean Time to Resolution (MTTR) | PagerDuty / incident tracker | 75% reduction across incident categories. |
