---
id: okf-play-05-claude-md
title: "Play 05: CLAUDE.md as Repo Memory"
type: play
stage: stage-3-build
entry_point: true
prerequisites: []
outputs:
  - "CLAUDE.md"
last_updated: "2026-10-06"
tags:
  - build
  - claude-md
  - repo-memory
  - context-window
  - entry-point
summary: How to author, curate, and maintain a concise CLAUDE.md file that gives AI agents essential new-joiner context at session startup.
related_links:
  - "[[openknowledge/stages/03-build]]"
  - "[[openknowledge/plays/play-06-skills-as-institutional-knowledge]]"
  - "[[openknowledge/templates/claude-context.template]]"
---

# Play 05: `CLAUDE.md` as Repo Memory

## 1. What Changes

*   **Before:** Critical engineering context (how to build, how to run tests, architectural caveats, known landmines) sits in engineers' heads, buried Slack threads, or outdated wiki pages. When new joiners or AI agents enter the codebase, they repeat the same costly errors.
*   **After:** Essential project context is distilled into a single root file: `CLAUDE.md`. The agent reads this file automatically at the start of every session. It is treated as live code and updated whenever an error is encountered twice.

---

## 2. Getting Started

*   **Prerequisites:** None. This is an **entry-point play**.
*   **Infrastructure:** A Git repository, Claude Code CLI, and an engineer familiar with repository architecture and build workflows.

---

## 3. Concrete Steps for Implementation

1.  **Generate Baseline via `/init`:**
    Run the automated initialization command inside the repository root:
    ```bash
    claude /init
    ```
    Claude scans package manifests, directory trees, and config files to emit an initial `CLAUDE.md`.
2.  **Prune to "Day One" Context:**
    Aggressively edit the generated file. Retain only what a talented senior new-joiner must know on their first morning:
    *   Single-target build, test, and lint commands.
    *   Primary architectural layout.
    *   Hard engineering conventions (e.g., `"Money is always BigDecimal, never float"`).
3.  **Establish the "Twice Rule":**
    Enact an explicit team working rule:
    > **When Claude makes the same mistake twice, the correction is immediately committed to `CLAUDE.md`.**
4.  **Enforce Strict Length Limits (Under One Page):**
    Because `CLAUDE.md` is injected into context at every session start, keep it under **100 lines / ~800 tokens**. Stale, verbose paragraphs consume token window with negative returns. Bulky policies belong in `skills/`.
5.  **Commit and Review Like Source Code:**
    Check `CLAUDE.md` into Git root. Changes to this file require PR review by code owners.

---

## 4. Production Example: `CLAUDE.md`

```markdown
# Payments Service

## Commands
- Build: make build
- Test: make test (unit), make itest (integration, requires Docker)
- Lint: make lint (runs in CI; must pass before committing)

## Conventions
- Java 21, Spring Boot 3.3. No new Lombok annotations; use record classes.
- Money is always BigDecimal, never float or double.
- Every new public REST endpoint requires an integration test in `src/itest/`.

## Architecture
- `api/`: REST controllers and OpenAPI schemas.
- `core/`: Domain logic and business invariants.
- `adapters/`: Outbound communication to external payment gateways.
- `schemas/`: Generated Kafka event definitions (NEVER edit directly).

## Things Claude Gets Wrong
- Do not bump dependency versions in `pom.xml`; platform infrastructure owns upgrades.
- The legacy `v1/` package is frozen; all new logic must reside in `v2/`.
- Never disable or skip failing unit tests; fix the underlying code.
```

---

## 5. Governance Considerations

*   **Auditable Instructions:** Team conventions are explicit and subject to peer review.
*   **Continuous Feedback:** Reviewers can reject PRs with instructions to update `CLAUDE.md` so the team never sees that class of error again.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Repeated Error Frequency | Session traces / Prompt history | Drops to near-zero for documented errors. |
| **Lagging Indicator** | Onboarding Time to First PR | Git commit history for new joiners | Drops from 2 weeks to under 2 days. |
