// Shared pieces of the stage prompts: the context type and the blocks every prompt repeats.
// Source of truth is the knowledge base (SKILL.md phases, plays 01-03, 05, 08, 10, 11, 13, 14),
// so the wording stays close to it. Pure: text in, text out. Required section names match
// artifacts.ts REQUIRED_SECTIONS verbatim because the harness parses them.

import type { PromptKey, StageId } from '../../types'
import { STAGE_META } from './constants'

export type PromptContext = {
  slug: string
  title: string
  date: string
  stage: StageId
  paths: {
    intent: string
    spec: string
    plan: string
    proof: string
    review: string
    claudeMd: string
    reviewPolicy: string
    incident: string
    lesson: string
    eval: string
  }
  policySkills: string[]
  knowledgeRoot: string
  verifyCommands: string[]
  nitCap: number
  planFiles?: string[]
  notes?: string
  blockedBy?: string[]
  /** What the human wrote when sending a gate back. */
  gateFeedback?: string
  /** Review passes from config (defaults to the three of review-policy.template.md). */
  reviewPasses?: { tag: string; title: string }[]
}

/** The stage each prompt belongs to: the prompt defines the work, not the run's current stage. */
export const PROMPT_STAGE: Record<PromptKey, StageId> = {
  interview: 'plan',
  'draft-spec': 'design',
  'draft-plan': 'build',
  implement: 'build',
  verify: 'test',
  review: 'deploy',
  release: 'deploy',
  fix: 'test',
  incident: 'maintain',
  lesson: 'maintain',
}

/** The plugin's subagents: file name, spawn type and the tool list their front-matter must carry. */
export const AGENT_DEFS = {
  verifier: { name: 'verifier', type: 'okf-loop:verifier', tools: ['Bash', 'Read'] },
  reviewer: { name: 'reviewer', type: 'okf-loop:reviewer', tools: ['Read', 'Grep', 'Glob', 'Bash'] },
  diagnoser: { name: 'diagnoser', type: 'okf-loop:diagnoser', tools: ['Read', 'Grep', 'Bash'] },
} as const

