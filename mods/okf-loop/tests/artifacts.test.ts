import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_CONFIG } from '../hooks/core/config'
import { TEMPLATE_NAMES } from '../hooks/core/constants'
import {
  REQUIRED_SECTIONS,
  appendTwiceRule,
  driftFiles,
  flaggedConcernCount,
  parseArtifact,
  parseReview,
  parseVerdict,
  planFiles,
  readStatus,
  renderArtifact,
  renderScaffold,
  sectionNames,
  setArtifactStatus,
} from '../hooks/core/artifacts'
import { bundledKnowledge } from '../hooks/core/knowledge'

const cfg = { review: DEFAULT_CONFIG.review }
const templates = bundledKnowledge().templates
const tpl = (n: 'intent' | 'spec' | 'plan' | 'claude-context' | 'bands' | 'ci-evals-workflow') => templates[n] ?? ''
const codes = (d: { issues: { code: string }[] }) => d.issues.map((i) => i.code)

const INTENT = `# Intent: Self-service refunds

**Author:** Maria Silva (Claims Product)  
**Status:** under-review  
**Date:** 2026-10-06  
**Source Ticket / Anomaly Ref:** JIRA-4521  

---

## Problem
Claims handlers spend 30% of call time issuing refunds by hand.

## Proposed Outcome
Customers refund eligible orders in the portal without a call.

## Affected Users and Systems
- **User Personas:** Claims Handlers
- **Target Systems / Repositories:** portal, payment-api

## Constraints
- **Security & Auth:** Existing JWT session auth only.
- **Out of Scope:** Partial refunds.

## Open Questions
- [x] Which refund window applies? Answered: 30 days.
- [ ] Does finance need a weekly export?
`

const SPEC = `# Specification: Self-service refunds

**Intent Reference:** intent/self-service-refunds.md  
**Lead Architect / PO:** Maria Silva  
**Status:** draft  
**Version:** 1.0.0  

---

## 1. Executive Summary & Scope
Customers can refund eligible orders.

## 2. Requirements & Functional Contracts
- **REQ-01:** Refund within 30 days.

## 3. Technical Architecture & Interfaces

### 3.1 API Endpoints / Schemas
\`\`\`http
POST /api/v2/refunds
## not a heading, inside a fence
\`\`\`

## 4. Policy Compliance Matrix
| Policy Domain | Applied Skill Version | Compliance Strategy | Status |
| :--- | :--- | :--- | :--- |
| **API Security** | \`secure-api-review@v1.2\` | JWT required | Compliant |

## 5. Flagged Areas of Concern
> [!WARNING]
> 1. **Upstream Rate Limiting:** the core service throttles at 50 RPS.
> 2. **Authentication Trade-Off:** needs InfoSec sign-off.

## 6. Sign-off & Progression
- [x] Product Owner Approval: \`[Name]\` Date: \`[Date]\`
- [ ] Security / Architecture Reviewer: \`[Name]\` Date: \`[Date]\`
`

const PLAN = `# Plan: Self-service refunds (from specs/self-service-refunds.spec.md)

**Author / Engineer:** Maria Silva  
**Branch:** \`feature/self-service-refunds\`  
**Status:** accepted  
**Date:** 2026-10-06  

---

## Files That Change
- \`src/api/refunds.ts\` (new)
- \`src/domain/refund.ts\` (modify: add the 30 day window)
- tests/refund.test.ts - new unit tests
- \`src/ui/\`, \`docs/refunds.md\`
- \`schemas/**\`

## Order of Work
1. Endpoint.
2. Domain rule.

## Risks
- Upstream latency.

## Proof of Correctness
- \`make test\`: all green.
`

const PROOF = `Running verification...

### Verification Verdict: PASS
### Commands Executed
- make test
### Discrepancies vs plan.md
None.
`

const REVIEW = `# Review: Self-service refunds

### Pass 1 — Logic & Regressions [Bugs]
- [x] **Important** [Bugs] src/api/refunds.ts:42 — off-by-one in the 30 day window
- **Nit** [Bugs] src/domain/refund.ts:10 — rename \`d\` to \`days\`

### Pass 2 — Security & Privacy [Security]
- [ ] **Important** [Security] src/api/refunds.ts:60 — refund id is not authorized against the caller

### Pass 3 — Specification & Architecture Alignment [Compliance]
- **Nit** [Compliance] src/ui/Refund.tsx:3 — not in plan.md

Found 4 additional minor naming/formatting nits; skipping detail to prevent review fatigue.
### Review Verdict: BLOCKED
`

describe('sectionNames', () => {
  test('lists ## headings in order, numbering stripped, fences and ### ignored', () => {
    expect(sectionNames(SPEC)).toEqual([
      'Executive Summary & Scope',
      'Requirements & Functional Contracts',
      'Technical Architecture & Interfaces',
      'Policy Compliance Matrix',
      'Flagged Areas of Concern',
      'Sign-off & Progression',
    ])
    expect(sectionNames('## 2.1 Deep\n### Sub\n##Tight\n## Trailing ##\n')).toEqual(['Deep', 'Trailing'])
    expect(sectionNames('')).toEqual([])
  })
})

