---
id: okf-play-13-control-bands
title: "Play 13: Closing the Loop with Statistical Control Bands"
type: play
stage: stage-6-maintain
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "[[openknowledge/plays/play-09-continuous-evals-ci]]"
  - "[[openknowledge/plays/play-10-ai-pr-review-loop]]"
  - "[[openknowledge/plays/play-12-cicd-pipeline-and-sandboxing]]"
outputs:
  - "bands.yaml"
  - "intent/<incident-diagnosis>.md"
last_updated: "2026-10-06"
tags:
  - maintain
  - closed-loop
  - statistical-process-control
  - control-bands
  - autonomous-feedback
summary: How to set up deterministic statistical control bands that invoke headless agents to diagnose production anomalies and synthesize intent.md to close the SDLC loop.
related_links:
  - "[[openknowledge/stages/06-maintain]]"
  - "[[openknowledge/plays/play-14-on-call-first-responder]]"
  - "[[openknowledge/templates/bands.template]]"
  - "[[openknowledge/stages/01-plan]]"
---

# Play 13: Closing the Loop with Statistical Control Bands

## 1. What Changes

*   **Before:** Maintenance is completely reactive. Production metrics drift, or an alert triggers at 3:00 AM. If an engineer is busy or misses the page, the defect impacts customers for hours. The post-mortem is postponed and rarely results in preventative code changes.
*   **After:** A deterministic watcher calculates statistical process control (SPC) bands over production metrics. When a metric breaches a threshold, it invokes Claude headlessly. Claude diagnoses root cause, isolates the failure, and emits an `intent.md` directly into the Stage 1 triage queue.

---

## 2. The Core Principle: Deterministic Detection, Agentic Diagnosis

```
Detection stays 100% deterministic.
Claude is invoked once a band is breached,
and the tier sets what it may do.
```

No LLM runs in the critical path of detecting anomalies. Statistical algorithms compute standard deviation ($\sigma$) and Western Electric rules over a 30-day rolling baseline. The LLM is only invoked to perform reasoning once a breach occurs.

---

## 3. The Three Statistical Tiers

| Tier | Anomaly Level | System Action | Allowed Agent Tool Surface |
| :--- | :--- | :--- | :--- |
| **Tier 1 ($1\sigma$)** | Normal variance / slight drift | Pure logging | No agent invocation. |
| **Tier 2 ($2\sigma$)** | Early degradation detected | Read-only diagnostic pass | `Read`, `Grep`, `Bash(gh run view *)` $\rightarrow$ emits diagnostic `intent.md`. |
| **Tier 3 ($3\sigma$)** | Critical breach / outage | Remediation / Propose action | Propose revert PR or trigger pre-approved MCP rollback tool. |

---

## 4. Configuration: `bands.yaml`

```yaml
metric: ci_test_failure_rate
baseline: rolling_30d
rules: western_electric

tiers:
  1sigma:
    action: log
  2sigma:
    action: diagnose
    tools: "Read,Grep,Bash(gh run view *)"
  3sigma:
    action: propose
    routes:
      - pull_request
      - runbook:rollback-deploy
```

---

## 5. Concrete Steps for Implementation

1.  **Select Target Metric with Rolling Baseline:**
    Select a clean metric: e.g., CI build failure rate, post-deployment HTTP 5xx rate, or checkout latency.
2.  **Author Deterministic Watcher Script:**
    Write a unit-tested Python or shell script that queries Prometheus, Datadog, or GitHub Actions API. Calculate rolling mean and $\sigma$.
3.  **Define Tier Triggers:**
    *   **At $2\sigma$ Breach:** The watcher script launches headless Claude:
        ```bash
        claude -p "Metric $METRIC breached 2-sigma band. Correlate recent commits in Git against logs. Format findings as intent/incident-$DATE.md."
        ```
    *   **At $3\sigma$ Breach:** The watcher executes the autonomous response: triggers rehearsed rollback via MCP and files an urgent revert PR.
4.  **Emitted Artifact Feeds Stage 1:**
    The generated `intent.md` contains the error signature, affected services, root cause hypothesis, and suggested fix. The on-call engineer reviews it and approves it directly into Stage 2 Design!
5.  **Add Incident Eval to CI:**
    Once the bug fix ships, convert the incident reproduction into a permanent test case in `evals/` (Play 09).

---

## 6. Governance Considerations

*   **Zero Unconstrained Production Access:** The agent cannot make unilateral infrastructure changes; all Tier 3 actions route through pre-approved runbooks or PR review gates.
*   **Audit Logging:** Every band trigger, diagnostic trace, and PR created by Claude is logged with timestamps.

---

## 7. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Breach-to-Intent Latency | Monitoring and Git timestamps | Drops from 48 hours to under 5 minutes. |
| **Lagging Indicator** | Incident Recurrence Rate | Incident management tracker | Drops to zero for previously resolved incident classes. |
