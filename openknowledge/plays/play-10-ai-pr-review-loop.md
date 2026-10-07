---
id: okf-play-10-ai-pr-review
title: "Play 10: Dual-Direction AI in the PR Review Loop"
type: play
stage: stage-5-deploy
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-05-agent-context-claude-md]]"
  - "[[openknowledge/plays/play-06-skills-as-institutional-knowledge]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
outputs:
  - "REVIEW.md"
  - "github-pr-comments"
last_updated: "2026-10-06"
tags:
  - deploy
  - pr-review
  - code-review
  - two-way-review
  - governance
summary: How AI participates bidirectionally in pull requests by executing multi-pass reviews against REVIEW.md and autonomously remediating review comments.
related_links:
  - "[[openknowledge/stages/05-deploy]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
  - "[[openknowledge/templates/review-policy.template]]"
---

# Play 10: Dual-Direction AI in the PR Review Loop

## 1. What Changes

*   **Before:** Code review capacity is tied strictly to human hours. PRs sit in reviewer queues for days, review thoroughness degrades with cognitive fatigue, and authors spend significant time chasing reviewers.
*   **After:** Claude participates **bidirectionally in the PR loop**. It reviews incoming PRs against explicit policies (`REVIEW.md`), and when tagged on PR comments, it inspects critiques, pushes fixes, and reruns tests autonomously.

---

## 2. The Dual Directions of AI Code Review

```mermaid
flowchart LR
    subgraph Direction1 ["Direction 1: Agent Reviews Incoming PRs"]
        PR1[Author Opens PR] --> AgentRev["Claude Reviews PR\n(Pass 1: Logic Bugs\nPass 2: Security\nPass 3: Spec & Plan Compliance)"]
        AgentRev --> Tally["Publishes Machine-Readable Findings"]
        Tally --> HumanCheck["Human Approver Examines System Risk"]
    end

    subgraph Direction2 ["Direction 2: Agent Remediates Review Comments"]
        Comment["Human tags @claude on PR comment"] --> AgentFix["Claude pulls branch,\napplies fix, verifies tests"]
        AgentFix --> Push["Pushes commit & replies in thread"]
    end
```

---

## 3. Concrete Steps for Implementation

1.  **Draft Repository Review Policy (`REVIEW.md`):**
    Establish explicit review guidelines at the repository root:
    *   **Pass 1 (Bugs & Regressions):** Logical flaws, off-by-one errors, race conditions.
    *   **Pass 2 (Security):** Injection risks, authentication omissions, plaintext secrets, unmasked PII.
    *   **Pass 3 (Compliance):** Does the diff faithfully match `spec.md` and `plan.md`?
2.  **Define What "Important" Means:**
    Instruct the agent to reserve high-severity tags strictly for data corruption, security breaches, or behavioral deviations.
3.  **Cap the Nits:**
    Restrict stylistic nits to **no more than 5 per review** (summarizing the remainder as a single count) to prevent PR comment spam.
4.  **Tag `@claude` for Interactive Fixes:**
    When reviewers leave actionable comments, they simply tag `@claude`. The `claude-code-action` runs, interprets the feedback, pushes the change, and marks the conversation resolved.
5.  **Feed Errors Back into `CLAUDE.md`:**
    If a review comment catches a recurring anti-pattern for the second time, the fix PR **must add that convention to `CLAUDE.md`**.

---

## 4. Production Example: `REVIEW.md`

```markdown
# Review Instructions

## Passes
Execute three distinct passes and tag every finding:
- **Bugs:** Logic errors, unhandled nulls, concurrency deadlocks, edge regressions.
- **Security:** Injection vectors, broken auth guards, PII exposed in logs.
- **Compliance:** Verify the diff faithfully satisfies `spec.md` and `plan.md`.

## What "Important" Means Here
Reserve the `Important` severity tag exclusively for findings that break functionality, leak sensitive data, or violate compliance. Formatting, syntax choices, and variable naming are categorized as `Nit`.

## Cap the Nits
Report at most 5 stylistic nits per review. Summarize any additional minor points in a single line summary.

## Do Not Report
- Any code inside generated directories (`src/gen/`, `build/`).
- Stylistic issues already handled by CI linters (`make lint`).
```

---

## 5. Governance Considerations

*   **Separation of Duties:** The agent that drafted the code **has zero authority to approve or merge the PR**.
*   **Human Gating:** Merging requires explicit code owner approval under branch protection rules. Human reviewers elevate their attention from hunting typos to evaluating business intent and systemic architectural risk.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Time to First Review | GitHub PR webhook events | Under 5 minutes for 100% of pull requests. |
| **Lagging Indicator** | Escaped Defects to Production | Incident reports | Marked decline in post-merge regression incidents. |
