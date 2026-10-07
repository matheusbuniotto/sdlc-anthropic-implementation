// Realistic sample data for the UI tests (and for the integration tests that
// mount the views): the 14 plays from the real knowledge front-matter, an
// active run mid-loop, guard stats, ledger rows, metrics, a band breach, plus a
// fake element table per surface and an actions object that records its calls.

import type { RenderElement } from 'claude-code'

import type {
  ArtifactDoc,
  ArtifactKind,
  ArtifactStatus,
  AutopilotView,
  BandView,
  GateId,
  GateReport,
  GuardId,
  GuardView,
  LedgerEntry,
  LoopConfig,
  MetricView,
  NextAction,
  PlayDef,
  PlayView,
  Requirement,
  RunRecord,
  RunSnapshot,
  RunSummary,
  SetupItem,
  StageId,
  StageSnapshot,
  StageState,
  UiActions,
  UiState,
  ViewModel,
} from '../types'
import { GATE_DEFS, GUARD_DEFS, GUARD_ORDER, PLAY_ENFORCEMENT, STAGE_META, STAGE_PLAYS } from '../hooks/core/constants'
import type { PaneElements, Surface } from '../hooks/ui/elements'

export const SURFACES: readonly Surface[] = ['terminal', 'desktop', 'vscode', 'mobile']