describe('readStatus', () => {
  test('reads the bold, plain, list and backticked shapes', () => {
    expect(readStatus('# T\n\n**Status:** approved  \n')).toBe('approved')
    expect(readStatus('# T\n\n**Status**: accepted\n')).toBe('accepted')
    expect(readStatus('# T\n\nStatus: under-review\n')).toBe('under-review')
    expect(readStatus('# T\n\n- **Status:** `in-progress`\n')).toBe('in-progress')
    expect(readStatus('# T\n\nstatus: Complete\n')).toBe('complete')
  })

  test('tolerates spaces, annotations and CRLF', () => {
    expect(readStatus('**Status:** under review\n')).toBe('under-review')
    expect(readStatus('**Status:** in progress (day 2)\n')).toBe('in-progress')
    expect(readStatus('**Status:** approved by Maria\n')).toBe('approved')
    expect(readStatus('# T\r\n**Status:** rejected\r\n')).toBe('rejected')
  })

  test('the template placeholder list is a draft; nothing readable is unknown', () => {
    expect(readStatus('**Status:** [draft | under-review | approved | rejected]\n')).toBe('draft')
    expect(readStatus('**Status:** banana\n')).toBe('unknown')
    expect(readStatus('**Status:**\n')).toBe('unknown')
    expect(readStatus('# no status here\n')).toBe('unknown')
  })

  test('only the header block counts: a Status line in the body or in a fence is not the status', () => {
    expect(readStatus('# T\n\n## Body\nStatus: approved\n')).toBe('unknown')
    expect(readStatus('# T\n```\nStatus: approved\n```\n\n**Status:** draft\n')).toBe('draft')
  })
})

describe('setArtifactStatus', () => {
  test('rewrites the value and keeps the shape', () => {
    expect(setArtifactStatus('# T\n\n**Status:** draft  \n**Date:** x\n', 'intent', 'approved')).toBe('# T\n\n**Status:** approved  \n**Date:** x\n')
    expect(setArtifactStatus('# T\n\nStatus: draft\n', 'plan', 'accepted')).toBe('# T\n\nStatus: accepted\n')
    expect(setArtifactStatus('- **Status**: draft\n', 'spec', 'under-review')).toBe('- **Status**: under-review\n')
    expect(setArtifactStatus('**Status:** `draft`\n', 'plan', 'in-progress')).toBe('**Status:** `in-progress`\n')
    expect(setArtifactStatus('# T\r\n**Status:** draft\r\n', 'intent', 'approved')).toBe('# T\r\n**Status:** approved\r\n')
  })

  test('replaces the template placeholder list', () => {
    const out = setArtifactStatus(INTENT.replace('under-review', '[draft | under-review | approved | rejected]'), 'intent', 'draft')
    expect(out).toContain('**Status:** draft  \n')
    expect(out).not.toContain('[draft |')
  })

  test('is idempotent and leaves the rest of the document alone', () => {
    const once = setArtifactStatus(PLAN, 'plan', 'complete')
    expect(setArtifactStatus(once, 'plan', 'complete')).toBe(once)
    expect(once.replace('**Status:** complete', '**Status:** accepted')).toBe(PLAN)
    expect(setArtifactStatus(PLAN, 'plan', 'accepted')).toBe(PLAN)
  })

  test('inserts a missing Status line after the header fields, in their style', () => {
    const bold = '# Plan: X\n\n**Author:** A  \n**Date:** D  \n\n---\n\n## Files That Change\n'
    expect(setArtifactStatus(bold, 'plan', 'draft')).toBe('# Plan: X\n\n**Author:** A  \n**Date:** D  \n**Status:** draft  \n\n---\n\n## Files That Change\n')
    const plain = '# Intent: X\n\nAuthor: A\n\n## Problem\n'
    expect(setArtifactStatus(plain, 'intent', 'draft')).toBe('# Intent: X\n\nAuthor: A\nStatus: draft\n\n## Problem\n')
    expect(setArtifactStatus('# T\n\n## Problem\n', 'intent', 'draft')).toBe('# T\n\n**Status:** draft\n\n## Problem\n')
    expect(setArtifactStatus('no heading\n', 'intent', 'draft')).toBe('**Status:** draft\n\nno heading\n')
  })

  test('a status outside the kind vocabulary changes nothing', () => {
    expect(setArtifactStatus(INTENT, 'intent', 'complete')).toBe(INTENT)
    expect(setArtifactStatus(SPEC, 'spec', 'accepted')).toBe(SPEC)
    expect(setArtifactStatus(PLAN, 'plan', 'approved')).toBe(PLAN)
    expect(setArtifactStatus(PLAN, 'plan', 'unknown')).toBe(PLAN)
    expect(setArtifactStatus(PLAN, 'plan', 'missing')).toBe(PLAN)
  })
})

describe('parseArtifact: a complete intent', () => {
  const doc = parseArtifact('intent', 'intent/self-service-refunds.md', INTENT, 1234, cfg)

  test('reads title, status, sections, checklist', () => {
    expect(doc.exists).toBe(true)
    expect(doc.kind).toBe('intent')
    expect(doc.path).toBe('intent/self-service-refunds.md')
    expect(doc.mtimeMs).toBe(1234)
    expect(doc.title).toBe('Self-service refunds')
    expect(doc.status).toBe('under-review')
    expect(doc.sections).toEqual(['Problem', 'Proposed Outcome', 'Affected Users and Systems', 'Constraints', 'Open Questions'])
    expect(doc.missingSections).toEqual([])
    expect(doc.checklist).toEqual({ done: 1, total: 2 })
    expect(doc.flaggedConcerns).toBe(0)
    expect(doc.planFiles).toEqual([])
  })

  test('has no issues: it is ready to put to a human', () => {
    expect(doc.issues).toEqual([])
  })
})

