---
id: okf-template-spec
title: "Template: Stage 2 spec.md"
type: template
stage: stage-2-design
last_updated: "2026-10-06"
summary: Standardized template for requirements and design specification, incorporating policy skill compliance and flagged concerns.
---

# Specification: [Feature Name]

**Intent Reference:** [Link or Path to intent.md]  
**Lead Architect / PO:** [Name]  
**Status:** [draft | under-review | approved]  
**Version:** 1.0.0  

---

## 1. Executive Summary & Scope
[Brief 2-3 paragraph synthesis translating intent.md into concrete software deliverables. Summarize high-level system impacts.]

## 2. Requirements & Functional Contracts
- **REQ-01:** [Description of requirement]
- **REQ-02:** [Description of requirement]
- **REQ-03:** [Edge case handling requirement]

## 3. Technical Architecture & Interfaces

### 3.1 API Endpoints / Schemas
```http
POST /api/v2/resource
Authorization: Bearer <JWT>
Content-Type: application/json

{
  "field_one": "string",
  "field_two": 123
}
```

### 3.2 Data Models & State Transitions
[State diagrams or schema schemas. Specify database entities, indices, or event payloads.]

### 3.3 UI / UX Specifications (If Applicable)
- Design system component references.
- Visual mock URLs or screenshot artifact references.

## 4. Policy Compliance Matrix
| Policy Domain | Applied Skill Version | Compliance Strategy | Status |
| :--- | :--- | :--- | :--- |
| **API Security** | `secure-api-review@v1.2` | Gateway JWT required; input validated via OpenAPI | Compliant |
| **Data Protection** | `pii-redaction@v2.0` | Sensitive fields scrubbed from logging pipeline | Compliant |
| **Brand & Design** | `ui-design-tokens@v1.0` | Shared component library typography & colors | Compliant |

## 5. Flagged Areas of Concern
> [!WARNING]
> Highlight areas where requirements conflict with corporate policy or create architectural risks:
> 1. **Upstream Rate Limiting:** The upstream core service throttles at 50 RPS. A Redis cache layer with 30s TTL is required to prevent denial of service.
> 2. **Authentication Trade-Off:** Requires sign-off from InfoSec regarding session duration.

## 6. Sign-off & Progression
- [ ] Product Owner Approval: `[Name]` Date: `[Date]`
- [ ] Security / Architecture Reviewer: `[Name]` Date: `[Date]`
