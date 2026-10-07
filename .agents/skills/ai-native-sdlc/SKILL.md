---
name: ai-native-sdlc
description: >-
  Transform and execute software development according to the AI-Native SDLC Playbook.
  Use when planning new features (capturing intent.md), designing specifications (spec.md),
  running plan mode (plan.md), enforcing bug fix reproduction protocols, conducting multi-pass
  PR reviews (REVIEW.md), setting up guardrail/approval hooks, or closing the maintenance loop.
---

# AI-Native SDLC Skill

This skill implements the **AI-Native Software Development Lifecycle (SDLC)** methodology based on the Anthropic Technical Playbook by Louis Claxton et al. It provides procedures to operate development as a continuous, autonomous loop with humans governing above the loop.

---

## 1. Fast Action Dispatcher

Choose the relevant phase based on the user's request:

| Request / Action | Procedure | Primary Artifact |
| :--- | :--- | :--- |
| **New Feature / User Idea** | [Phase 1: Capture Intent](#phase-1-capture-intent-intentmd) | `intent/intent.md` |
| **Requirements & Tech Design** | [Phase 2: Generate Spec](#phase-2-requirements--design-specmd) | `specs/spec.md` |
| **Code Implementation Start** | [Phase 3: Plan Mode & Build](#phase-3-plan-mode--build-planmd) | `plans/plan.md` |
| **Bug Fixing / Defect Remediation** | [Phase 4: Test Reproduction Protocol](#phase-4-bug-fix-reproduction-protocol) | Failing test $\rightarrow$ Fix |
| **PR Review / Code Quality Pass** | [Phase 5: Multi-Pass PR Review](#phase-5-multi-pass-pr-review-reviewmd) | `REVIEW.md` checklist |
| **Production Gate / Hook Setup** | [Phase 6: Hook Guardrails](#phase-6-hook-guardrails--approval-gates) | `.claude/hooks/*.sh` |
| **Production Anomaly Triage** | [Phase 7: Maintenance Loop](#phase-7-autonomous-maintenance--closing-the-loop) | Anomaly $\rightarrow$ `intent.md` |

---

## Phase 1: Capture Intent (`intent.md`)

When a user brings a new idea, feature request, or problem statement:
1. **Interview the User (Socratic Elicitation):**
   Ask clarifying questions covering:
   - What users or operators cannot do today (quantified where possible).
   - What the ideal outcome looks like.
   - Affected users, systems, and dependencies.
   - Security, privacy, auth, and performance constraints.
   - Explicit out-of-scope boundaries.
2. **Generate `intent.md`:**
   Structure output according to [Intent Template](../../../openknowledge/templates/intent.template.md):
   ```markdown
   # Intent: [Title]
   Author: [Name] ([Role]). Status: draft. Date: [YYYY-MM-DD]
   ## Problem
   ## Proposed outcome
   ## Affected users and systems
   ## Constraints
   ## Open questions
   ```
3. **Commit Artifact:**
   Save to `intent/<feature-name>.md` and ask user for review before progressing to Design.

---

## Phase 2: Requirements & Design (`spec.md`)

When an `intent.md` is approved:
1. **Load Institutional Skills:**
   Read active repo guidelines (security, API standards, brand tokens).
2. **Draft `spec.md`:**
   Translate intent into software architecture:
   - REQ contracts and interfaces (OpenAPI schema, component contracts).
   - Policy compliance matrix.
   - **Flagged Areas of Concern:** Explicitly highlight any policy contradictions or rate-limit trade-offs.
3. **Sign-Off:**
   Resolve flagged concerns with the user before starting implementation. Commit `spec.md` alongside `intent.md`.

---

## Phase 3: Plan Mode & Build (`plan.md`)

**Rule: Nothing is implemented without an accepted plan.**

1. **Activate Read-Only Plan Mode:**
   Do not edit files immediately. Explore the codebase, trace call stacks, and find existing patterns.
2. **Author `plan.md`:**
   Structure into 4 mandatory sections:
   - **Files that change:** Exhaustive list of paths (new vs modified).
   - **Order of work:** Chronological, step-by-step implementation tasks.
   - **Risks & Mitigations:** Architectural bottlenecks, caching needs, or failure modes.
   - **Proof of Correctness:** Specific test commands, screenshot comparison targets, and lint checks.
3. **Interrogate the Plan:**
   Ask the user: *"What could break? Which step is riskiest? Should we proceed with this execution plan?"*
4. **Autonomous Execution:**
   Once plan is accepted, execute the changes. If an unexpected condition forces a deviation from the plan, update `plan.md` in the exact same commit.

---

## Phase 4: Bug-Fix Reproduction Protocol

When fixing bugs or reported regressions, enforce the **Strict 3-Step Protocol**:
1. **Reproduction Test First:**
   Write an automated test that reproduces the failure. Run it and verify it fails with the reported symptom.
2. **Commit the Failing Test:**
   Commit this test to Git *before* touching application source code.
3. **Fix the Implementation:**
   Modify the application code to make the test pass.
   > **CRITICAL INVARIANT:** Do not edit, weaken, or delete the test assertions during the fix. If tests fail, fix the implementation code, not the test.

---

## Phase 5: Multi-Pass PR Review (`REVIEW.md`)

When reviewing diffs or preparing PRs, execute 3 structured passes:
1. **Pass 1 — Logic & Regressions (`[Bugs]`):**
   Check for off-by-one errors, null dereferences, race conditions, and unhandled errors.
2. **Pass 2 — Security & Privacy (`[Security]`):**
   Check for injection risks, authentication gaps, plaintext tokens, and unredacted PII in logs.
3. **Pass 3 — Compliance & Alignment (`[Compliance]`):**
   Verify the diff matches `plan.md` and `spec.md`. Flag any out-of-scope modified files.
4. **Cap the Nits:**
   Report at most 5 minor style suggestions. Summarize additional minor points in a single count.

---

## Phase 6: Hook Guardrails & Approval Gates

1. **Build Guardrail Hooks (`PreToolUse` on `Edit`):**
   Block edits to protected directories (e.g. `schemas/generated/`, `api/v1/frozen/`, `.env*`).
2. **Production Gate Hooks (`PreToolUse` on `Bash`):**
   Intercept commands targeting `deploy` or `production`. If `RELEASE_APPROVAL` is missing, exit with code `2`:
   ```bash
   if [[ "$cmd" =~ deploy.*production ]]; then
     [ -z "$RELEASE_APPROVAL" ] && echo "Production deploy requires release authorization" >&2 && exit 2
   fi
   ```

---

## Phase 7: Autonomous Maintenance & Closing the Loop

When diagnosing production metric breaches or incidents:
1. **Correlate Anomaly with Git History:**
   Match error signatures or timestamps against recent deploy commit SHAs.
2. **Determine Action Tier:**
   - **Tier 1 ($1\sigma$):** Log only.
   - **Tier 2 ($2\sigma$):** Read-only diagnosis; synthesize finding into `intent/incident-<date>.md`.
   - **Tier 3 ($3\sigma$):** Propose revert PR or trigger rehearsed rollback tool.
3. **Record Lessons Learned:**
   Commit retrospective to `lessons/<date>-<title>.md`.
4. **Permanent Regression Eval:**
   Add reproduction test case to CI `evals/<incident-id>.json`.

---

## References & Documentation
- Master Wiki Index: [openknowledge/INDEX.md](../../../openknowledge/INDEX.md)
- Playbook Stages: [openknowledge/stages/](../../../openknowledge/stages/)
- Implementation Plays: [openknowledge/plays/](../../../openknowledge/plays/)
- Production Templates: [openknowledge/templates/](../../../openknowledge/templates/)