describe('parseArtifact: missing, empty and malformed', () => {
  test('a missing file reports every required section as missing and status missing', () => {
    const doc = parseArtifact('spec', 'specs/x.spec.md', null, 0, cfg)
    expect(doc.exists).toBe(false)
    expect(doc.status).toBe('missing')
    expect(doc.missingSections).toEqual(REQUIRED_SECTIONS.spec)
    expect(doc.issues).toEqual([])
    expect(parseArtifact('proof', 'p.md', null, 0, cfg).missingSections).toEqual([])
  })

  test('an empty or blank file is an error', () => {
    for (const text of ['', ' \n\n']) {
      const doc = parseArtifact('intent', 'intent/x.md', text, 5, cfg)
      expect(doc.exists).toBe(true)
      expect(codes(doc)).toEqual(['empty'])
      expect(doc.issues[0]?.severity).toBe('error')
    }
  })

  test('no Status line, unreadable Status and a status foreign to the kind are errors', () => {
    const none = parseArtifact('intent', 'x', INTENT.replace(/\*\*Status:\*\*.*\n/, ''), 0, cfg)
    expect(codes(none)).toEqual(['status-invalid'])
    expect(none.status).toBe('unknown')
    expect(none.issues[0]?.severity).toBe('error')
    const junk = parseArtifact('intent', 'x', INTENT.replace('under-review', 'banana'), 0, cfg)
    expect(junk.issues[0]?.message).toContain('not readable')
    const foreign = parseArtifact('spec', 'x', SPEC.replace('draft', 'accepted'), 0, cfg)
    expect(foreign.issues[0]?.message).toContain('"accepted" is not valid for spec')
    expect(foreign.status).toBe('unknown')
    expect(parseArtifact('plan', 'x', PLAN.replace('accepted', 'approved'), 0, cfg).status).toBe('unknown')
  })

  test('each missing section is a warning', () => {
    const doc = parseArtifact('intent', 'x', INTENT.replace('## Constraints', '## Limits'), 0, cfg)
    expect(doc.missingSections).toEqual(['Constraints'])
    expect(doc.issues).toEqual([{ severity: 'warn', code: 'missing-section', message: 'Missing section "Constraints".' }])
  })

  test('section matching ignores case, numbering and "&"/"and", and accepts the short name', () => {
    const plan = parseArtifact('plan', 'x', PLAN, 0, cfg)
    expect(plan.sections).toContain('Risks')
    expect(plan.missingSections).toEqual([])
    const spec = parseArtifact('spec', 'x', SPEC.replace('Executive Summary & Scope', 'executive summary and scope').replace('Sign-off & Progression', 'Sign off'), 0, cfg)
    expect(spec.missingSections).toEqual([])
    const odd = parseArtifact('plan', 'x', PLAN.replace('## Files That Change', '## 1) FILES that change'), 0, cfg)
    expect(odd.missingSections).toEqual([])
  })

  test('proof, review, lesson and eval kinds have no required sections and a status only if written', () => {
    expect(parseArtifact('proof', 'p', PROOF, 0, cfg).status).toBe('unknown')
    expect(parseArtifact('proof', 'p', PROOF, 0, cfg).missingSections).toEqual([])
    expect(parseArtifact('lesson', 'l', '# Lesson\n\n**Status:** draft\n', 0, cfg).status).toBe('draft')
    expect(codes(parseArtifact('proof', 'p', 'no verdict here', 0, cfg))).toEqual(['no-verdict'])
    const ev = parseArtifact('eval', 'e.json', '{"id":"inc-42","prompt":"x"}', 0, cfg)
    expect(ev.title).toBe('inc-42')
    expect(ev.issues).toEqual([])
    expect(codes(parseArtifact('eval', 'e.json', '{oops', 0, cfg))).toEqual(['invalid-json'])
  })

  test('an incident is read as an intent without required sections', () => {
    const doc = parseArtifact('incident', 'intent/incident-2026-10-06.md', INTENT.replace('under-review', 'draft'), 0, cfg)
    expect(doc.status).toBe('draft')
    expect(doc.missingSections).toEqual([])
    expect(doc.checklist).toEqual({ done: 1, total: 2 })
  })
})

