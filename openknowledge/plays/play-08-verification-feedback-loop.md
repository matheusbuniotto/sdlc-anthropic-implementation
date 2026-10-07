---
id: okf-play-08-feedback-loop
title: "Play 08: Deterministic Verification Feedback Loop"
type: play
stage: stage-4-test
entry_point: true
prerequisites: []
outputs:
  - "CLAUDE.md verification section"
  - "test-protection hooks"
last_updated: "2026-10-06"
tags:
  - test
  - feedback-loop
  - tdd
  - self-healing
  - entry-point
summary: How to equip agents with self-verifying build and test loops, the strict test-first bug fix protocol, and hook-level test file protections.
related_links:
  - "[[openknowledge/stages/04-test]]"
  - "[[openknowledge/plays/play-07-build-guardrail-hooks]]"
  - "[[openknowledge/plays/play-09-continuous-evals-ci]]"
---

# Play 08: Deterministic Verification Feedback Loop

## 1. What Changes

*   **Before:** Code correctness signals arrive late. CI runs minutes later, QA verifies days later, or production users report broken flows weeks later. The human engineer is forced to manually test every edge case, becoming the ultimate delivery bottleneck.
*   **After:** The agent is provided with an immediate, self-correcting feedback loop. It runs local builds, executes test suites, inspects screenshot diffs, and iterates autonomously until all checks pass *before* declaring work done.

---

## 2. Feedback Loop vs. Verifier Subagent

*   **Feedback Loop:** Runs continuously throughout the implementation session as many times as code changes.
*   **Verifier Subagent:** An independent, fresh context window launched *after* work is allegedly complete. Because it has no memory of the assumptions made during coding, it evaluates the change objectively without bias.

---

## 3. Concrete Steps for Implementation

1.  **Wrap Checks in Single Deterministic Commands:**
    Consolidate environment setups and multi-step checks into a single invocation (`make test`, `npm test`, `cargo test`) that exits non-zero on any error.
2.  **Define Quantifiable Verification Targets:**
    Instruct Claude with clear, measurable proof conditions:
    *   `"All unit tests in tests/claims/test_service.py must pass."`
    *   `"The endpoint /api/v2/status returns 200 OK with expected payload schema."`
    *   `"Frontend screenshot matches mock with zero visual regressions."`
3.  **Enforce the Strict Bug-Fixing Protocol:**
    For resolving any defect or regression:
    *   **Step A (Reproduction):** Instruct the agent to author a failing test that reproduces the bug, run it, and confirm it fails for the exact reported reason.
    *   **Step B (Commit Reproduction):** Commit that failing test to Git *before* touching application code.
    *   **Step C (Fix Implementation):** Instruct the agent to make the test pass **without modifying the test file**.
    A passing test that predated the fix and could not be altered by the agent is cryptographic proof the defect is resolved.
4.  **Protect Test Integrity via Hooks:**
    Configure a hook to disallow editing test files during fix sessions:
    ```bash
    # Check if agent attempts to edit tests during fix
    if [[ "$tool_file" =~ ^tests/.* ]] && [ "$FIX_MODE" = "true" ]; then
      echo "REJECTED: Test files are locked during bug remediation. Fix the implementation." >&2
      exit 2
    fi
    ```
5.  **Codify Verification in `CLAUDE.md`:**
    Add a non-negotiable verification block to `CLAUDE.md`:
    ```markdown
    ## Verifying Your Work
    - Build: make build (must finish with "Build succeeded")
    - Test: make test (all green; never skip or delete a failing test)
    - Lint: make lint (zero warnings)

    Run all three before reporting any task complete, and paste the literal terminal output.
    If a test fails, fix the code, not the test.
    ```

---

## 4. Governance Considerations

*   **Mechanical Proof Attached to PR:** The PR description contains the literal terminal output and test logs produced by the toolchain. Reviewers don't have to wonder if it was tested.
*   **Tamper Prevention:** Hooks prevent agents from lowering code coverage thresholds or skipping broken test assertions.

---

## 5. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | First-Pass CI Success Rate | CI pipeline telemetry | $\ge 90\%$ pass rate on initial commit push. |
| **Lagging Indicator** | Review Turnaround Time | GitHub PR metadata | Review time falls by $>60\%$ as mechanical proof is pre-attached. |
