---
id: okf-stage-06-maintain
title: "Stage 6: Maintain — Autonomous Monitoring & Closing the Loop"
type: stage
stage_number: 6
last_updated: "2026-10-06"
tags:
  - stage-6
  - maintain
  - closed-loop
  - control-bands
  - claude-on-call
  - incident-response
summary: How statistical control bands invoke headless agents to diagnose anomalies and feed new intent.md artifacts back into Stage 1, completing the autonomous loop.
related_links:
  - "[[openknowledge/plays/play-13-closing-the-loop-control-bands]]"
  - "[[openknowledge/plays/play-14-on-call-first-responder]]"
  - "[[openknowledge/templates/bands.template]]"
  - "[[openknowledge/stages/01-plan]]"
---

# Stage 6: Maintain — Autonomous Monitoring & Closing the Loop

In Stage 6, **the software lifecycle loop closes**.

Instead of waiting for an engineer to notice a 3:00 AM alert or triage a stagnant backlog ticket, **production telemetry triggers headless agent execution**. What the agent discovers is diagnosed, quarantined, or fed directly back into Stage 1 as a new `intent.md`.

---

## 1. Traditional vs. AI-Native Maintenance

| Dimension | Traditional SDLC | AI-Native SDLC |
| :--- | :--- | :--- |
| **Response Model** | Purely reactive: alerts wake engineers; tickets sit in queues; post-mortems rarely reach code. | Proactive and autonomous: deterministic triggers invoke agents immediately upon statistical drift. |
| **Trigger Path** | Human must log into observability dashboards, triage, and open a ticket. | Headless trigger invokes Claude with **no human in the invocation path**. |
| **Autonomy Boundaries** | Engineers scramble with manual SSH commands and undocumented runbooks. | Tiered autonomy strictly governed by statistical control bands (`bands.yaml`). |
| **Organizational Memory** | Incident notes scattered across Slack threads, Google Docs, and Jira. | Version-controlled post-mortems committed to `lessons/*.md` and converted into permanent CI evals. |

---

## 2. The Closed-Loop Architecture

```mermaid
flowchart TD
    Metrics["Production Metrics Store\n(Prometheus / Datadog / CI Logs)"] --> Script["Deterministic Detection Script\n(Rolling baseline + Western Electric rules)"]
    
    Script --> Tier1["1-Sigma Drift: Log only"]
    Script --> Tier2["2-Sigma Drift: Read-Only Diagnosis\n(Claude inspects logs, diffs, metrics)"]
    Script --> Tier3["3-Sigma Breach: Autonomous Action\n(Open Revert PR or Trigger Rehearsed Rollback)"]
    
    Tier2 --> IntentCommit["Synthesizes intent.md\n(Incident evidence, proposed outcome, affected systems)"]
    IntentCommit --> Stage1["Stage 1: Plan\n(Product Owner / On-Call Triage Queue)"]
    
    Tier3 --> PostMortem["Claude on Call Writes lessons/*.md"]
    PostMortem --> EvalSuite["Adds permanent regression eval to CI"]

    style Script fill:#fff9c4,stroke:#fbc02d,stroke-width:2px
    style IntentCommit fill:#bbdefb,stroke:#1976d2,stroke-width:2px
    style Stage1 fill:#c8e6c9,stroke:#388e3c,stroke-width:2px
```

---

## 3. The Core Mechanisms

### 1. Statistical Process Control Bands (`bands.yaml`)
Detection remains 100% deterministic (no LLM hallucination in the detection path). Mean and standard deviation are calculated over a rolling window (e.g. 30 days) using Western Electric or SPC rules:
*   **$1\sigma$ (In Control):** Log status; no agent invoked.
*   **$2\sigma$ (Early Warning):** Agent invoked read-only (`Read`, `Grep`, `gh run view`) to diagnose root cause and assemble evidence.
*   **$3\sigma$ (Critical Anomaly):** Agent opens a revert PR or invokes a rehearsed rollback MCP tool.

### 2. Autonomous Intent Generation
When a problem is diagnosed, the agent writes an `intent.md` in exact Stage 1 format, detailing:
*   The metric anomaly signature;
*   The offending deploy commit SHA;
*   The affected endpoints or microservices;
*   The recommended remediation.
The on-call engineer or product owner merely reviews and approves the artifact into Stage 2.

### 3. Claude on Call (Collaboration App First Responder)
Via workplace integrations (Slack / Teams), Claude participates directly in incident channels:
*   Correlates incoming error alerts against recent deployment diffs in minutes.
*   Proposes the rehearsed rollback to the incident commander.
*   Upon human confirmation (`"Go"`), executes rollback, verifies metrics return to baseline, and commits the post-mortem to `lessons/<date>-<title>.md`.

---

## 4. Key Metrics

*   **Leading Metric:** Time from control band breach to committed `intent.md` in the triage queue; percentage of incidents triaged autonomously.
*   **Lagging Metric:** Mean Time to Recovery (MTTR) and recurrence rate of identical incident classes.
