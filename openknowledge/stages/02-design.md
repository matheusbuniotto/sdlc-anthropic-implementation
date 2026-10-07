---
id: okf-stage-02-design
title: "Stage 2: Design — Requirements & Design Specification"
type: stage
stage_number: 2
last_updated: "2026-10-06"
tags:
  - stage-2
  - design
  - requirements
  - spec-md
  - policy-skills
summary: How requirements engineering and technical architecture collapse into a single agentic session guided by policy skills to produce spec.md.
related_links:
  - "[[openknowledge/plays/play-02-requirements-and-design]]"
  - "[[openknowledge/templates/spec.template]]"
  - "[[openknowledge/stages/03-build]]"
---

# Stage 2: Design — Requirements & Design Specification

In Stage 2, **requirements analysis and technical design collapse into a single prompted session**.

Instead of waiting weeks for architects and policy boards to discover compliance violations, organizational policies (brand, security, UX, regulatory) are encoded as **version-controlled skills** and applied *while the spec is being drafted*.

---

## 1. Traditional vs. AI-Native Design

| Dimension | Traditional SDLC | AI-Native SDLC |
| :--- | :--- | :--- |
| **Separation of Work** | Analysts write requirements; architects write design; security reviews later. | Agent reads `intent.md`, queries repo architecture, and generates a unified specification. |
| **Policy Checking** | Discovered late in review gates weeks into the project. | Applied upfront as generative constraints through organizational skills. |
| **Artifact** | Sprawling Confluence pages and static architecture diagrams. | Machine-actionable `spec.md` paired with `intent.md` in version control. |
| **Conflict Resolution** | Buried until code review or security audit. | Agent explicitly surfaces and flags policy contradictions for human escalation. |

---

## 2. The Stage 2 Workflow

```mermaid
sequenceDiagram
    autonumber
    actor PO as Product Owner
    participant Claude as Claude Agent
    participant Skills as Org Skills (Security, Brand, UX)
    participant PolicyOwner as Policy / Security Lead
    participant Git as Git Repo

    PO->>Claude: Prompt with intent.md + context
    Claude->>Skills: Load security, brand & API rules
    Claude->>Claude: Evaluate constraints & detect conflicts
    Claude->>PO: Emits spec.md with "Flagged Concerns"
    PO->>PolicyOwner: Resolve flagged policy concerns
    PolicyOwner-->>PO: Decision logged
    PO->>Git: Commit spec.md alongside intent.md
    Note over PO,Git: Accepted spec.md triggers Stage 3: Build Plan Mode
```

---

## 3. The Core Artifact: `spec.md`

The generated specification contains:
*   **Context & Goal Alignment:** Mapping directly back to `intent.md`.
*   **System & API Boundaries:** Interface contracts, endpoint parameters, and data models.
*   **Policy Compliance Declarations:** How security, UX, and performance skills were satisfied.
*   **Flagged Areas of Concern:** The exact dilemmas where requirements tension against policy (e.g. rate limit limits vs caching tradeoffs).

The pair—`intent.md` (what was asked for) and `spec.md` (what was decided)—forms the foundational contract of the build phase.

---

## 4. Front-End Design Acceleration

For user-facing products:
1. Product Owner passes `intent.md` into an interactive visual generator (e.g. Claude Design).
2. The mock is iterated visually within minutes.
3. The mock artifacts and styling tokens are exported directly into the `spec.md` for engineering implementation.

---

## 5. Metrics & Governance

*   **Leading Metric:** Elapsed time between `intent.md` commit and `spec.md` commit.
*   **Lagging Metric:** Requirements rework after implementation commences (counted via `spec.md` commits dated after the first `plan.md` commit).
