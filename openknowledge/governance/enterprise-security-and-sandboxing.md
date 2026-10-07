---
id: okf-gov-security-sandboxing
title: Enterprise Security, Permissions and Sandboxing
type: governance
category: security
last_updated: "2026-10-06"
tags:
  - security
  - permissions
  - sandboxing
  - mdm
  - zero-trust
summary: Architectural guide for locking down agent environments using OS sandboxing, filesystem access control, network domain allowlists, and MDM-managed configurations.
related_links:
  - "[[openknowledge/stages/05-deploy]]"
  - "[[openknowledge/plays/play-11-hooks-as-approval-gates]]"
  - "[[openknowledge/templates/enterprise-managed-settings.template]]"
---

# Enterprise Security, Permissions and Sandboxing

In enterprise and regulated organizations, granting an autonomous agent terminal execution power presents significant security challenges.

The AI-Native SDLC addresses this through defense-in-depth: combining **fine-grained tool permissions**, **OS-level sandboxing**, **deterministic hooks**, and **centrally managed MDM configurations**.

---

## 1. The Defense-in-Depth Security Model

```mermaid
flowchart TD
    Prompt["Agent Action / Command"] --> L1["Layer 1: Permissions Allow/Deny List\n(Blocks secret paths, formats, arbitrary curl/wget)"]
    L1 --> L2["Layer 2: PreToolUse Shell Hooks\n(Enforces branch protection, change tickets, deploy tokens)"]
    L2 --> L3["Layer 3: OS Container / Sandbox Isolation\n(Stripped env secrets, denied ~/.ssh, ~/.aws)"]
    L3 --> L4["Layer 4: Network Egress Domain Allowlist\n(Blocks unauthorized exfiltration, allows internal git/npm)"]
    L4 --> Host["Host OS / Production Infrastructure"]

    style L1 fill:#fff3e0,stroke:#e65100
    style L2 fill:#ffe0b2,stroke:#f57c00
    style L3 fill:#ffcc80,stroke:#ef6c00
    style L4 fill:#ffb74d,stroke:#e65100
```

---

## 2. What Each Security Control Guarantees

### 1. `permissions.deny`
*   Keeps sensitive configuration files out of the agent's context window:
    `"deny": ["Read(.env*)", "Read(./secrets/**)", "WebFetch", "Bash(curl *)", "Bash(wget *)"]`
*   Blocks arbitrary outbound HTTP calls from within tool execution.

### 2. `permissions.allow`
*   Pre-approves the safe, repetitive inner-loop developer commands:
    `"allow": ["Bash(git *)", "Bash(make build)", "Bash(make test)", "Bash(make lint)"]`
*   Eliminates prompt fatigue for routine tasks without compromising security.

### 3. `disableBypassPermissionsMode` & `allowManagedPermissionRulesOnly`
*   Disables command-line flags (such as `--dangerously-skip-permissions`).
*   Ensures individual developers or project-level files cannot widen permissions.

### 4. OS-Level Sandboxing
*   A tool-level deny on `WebFetch` does not prevent a bash command from reaching the network.
*   **The OS Sandbox closes this gap:** Blocks network egress outright, permitting traffic only to explicitly allowlisted domains (`git.internal.example.com`, `registry.npmjs.org`).
*   Denies access to sensitive user directories (`~/.ssh`, `~/.aws/credentials`).
*   Strips sensitive tokens (`GITHUB_TOKEN`, `AWS_SECRET_ACCESS_KEY`) from the environment of every sandboxed process.

### 5. `failIfUnavailable` & `allowUnsandboxedCommands: false`
*   The agent **refuses to initialize or start** if the OS sandbox cannot be spawned.
*   Commands that fail inside the sandbox cannot be retried outside of it.

### 6. Centralized MDM Distribution
*   Configuration is deployed by IT administrators via MDM or the enterprise admin console.
*   Developers and agents have read-only access to policies, guaranteeing universal compliance across the fleet.
