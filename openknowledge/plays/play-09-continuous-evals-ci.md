---
id: okf-play-09-evals-ci
title: "Play 09: Continuous Evals in CI"
type: play
stage: stage-4-test
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-05-agent-context-claude-md]]"
  - "[[openknowledge/plays/play-08-verification-feedback-loop]]"
outputs:
  - ".github/workflows/agent-evals.yml"
  - "evals/*.json"
last_updated: "2026-10-06"
tags:
  - test
  - evals
  - ci-cd
  - regression-testing
  - qa
summary: How to construct a regression evaluation suite that tests agent prompts, skills, and configuration changes automatically in CI.
related_links:
  - "[[openknowledge/stages/04-test]]"
  - "[[openknowledge/plays/play-13-closing-the-loop-control-bands]]"
  - "[[openknowledge/templates/ci-evals-workflow.template]]"
---

# Play 09: Continuous Evals in CI

## 1. What Changes

*   **Before:** QA testing occurs at stage gates. When someone alters a system prompt, updates an agent skill, or Anthropic releases a new foundation model, teams have no way to verify whether agent behavior improved or regressed without subjective manual trial and error.
*   **After:** The organization maintains an automated **continuous evaluation suite in CI**. Agent configurations (`CLAUDE.md`, `.claude/skills/`, `.claude/hooks/`) are regression-tested with the exact same rigor as production application code.

---

## 2. Getting Started

*   **Prerequisites:** An established `CLAUDE.md` (Play 05) and local test commands (Play 08).
*   **Infrastructure:** A CI platform (e.g. GitHub Actions) with Claude Code headless execution capability, and an API key with allocated budget for eval runs.

---

## 3. Concrete Steps for Implementation

1.  **Harvest 20 to 50 Real Engineering Tasks:**
    Platform engineers extract real pull requests and bug fixes recently merged by the team, recording the prompt and accepted file diff.
2.  **Define the Eval Schema:**
    Store each test case in `evals/<id>.json`:
    ```json
    {
      "id": "eval-014-auth-header-validation",
      "prompt": "Add Bearer token validation to the /v2/status route and verify it rejects expired tokens with 401.",
      "expected_checks": [
        "pytest tests/test_status_auth.py",
        "make lint"
      ]
    }
    ```
3.  **Construct Non-Interactive CI Runner:**
    Set up a workflow that runs on any PR modifying agent configuration files, as well as a nightly schedule:
    ```yaml
    name: Agent Regression Evals
    on:
      pull_request:
        paths: ['CLAUDE.md', '.claude/**', '.agents/**']
      schedule:
        - cron: '0 2 * * *' # Nightly regression baseline
    ```
4.  **Enforce Pass-Rate Merge Gates:**
    Require that PRs modifying skills or `CLAUDE.md` maintain a pass rate threshold (e.g., $\ge 95\%$). If a prompt edit causes previously passing tasks to fail, the PR is blocked.
5.  **The Incident-to-Eval Pipeline:**
    Whenever a production bug slips through, the incident post-mortem **must include authoring a permanent eval JSON case**. This guarantees the agent never re-introduces the same bug in future sessions.

---

## 4. Production CI Workflow (`.github/workflows/agent-evals.yml`)

```yaml
name: Agent Evals
on:
  pull_request:
    paths: ['CLAUDE.md', '.claude/**']
  schedule:
    - cron: '0 2 * * *'

jobs:
  evals:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Claude Code CLI
        run: npm install -g @anthropic-ai/claude-code
      - name: Execute Eval Suite
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          for eval_file in evals/*.json; do
            echo "Running eval: $eval_file"
            prompt=$(jq -r '.prompt' "$eval_file")
            
            claude -p "$prompt" \
              --allowedTools "Read,Edit,Bash(make test)" \
              --output-format json > result.json
            
            ./evals/check.sh "$eval_file" result.json
          done
```

---

## 5. Governance Considerations

*   **Continuous Quality Gate:** QA shifts from manually testing application features to stewarding and expanding the benchmark eval suite.
*   **Version Pinning:** When upgrading model versions, running the eval suite proves backward compatibility across internal development standards.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Eval Suite Pass Rate | CI eval dashboard | Consistently $\ge 95\%$ across model updates. |
| **Lagging Indicator** | Incident-to-Eval Cycle Time | Post-mortem ticket timestamps | Incidents converted into permanent evals within 48 hours. |