describe('parseArtifact: placeholders', () => {
  test('the untouched templates are drafts with a placeholder warning and are not ready', () => {
    for (const kind of ['intent', 'spec', 'plan'] as const) {
      const doc = parseArtifact(kind, `${kind}.md`, tpl(kind), 0, cfg)
      expect(doc.status).toBe('draft')
      expect(codes(doc)).toContain('placeholder')
      expect(doc.missingSections).toEqual([])
    }
    const intent = parseArtifact('intent', 'x', tpl('intent'), 0, cfg)
    expect(intent.issues[0]?.message).toContain('[Short Descriptive Title]')
    expect(intent.title).toBe('[Short Descriptive Title]')
  })

  test('a bracketed Describe… slot is caught even without a closing bracket', () => {
    const text = INTENT.replace('Claims handlers spend 30% of call time issuing refunds by hand.', '[Describe in plain language what users cannot do')
    expect(codes(parseArtifact('intent', 'x', text, 0, cfg))).toEqual(['placeholder'])
  })

  test('links, checkboxes, wiki links, code spans and fenced code are not placeholders', () => {
    const text = INTENT.replace(
      'Customers refund eligible orders in the portal without a call.',
      'See [the policy](https://x.test) and [[wiki/link]] and `[Name]` and [1]: ref\n\n```\n[Describe this]\n```\n[e.g. example text]'.replace('[e.g. example text]', ''),
    )
    expect(codes(parseArtifact('intent', 'x', text, 0, cfg))).toEqual([])
  })

  test('the spec sign-off block is for the human: [Name] and [Date] there do not count', () => {
    const text = SPEC.replaceAll('`[Name]`', '[Name]').replaceAll('`[Date]`', '[Date]')
    expect(codes(parseArtifact('spec', 'x', text, 0, cfg))).toEqual([])
    expect(codes(parseArtifact('spec', 'x', text.replace('Customers can refund eligible orders.', '[Name]'), 0, cfg))).toEqual(['placeholder'])
  })

  test('template example text that is easy to leave behind is flagged', () => {
    const branch = PLAN.replace('feature/self-service-refunds', 'feature/[feature-name]')
    expect(codes(parseArtifact('plan', 'x', branch, 0, cfg))).toEqual(['placeholder'])
    const warn = SPEC.replace('> [!WARNING]', '> [!WARNING]\n> Highlight areas where requirements conflict with corporate policy or create architectural risks:')
    expect(codes(parseArtifact('spec', 'x', warn, 0, cfg))).toEqual(['placeholder'])
    const example = PLAN.replace('src/api/refunds.ts', 'path/to/NewComponent.tsx')
    const doc = parseArtifact('plan', 'x', example, 0, cfg)
    expect(doc.issues[0]?.message).toContain('path/to/')
  })

  test('a status choice list left in the Status line is a placeholder', () => {
    const doc = parseArtifact('plan', 'x', PLAN.replace('accepted', '[draft | accepted | in-progress | complete]'), 0, cfg)
    expect(doc.status).toBe('draft')
    expect(codes(doc)).toEqual(['placeholder'])
  })
})

