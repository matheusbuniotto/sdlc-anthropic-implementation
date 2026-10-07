---
id: okf-play-06-skills-policy
title: "Play 06: Skills as Operational Institutional Knowledge"
type: play
stage: stage-3-build
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-05-agent-context-claude-md]]"
outputs:
  - ".claude/skills/<name>/SKILL.md"
last_updated: "2026-10-06"
tags:
  - build
  - skills
  - policies
  - security
  - compliance
summary: How to encode complex, cross-cutting enterprise policies (security standards, API guidelines, brand rules) into modular, reusable agent skills.
related_links:
  - "[[openknowledge/stages/03-build]]"
  - "[[openknowledge/plays/play-07-build-guardrail-hooks]]"
  - "[[openknowledge/plays/play-10-ai-pr-review-loop]]"
---

# Play 06: Skills as Operational Institutional Knowledge

## 1. What Changes

*   **Before:** Enterprise policies (OWASP standards, API design standards, data governance, accessibility) are published as static PDF documents or internal wikis. Engineers rarely read them completely, and violations are caught late during security or compliance sign-offs.
*   **After:** Policies are codified as **version-controlled agent skills**. When an agent undertakes an action matching a skill's trigger description, the policy instructions load dynamically into context and are applied generative-time.

---

## 2. Rule of Thumb: What Goes Where?

*   **Put in `CLAUDE.md`:** Repo-wide, daily invariants (build command, architecture summary, top 3 recurring errors). Kept under one page.
*   **Put in a `Skill`:** Specialized, multi-step procedures or deep policies that apply only to specific tasks (e.g. creating public endpoints, migrating a database, handling encryption keys).
*   **Put in a `Hook`:** Absolute red lines that must never be bypassed regardless of prompt instructions (e.g. preventing edits to secrets or production deploy blocking).

---

## 3. Concrete Steps for Implementation

1.  **Identify Inconsistently Enforced Knowledge:**
    Select a policy with high business risk that frequently triggers review comments (e.g., API security, telemetry tagging, or PII handling).
2.  **Define the Skill Directory Structure:**
    Create a modular directory in `.claude/skills/<skill-name>/` (or `.agents/skills/<skill-name>/`):
    ```text
    .claude/skills/secure-api-review/
    ├── SKILL.md            # Required frontmatter + procedure
    ├── scripts/            # Optional validation scripts
    │   └── check-endpoints.sh
    └── references/         # Bulky docs, OpenAPI schemas, or checklists
    ```
3.  **Draft `SKILL.md` with Trigger Frontmatter:**
    Ensure the `description` explicitly declares **what** the skill does and **when** it should trigger:
    ```markdown
    ---
    name: secure-api-review
    description: Apply the API security standard. Use whenever creating or modifying an external-facing endpoint, reviewing API code, or generating an OpenAPI spec.
    ---
    # Secure API Review Procedure
    When creating or modifying an API endpoint:
    1. Authentication: Every route requires the gateway JWT; no anonymous access outside `/health`.
    2. Input Validation: Validate all request bodies strictly against schema; reject unknown attributes.
    3. Audit Logging: Every state mutation must emit an audit log with actor, action, and timestamp.
    4. Data Classification: Fields tagged PII must never appear in log payloads or error responses.

    Run `scripts/check-endpoints.sh` and embed its output in your session summary.
    ```
4.  **Test Trigger Activation:**
    Prompt Claude with varied phrasings (e.g., *"Add a POST route to update user profile"*) to ensure the skill reliably activates.
5.  **Assign Named Policy Ownership:**
    The security or architecture lead owns the skill directory. Any policy modification is submitted as a PR against `.claude/skills/` and signed off by the policy owner.

---

## 4. Governance Considerations

*   **Advisory Nature of Skills:** A skill makes the agent highly likely to adhere to guidelines, but does not provide mathematical enforcement. Critical policies must be backed by **deterministic hooks** (Play 07 & Play 11).
*   **Versioned Compliance:** Because skills live in Git, every PR can prove which exact version of the corporate security policy governed its generation.

---

## 5. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Policy Update Propagation Time | Git merge timestamp of skill PR | Policy changes take effect immediately across all engineer sessions. |
| **Lagging Indicator** | Policy-Related PR Review Comments | PR review history | Comments citing the codified policy drop toward zero. |
