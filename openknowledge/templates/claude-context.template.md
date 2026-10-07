---
id: okf-template-claude-context
title: "Template: Repository CLAUDE.md"
type: template
stage: stage-3-build
last_updated: "2026-10-06"
summary: High-density, single-page onboarding context template for CLAUDE.md to be checked into repo root.
---

# [Repository / Microservice Name]

## Commands
- **Build:** `make build` (must finish with "Build succeeded")
- **Test (Unit):** `make test` (exits non-zero on test failures)
- **Test (Integration):** `make itest` (requires Docker daemon)
- **Lint / Format:** `make lint` (runs in CI; must have zero warnings)

## Conventions
- **Language / Framework:** [e.g. TypeScript 5.4, React 19, Next.js 15 App Router | Java 21, Spring Boot 3.3]
- **Type Safety & Style:** [e.g. Strict TypeScript mode; no `any`; no manual `type assertions`]
- **Domain Invariants:** [e.g. Financial values must strictly use `BigDecimal` / integer cents, never floating-point `number`]
- **Testing Standard:** Every new endpoint or domain mutation requires an automated test in `tests/`.

## Architecture
- `src/api/`: REST controllers, route handlers, and request schema validators.
- `src/domain/`: Core entities, business rules, and aggregate logic (free of framework dependencies).
- `src/infrastructure/`: Database repositories, third-party clients, external integrations.
- `schemas/`: Generated event contracts and protobufs (NEVER edit generated files manually).

## Things Claude Gets Wrong (The "Twice Rule")
- Do NOT bump dependency versions in `package.json` or `pom.xml`; infrastructure platform owns upgrades.
- The legacy `v1/` route package is frozen; all new routes must be registered under `v2/`.
- Never modify or skip failing assertions in existing test files; fix the application source code.
- Always use the centralized logger (`import logger from '@/lib/logger'`); never call raw `console.log`.

## Verifying Your Work
Before marking any task complete or submitting a PR:
1. Run `make lint` -> must have zero warnings.
2. Run `make test` -> all tests green.
3. Paste the terminal output into your response as proof.
