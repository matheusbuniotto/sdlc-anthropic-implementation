---
id: okf-template-review-policy
title: "Template: Repository REVIEW.md"
type: template
stage: stage-5-deploy
last_updated: "2026-10-06"
summary: Template for repository review policy governing automated multi-pass AI pull request reviews.
---

# Pull Request Review Policy

## Review Passes
Execute three distinct passes on every pull request diff. Tag each finding explicitly with its pass name:

### Pass 1: Logic & Regressions (Tag: `[Bugs]`)
- Incorrect conditional branches, potential `null`/`undefined` dereferences.
- Off-by-one errors and array boundary violations.
- Asynchronous race conditions, unhandled Promise rejections, resource leaks.

### Pass 2: Security & Privacy (Tag: `[Security]`)
- SQL, command, or script injection vulnerabilities.
- Authentication bypass or broken endpoint authorization guards.
- Hardcoded keys, tokens, or plaintext secrets.
- Logging of unredacted Personally Identifiable Information (PII) or sensitive payloads.

### Pass 3: Specification & Architecture Alignment (Tag: `[Compliance]`)
- Verify that the implementation diff faithfully satisfies `spec.md` and `plan.md`.
- Flag unexpected file changes or structural deviations not authorized in `plan.md`.
- Verify conformance to architectural invariants specified in `CLAUDE.md`.

---

## Severity Definitions

### `Important`
Reserve the `Important` severity tag exclusively for findings that:
1. Break existing system behavior or produce incorrect calculations.
2. Introduce security vulnerabilities, compliance breaches, or credential leaks.
3. Violate database transaction safety or introduce silent data corruption.

### `Nit`
Minor stylistic preferences, variable naming suggestions, or idiomatic refactorings.

---

## Nit Cap (Anti-Spam Threshold)
- **Report at most 5 nits per review.**
- If more than 5 minor points exist, summarize them in a single aggregated bullet point:
  `"Found 4 additional minor naming/formatting nits; skipping detail to prevent review fatigue."`

---

## Ignore Paths
Do NOT evaluate or comment on:
- Generated files (e.g. `src/gen/**`, `build/**`, `*.min.js`, `schema_generated.ts`).
- Formatting or linting rules that are already automatically enforced by CI linters.
- Third-party vendor bundles or lockfiles (`package-lock.json`, `yarn.lock`).
