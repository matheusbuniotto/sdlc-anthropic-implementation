---
id: okf-template-intent
title: "Template: Stage 1 intent.md"
type: template
stage: stage-1-plan
last_updated: "2026-10-06"
summary: Standardized template for capturing customer problem, desired outcomes, constraints, and open questions as an intent.md artifact.
---

# Intent: [Short Descriptive Title]

**Author:** [Full Name] ([Department / Role])  
**Status:** [draft | under-review | approved | rejected]  
**Date:** [YYYY-MM-DD]  
**Source Ticket / Anomaly Ref:** [e.g. JIRA-1234 or ANOMALY-5xx-2026-06-02]  

---

## Problem
[Describe in plain language what users, customers, or internal operators cannot do today. Include quantitative estimates where available (e.g. "Support handlers spend 30% of call time on this"). Avoid premature software design solutions here.]

## Proposed Outcome
[Describe what success looks like when this capability exists. Detail the target user experience, primary workflows, and operational metrics impacted.]

## Affected Users and Systems
- **User Personas:** [e.g. Claims Handlers, Enterprise Portal End-Users]
- **Target Systems / Repositories:** [e.g. frontend-portal, payment-api, auth-service]
- **External Dependencies:** [e.g. Stripe, Twilio, Snowflake]

## Constraints
- **Security & Auth:** [e.g. Existing JWT session auth only; no anonymous access]
- **Data Privacy & Classification:** [e.g. Strictly no new PII persisted in portal cache]
- **Performance / SLAs:** [e.g. p99 response time must stay under 150ms]
- **Out of Scope:** [Explicitly delineate what must NOT be implemented in this iteration]

## Open Questions
- [ ] [Open Question 1: Unresolved product edge case or policy dilemma]
- [ ] [Open Question 2: Downstream service dependency or rate limit consideration]
