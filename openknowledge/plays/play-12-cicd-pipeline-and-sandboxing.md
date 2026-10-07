---
id: okf-play-12-cicd-sandboxing
title: "Play 12: CI/CD Integration, Sandboxing & MCP Deployments"
type: play
stage: stage-5-deploy
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-10-ai-pr-review-loop]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
outputs:
  - "ci-cd-pipelines"
  - "mcp-deployment-tools"
last_updated: "2026-10-06"
tags:
  - deploy
  - ci-cd
  - sandboxing
  - mcp
  - enterprise-security
summary: How to run Claude non-interactively in CI pipelines, apply strict OS sandboxing, and expose deployments via scoped Model Context Protocol (MCP) tools.
related_links:
  - "[[openknowledge/stages/05-deploy]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
  - "[[openknowledge/templates/enterprise-managed-settings.template]]"
  - "[[openknowledge/governance/enterprise-security-and-sandboxing]]"
---

# Play 12: CI/CD Integration, Sandboxing & MCP Deployments

## 1. What Changes

*   **Before:** CI pipelines execute rigid bash scripts. Whenever something fails (a flaky test, a broken compile, an invalid changelog), execution halts and waits for an on-call engineer to manually investigate. Deployments rely on shell scripts holding dangerous, standing production credentials.
*   **After:** Headless Claude instances (`claude -p`) execute inside CI runners for complex judgment steps (triaging build failures, writing release notes). Deployments are abstracted behind scoped **MCP tools**, executing inside sandboxes stripped of standing production credentials.

---

## 2. Getting Started

*   **Prerequisites:** Code review loop active (Play 10) and approval gate hooks deployed (Play 11).
*   **Infrastructure:** A CI platform (GitHub Actions, GitLab CI), runner sandboxes, enterprise LLM endpoints (AWS Bedrock, Google Vertex AI, or Microsoft Foundry), and custom MCP servers for target environments.

---

## 3. Concrete Steps for Implementation

1.  **Introduce Read-Only Judgment Steps First:**
    Begin by using headless Claude to triage failures and summarize diffs without giving the agent write permissions:
    ```yaml
    - name: Triage Failed Build
      if: failure()
      run: >
        claude -p "Read the build log at out/build.log. Identify the root cause,
        indicate whether the failure appears flaky or deterministic, and format
        a concise summary for the PR thread." >> triage.md
    ```
2.  **Add Gated Write Actions:**
    Allow headless agents to auto-fix formatting, regenerate API client SDKs, or update changelogs, but route all output as **new pull requests through branch protection**. The agent never possesses direct push rights to `main`.
3.  **Enforce Multi-Tier Environment Autonomy:**
    *   **Development / Sandbox:** Agent possesses full autonomy to trigger deployments and tear downs.
    *   **Staging:** Agent deploys automatically if integration tests pass; rehearses rollbacks continuously.
    *   **Production:** Agent prepares the release candidate, verifies checksums, drafts release notes, and halts at the approval gate hook.
4.  **Expose Deployment Tooling via MCP:**
    Rather than letting agents execute arbitrary bash shell commands with broad credentials, expose deployment actions as structured Model Context Protocol (MCP) tools:
    *   `tools/deploy(env, image_tag)`
    *   `tools/deployment_status(env)`
    *   `tools/rollback(env, target_revision)`
    This replaces shell scripting with a strictly typed API allowlist.
5.  **Rehearse the Rollback Path:**
    The rollback tool must be exercised on every staging deployment. When an anomaly occurs in Stage 6, the agent must be able to roll back in seconds with proven certainty.

---

## 4. Enterprise Sandboxing Configuration

Production runners deploy `managed-settings.json` to prevent arbitrary network egress or host file exploration:

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": true,
    "allowUnsandboxedCommands": false,
    "network": {
      "allowedDomains": [
        "git.internal.example.com",
        "registry.npmjs.org",
        "pypi.org"
      ]
    },
    "credentials": {
      "files": [
        { "path": "~/.ssh", "mode": "deny" },
        { "path": "~/.aws/credentials", "mode": "deny" }
      ],
      "envVars": [
        { "name": "AWS_SECRET_ACCESS_KEY", "mode": "deny" }
      ]
    }
  }
}
```

---

## 5. Governance Considerations

*   **Identity Segregation:** Non-interactive CI agents execute under a dedicated service identity, guaranteeing distinct attribution in audit logs.
*   **Zero Standing Privileges:** Agents receive short-lived, environment-scoped tokens with minimum permissions necessary to execute the approved step.

---

## 6. How to Measure Success

| Metric Type | Metric Name | Measurement Source | Target / Expectation |
| :--- | :--- | :--- | :--- |
| **Leading Indicator** | Automated Pipeline Triage Rate | CI job execution logs | $\ge 70\%$ of pipeline errors triaged without waking an engineer. |
| **Lagging Indicator** | DORA Lead Time & MTTR | DORA observability stack | Significant reduction in Lead Time for Changes and Mean Time to Recovery. |