/** 2026-10-06 15:30 UTC: every relative time in the fixtures hangs off this. */
export const NOW = Date.UTC(2026, 9, 6, 15, 30, 0)
const MIN = 60_000
const HOUR = 60 * MIN

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function sampleConfig(overrides: Partial<LoopConfig> = {}): LoopConfig {
  return {
    version: 1,
    knowledge: { root: 'openknowledge' },
    autonomy: {
      mode: 'semi',
      maxAutoTurns: 12,
      haltOnBlocks: 3,
      haltOnVerifyFails: 3,
      humanGates: ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve'],
      autoKinds: ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'],
    },
    plays: { enabled: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11] },
    paths: {
      intent: 'intent/{slug}.md',
      spec: 'specs/{slug}.spec.md',
      plan: 'plans/{slug}.plan.md',
      proof: 'proofs/{slug}.proof.md',
      review: 'reviews/{slug}.review.md',
      incident: 'intent/incident-{date}.md',
      lesson: 'lessons/{date}-{slug}.md',
      eval: 'evals/{slug}.json',
      claudeMd: 'CLAUDE.md',
      reviewPolicy: 'REVIEW.md',
      bands: 'bands.yaml',
      ciWorkflow: '.github/workflows/agent-evals.yml',
      managedSettings: '.okf/enterprise-managed-settings.json',
      productionGate: '.claude/hooks/production-gate.sh',
    },
    guards: {
      disabled: [],
      protectedPaths: ['schemas/generated/**', 'api/v1/frozen/**', '.env', '.env.*', 'secrets/**'],
      testGlobs: ['tests/**', 'test/**', '**/*.test.*', '**/*.spec.*'],
      planFirstExempt: ['**/*.md', 'intent/**', 'specs/**', 'plans/**', '.okf/**'],
      secretPatterns: [{ name: 'AWS access key', pattern: 'AKIA[0-9A-Z]{16}' }],
      productionPatterns: ['kubectl\\s+apply', 'terraform\\s+apply', 'helm\\s+upgrade'],
      destructiveSql: true,
      protectedBranches: ['main', 'master'],
      credentialPaths: ['~/.ssh/**', '~/.aws/**', '**/.env'],
      blockNetwork: false,
      grantMinutes: 15,
    },
    verify: { commands: ['make test', 'npm test', 'bun test'] },
    review: {
      nitCap: 5,
      passes: [
        { tag: 'Bugs', title: 'Logic & Regressions' },
        { tag: 'Security', title: 'Security & Privacy' },
        { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
      ],
      ignorePaths: ['build/**', 'package-lock.json'],
    },
    bands: { enabled: true, sources: [], window: 30, tier3: 'propose', runbook: [] },
    ui: { openPaneOnStart: false, showBand: true },
    policySkills: ['.claude/skills/**/SKILL.md', 'CLAUDE.md'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Plays: titles, prerequisites, outputs and summaries as in openknowledge/plays/*.md
// ---------------------------------------------------------------------------

const play = (
  n: number,
  id: string,
  title: string,
  stage: StageId,
  entryPoint: boolean,
  prerequisites: number[],
  outputs: string[],
  summary: string,
  file: string,
  tags: string[],
): PlayDef => ({ n, id, title, stage, entryPoint, prerequisites, outputs, summary, path: `plays/${file}.md`, tags })

export const PLAYS: PlayDef[] = [
  play(1, 'okf-play-01-capture-intent', 'Play 01: Capture as intent.md', 'plan', true, [], ['intent/intent.md'], 'Guide for non-technical or product originators to brainstorm ideas with Claude and commit human-readable, machine-actionable intent.md artifacts.', 'play-01-capture-intent', ['plan', 'intent-md']),
  play(2, 'okf-play-02-requirements-and-design', 'Play 02: Requirements & Design Specification', 'design', false, [1], ['specs/spec.md'], 'How Product Owners prompt Claude with intent.md and organizational skills to produce an implementation-ready spec.md with flagged risk areas.', 'play-02-requirements-and-design', ['design', 'spec-md']),
  play(3, 'okf-play-03-plan-mode', 'Play 03: Plan Mode as the Default Starting Point', 'build', false, [2], ['plans/plan.md'], 'How engineers utilize Claude Code plan mode to interrogate the codebase, formulate a rigorous plan.md, and eliminate implementation rework.', 'play-03-plan-mode', ['build', 'plan-mode']),
  play(4, 'okf-play-04-auto-mode-worktrees', 'Play 04: Auto Mode, Parallel Sessions & Worktrees', 'build', false, [3, 8], ['git-worktrees', 'multi-session-branches'], 'How engineers run multiple autonomous agent sessions in parallel using Git worktrees, shifting their role from line-by-line typing to orchestration.', 'play-04-auto-mode-and-worktrees', ['build', 'auto-mode']),
  play(5, 'okf-play-05-claude-md', 'Play 05: CLAUDE.md as Repo Memory', 'build', true, [], ['CLAUDE.md'], 'How to author, curate, and maintain a concise CLAUDE.md file that gives AI agents essential new-joiner context at session startup.', 'play-05-agent-context-claude-md', ['build', 'claude-md']),
  play(6, 'okf-play-06-skills-policy', 'Play 06: Skills as Operational Institutional Knowledge', 'build', false, [5], ['.claude/skills/<name>/SKILL.md'], 'How to encode complex, cross-cutting enterprise policies (security standards, API guidelines, brand rules) into modular, reusable agent skills.', 'play-06-skills-as-institutional-knowledge', ['build', 'skills']),
  play(7, 'okf-play-07-guardrail-hooks', 'Play 07: Hooks as Build-Time Guardrails', 'build', true, [], ['.claude/settings.json', '.claude/hooks/*'], 'How to configure deterministic PreToolUse hooks that enforce hard technical boundaries during code construction without blocking flow.', 'play-07-build-guardrail-hooks', ['build', 'hooks']),
  play(8, 'okf-play-08-feedback-loop', 'Play 08: Deterministic Verification Feedback Loop', 'test', true, [], ['CLAUDE.md verification section', 'test-protection hooks'], 'How to equip agents with self-verifying build and test loops, the strict test-first bug fix protocol, and hook-level test file protections.', 'play-08-verification-feedback-loop', ['test', 'feedback-loop']),
  play(9, 'okf-play-09-evals-ci', 'Play 09: Continuous Evals in CI', 'test', false, [5, 8], ['.github/workflows/agent-evals.yml', 'evals/*.json'], 'How to construct a regression evaluation suite that tests agent prompts, skills, and configuration changes automatically in CI.', 'play-09-continuous-evals-ci', ['test', 'evals']),
  play(10, 'okf-play-10-ai-pr-review', 'Play 10: Dual-Direction AI in the PR Review Loop', 'deploy', false, [5, 6, 11], ['REVIEW.md', 'github-pr-comments'], 'How AI participates bidirectionally in pull requests by executing multi-pass reviews against REVIEW.md and autonomously remediating review comments.', 'play-10-ai-pr-review-loop', ['deploy', 'pr-review']),
  play(11, 'okf-play-11-approval-gate-hooks', 'Play 11: Hooks as Non-Negotiable Approval Gates', 'deploy', false, [7], ['.claude/hooks/production-gate.sh'], 'How to use PreToolUse hooks to establish cryptographically enforced approval gates preventing unauthorized production deployments.', 'play-11-hooks-as-approval-gates', ['deploy', 'approval-gates']),
  play(12, 'okf-play-12-cicd-sandboxing', 'Play 12: CI/CD Integration, Sandboxing & MCP Deployments', 'deploy', false, [10, 11], ['ci-cd-pipelines', 'mcp-deployment-tools'], 'How to run Claude non-interactively in CI pipelines, apply strict OS sandboxing, and expose deployments via scoped Model Context Protocol (MCP) tools.', 'play-12-cicd-pipeline-and-sandboxing', ['deploy', 'ci-cd']),
  play(13, 'okf-play-13-control-bands', 'Play 13: Closing the Loop with Statistical Control Bands', 'maintain', false, [1, 9, 10, 12], ['bands.yaml', 'intent/<incident-diagnosis>.md'], 'How to set up deterministic statistical control bands that invoke headless agents to diagnose production anomalies and synthesize intent.md to close the SDLC loop.', 'play-13-closing-the-loop-control-bands', ['maintain', 'control-bands']),
  play(14, 'okf-play-14-on-call-first-responder', 'Play 14: Claude on Call (Incident Triage & Memory)', 'maintain', false, [13], ['lessons/<date>-<title>.md', 'evals/<incident-id>.json'], 'How workplace bot integrations (Claude Tag) act as first responders in incident channels, correlating errors to diffs and recording organizational memory.', 'play-14-on-call-first-responder', ['maintain', 'claude-on-call']),
]

const EVIDENCE: Record<number, { label: string; ok: boolean }[]> = {
  1: [{ label: 'intent/ holds an intent file', ok: true }],
  3: [{ label: 'plans/ holds a plan file', ok: true }],
  5: [{ label: 'CLAUDE.md', ok: true }],
  7: [
    { label: '.claude/settings.json', ok: true },
    { label: '.claude/hooks/*', ok: false },
  ],
  10: [{ label: 'REVIEW.md', ok: false }],
  11: [{ label: '.claude/hooks/production-gate.sh', ok: true }],
  13: [{ label: 'bands.yaml', ok: false }],
}

export function playViews(enabled: number[]): PlayView[] {
  return PLAYS.map(p => ({
    ...p,
    enabled: enabled.includes(p.n),
    unmet: p.prerequisites.filter(q => !enabled.includes(q)),
    dependents: PLAYS.filter(d => d.prerequisites.includes(p.n) && enabled.includes(d.n)).map(d => d.n),
    enforcedBy: PLAY_ENFORCEMENT[p.n] ?? [],
    evidence: EVIDENCE[p.n] ?? [],
  }))
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const GUARD_STATS: Partial<Record<GuardId, { hits: number; ago: number; message: string }>> = {
  'protect-paths': { hits: 3, ago: 22 * MIN, message: 'okf-loop · Play 07 · Protect paths: .env is protected from agent edits.\nDo instead: ask the human to change it, or write .env.example.' },
  'secret-leak': { hits: 1, ago: 3 * HOUR, message: 'okf-loop · Play 07 · Block secret writes: the content matches AWS access key (AKIA…MPLE).\nDo instead: read the value from the environment.' },
  'plan-first': { hits: 5, ago: 9 * MIN, message: 'okf-loop · Play 03 · Plan before code: src/limits.ts cannot change before rate-limit-checkout.plan.md is accepted.\nDo instead: ask the human to /sdlc approve plan.accept.' },
  'production-gate': { hits: 2, ago: 26 * HOUR, message: 'okf-loop · Play 11 · Production gate: kubectl apply -f prod.yaml needs a release grant.\nDo instead: ask the release manager to /sdlc release grant.' },
  'separation-of-duties': { hits: 1, ago: 30 * HOUR, message: 'okf-loop · Play 10 · Separation of duties: git push origin main is a human act.\nDo instead: open a pull request.' },
  'gate-integrity': { hits: 1, ago: 5 * HOUR, message: 'okf-loop · Play 11 · Gate integrity: only a human moves Status to approved.\nDo instead: set under-review and ask for /sdlc approve spec.approve.' },
}

export function guardViews(enabledPlays: number[], disabled: GuardId[] = []): GuardView[] {
  return GUARD_ORDER.map(id => {
    const def = GUARD_DEFS[id]
    const s = GUARD_STATS[id]
    return {
      ...def,
      enabled: !disabled.includes(id),
      active: enabledPlays.includes(def.play),
      stat: s ? { hits: s.hits, lastAt: NOW - s.ago, lastMessage: s.message } : { hits: 0, lastAt: null, lastMessage: '' },
    }
  })
}

// ---------------------------------------------------------------------------
// Artifacts, gates, stages, runs
// ---------------------------------------------------------------------------

export const doc = (kind: ArtifactKind, path: string, status: ArtifactStatus, extra: Partial<ArtifactDoc> = {}): ArtifactDoc => ({
  kind,
  path,
  exists: status !== 'missing',
  status,
  title: path,
  mtimeMs: NOW - 2 * HOUR,
  sections: [],
  missingSections: [],
  checklist: { done: 0, total: 0 },
  flaggedConcerns: 0,
  planFiles: [],
  issues: [],
  ...extra,
})

const req = (id: string, label: string, ok: boolean, by: Requirement['by'], detail?: string): Requirement =>
  detail === undefined ? { id, label, ok, by } : { id, label, ok, by, detail }

function gate(id: GateId, requirements: Requirement[], o: { ready: boolean; approved: boolean; blockedBy?: string[] }): GateReport {
  const def = GATE_DEFS[id]
  return { id, stage: def.stage, label: def.label, kind: def.kind, requirements, ready: o.ready, approved: o.approved, blockedBy: o.blockedBy ?? [] }
}

function stage(id: StageId, state: StageState, summary: string, artifacts: ArtifactDoc[], gates: GateReport[]): StageSnapshot {
  const meta = STAGE_META[id]
  return { id, number: meta.number, name: meta.name, tagline: meta.tagline, state, artifacts, gates, summary, plays: STAGE_PLAYS[id] }
}

export function runRecord(slug: string, title: string, extra: Partial<RunRecord> = {}): RunRecord {
  return {
    slug,
    title,
    source: 'human',
    createdAt: NOW - 27 * HOUR,
    approvals: {},
    fix: { active: false, reproCommitted: false },
    proof: { lastEditAt: 0, lastRunAt: 0, lastRunPassed: null, lastCommand: '' },
    edits: [],
    autoTurns: 4,
    blockStreak: 0,
    verifyFailStreak: 0,
    paused: false,
    ...extra,
  }
}

export const SLUG = 'rate-limit-checkout'
export const TITLE = 'Add rate limiting to checkout'

const intentDoc = (status: ArtifactStatus): ArtifactDoc => doc('intent', `intent/${SLUG}.md`, status, { checklist: { done: 3, total: 3 } })
const specDoc = (status: ArtifactStatus, extra: Partial<ArtifactDoc> = {}): ArtifactDoc => doc('spec', `specs/${SLUG}.spec.md`, status, { checklist: { done: 0, total: 3 }, ...extra })
const planDoc = (status: ArtifactStatus): ArtifactDoc =>
  doc('plan', `plans/${SLUG}.plan.md`, status, { planFiles: ['src/checkout/limits.ts', 'src/checkout/middleware.ts', 'tests/limits.test.ts'] })

const intentGate = (approved: boolean): GateReport =>
  gate(
    'intent.approve',
    [
      req('intent.exists', 'intent.md exists', true, 'machine'),
      req('intent.sections', 'all 5 sections present', true, 'machine'),
      req('intent.clean', 'no template placeholders', true, 'machine'),
      req('intent.status', 'Status: approved', approved, 'human'),
    ],
    { ready: true, approved },
  )

const specGate = (approved: boolean): GateReport =>
  gate(
    'spec.approve',
    [
      req('spec.exists', 'spec.md exists', true, 'machine'),
      req('spec.sections', 'all 6 sections present', true, 'machine'),
      req('spec.clean', 'no template placeholders', true, 'machine'),
      req('spec.signoff', 'sign-off checklist', true, 'machine', '3 items'),
      req('spec.concerns', approved ? 'flagged concerns resolved' : '2 flagged concerns to resolve', approved, 'human'),
      req('spec.status', 'Status: approved', approved, 'human'),
    ],
    { ready: true, approved },
  )

const planGate = (approved: boolean): GateReport =>
  gate(
    'plan.accept',
    [
      req('plan.exists', 'plan.md exists', true, 'machine'),
      req('plan.sections', 'all 4 sections present', true, 'machine'),
      req('plan.files', 'files that change are listed', true, 'machine', '3 files'),
      req('plan.status', 'Status: accepted', approved, 'human'),
    ],
    { ready: true, approved },
  )

const verifyGate = (state: 'pending' | 'failed' | 'passed'): GateReport =>
  gate(
    'verify.pass',
    [
      req('proof.exists', 'proof exists', state !== 'pending', 'machine'),
      req('proof.verdict', 'verdict PASS', state === 'passed', 'machine', state === 'failed' ? 'verdict is FAIL' : undefined),
      req('proof.fresh', 'nothing edited after the proof', state === 'passed', 'machine'),
    ],
    { ready: state === 'passed', approved: state === 'passed', blockedBy: state === 'passed' ? [] : [state === 'failed' ? 'verification FAILED: 2 tests red' : 'no proof yet'] },
  )

const reviewGate = (passed: boolean): GateReport =>
  gate(
    'review.pass',
    [
      req('review.exists', 'review exists with all 3 passes', passed, 'machine'),
      req('review.important', 'no open Important findings', passed, 'machine'),
      req('review.nits', 'nits within the cap of 5', passed, 'machine'),
    ],
    { ready: passed, approved: passed, blockedBy: passed ? [] : ['no review yet'] },
  )

const releaseGate = (ready: boolean): GateReport =>
  gate(
    'release.approve',
    [req('release.review', 'review.pass', ready, 'machine'), req('release.human', 'a named human authorizes the release', false, 'human')],
    { ready, approved: false, blockedBy: ready ? [] : ['review.pass'] },
  )

function snapshot(
  stages: StageSnapshot[],
  current: StageId,
  next: NextAction,
  o: { health: RunSnapshot['health']; progress: number; record?: Partial<RunRecord> },
): RunSnapshot {
  return { record: runRecord(SLUG, TITLE, o.record), stages, current, next, health: o.health, progress: o.progress }
}

const pending = (id: StageId, summary: string, gates: GateReport[] = [], artifacts: ArtifactDoc[] = []): StageSnapshot => stage(id, 'pending', summary, artifacts, gates)

/** Plan and Design done, Build under way: the autopilot is implementing an accepted plan. */
export function midLoopRun(): RunSnapshot {
  return snapshot(
    [
      stage('plan', 'done', 'intent approved by matheus', [intentDoc('approved')], [intentGate(true)]),
      stage('design', 'done', 'spec approved by matheus', [specDoc('approved')], [specGate(true)]),
      stage('build', 'active', 'plan accepted · implementing 3 files', [planDoc('in-progress')], [planGate(true)]),
      pending('test', 'waits for the plan to complete', [verifyGate('pending')], [doc('proof', `proofs/${SLUG}.proof.md`, 'missing')]),
      pending('deploy', 'waits for verification', [reviewGate(false), releaseGate(false)], [doc('review', `reviews/${SLUG}.review.md`, 'missing')]),
      pending('maintain', 'monitoring starts after the release'),
    ],
    'build',
    { kind: 'implement', stage: 'build', label: 'Implement the plan', reason: 'plan.md is accepted, so the agent builds it step by step and proves each step before moving on.', byHuman: false, promptKey: 'implement', auto: true },
    {
      health: 'ok',
      progress: 3 / 6,
      record: {
        approvals: {
          'intent.approve': { by: 'matheus', at: NOW - 25 * HOUR },
          'spec.approve': { by: 'matheus', at: NOW - 3 * HOUR },
          'plan.accept': { by: 'matheus', at: NOW - 70 * MIN },
        },
      },
    },
  )
}

/** The agent drafted spec.md; two flagged concerns wait for a person. */
export function awaitingSpecRun(): RunSnapshot {
  return snapshot(
    [
      stage('plan', 'done', 'intent approved by matheus', [intentDoc('approved')], [intentGate(true)]),
      stage('design', 'awaiting-human', 'spec.md is ready for your sign-off', [specDoc('under-review', { flaggedConcerns: 2, sections: ['Executive Summary & Scope'] })], [specGate(false)]),
      pending('build', 'waits for the spec', [planGate(false)], [doc('plan', `plans/${SLUG}.plan.md`, 'missing')]),
      pending('test', 'waits for the plan'),
      pending('deploy', 'waits for verification'),
      pending('maintain', 'monitoring starts after the release'),
    ],
    'design',
    { kind: 'await-human', stage: 'design', label: 'Sign off the spec', reason: 'spec.md is complete and has 2 flagged concerns that only a person can resolve.', byHuman: true, gate: 'spec.approve', auto: false },
    { health: 'attention', progress: 1 / 6, record: { autoTurns: 2, approvals: { 'intent.approve': { by: 'matheus', at: NOW - 25 * HOUR } } } },
  )
}

/** The proof says FAIL: the test stage is blocked and the next step is to fix the code. */
export function blockedRun(): RunSnapshot {
  return snapshot(
    [
      stage('plan', 'done', 'intent approved by matheus', [intentDoc('approved')], [intentGate(true)]),
      stage('design', 'done', 'spec approved by matheus', [specDoc('approved')], [specGate(true)]),
      stage('build', 'done', 'plan complete', [planDoc('complete')], [planGate(true)]),
      stage('test', 'blocked', 'verification FAILED: 2 tests red', [doc('proof', `proofs/${SLUG}.proof.md`, 'draft')], [verifyGate('failed')]),
      pending('deploy', 'waits for verification', [reviewGate(false), releaseGate(false)], [doc('review', `reviews/${SLUG}.review.md`, 'missing')]),
      pending('maintain', 'monitoring starts after the release'),
    ],
    'test',
    { kind: 'implement', stage: 'test', label: 'Fix the failing verification', reason: 'The proof verdict is FAIL (2 tests red). The agent fixes the implementation, never the tests, then verifies again.', byHuman: false, promptKey: 'implement', auto: true },
    { health: 'blocked', progress: 3 / 6, record: { autoTurns: 9, verifyFailStreak: 3, proof: { lastEditAt: NOW - 20 * MIN, lastRunAt: NOW - 8 * MIN, lastRunPassed: false, lastCommand: 'make test' } } },
  )
}

/** Verification and review passed: the release gate waits for a person. */
export function releaseRun(): RunSnapshot {
  return snapshot(
    [
      stage('plan', 'done', 'intent approved by matheus', [intentDoc('approved')], [intentGate(true)]),
      stage('design', 'done', 'spec approved by matheus', [specDoc('approved')], [specGate(true)]),
      stage('build', 'done', 'plan complete', [planDoc('complete')], [planGate(true)]),
      stage('test', 'done', 'verification passed on the final diff', [doc('proof', `proofs/${SLUG}.proof.md`, 'complete')], [verifyGate('passed')]),
      stage('deploy', 'awaiting-human', 'review is clean; a named human authorizes the release', [doc('review', `reviews/${SLUG}.review.md`, 'complete')], [reviewGate(true), releaseGate(true)]),
      pending('maintain', 'monitoring starts after the release'),
    ],
    'deploy',
    { kind: 'release', stage: 'deploy', label: 'Authorize the release', reason: 'Verification passed and the three-pass review is clean. Only a named human can authorize production.', byHuman: true, gate: 'release.approve', auto: false },
    { health: 'attention', progress: 5 / 6, record: { autoTurns: 7 } },
  )
}

// ---------------------------------------------------------------------------
// Ledger, metrics, bands, setup
// ---------------------------------------------------------------------------

const entry = (agoMs: number, kind: LedgerEntry['kind'], actor: LedgerEntry['actor'], summary: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({
  ts: NOW - agoMs,
  kind,
  actor,
  summary,
  run: SLUG,
  ...extra,
})

export function sampleLedger(): LedgerEntry[] {
  return [
    entry(27 * HOUR, 'run.created', 'human', `Run created: ${TITLE}`),
    entry(27 * HOUR - MIN, 'stage.entered', 'mod', 'Entered ① Plan', { stage: 'plan' }),
    entry(26 * HOUR, 'artifact.written', 'agent', `Wrote intent/${SLUG}.md (draft)`, { stage: 'plan' }),
    entry(26 * HOUR - 5 * MIN, 'gate.opened', 'mod', 'intent.approve is ready for a person', { stage: 'plan' }),
    entry(25 * HOUR, 'gate.approved', 'human', 'matheus approved intent.approve', { stage: 'plan' }),
    entry(26 * HOUR - 40 * MIN, 'guard.blocked', 'mod', 'plan-first blocked Write src/limits.ts: the plan is not accepted yet', { data: { guard: 'plan-first' } }),
    entry(4 * HOUR, 'artifact.written', 'agent', `Wrote specs/${SLUG}.spec.md (draft)`, { stage: 'design' }),
    entry(3 * HOUR + 20 * MIN, 'gate.opened', 'mod', 'spec.approve is ready for a person', { stage: 'design' }),
    entry(5 * HOUR, 'guard.blocked', 'mod', 'gate-integrity blocked an Edit that set Status: approved on the spec', { data: { guard: 'gate-integrity' } }),
    entry(3 * HOUR, 'gate.approved', 'human', 'matheus approved spec.approve', { stage: 'design' }),
    entry(3 * HOUR - 2 * MIN, 'autopilot.queued', 'mod', 'Autopilot queued draft-plan (1/12)', { stage: 'build' }),
    entry(2 * HOUR + 10 * MIN, 'artifact.written', 'agent', `Wrote plans/${SLUG}.plan.md (draft)`, { stage: 'build' }),
    entry(80 * MIN, 'gate.opened', 'mod', 'plan.accept is ready for a person', { stage: 'build' }),
    entry(70 * MIN, 'gate.approved', 'human', 'matheus approved plan.accept', { stage: 'build' }),
    entry(69 * MIN, 'autopilot.queued', 'mod', 'Autopilot queued implement (2/12)', { stage: 'build' }),
    entry(48 * MIN, 'proof.fail', 'mod', 'make test failed (3 tests red)', { stage: 'build' }),
    entry(46 * MIN, 'autopilot.queued', 'mod', 'Autopilot queued implement (3/12)', { stage: 'build' }),
    entry(30 * MIN, 'proof.pass', 'mod', 'make test passed', { stage: 'build' }),
    entry(22 * MIN, 'guard.blocked', 'mod', 'protect-paths blocked Edit .env: protected path', { data: { guard: 'protect-paths' } }),
    entry(9 * MIN, 'guard.blocked', 'mod', 'plan-first blocked Write docs/notes.ts before the plan was accepted', { data: { guard: 'plan-first' } }),
    entry(6 * MIN, 'autopilot.queued', 'mod', 'Autopilot queued implement (4/12)', { stage: 'build' }),
    entry(4 * MIN, 'band.breach', 'mod', 'error_rate reached 2σ (1.8 vs mean 1.1)', { run: undefined, data: { metric: 'error_rate' } }),
  ]
}

const metric = (id: string, stage: MetricView['stage'], kind: MetricView['kind'], label: string, value: string, raw: number | null, status: MetricView['status'], target?: string, hint = ''): MetricView =>
  target === undefined ? { id, stage, kind, label, value, raw, status, hint } : { id, stage, kind, label, value, raw, target, status, hint }

export function sampleMetrics(): MetricView[] {
  return [
    metric('elicitation', 'plan', 'leading', 'Elicitation latency', '1h 12m', 72 * MIN, 'good', '< 2 hours', 'Run created to intent approved.'),
    metric('survival', 'plan', 'lagging', 'Intent survival', '100%', 1, 'good', undefined, 'Approved over approved plus rejected.'),
    metric('design', 'design', 'leading', 'Design compression', '21h', 21 * HOUR, 'warn', undefined, 'Intent approved to spec approved.'),
    metric('rework', 'design', 'lagging', 'Requirements rework', '0', 0, 'good', undefined, 'Spec edits after plan acceptance.'),
    metric('plan-proof', 'build', 'leading', 'Plan-to-proof time', 'n/a', null, 'n/a', undefined, 'Plan accepted to verification passed.'),
    metric('drift', 'build', 'lagging', 'Plan drift', '25%', 0.25, 'bad', '0%', 'Edited files outside the plan.'),
    metric('first-pass', 'test', 'leading', 'First-pass green rate', '50%', 0.5, 'bad', '≥ 90%', 'Passing proofs over all proofs.'),
    metric('failed', 'test', 'lagging', 'Failed verifications', '1', 1, 'warn', undefined, 'proof.fail entries.'),
    metric('gate-wait', 'deploy', 'leading', 'Gate wait', '14m', 14 * MIN, 'good', undefined, 'Gate opened to approved.'),
    metric('guards', 'deploy', 'lagging', 'Guard interceptions', '13', 13, 'warn', undefined, '5 plan-first, 3 protect-paths'),
    metric('breach', 'maintain', 'leading', 'Breach-to-intent latency', 'n/a', null, 'n/a', '< 5 minutes', 'Band breach to incident intent.'),
    metric('parallel', 'all', 'leading', 'Parallel runs', '3', 3, 'good', '2–3', 'Runs not fully done.'),
  ]
}

export function sampleBands(): BandView[] {
  const values = [1.1, 1.0, 1.2, 0.9, 1.1, 1.3, 1.2, 1.1, 1.5, 1.7, 1.8]
  return [
    {
      metric: 'error_rate',
      description: 'Checkout 5xx rate',
      values,
      last: { metric: 'error_rate', at: NOW - 4 * MIN, value: 1.8, mean: 1.1, sd: 0.3, z: 2.3, tier: '2sigma', rules: ['WE2'], n: 30 },
      tier: '2sigma',
      spec: null,
      source: null,
    },
    {
      metric: 'p95_latency_ms',
      description: 'Checkout p95 latency',
      values: [208, 212, 205, 215, 210, 209, 213, 211, 207, 214, 212],
      last: { metric: 'p95_latency_ms', at: NOW - 4 * MIN, value: 212, mean: 210, sd: 3, z: 0.7, tier: 'in-control', rules: [], n: 30 },
      tier: 'in-control',
      spec: null,
      source: null,
    },
  ]
}

export function sampleSetup(allMissing = false): SetupItem[] {
  const item = (id: string, label: string, path: string, play: number, exists: boolean, template: SetupItem['template'], hint: string): SetupItem => ({
    id,
    label,
    path,
    play,
    exists: exists && !allMissing,
    ...(template ? { template } : {}),
    hint,
  })
  return [
    item('claude-md', 'CLAUDE.md', 'CLAUDE.md', 5, true, 'claude-context', 'Repo memory: build, test and the things Claude gets wrong.'),
    item('review-md', 'REVIEW.md', 'REVIEW.md', 10, false, 'review-policy', 'The three-pass review policy the reviewer agent follows.'),
    item('verifier', 'Verifier agent', '.claude/agents/verifier.md', 8, true, 'verifier-agent', 'A report-only agent that proves the work.'),
    item('production-gate', 'Production gate hook', '.claude/hooks/production-gate.sh', 11, true, 'production-gate', 'Blocks production deploys without a release token.'),
    item('bands', 'Control bands', 'bands.yaml', 13, false, 'bands', 'Metrics, rules and what each sigma tier does.'),
    item('ci-evals', 'CI evals workflow', '.github/workflows/agent-evals.yml', 9, false, 'ci-evals-workflow', 'Runs the eval suite on every change to prompts and skills.'),
    item('managed-settings', 'Managed settings', '.okf/enterprise-managed-settings.json', 12, false, 'managed-settings', 'Sandboxing and network policy for CI and enterprise rollouts.'),
  ]
}

// ---------------------------------------------------------------------------
// View models
// ---------------------------------------------------------------------------

const RUNS: RunSummary[] = [
  { slug: SLUG, title: TITLE, current: 'build', health: 'ok', progress: 0.5, source: 'human', createdAt: NOW - 27 * HOUR },
  { slug: 'retry-payment-webhooks', title: 'Retry payment webhooks with backoff', current: 'design', health: 'attention', progress: 1 / 6, source: 'ticket', createdAt: NOW - 8 * HOUR },
  { slug: 'incident-2026-10-04', title: 'Investigate error_rate anomaly', current: 'plan', health: 'ok', progress: 0, source: 'anomaly', createdAt: NOW - 2 * HOUR },
]

const RUNNING: AutopilotView = { mode: 'semi', paused: false, budgetLeft: 8, budgetMax: 12, reason: 'plan.md is accepted: the agent implements it, then verifies.', state: 'running' }

export function sampleView(overrides: Partial<ViewModel> = {}): ViewModel {
  const config = overrides.config ?? sampleConfig()
  const base: ViewModel = {
    ready: true,
    now: NOW,
    cwd: '/work/checkout',
    config,
    configIssues: [],
    knowledge: { source: 'bundled', root: 'openknowledge', title: 'The AI-Native SDLC Master Knowledge Index', issues: [] },
    plays: playViews(config.plays.enabled),
    runs: RUNS,
    active: midLoopRun(),
    guards: guardViews(config.plays.enabled, config.guards.disabled),
    release: { envToken: false, grantUntil: null },
    autopilot: RUNNING,
    ledger: sampleLedger(),
    metrics: sampleMetrics(),
    bands: sampleBands(),
    setup: sampleSetup(),
    quarantined: [],
    notice: '',
  }
  return { ...base, ...overrides }
}

/** A person owes the next move: spec.md waits for sign-off. */
export function awaitingHumanView(overrides: Partial<ViewModel> = {}): ViewModel {
  return sampleView({
    active: awaitingSpecRun(),
    autopilot: { mode: 'semi', paused: false, budgetLeft: 10, budgetMax: 12, reason: 'Halted at the spec.approve gate: it is yours to pass.', state: 'human-gate' },
    bands: sampleBands().map(b => ({ ...b, tier: 'in-control', last: b.last && { ...b.last, tier: 'in-control' } })),
    ...overrides,
  })
}

/** Verification failed three times: the run is blocked and the autopilot halted. */
export function blockedView(overrides: Partial<ViewModel> = {}): ViewModel {
  return sampleView({
    active: blockedRun(),
    autopilot: { mode: 'semi', paused: false, budgetLeft: 3, budgetMax: 12, reason: 'Halted after 3 failed verifications in a row.', state: 'verify-fail-streak' },
    ...overrides,
  })
}

/** Review is clean; releasing needs a named human, and no grant is live. */
export function releaseView(overrides: Partial<ViewModel> = {}): ViewModel {
  return sampleView({
    active: releaseRun(),
    autopilot: { mode: 'semi', paused: false, budgetLeft: 5, budgetMax: 12, reason: 'Halted at the release.approve gate: it is yours to pass.', state: 'human-gate' },
    ...overrides,
  })
}

/** A project that has never run the Loop: nothing scaffolded, nothing recorded. */
export function emptyView(overrides: Partial<ViewModel> = {}): ViewModel {
  const config = sampleConfig({ bands: { enabled: false, sources: [], window: 30, tier3: 'propose', runbook: [] } })
  return sampleView({
    config,
    plays: playViews(config.plays.enabled),
    guards: guardViews(config.plays.enabled).map(g => ({ ...g, stat: { hits: 0, lastAt: null, lastMessage: '' } })),
    runs: [],
    active: null,
    autopilot: { mode: 'semi', paused: false, budgetLeft: 12, budgetMax: 12, reason: 'No run yet.', state: 'no-run' },
    ledger: [],
    metrics: sampleMetrics().map(m => ({ ...m, value: 'n/a', raw: null, status: 'n/a' as const })),
    bands: [],
    setup: sampleSetup(true),
    ...overrides,
  })
}

/** An approval the agent could have written: spec.md says approved, the mod never recorded it, so it is held. */
export function quarantinedRun(): RunSnapshot {
  const base = awaitingSpecRun()
  const stages = base.stages.map(s =>
    s.id === 'design'
      ? {
          ...s,
          summary: 'spec.md says approved but is held until you confirm',
          artifacts: [specDoc('approved', { flaggedConcerns: 2 })],
          gates: [
            gate(
              'spec.approve',
              [
                req('spec.exists', 'spec.md exists', true, 'machine'),
                req('spec.sections', 'all 6 sections present', true, 'machine'),
                req('spec.status', 'Status: approved', false, 'human', 'held: changed while the agent was working'),
              ],
              { ready: true, approved: false },
            ),
          ],
        }
      : s,
  )
  return { ...base, stages }
}

/** The spec looks approved but changed during an agent turn with no approval on record, so a person must confirm it. */
export function quarantinedView(overrides: Partial<ViewModel> = {}): ViewModel {
  return awaitingHumanView({
    active: quarantinedRun(),
    quarantined: [
      { slug: SLUG, gate: 'spec.approve', path: `specs/${SLUG}.spec.md`, detail: 'Status: approved appeared at 12:14 with no approval recorded by the mod; the agent edited this file in the same turn.' },
      { slug: 'retry-payment-webhooks', gate: 'intent.approve', path: 'intent/retry-payment-webhooks.md', detail: 'Status: approved appeared with no approval recorded.' },
    ],
    ...overrides,
  })
}

export function sampleUi(overrides: Partial<UiState> = {}): UiState {
  return {
    tab: 'loop',
    selectedPlay: null,
    ledgerFilter: { kinds: null, run: null, query: '' },
    draftIdea: '',
    bandExpanded: false,
    bandHidden: false,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Actions that record
// ---------------------------------------------------------------------------

export type Call = { name: keyof UiActions; args: unknown[] }
export type RecordedActions = UiActions & { calls: Call[] }

export function noopActions(): RecordedActions {
  const calls: Call[] = []
  const rec =
    <N extends keyof UiActions>(name: N) =>
    (...args: unknown[]): void => {
      calls.push({ name, args })
    }
  return {
    calls,
    setTab: rec('setTab'),
    selectPlay: rec('selectPlay'),
    setLedgerFilter: rec('setLedgerFilter'),
    setDraftIdea: rec('setDraftIdea'),
    newRun: rec('newRun'),
    selectRun: rec('selectRun'),
    approve: rec('approve'),
    confirm: rec('confirm'),
    reject: rec('reject'),
    runNext: rec('runNext'),
    setMode: rec('setMode'),
    togglePause: rec('togglePause'),
    togglePlay: rec('togglePlay'),
    toggleGuard: rec('toggleGuard'),
    grantRelease: rec('grantRelease'),
    revokeRelease: rec('revokeRelease'),
    scaffold: rec('scaffold'),
    scaffoldAll: rec('scaffoldAll'),
    exportAudit: rec('exportAudit'),
    checkBands: rec('checkBands'),
    reloadKnowledge: rec('reloadKnowledge'),
    toggleBand: rec('toggleBand'),
    hideBand: rec('hideBand'),
    openPane: rec('openPane'),
    closePane: rec('closePane'),
  }
}

// ---------------------------------------------------------------------------
// A fake element table: the constructors the engine hands a view, as plain data
// ---------------------------------------------------------------------------

export type FakeNode = { type: string; props: Record<string, unknown>; children: unknown[] }

function flatten(children: unknown): unknown[] {
  if (children === null || children === undefined || children === false || children === true) return []
  if (Array.isArray(children)) return children.flatMap(flatten)
  return [typeof children === 'number' ? String(children) : children]
}

const make =
  (type: string) =>
  (props: Record<string, unknown> & { children?: unknown }): RenderElement => {
    const { children, ...rest } = props
    return { type, props: rest, children: flatten(children) } as unknown as RenderElement
  }

/** The table a surface hands out: mobile has no Input/Select, every other surface has them. */
export function fakeElements(surface: Surface): PaneElements {
  const table = {
    Box: make('Box'),
    Text: make('Text'),
    Button: make('Button'),
    Markdown: make('Markdown'),
    Link: make('Link'),
    Code: make('Code'),
    ...(surface === 'mobile' ? {} : { Input: make('Input'), Select: make('Select') }),
  }
  return table as unknown as PaneElements
}
