// Stage prompts for Plan and Design and the planning half of Build: interview, draft-spec, draft-plan.

import type { PromptContext } from './prompts-kit'
import { GUARD_RULE, NEVER_APPROVE, code, doc, header, intentSkeleton, lines, list, playbook, situation, stopAtGate, verifyBlock } from './prompts-kit'
import { TEMPLATE_FILES } from './constants'

// -- 1. interview ------------------------------------------------------------------------------

export function interview(ctx: PromptContext): string {
  const out = ctx.paths.intent
  return doc(
    header(
      'interview',
      ctx,
      'Interview the originator, then record the result as a committed intent file. Intent is a proto-spec in the originator’s own words: what is wrong today, what better looks like, who and what is touched. You are a senior business analyst here, not a designer: no software solutions in it.',
    ),
    situation(ctx),
    lines(
      '## Inputs',
      list([
        `The originator’s idea: "${ctx.title}".`,
        `${code(out)}: if it already exists, read it and continue from it instead of starting over.`,
        `${code(ctx.paths.claudeMd)}, only to name real systems correctly. Do not explore the code for solutions.`,
        `Template, if present: ${code(ctx.knowledgeRoot + '/' + TEMPLATE_FILES.intent)}. The structure you need is below.`,
      ]),
    ),
    lines(
      '## The interview',
      'Socratic elicitation, one question at a time. Use the AskUserQuestion tool when a short list of options fits (personas, systems, yes/no constraints); ask in plain chat when you need the originator’s own words. Wait for each answer. Never batch questions, never answer for the originator. Cover, in this order:',
      '1. Problem: what can users or operators not do today? Press for numbers: how many, how often, how long, what it costs.',
      '2. Ideal outcome: what does success look like from the user’s side, and which metric moves?',
      '3. Affected users and systems: which personas, which systems and repositories, which external dependencies?',
      '4. Constraints: security and auth, privacy and PII, performance and SLAs, regulation.',
      '5. Out of scope: what must NOT be done in this iteration?',
      'Follow vague answers up ("faster": by how much, measured how?). Skip what the idea or notes already answered. Stop when each of the five areas has a concrete answer or is recorded as an open question; four to eight questions is typical.',
    ),
    lines(
      `## Output: ${code(out)}`,
      'Write the file in the standard template, with exactly these `##` sections (the harness checks for them): Problem, Proposed Outcome, Affected Users and Systems, Constraints, Open Questions.',
      intentSkeleton(ctx),
      list([
        'Author is the originator’s name and role as they gave it (ask once if unknown; fall back to `git config user.name`).',
        'Problem is quantified where the originator quantified it and says nothing about solutions.',
        'Constraints always includes an "Out of Scope" line. Open Questions are unresolved items only, as `- [ ]` checkboxes.',
        'Unknown facts go into Open Questions. Never invent numbers, personas or systems.',
        'No template text may remain: every `[bracketed placeholder]` and `...` is replaced with real content.',
      ]),
    ),
    lines(
      '## Status vocabulary',
      'draft | under-review | approved | rejected',
      list([
        'Write `**Status:** draft` while you interview and draft.',
        'Change it to `**Status:** under-review` only when all five sections hold real content and the originator has confirmed the draft.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Do not',
      list([
        `Edit any file other than ${code(out)}. No code, no spec, no plan.`,
        'Propose designs, stacks or solutions inside the intent.',
        'Skip the interview because the idea sounds clear.',
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        `${code(out)} exists with the five sections, real content, no placeholders, Status \`under-review\`.`,
        'The originator has read it back and confirmed or corrected it.',
      ]),
    ),
    stopAtGate({ gate: 'intent.approve', file: out, look: 'Problem and Open Questions, to confirm it says what the originator meant' }),
    GUARD_RULE,
    playbook('interview', ctx),
  )
}

// -- 2. draft-spec -----------------------------------------------------------------------------

function specSkeleton(ctx: PromptContext): string {
  return lines(
    '```markdown',
    '# Specification: <feature name>',
    '',
    `**Intent Reference:** ${ctx.paths.intent}`,
    '**Lead Architect / PO:** <name>',
    '**Status:** draft',
    '**Version:** 1.0.0',
    '',
    '---',
    '',
    '## 1. Executive Summary & Scope',
    '## 2. Requirements & Functional Contracts',
    '- **REQ-01:** ...',
    '## 3. Technical Architecture & Interfaces',
    '### 3.1 API Endpoints / Schemas',
    '### 3.2 Data Models & State Transitions',
    '### 3.3 UI / UX Specifications (if applicable)',
    '## 4. Policy Compliance Matrix',
    '| Policy Domain | Applied Skill Version | Compliance Strategy | Status |',
    '| :--- | :--- | :--- | :--- |',
    '## 5. Flagged Areas of Concern',
    '> [!WARNING]',
    '> 1. **<concern>:** what conflicts or is risky, and who must decide (named policy owner).',
    '## 6. Sign-off & Progression',
    '- [ ] Product Owner Approval: pending',
    '- [ ] Security / Architecture Reviewer: pending',
    '```',
  )
}

export function draftSpec(ctx: PromptContext): string {
  const out = ctx.paths.spec
  const skills =
    ctx.policySkills.length > 0
      ? `Policy skills configured for this project (globs): ${ctx.policySkills.map(code).join(', ')}.`
      : 'No policy skill globs are configured.'
  return doc(
    header(
      'draft-spec',
      ctx,
      'Translate the approved intent into one requirements-and-design spec, applying the organisation’s policy skills while you write it, and surface every place where policies or requirements cannot all be satisfied. Requirements and design happen in this single session.',
    ),
    situation(ctx),
    lines(
      '## Inputs',
      list([
        `${code(ctx.paths.intent)}: the approved intent. Read it fully. It is the originator’s words; do not edit it.`,
        `${code(ctx.paths.claudeMd)} and the repository itself (read-only): real interfaces, conventions, existing endpoints.`,
        skills,
        `Template, if present: ${code(ctx.knowledgeRoot + '/' + TEMPLATE_FILES.spec)}.`,
      ]),
    ),
    lines(
      '## Load the policy skills first',
      'Glob for the files those patterns match, read each one, and invoke any skill whose description fits (security, API standards, data protection, brand, UX, accessibility, regulatory). Apply them while drafting, not afterwards. Record every policy you applied in the Policy Compliance Matrix with its skill name or file path (and version, if the skill states one). Never claim a policy you did not read. If no policy skill exists, say so in the matrix and in Flagged Areas of Concern.',
    ),
    lines(
      `## Output: ${code(out)}`,
      'Exactly these `##` sections (the harness checks for them; numbering is free):',
      list([
        'Executive Summary & Scope',
        'Requirements & Functional Contracts',
        'Technical Architecture & Interfaces',
        'Policy Compliance Matrix',
        'Flagged Areas of Concern',
        'Sign-off & Progression',
      ]),
      specSkeleton(ctx),
      list([
        'Executive Summary: two or three paragraphs turning the intent into concrete deliverables and system impact.',
        'Requirements: one testable sentence per REQ-nn, each traceable to something in the intent; cover edge cases, failure modes, permissions, concurrency and rate limits.',
        'Technical Architecture: grounded in files, interfaces and conventions you actually read (cite paths). A subsection that does not apply says "Not applicable" and why.',
        'Every Open Question of the intent is resolved here (when the repository or a policy answers it) or carried into Flagged Areas of Concern with its decision owner. Never drop one silently.',
        'Flagged Areas of Concern is the most important section: each dilemma where requirements tension against a policy, or the design carries a risk (for example an upstream rate limit versus caching), as a numbered entry that names who decides. If there truly are none, write one plain sentence saying so and why; do not invent entries.',
        'Sign-off lines stay unchecked and say `pending`. No `[Name]` or `[Date]` brackets, no template text of any kind.',
      ]),
    ),
    lines(
      '## Status vocabulary',
      'draft | under-review | approved',
      list([
        'Write `**Status:** draft` while drafting.',
        'Change it to `**Status:** under-review` once all six sections are complete, the matrix and flagged concerns are filled in, and no template text remains.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Do not',
      list([
        `Edit any file other than ${code(out)}. No code, no plan, no changes to the intent.`,
        'Decide a policy conflict yourself. Flag it and let its owner decide.',
        'Pause to ask the human for decisions you can record as flagged concerns; you may be running unattended.',
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        `${code(out)} exists with the six sections, REQ contracts, a compliance matrix, flagged concerns and sign-off lines.`,
        'No placeholders; Status `under-review`.',
      ]),
    ),
    stopAtGate({
      gate: 'spec.approve',
      file: out,
      look: 'the Flagged Areas of Concern first (these are what an analyst would take to a change board); resolve each with its named owner, then check the sign-off lines',
    }),
    GUARD_RULE,
    playbook('draft-spec', ctx),
  )
}

// -- 3. draft-plan -----------------------------------------------------------------------------

function planSkeleton(ctx: PromptContext): string {
  return lines(
    '```markdown',
    `# Plan: <task title> (from ${ctx.paths.intent} / ${ctx.paths.spec})`,
    '',
    '**Author / Engineer:** <name>',
    '**Branch:** `<feature branch>`',
    '**Status:** draft',
    `**Date:** ${ctx.date}`,
    '',
    '---',
    '',
    '## Files That Change',
    '- `path/to/NewComponent.tsx` (new)',
    '- `path/to/existing_service.py` (modify: what and why)',
    '- `path/to/tests/test_service.py` (modify: add assertions)',
    '## Order of Work',
    '1. **<step>:** what is done, small enough to verify on its own.',
    '## Risks & Mitigations',
    '- **Risk:** ...',
    '  *Mitigation:* ...',
    '### Interrogation',
    '## Proof of Correctness',
    '- `<command>`: <quantified expected result>',
    '```',
  )
}

export function draftPlan(ctx: PromptContext): string {
  const out = ctx.paths.plan
  return doc(
    header(
      'draft-plan',
      ctx,
      'Work in plan mode: explore the codebase read-only, then write the implementation plan that a human will accept before any code is touched. Nothing is implemented without an accepted plan.',
    ),
    situation(ctx),
    lines(
      '## Inputs',
      list([
        `${code(ctx.paths.intent)} and ${code(ctx.paths.spec)}: both approved. Every REQ of the spec must be covered by the plan.`,
        `${code(ctx.paths.claudeMd)}: commands, conventions, architecture, things Claude gets wrong.`,
        'The codebase, read-only: trace call stacks, find the existing patterns to reuse, find the tests that already cover the area.',
        `Template, if present: ${code(ctx.knowledgeRoot + '/' + TEMPLATE_FILES.plan)}.`,
      ]),
    ),
    lines(
      '## Plan mode',
      `This stage is read-only exploration. You may Read, Grep, Glob and run non-mutating shell commands (ls, git log, git grep). The only file you may write is ${code(out)}. Source edits are refused by the plan-first guard until a human accepts the plan.`,
    ),
    lines(
      `## Output: ${code(out)}`,
      'Exactly four mandatory `##` sections (the harness checks for them):',
      list([
        'Files That Change: the exhaustive list, one repo-relative path per bullet in backticks, annotated (new) or (modify: why). Include tests. The harness parses this list; later edits outside it count as plan drift. Prefer exact files over directories.',
        'Order of Work: chronological numbered steps, each small enough to verify before the next begins.',
        'Risks & Mitigations: architectural bottlenecks, failure modes, caching and rate-limit needs, each with its mitigation.',
        `Proof of Correctness: the exact commands and quantified results that prove completion, for example "${code('<test command> <path>')} passes N scenarios", lint with zero warnings, screenshot targets. Choose commands that exist in this repository (check Makefile, package.json and CLAUDE.md).`,
      ]),
      verifyBlock(ctx),
      planSkeleton(ctx),
    ),
    lines(
      '## Interrogate the plan',
      'Before you finish, answer these inside the plan, under a `### Interrogation` heading in Risks & Mitigations:',
      list([
        'What could this change break in existing downstream modules?',
        'Which step carries the highest risk (latency, concurrency, data loss)?',
        'Which design alternatives did you evaluate and reject, and why?',
      ]),
      'Then refine until an engineer who was not part of this conversation could implement the change from the document alone.',
    ),
    lines(
      '## Status vocabulary',
      'draft | accepted | in-progress | complete',
      list([
        'Leave `**Status:** draft`. `in-progress` and `complete` belong to the implement stage.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Do not',
      list([
        `Edit any file other than ${code(out)}: no source, no tests, no spec, no intent.`,
        'Start implementing "just the easy part".',
        'Leave anything the spec requires out of the plan, or add work the spec does not ask for.',
        'Pause to ask the human for decisions you can record under Risks & Mitigations; you may be running unattended.',
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        `${code(out)} exists with the four sections, a non-empty parseable Files That Change list, no placeholders, Status \`draft\`.`,
        'Every REQ of the spec appears in Order of Work and in Proof of Correctness.',
        'The interrogation is answered in the plan.',
      ]),
    ),
    stopAtGate({
      gate: 'plan.accept',
      file: out,
      look: 'Files That Change (anything missing or unexpected?), Order of Work, and the riskiest step. In your final message answer "What could break? Which step is riskiest?" and ask "Should we proceed with this plan?"',
    }),
    GUARD_RULE,
    playbook('draft-plan', ctx),
  )
}
