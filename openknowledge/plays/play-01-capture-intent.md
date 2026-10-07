---
id: okf-play-01-capture-intent
title: "Play 01: Capture as intent.md"
type: play
stage: stage-1-plan
entry_point: true
prerequisites: []
outputs:
  - "intent/intent.md"
last_updated: "2026-10-06"
tags:
  - plan
  - intent-md
  - product-management
  - entry-point
summary: Guide for non-technical or product originators to brainstorm ideas with Claude and commit human-readable, machine-actionable intent.md artifacts.
related_links:
  - "[[openknowledge/stages/01-plan]]"
  - "[[openknowledge/plays/play-02-requirements-and-design]]"
  - "[[openknowledge/templates/intent.template]]"
---

# Play 01: Capture as `intent.md`

## 1. What Changes

*   **Before:** An idea passes through backlog tickets, refinement meetings, and multiple handoffs before anyone acts on it. By the time it reaches engineering, the requirements are severed from what the originator intended.
*   **After:** The originator brainstorms with Claude and records the outcome as `intent.md`—a proto-spec written in the originator's own terms, immediately version-controlled and actionable by downstream agents.

---

## 2. Getting Started

*   **Prerequisites:** None. This is an **entry-point play**.
*   **Infrastructure:**
    *   Claude access for non-engineers (e.g. Claude Code, Claude.ai, or chat interface).
    *   An agreed `intent.md` template (see [Intent Template](../templates/intent.template.md)).
    *   A shared, version-controlled home for intent watched by the Product Owner (e.g. an `intent/` folder in the repository).
    *   VCS connector (e.g., GitHub integration) so non-technical originators can commit markdown files directly without mastering git CLI.

---

## 3. Concrete Steps for Implementation

1.  **Describe the Problem in Plain Language:**
    The originator describes what users cannot do today, who is affected, what "better" looks like, and what is out of scope. No formal software engineering jargon is required.
2.  **Conduct Socratic Brainstorming:**
    Claude asks the clarifying questions a senior business analyst would ask:
    *   *What specific user personas or customer journeys are touched?*
    *   *What are the known boundaries and constraints (security, privacy, performance)?*
    *   *What does a successful outcome look like?*
3.  **Draft `intent.md`:**
    Ask Claude to format the result into the organization's standard template:
    ```
    Please write the result of our discussion as intent.md using our standard
    template, covering the problem, proposed outcome, affected users and systems,
    constraints, and open questions.
    ```
4.  **Review and Correct:**
    The originator reads the generated file and corrects any misinterpretations or nuances Claude missed.
5.  **Commit to Version Control:**
    Commit `intent.md` to the shared repository directory (`intent/claims-status.md`). The author, timestamp, and commit SHA enter the permanent audit record.

---

## 4. Worked Example: `intent.md`

```markdown
# Intent: claims status self-service
Author: J. Ortiz (claims operations)
Status: draft
Date: 2026-06-02

## Problem
Customers phone the contact center to ask where their claim is.
Handlers spend roughly a third of call time on status-only queries.

## Proposed outcome
Customers see claim status, next step, and expected date in the portal.

## Affected users and systems
Claims handlers, portal team, claims-core API.

## Constraints
No new PII in the portal session. Existing authentication only.

## Open questions
Do third-party loss adjusters need access too?
```

---

## 5. Governance Considerations

*   **Evidence:** The committed `intent.md` in Git. It records the author identity, timestamp, and full revision diff.
*   **Approval Authority:** The Product Owner reviews the committed `intent.md`. The decision to merge or reject is logged as a Git PR review or issue state change.
*   **Auditability:** Every downstream line of code can be cryptographically traced back to this initial intent commit.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Elicitation Time | Git log (timestamp from first conversation to commit) | Drops from multi-week refinement cycles to under 2 hours. |
| **Lagging Indicator** | Intent Survival Rate | Git commit history (% of `intent.md` accepted into Design vs closed) | $\ge 80\%$ acceptance; near-zero post-spec rewrites. |
