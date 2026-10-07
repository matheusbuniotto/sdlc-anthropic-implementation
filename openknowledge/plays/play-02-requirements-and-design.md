---
id: okf-play-02-requirements-and-design
title: "Play 02: Requirements & Design Specification"
type: play
stage: stage-2-design
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-01-capture-intent]]"
outputs:
  - "specs/spec.md"
last_updated: "2026-10-06"
tags:
  - design
  - requirements
  - spec-md
  - policy-skills
summary: How Product Owners prompt Claude with intent.md and organizational skills to produce an implementation-ready spec.md with flagged risk areas.
related_links:
  - "[[openknowledge/stages/02-design]]"
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "[[openknowledge/plays/play-03-plan-mode]]"
  - "[[openknowledge/templates/spec.template]]"
---

# Play 02: Requirements & Design Specification

## 1. What Changes

*   **Before:** Requirements and architectural design are separate phases run by disparate teams (business analysts, architects, UX designers). The handoffs are lossy, bureaucratic, and compliance policies are discovered weeks later during painful review gates.
*   **After:** Both requirements and technical design occur in a single agentic session. Claude consumes `intent.md` alongside institutional skills (brand, security, UX, regulatory), generates `spec.md`, and proactively flags potential policy dilemmas.

---

## 2. Getting Started

*   **Prerequisites:** An accepted `intent.md` (Play 01), and corporate policies codified as skills (Play 06) for security, compliance, brand, and UX.
*   **Infrastructure:** A Product Owner with Claude access. No advanced programming capability is needed.

---

## 3. Concrete Steps for Implementation

1.  **Initialize the Session:**
    Open a session with Claude, ensure organizational skills are loaded, and attach the accepted `intent.md`.
2.  **Execute the Specification Prompt:**
    Point Claude at the intent artifact, specify architectural boundaries, and instruct it to flag policy contradictions:
    ```markdown
    Read the attached intent.md and produce a requirements and design spec for
    integrating it into our existing codebase. Apply the skills available to you
    so the plan conforms to our brand guidelines, security policies, and UX
    standards. Document the spec fully as spec.md, ready to hand to the
    engineering team. Describe clearly any areas of concern, especially where you
    cannot satisfy contradicting policies.
    ```
3.  **Validate Alignment:**
    The Product Owner reviews `spec.md` against the original intent. Does it resolve the user problem? Are all open questions answered?
4.  **Escalate Flagged Concerns:**
    Review the flagged areas of concern first. These are the points an analyst would have brought to a change board. Resolve each dilemma directly with the named policy owner (e.g., security officer) before engineering sees the document.
5.  **Commit the Artifact Pair:**
    Commit `spec.md` into Git alongside `intent.md`.
6.  **Progress to Build Gate:**
    The Product Owner decides whether to release the pair into build. For higher-risk features, a technical architect signs off.

---

## 4. Front-End Design Integration

When the feature involves user interfaces:
1. Product Owner loads `intent.md` into Claude Design (beta).
2. The agent generates interactive component mocks.
3. Once iterated and approved, design tokens, layout parameters, and screenshot references are exported into `spec.md`.

---

## 5. Governance Considerations

*   **Policy Verification Upfront:** Live security and UX policies are evaluated while the design is generated—not discovered weeks later.
*   **Audit Evidence:** The `intent.md` and `spec.md` pair in Git records exactly what was requested, which skill versions were applied, what trade-offs were flagged, and who authorized the implementation.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Design Cycle Latency | Git timestamps (delta between `intent.md` and `spec.md` commits) | Collapses from 2–4 weeks to less than 4 hours. |
| **Lagging Indicator** | Downstream Requirements Rework | Git log (count of `spec.md` commits after first `plan.md` commit) | Less than 5% rework across sprints. |