describe('parseArtifact: spec and plan details', () => {
  test('spec: sign-off checklist, flagged concerns, no issues', () => {
    const doc = parseArtifact('spec', 'specs/x.spec.md', SPEC, 0, cfg)
    expect(doc.title).toBe('Self-service refunds')
    expect(doc.status).toBe('draft')
    expect(doc.checklist).toEqual({ done: 1, total: 2 })
    expect(doc.flaggedConcerns).toBe(2)
    expect(doc.missingSections).toEqual([])
    expect(doc.issues).toEqual([])
  })

  test('spec without any sign-off checkbox has checklist.total 0', () => {
    const doc = parseArtifact('spec', 'x', SPEC.replace(/- \[[ x]\] .*\n/g, ''), 0, cfg)
    expect(doc.checklist).toEqual({ done: 0, total: 0 })
  })

  test('plan: title without "(from …)", files, a short "Risks" section accepted', () => {
    const doc = parseArtifact('plan', 'plans/x.plan.md', PLAN, 0, cfg)
    expect(doc.title).toBe('Self-service refunds')
    expect(doc.status).toBe('accepted')
    expect(doc.planFiles).toEqual(['src/api/refunds.ts', 'src/domain/refund.ts', 'tests/refund.test.ts', 'src/ui/', 'docs/refunds.md', 'schemas/**'])
    expect(doc.issues).toEqual([])
  })

  test('plan with nothing under Files That Change warns no-files', () => {
    const doc = parseArtifact('plan', 'x', PLAN.replace(/## Files That Change[\s\S]*## Order of Work/, '## Files That Change\n\n## Order of Work'), 0, cfg)
    expect(doc.planFiles).toEqual([])
    expect(codes(doc)).toEqual(['no-files'])
  })

  test('review documents carry the parseReview lint', () => {
    const doc = parseArtifact('review', 'reviews/x.review.md', REVIEW, 0, cfg)
    expect(doc.exists).toBe(true)
    expect(doc.issues.map((i) => i.code)).toEqual([])
    expect(codes(parseArtifact('review', 'r', 'nothing useful', 0, cfg))).toContain('no-passes')
  })
})

describe('flaggedConcernCount', () => {
  test('counts numbered, bulleted and bold-led entries, in a blockquote or not', () => {
    expect(flaggedConcernCount(SPEC)).toBe(2)
    expect(flaggedConcernCount('## 5. Flagged Areas of Concern\n- one\n- two\n- three\n\n## 6. Sign-off\n- [ ] a\n')).toBe(3)
    expect(flaggedConcernCount('## Flagged Areas of Concern\n> **Rate limits:** 50 RPS\n> **Auth:** sign-off\n')).toBe(2)
    expect(flaggedConcernCount('## Flagged Areas of Concern\n1. First\n2) Second\n')).toBe(2)
  })

  test('none, resolved items, prose and a missing section count zero', () => {
    expect(flaggedConcernCount('## Flagged Areas of Concern\n- None\n')).toBe(0)
    expect(flaggedConcernCount('## Flagged Areas of Concern\nNone.\n')).toBe(0)
    expect(flaggedConcernCount('## Flagged Areas of Concern\n- [x] resolved\n- [ ] open\n')).toBe(1)
    expect(flaggedConcernCount('## Flagged Areas of Concern\n> Highlight areas where requirements conflict.\n')).toBe(0)
    expect(flaggedConcernCount('## Problem\n- not a concern\n')).toBe(0)
    expect(flaggedConcernCount('')).toBe(0)
  })
})

describe('planFiles', () => {
  const plan = (body: string) => `# Plan: x\n\n## Files That Change\n${body}\n\n## Order of Work\n- \`src/not-listed.ts\`\n`

  test('takes paths from bullets, ignoring annotations; later sections are not read', () => {
    expect(planFiles(PLAN)).toEqual(['src/api/refunds.ts', 'src/domain/refund.ts', 'tests/refund.test.ts', 'src/ui/', 'docs/refunds.md', 'schemas/**'])
  })

  test('handles numbered lists, bold, ./ prefixes, backslashes and duplicates', () => {
    const out = planFiles(plan('1. `./src/a.ts` (new)\n2. **src/b.ts**: modify\n* `src\\c.ts`\n- `src/a.ts` (again)'))
    expect(out).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  test('takes several paths from one bullet and ignores prose bullets', () => {
    expect(planFiles(plan('- `a/x.ts`, `a/y.ts` and `a/z.ts` (modify)\n- Nothing else changes\n- Makefile\n- New file: `docs/new.md`'))).toEqual(['a/x.ts', 'a/y.ts', 'a/z.ts', 'Makefile', 'docs/new.md'])
  })

  test('reads table rows and fenced listings', () => {
    expect(planFiles(plan('| File | Change |\n| --- | --- |\n| `src/t.ts` | new |'))).toEqual(['src/t.ts'])
    expect(planFiles(plan('```\nsrc/f1.ts\n- src/f2.ts\n```'))).toEqual(['src/f1.ts', 'src/f2.ts'])
  })

  test('keeps glob entries whole, including a leading **', () => {
    expect(planFiles(plan('- `**/*.test.ts`\n- `schemas/**` (generated)'))).toEqual(['**/*.test.ts', 'schemas/**'])
  })

  test('no section means no files', () => {
    expect(planFiles('# Plan\n\n## Order of Work\n- `a.ts`\n')).toEqual([])
    expect(planFiles('')).toEqual([])
  })
})

describe('driftFiles', () => {
  test('files outside the plan are drift; exact matches are not', () => {
    expect(driftFiles(['src/a.ts', 'src/b.ts'], ['src/a.ts'])).toEqual(['src/b.ts'])
    expect(driftFiles([], ['src/a.ts'])).toEqual([])
    expect(driftFiles(['src/a.ts'], [])).toEqual(['src/a.ts'])
  })

  test('a planned directory (with or without a trailing slash) covers the files beneath it', () => {
    expect(driftFiles(['src/ui/Button.tsx', 'src/ui/deep/x.ts', 'src/uix/y.ts'], ['src/ui/'])).toEqual(['src/uix/y.ts'])
    expect(driftFiles(['src/ui/Button.tsx', 'src/uix/y.ts'], ['src/ui'])).toEqual(['src/uix/y.ts'])
  })

  test('a planned glob covers what it matches', () => {
    expect(driftFiles(['schemas/a.json', 'schemas/deep/b.json', 'src/c.ts'], ['schemas/**'])).toEqual(['src/c.ts'])
    expect(driftFiles(['src/a.ts', 'src/a.js', 'src/sub/b.ts'], ['src/*.ts'])).toEqual(['src/a.js', 'src/sub/b.ts'])
  })

  test('normalizes ./ and backslashes and de-duplicates', () => {
    expect(driftFiles(['./src/a.ts', 'src\\b.ts', 'src/b.ts'], ['src/a.ts'])).toEqual(['src/b.ts'])
  })
})

describe('parseVerdict', () => {
  test('reads PASS and FAIL from the verdict line', () => {
    expect(parseVerdict(PROOF)).toBe('PASS')
    expect(parseVerdict('### Verification Verdict: FAIL\n')).toBe('FAIL')
    expect(parseVerdict('**Verification Verdict:** PASS\n')).toBe('PASS')
    expect(parseVerdict('Verification Verdict: pass')).toBe('PASS')
  })

  test('the last verdict wins; the template placeholder and prose are not verdicts', () => {
    expect(parseVerdict('### Verification Verdict: FAIL\n...\n### Verification Verdict: PASS\n')).toBe('PASS')
    expect(parseVerdict('### Verification Verdict: [PASS | FAIL]\n')).toBeNull()
    expect(parseVerdict('The verification verdict is PASS')).toBeNull()
    expect(parseVerdict('')).toBeNull()
  })

  test('works inside a pasted fence and with CRLF', () => {
    expect(parseVerdict('```\n### Verification Verdict: PASS\n```\n')).toBe('PASS')
    expect(parseVerdict('x\r\n### Verification Verdict: FAIL\r\n')).toBe('FAIL')
  })
})

describe('parseReview', () => {
  test('counts passes, findings, nits and the overflow line per SPEC §5.6', () => {
    const r = parseReview(REVIEW, cfg)
    expect(r.passes).toEqual(['Bugs', 'Security', 'Compliance'])
    expect(r.importantOpen).toBe(1)
    expect(r.importantResolved).toBe(1)
    expect(r.nits).toBe(2)
    expect(r.nitOverflowSummarized).toBe(true)
    expect(r.verdict).toBe('BLOCKED')
    expect(r.issues).toEqual([])
  })

  test('a clean review', () => {
    const clean = `# Review: x
### Pass 1 — Logic & Regressions [Bugs]
No findings.
### Pass 2 — Security & Privacy [Security]
No findings.
### Pass 3 — Specification & Architecture Alignment [Compliance]
- **Nit** [Compliance] a.ts:1 — nit
### Review Verdict: CLEAN
`
    const r = parseReview(clean, cfg)
    expect(r).toEqual({ passes: ['Bugs', 'Security', 'Compliance'], importantOpen: 0, importantResolved: 0, nits: 1, nitOverflowSummarized: false, verdict: 'CLEAN', issues: [] })
  })

  test('lint: missing passes, missing verdict, mismatches and the nit cap', () => {
    const partial = parseReview('### Pass 1 — Logic & Regressions [Bugs]\n- [ ] **Important** [Bugs] a:1 — x\n### Review Verdict: CLEAN\n', cfg)
    expect(partial.passes).toEqual(['Bugs'])
    expect(partial.issues.map((i) => i.code)).toEqual(['missing-pass', 'missing-pass', 'verdict-mismatch'])
    const none = parseReview('hello', cfg)
    expect(none.verdict).toBeNull()
    expect(none.issues.map((i) => i.code)).toEqual(['no-passes', 'no-verdict'])
    expect(none.issues[0]?.severity).toBe('error')
    const blocked = parseReview(`### Pass 1 — Logic & Regressions [Bugs]\n### Pass 2 — Security & Privacy [Security]\n### Pass 3 — x [Compliance]\n### Review Verdict: BLOCKED\n`, cfg)
    expect(blocked.issues.map((i) => i.code)).toEqual(['verdict-mismatch'])
    const nits = Array.from({ length: 6 }, (_, i) => `- **Nit** [Bugs] a:${i} — n`).join('\n')
    const loud = parseReview(`### Pass 1 — Logic & Regressions [Bugs]\n${nits}\n### Pass 2 — Security & Privacy [Security]\n### Pass 3 — x [Compliance]\n### Review Verdict: CLEAN\n`, cfg)
    expect(loud.nits).toBe(6)
    expect(loud.issues.map((i) => i.code)).toEqual(['nit-cap'])
  })

  test('is tolerant: titles without [Tag], other bullet styles, CRLF, custom pass tags', () => {
    const r = parseReview('### Pass 1: Logic & Regressions\n* **Important** a:1 — no checkbox counts as open\n1. [X] **Important:** b:2 — done\n### Pass 2 — Security & Privacy\r\n- **Nit** n\r\n### Review Verdict: **CLEAN**\n', cfg)
    expect(r.passes).toEqual(['Bugs', 'Security'])
    expect(r.importantOpen).toBe(1)
    expect(r.importantResolved).toBe(1)
    expect(r.nits).toBe(1)
    expect(r.verdict).toBe('CLEAN')
    const perf = parseReview('### Pass 1 — Performance [Perf]\n### Review Verdict: CLEAN\n', { review: { ...cfg.review, passes: [{ tag: 'Perf', title: 'Performance' }] } })
    expect(perf.passes).toEqual(['Perf'])
    expect(perf.issues).toEqual([])
    expect(parseReview('### Pass 1 — Mystery\n', cfg).issues.some((i) => i.code === 'pass-no-tag')).toBe(true)
  })

  test('a review with unfilled verdict placeholder has no verdict', () => {
    expect(parseReview('### Review Verdict: [CLEAN | BLOCKED]\n', cfg).verdict).toBeNull()
  })
})

describe('appendTwiceRule', () => {
  test('adds a dated bullet at the end of the section', () => {
    const out = appendTwiceRule(tpl('claude-context'), 'Never call raw fetch; use the api client', '2026-10-06')
    const lines = out.split('\n')
    const at = lines.indexOf('- Never call raw fetch; use the api client (added 2026-10-06)')
    expect(at).toBeGreaterThan(0)
    expect(lines[at - 1]).toContain('Always use the centralized logger')
    expect(lines[at + 1]).toBe('')
    expect(lines[at + 2]).toBe('## Verifying Your Work')
    expect(out.replace(`${lines[at]}\n`, '')).toBe(tpl('claude-context'))
  })

  test('creates the section when missing, at the end, with a trailing newline', () => {
    expect(appendTwiceRule('# Repo\n\n## Commands\n- make test', 'Do not edit generated files', '2026-10-06')).toBe(
      '# Repo\n\n## Commands\n- make test\n\n## Things Claude Gets Wrong (The "Twice Rule")\n- Do not edit generated files (added 2026-10-06)\n',
    )
    expect(appendTwiceRule('', 'x', '')).toBe('## Things Claude Gets Wrong (The "Twice Rule")\n- x\n')
  })

  test('works when the section is last, with or without a trailing newline', () => {
    const base = '# R\n\n## Things Claude Gets Wrong\n- a\n'
    expect(appendTwiceRule(base, 'b', '2026-10-06')).toBe('# R\n\n## Things Claude Gets Wrong\n- a\n- b (added 2026-10-06)\n')
    expect(appendTwiceRule(base.trimEnd(), 'b', '')).toBe('# R\n\n## Things Claude Gets Wrong\n- a\n- b\n')
  })

  test('does not repeat a lesson, and normalizes whitespace and bullets', () => {
    const once = appendTwiceRule('# R\n', 'Use the logger', '2026-10-06')
    expect(appendTwiceRule(once, '- Use  the\nlogger', '2026-10-07')).toBe(once)
    expect(appendTwiceRule(once, '   ', '2026-10-07')).toBe(once)
    expect(appendTwiceRule('# R\n', '- Use\n  the logger', '')).toContain('\n- Use the logger\n')
  })

  test('keeps CRLF files CRLF', () => {
    const out = appendTwiceRule('# R\r\n\r\n## Things Claude Gets Wrong\r\n- a\r\n', 'b', '2026-10-06')
    expect(out).toBe('# R\r\n\r\n## Things Claude Gets Wrong\r\n- a\r\n- b (added 2026-10-06)\r\n')
  })
})

describe('renderArtifact', () => {
  const args = {
    title: 'Self-service refunds',
    author: 'Maria Silva (Claims Product)',
    date: '2026-10-06',
    slug: 'self-service-refunds',
    intentPath: 'intent/self-service-refunds.md',
    specPath: 'specs/self-service-refunds.spec.md',
  }

  test('intent: header filled, Status draft, body slots left for the author', () => {
    const out = renderArtifact({ ...args, kind: 'intent', template: tpl('intent'), source: 'JIRA-4521' })
    expect(out.split('\n').slice(0, 7)).toEqual([
      '# Intent: Self-service refunds',
      '',
      '**Author:** Maria Silva (Claims Product)  ',
      '**Status:** draft  ',
      '**Date:** 2026-10-06  ',
      '**Source Ticket / Anomaly Ref:** JIRA-4521  ',
      '',
    ])
    expect(out).toContain('## Problem\n[Describe in plain language')
    const doc = parseArtifact('intent', 'x', out, 0, cfg)
    expect(doc.title).toBe('Self-service refunds')
    expect(doc.status).toBe('draft')
    expect(doc.missingSections).toEqual([])
    expect(codes(doc)).toEqual(['placeholder'])
    expect(doc.issues[0]?.message).not.toContain('Short Descriptive')
  })

  test('intent from a human has no ticket: the ref reads n/a; an anomaly keeps its ref', () => {
    expect(renderArtifact({ ...args, kind: 'intent', template: tpl('intent') })).toContain('**Source Ticket / Anomaly Ref:** n/a  ')
    expect(renderArtifact({ ...args, kind: 'intent', template: tpl('intent'), source: 'human' })).toContain('Ref:** n/a  ')
    expect(renderArtifact({ ...args, kind: 'intent', template: tpl('intent'), source: 'ANOMALY-5xx-2026-10-06' })).toContain('Ref:** ANOMALY-5xx-2026-10-06  ')
  })

  test('spec: intent reference, author, Status draft, version untouched', () => {
    const out = renderArtifact({ ...args, kind: 'spec', template: tpl('spec') })
    expect(out.split('\n').slice(0, 6)).toEqual([
      '# Specification: Self-service refunds',
      '',
      '**Intent Reference:** intent/self-service-refunds.md  ',
      '**Lead Architect / PO:** Maria Silva (Claims Product)  ',
      '**Status:** draft  ',
      '**Version:** 1.0.0  ',
    ])
    expect(parseArtifact('spec', 'x', out, 0, cfg).missingSections).toEqual([])
  })

  test('plan: title with its source ref, branch, author, date', () => {
    const out = renderArtifact({ ...args, kind: 'plan', template: tpl('plan'), branch: 'feature/refunds' })
    expect(out.split('\n').slice(0, 6)).toEqual([
      '# Plan: Self-service refunds (from specs/self-service-refunds.spec.md)',
      '',
      '**Author / Engineer:** Maria Silva (Claims Product)  ',
      '**Branch:** `feature/refunds`  ',
      '**Status:** draft  ',
      '**Date:** 2026-10-06  ',
    ])
    expect(renderArtifact({ ...args, kind: 'plan', template: tpl('plan') })).toContain('**Branch:** `feature/self-service-refunds`')
    const fromIntent = renderArtifact({ ...args, kind: 'plan', template: tpl('plan'), specPath: undefined })
    expect(fromIntent.split('\n')[0]).toBe('# Plan: Self-service refunds (from intent/self-service-refunds.md)')
    const bare = renderArtifact({ kind: 'plan', template: tpl('plan'), title: 'T', author: 'A', date: 'D', slug: 's' })
    expect(bare.split('\n')[0]).toBe('# Plan: T')
  })

  test('the Status becomes draft even when a status was set; wiki front-matter is stripped; text ends with a newline', () => {
    const wiki = `---\nid: okf-template-plan\ntype: template\n---\n\n${tpl('plan')}`
    const out = renderArtifact({ ...args, kind: 'plan', template: wiki })
    expect(out.startsWith('# Plan: ')).toBe(true)
    expect(out.endsWith('\n')).toBe(true)
    const custom = renderArtifact({ ...args, kind: 'plan', template: tpl('plan').replace('[draft | accepted | in-progress | complete]', 'accepted') })
    expect(readStatus(custom)).toBe('draft')
  })

  test('a template without the standard header still gets a Status line; special characters are literal', () => {
    const out = renderArtifact({ ...args, kind: 'intent', template: '# Intent: [Short Descriptive Title]\n\n## Problem\nx\n', title: 'Pay $& more $1', author: 'A' })
    expect(out).toBe('# Intent: Pay $& more $1\n\n**Status:** draft\n\n## Problem\nx\n')
  })

  test('collapses a multi-line title', () => {
    expect(renderArtifact({ ...args, kind: 'intent', template: tpl('intent'), title: 'A\n  title ' }).split('\n')[0]).toBe('# Intent: A title')
  })
})

describe('renderScaffold', () => {
  const vars = { project: 'acme-api', date: '2026-10-06', paths: DEFAULT_CONFIG.paths }

  test('every template renders to non-empty text ending in a newline', () => {
    for (const name of TEMPLATE_NAMES) {
      const out = renderScaffold(name, templates[name] ?? '', vars)
      expect(out.length).toBeGreaterThan(100)
      expect(out.endsWith('\n')).toBe(true)
      expect(out).not.toContain('okf-template-')
    }
  })

  test('CLAUDE.md gets the project name and keeps the Twice Rule section', () => {
    const out = renderScaffold('claude-context', tpl('claude-context'), vars)
    expect(out.startsWith('# acme-api\n')).toBe(true)
    expect(out).toContain('## Things Claude Gets Wrong (The "Twice Rule")')
    expect(out).not.toContain('[Repository / Microservice Name]')
    expect(renderScaffold('claude-context', tpl('claude-context'), { ...vars, project: '  A\nB ' }).startsWith('# A B\n')).toBe(true)
  })

  test('REVIEW.md keeps the three passes and the nit cap wording', () => {
    const out = renderScaffold('review-policy', templates['review-policy'] ?? '', vars)
    expect(out.startsWith('# Pull Request Review Policy')).toBe(true)
    expect(out).toContain('(Tag: `[Bugs]`)')
    expect(out).toContain('Report at most 5 nits per review.')
  })

  test('the verifier agent keeps its own front-matter', () => {
    const out = renderScaffold('verifier-agent', templates['verifier-agent'] ?? '', vars)
    expect(out.startsWith('---\nname: verifier\ndescription:')).toBe(true)
    expect(out).toContain('### Verification Verdict: [PASS | FAIL]')
  })

  test('bands.yaml: front-matter gone, destination follows the incident path', () => {
    const out = renderScaffold('bands', tpl('bands'), vars)
    expect(out.startsWith('# Statistical Control Bands Specification: acme-api\n')).toBe(true)
    expect(out).toContain('metric: ci_test_failure_rate')
    expect(out).toContain('destination: "intent/incident-${DATE}.md"')
    const custom = renderScaffold('bands', tpl('bands'), { ...vars, paths: { ...vars.paths, incident: 'ops/{date}/incident.md' } })
    expect(custom).toContain('destination: "ops/${DATE}/incident.md"')
  })

  test('the CI workflow follows the configured eval directory and CLAUDE.md path, and says what it expects', () => {
    const out = renderScaffold('ci-evals-workflow', tpl('ci-evals-workflow'), vars)
    expect(out.split('\n')[0]).toBe('# Scaffolded by okf-loop on 2026-10-06 from openknowledge/templates/ci-evals-workflow.template.yml.')
    expect(out.split('\n')[1]).toContain('./evals/check.sh')
    expect(out).toContain('name: Agent Continuous Evals')
    expect(out).toContain("- 'evals/**'")
    const moved = renderScaffold('ci-evals-workflow', tpl('ci-evals-workflow'), {
      ...vars,
      paths: { ...vars.paths, eval: 'qa/evals/{slug}.json', claudeMd: 'docs/CLAUDE.md' },
    })
    expect(moved).toContain("- 'qa/evals/**'")
    expect(moved).toContain('for eval_file in qa/evals/*.json')
    expect(moved).toContain("- 'docs/CLAUDE.md'")
    expect(moved).not.toContain("'evals/**'")
  })

  test('managed settings stay valid JSON; the production gate stays an executable script', () => {
    const settings = renderScaffold('managed-settings', templates['managed-settings'] ?? '', vars)
    expect(JSON.parse(settings).sandbox.enabled).toBe(true)
    const gate = renderScaffold('production-gate', templates['production-gate'] ?? '', vars)
    expect(gate.startsWith('#!/bin/bash\n')).toBe(true)
    expect(gate).toContain('exit 2')
    expect(gate).toContain('RELEASE_APPROVAL')
  })

  test('the artifact templates are only stripped of wiki front-matter', () => {
    const wiki = `---\nid: okf-template-spec\ntype: template\n---\n\n# Specification: [Feature Name]\n`
    expect(renderScaffold('spec', wiki, vars)).toBe('# Specification: [Feature Name]\n')
    expect(renderScaffold('intent', tpl('intent'), vars)).toBe(tpl('intent'))
  })
})