export const DEFAULT_REVIEW_PASSES: { tag: string; title: string }[] = [
  { tag: 'Bugs', title: 'Logic & Regressions' },
  { tag: 'Security', title: 'Security & Privacy' },
  { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
]

const PLAYBOOK: Record<PromptKey, string[]> = {
  interview: ['plays/play-01-capture-intent.md', 'stages/01-plan.md'],
  'draft-spec': ['plays/play-02-requirements-and-design.md', 'stages/02-design.md'],
  'draft-plan': ['plays/play-03-plan-mode.md', 'stages/03-build.md'],
  implement: ['plays/play-03-plan-mode.md', 'plays/play-04-auto-mode-and-worktrees.md', 'plays/play-05-agent-context-claude-md.md'],
  verify: ['plays/play-08-verification-feedback-loop.md', 'stages/04-test.md'],
  review: ['plays/play-10-ai-pr-review-loop.md', 'stages/05-deploy.md'],
  release: ['plays/play-11-hooks-as-approval-gates.md', 'governance/enterprise-security-and-sandboxing.md'],
  fix: ['plays/play-08-verification-feedback-loop.md'],
  incident: ['plays/play-13-closing-the-loop-control-bands.md', 'stages/06-maintain.md'],
  lesson: ['plays/play-14-on-call-first-responder.md', 'plays/play-09-continuous-evals-ci.md'],
}

// -- small text helpers ------------------------------------------------------------------------

export const code = (s: string): string => '`' + s + '`'
export const list = (items: string[]): string => items.map(i => '- ' + i).join('\n')
export const lines = (...parts: (string | false | null | undefined)[]): string =>
  parts.filter((p): p is string => typeof p === 'string').join('\n')
/** Sections are separated by one blank line; empty ones vanish. */
export const doc = (...sections: (string | false | null | undefined)[]): string =>
  sections.filter((s): s is string => typeof s === 'string' && s.length > 0).join('\n\n')

export const NEVER_APPROVE =
  'Never set a Status to `approved` or `accepted`. Only a human moves a gate; the gate-integrity guard refuses the write and the attempt lands in the audit ledger.'

export const GUARD_RULE = lines(
  '## If a guard blocks you',
  'okf-loop guards are deterministic hooks, not suggestions. When a tool call is refused:',
  '1. Read the whole message. It names the guard, explains why, and ends with a "Do instead:" path.',
  '2. Take the "Do instead" path. Do not retry the same call, reword it, split it across several commands, or reach the same effect through another tool.',
  '3. If no compliant path exists, stop and tell the human what was blocked and which decision you need from them.',
)

export function header(key: PromptKey, ctx: PromptContext, goal: string): string {
  const stage = STAGE_META[PROMPT_STAGE[key]]
  return lines(
    `# okf-loop · Stage ${stage.number} ${stage.name} · ${key}`,
    `Run ${code(ctx.slug)} · "${ctx.title}" · ${ctx.date}`,
    '',
    goal,
  )
}

/** Human feedback, harness findings and free notes: the run-specific facts every prompt may carry. */
export function situation(ctx: PromptContext, notesLabel = 'Notes'): string {
  const parts: string[] = []
  if (ctx.gateFeedback && ctx.gateFeedback.trim() !== '') {
    parts.push(lines('## Human feedback to address first', 'The human sent this stage back with:', ctx.gateFeedback.trim()))
  }
  if (ctx.blockedBy && ctx.blockedBy.length > 0) {
    parts.push(lines('## What the harness found unmet', list(ctx.blockedBy)))
  }
  if (ctx.notes && ctx.notes.trim() !== '') parts.push(lines(`## ${notesLabel}`, ctx.notes.trim()))
  return parts.join('\n\n')
}

export function playbook(key: PromptKey, ctx: PromptContext): string {
  const paths = PLAYBOOK[key].map(p => code(`${ctx.knowledgeRoot}/${p}`)).join(', ')
  return `Playbook, if it exists in this repository: ${paths}. Everything you need is above.`
}

export function stopAtGate(a: { gate: string; file: string; look: string }): string {
  return lines(
    '## Stop at the gate',
    'When the completion criteria hold, stop. Do not start the next stage. Your final message tells the human:',
    list([
      `which file to review: ${code(a.file)}`,
      `what to read first: ${a.look}`,
      `how to pass the gate: ${code('/sdlc approve ' + a.gate)} (or the Approve button in the /sdlc pane); to send it back: ${code('/sdlc reject ' + a.gate + ' <reason>')}`,
    ]),
  )
}

export function verifyBlock(ctx: PromptContext): string {
  const cmds = ctx.verifyCommands
  return cmds.length > 0
    ? lines(
        `The harness recognises these as proof commands: ${cmds.map(code).join(', ')}.`,
        `Run the ones this repository actually uses (see "Verifying Your Work" in ${code(ctx.paths.claudeMd)}) and every command the plan names under Proof of Correctness.`,
      )
    : `No proof commands are configured. Use the commands in ${code(ctx.paths.claudeMd)} ("Verifying Your Work") and the plan's Proof of Correctness.`
}

// -- artifact skeletons (the section names are the contract with artifacts.ts) ----------------

export function intentSkeleton(ctx: PromptContext): string {
  return lines(
    '```markdown',
    '# Intent: <short descriptive title>',
    '',
    '**Author:** <full name> (<department / role>)',
    '**Status:** draft',
    `**Date:** ${ctx.date}`,
    '**Source Ticket / Anomaly Ref:** <ticket id, or none>',
    '',
    '---',
    '',
    '## Problem',
    '## Proposed Outcome',
    '## Affected Users and Systems',
    '- **User Personas:** ...',
    '- **Target Systems / Repositories:** ...',
    '- **External Dependencies:** ...',
    '## Constraints',
    '- **Security & Auth:** ...',
    '- **Data Privacy & Classification:** ...',
    '- **Performance / SLAs:** ...',
    '- **Out of Scope:** ...',
    '## Open Questions',
    '- [ ] ...',
    '```',
  )
}
