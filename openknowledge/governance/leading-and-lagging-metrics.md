---
id: okf-gov-metrics
title: Leading and Lagging Metrics Framework
type: governance
category: metrics
last_updated: "2026-10-06"
tags:
  - metrics
  - dora
  - kpis
  - opentelemetry
  - engineering-management
summary: Complete taxonomy of leading and lagging indicators across each stage of the AI-Native SDLC, tied to OpenTelemetry instrumentation and DORA measures.
related_links:
  - "[[openknowledge/INDEX]]"
  - "[[openknowledge/governance/audit-trail-and-chain-of-custody]]"
---

# Leading and Lagging Metrics Framework

Measuring transformation in an AI-Native engineering organization requires separating **Leading Indicators** (real-time signals of adoption and velocity) from **Lagging Indicators** (end outcomes in quality and stability).

---

## 1. Lifecycle Metrics Master Matrix

| SDLC Stage | Leading Indicator | Lagging Indicator | Telemetry / Data Source |
| :--- | :--- | :--- | :--- |
| **Stage 1: Plan** | **Elicitation Latency:** Time from first conversation to committed `intent.md`. (Target: $<2$ hours) | **Survival Rate:** % of `intent.md` accepted into Design vs closed; post-spec edits. | Git history on `intent/` directory. |
| **Stage 2: Design** | **Design Compression:** Elapsed time between `intent.md` and `spec.md` commits. | **Requirements Rework:** Count of `spec.md` commits dated *after* first `plan.md` commit. | Git log delta between spec and plan commits. |
| **Stage 3: Build** | **First-Pass Merge Share:** % of PRs merging without architecture revision; plan-to-PR time. | **Implementation Drift:** Discrepancy between merged PR diff and committed `plan.md`. | PR metadata & Git diff analysis. |
| **Stage 4: Test** | **First-Pass CI Green Rate:** Pass rate of initial agent commit push. (Target: $\ge 90\%$) | **Review Cycle Latency:** Time spent reviewing code when mechanical proof is attached. | CI check run logs & PR review duration. |
| **Stage 5: Deploy** | **Time to First Review:** AI review posted to PR within minutes; gate wait duration. | **Escaped Defect Rate:** Bugs discovered in production vs caught in review loop. | OpenTelemetry hook logs & incident management tracker. |
| **Stage 6: Maintain**| **Breach-to-Intent Latency:** Time from metric anomaly to triage queue `intent.md`. | **Incident Recurrence Rate:** Frequency of repeat incidents for which CI evals exist. | Observability stack logs & regression suite reports. |

---

## 2. Engineer Experience & Workflow Metrics

*   **Steering vs. Waiting Ratio:** The percentage of an engineer's day spent directing intent, reviewing plans, and evaluating risk, compared to waiting on builds or performing manual edits.
*   **Active Parallel Streams:** Average number of concurrent agent sessions (in Git worktrees) steered by an engineer while maintaining high PR quality (Target: 2 to 3 streams).
*   **Time to First PR (New Joiner):** How quickly a newly hired engineer ships their first merged production PR utilizing `CLAUDE.md` and skills (Target: $<48$ hours).

---

## 3. Integration with DORA Core Metrics

The AI-Native SDLC directly elevates all 4 standard DevOps Research and Assessment (DORA) metrics:

1.  **Deployment Frequency:** Increases by orders of magnitude as small, well-bounded changes move through fast automated review loops.
2.  **Lead Time for Changes:** Collapses from weeks to hours as the bottlenecks to the left (Plan, Design) and right (Test, Review) are automated.
3.  **Change Failure Rate (CFR):** Declines dramatically because corporate policies are verified upfront via skills, and agents self-verify code before human review.
4.  **Failed Deployment Recovery Time (MTTR):** Reaches minutes via rehearsed rollback MCP tools triggered autonomously by Tier 3 control bands.
