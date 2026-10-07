---
id: okf-concept-legacy-systems
title: Legacy Systems and the Source of Truth
type: concept
category: architecture
last_updated: "2026-10-06"
tags:
  - enterprise-architecture
  - jira
  - servicenow
  - source-of-truth
  - mcp
summary: Strategies for integrating Markdown-first AI-native workflows with established enterprise systems of record (Jira, ServiceNow, Figma).
related_links:
  - "[[openknowledge/concepts/committed-artifacts-as-audit-trail]]"
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "[[openknowledge/plays/play-12-cicd-pipeline-and-sandboxing]]"
---

# Legacy Systems and the Source of Truth

Enterprise software development rarely happens on a blank slate. Work items live in Jira, requirements in regulatory compliance portals (e.g. Jama, DOORS), designs in Figma, and change controls in ServiceNow.

These legacy systems cannot be eliminated overnight—auditors trust them, external departments depend on them, and legal requirements enforce them. The AI-Native SDLC accommodates these systems via explicit **Source of Truth** architectures.

---

## 1. The Core Invariant: Name Exactly One Source of Truth

When transitioning, declare **one system as the authoritative source of truth for each artifact**, with all other tools holding copies or hyperlinks.

```mermaid
flowchart TD
    subgraph ModelA ["Model 1: Repository as Source of Truth"]
        GitRepo["Git Repository\n(intent.md, spec.md, plan.md)\n[AUTHORITATIVE]"]
        JiraA["Jira / ServiceNow\n(References Commit SHA)\n[LINK ONLY]"]
        GitRepo -->|Sync / Link| JiraA
    end

    subgraph ModelB ["Model 2: Legacy System as Source of Truth"]
        JiraB["Jira / ServiceNow Record\n[AUTHORITATIVE]"]
        AgentWorking["Agent Working Copy\n(Read via MCP -> Markdown -> Sync Back)\n[EPHEMERAL]"]
        JiraB <-->|MCP Connector| AgentWorking
    end

    subgraph ModelC ["Model 3: Linkage as Minimum Bar"]
        GitC["Git Markdown File\n(Includes Ticket-ID: PROJ-123)"]
        JiraC["Jira Ticket\n(Includes Git Commit: abc123f)"]
        GitC <-->|Bi-directional reference| JiraC
    end
```

---

## 2. The Three Architectural Patterns

### Pattern 1: The Repo as the Source of Truth (Recommended for Engineering-Led Orgs)
*   **Architecture:** Markdown artifacts (`intent.md`, `spec.md`, `plan.md`) checked into Git are the canonical records.
*   **Legacy Behavior:** The Jira issue or ServiceNow change ticket is updated programmatically by CI or hooks, storing links directly to the Git commit hash.
*   **Advantages:** Complete unified timeline, single cryptographic authority (`git log`), zero sync drift between requirements and implementation diffs.

### Pattern 2: The Legacy System as the Source of Truth
*   **Architecture:** Jira, ServiceNow, or a specialized requirements database holds the official legal record.
*   **Agent Interaction:** The agent reads the ticket via an **MCP (Model Context Protocol)** connector at session startup, converts it into working Markdown context, and writes back the generated spec or plan into the ticket fields upon completion.
*   **Advantages:** Regulators and non-engineering stakeholders see zero process change; all audit reports continue exporting from existing tools.

### Pattern 3: Linkage as the Minimum Bar (Transition Baseline)
*   **Architecture:** Both systems coexist as recognized dual records.
*   **Enforcement:**
    *   Every Git artifact MUST state the issue key in its frontmatter:
        ```markdown
        # Intent: claims status self-service
        Jira-Key: PROJ-8492
        Commit-Sha: 4a2b9f1
        ```
    *   Every legacy record MUST include the Git commit SHA where the corresponding Markdown artifact was committed.
*   **Advantages:** Instant adoption with zero infrastructure re-architecture.
