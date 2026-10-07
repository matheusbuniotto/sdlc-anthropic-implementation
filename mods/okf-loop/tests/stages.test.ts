import { test, expect, describe } from 'claude-code/testing'
import type { ArtifactDoc, ArtifactKind, ArtifactStatus, GateId, LoopConfig, RunRecord, RunSnapshot, StageId } from '../types'
import {
  deriveRun,
  evaluateGate,
  newRunRecord,
  nextAction,
  recordApproval,
  recordRejection,
  statusForApproval,
  statusForRejection,
  summarizeRuns,
  currentStage,
  type DeriveInput,
} from '../hooks/core/stages'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)

const PATHS: LoopConfig['paths'] = {
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
}

const HUMAN_GATES: GateId[] = ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve']

function config(over: { humanGates?: GateId[]; autoKinds?: LoopConfig['autonomy']['autoKinds']; nitCap?: number } = {}): DeriveInput['config'] {
  return {
    autonomy: {
      mode: 'semi',
      maxAutoTurns: 12,
      haltOnBlocks: 3,
      haltOnVerifyFails: 3,
      humanGates: over.humanGates ?? HUMAN_GATES,
      autoKinds: over.autoKinds ?? ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'],
    },
    review: {
      nitCap: over.nitCap ?? 5,
      passes: [
        { tag: 'Bugs', title: 'Logic & Regressions' },
        { tag: 'Security', title: 'Security & Privacy' },
        { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
      ],
      ignorePaths: [],
    },
    paths: PATHS,
  }
}

function doc(kind: ArtifactKind, over: Partial<ArtifactDoc> = {}): ArtifactDoc {
  return {
    kind,
    path: `${kind}/add-login.md`,
    exists: true,
    status: 'draft',
    title: 'Add login',
    mtimeMs: NOW - HOUR,
    sections: [],
    missingSections: [],
    checklist: { done: 0, total: 0 },
    flaggedConcerns: 0,
    planFiles: [],
    issues: [],
    ...over,
  }
}

const intent = (status: ArtifactStatus = 'draft', over: Partial<ArtifactDoc> = {}) => doc('intent', { status, path: 'intent/add-login.md', ...over })
const spec = (status: ArtifactStatus = 'draft', over: Partial<ArtifactDoc> = {}) =>
  doc('spec', { status, path: 'specs/add-login.spec.md', checklist: { done: 0, total: 3 }, ...over })
const plan = (status: ArtifactStatus = 'draft', over: Partial<ArtifactDoc> = {}) =>
  doc('plan', { status, path: 'plans/add-login.plan.md', planFiles: ['src/login.ts', 'tests/login.test.ts'], ...over })
const proof = (over: Partial<ArtifactDoc> = {}) => doc('proof', { path: 'proofs/add-login.proof.md', ...over })
const review = (over: Partial<ArtifactDoc> = {}) => doc('review', { path: 'reviews/add-login.review.md', ...over })

const CLEAN_REVIEW = { passes: ['Bugs', 'Security', 'Compliance'], importantOpen: 0, nits: 2, verdict: 'CLEAN' as const }

// A bare record: no human has approved anything.
function bare(over: Partial<RunRecord> = {}): RunRecord {
  return { ...newRunRecord({ slug: 'add-login', title: 'Add login', source: 'human', now: NOW - 10 * HOUR }), ...over }
}

// The default run has a recorded plan acceptance, as the wiring writes when a human accepts the plan;
// it only matters once the plan reads in-progress or complete.
function record(over: Partial<RunRecord> = {}): RunRecord {
  return bare({ approvals: { 'plan.accept': { by: 'Ana', at: NOW - 5 * HOUR } }, ...over })
}

function input(over: Partial<DeriveInput> = {}): DeriveInput {
  return { record: record(), docs: {}, proofVerdict: null, review: null, config: config(), releaseGranted: false, now: NOW, ...over }
}

// Fixtures that walk the chain: each helper returns the docs for "everything up to here is done".
const toIntent = () => ({ intent: intent('approved') })
const toSpec = () => ({ ...toIntent(), spec: spec('approved') })
const toPlanAccepted = (status: ArtifactStatus = 'accepted') => ({ ...toSpec(), plan: plan(status) })
const toPlanComplete = () => toPlanAccepted('complete')
const toVerified = () => ({ ...toPlanComplete(), proof: proof() })
const toReviewed = () => ({ ...toVerified(), review: review() })

const states = (s: RunSnapshot): Record<StageId, string> =>
  Object.fromEntries(s.stages.map((st) => [st.id, st.state])) as Record<StageId, string>

const gate = (s: RunSnapshot, id: GateId) => {
  const g = s.stages.flatMap((st) => st.gates).find((x) => x.id === id)
  if (!g) throw new Error(`no gate ${id}`)
  return g
}

describe('plan stage: intent.approve', () => {
  test('a missing intent keeps the stage active and the next step is the interview', () => {
    const s = deriveRun(input())
    expect(states(s)).toEqual({ plan: 'active', design: 'pending', build: 'pending', test: 'pending', deploy: 'pending', maintain: 'pending' })
    expect(s.current).toBe('plan')
    expect(s.progress).toBe(0)
    expect(s.health).toBe('ok')
    expect(s.next).toMatchObject({ kind: 'interview', stage: 'plan', byHuman: false, auto: false, promptKey: 'interview' })
    const g = gate(s, 'intent.approve')
    expect(g.ready).toBe(false)
    expect(g.approved).toBe(false)
    expect(g.kind).toBe('human')
    expect(g.blockedBy).toEqual(['intent.md has not been written yet'])
    expect(g.requirements[0]).toMatchObject({ id: 'exists', ok: false, by: 'machine', detail: 'intent/add-login.md' })
  })

  test('a placeholder intent is not ready for a human', () => {
    const s = deriveRun(input({ docs: { intent: intent('draft', { issues: [{ severity: 'warn', code: 'placeholder', message: 'placeholders remain' }] }) } }))
    expect(states(s).plan).toBe('active')
    expect(gate(s, 'intent.approve').ready).toBe(false)
    expect(gate(s, 'intent.approve').blockedBy).toEqual(['intent.md still contains template placeholders'])
    expect(s.next).toMatchObject({ kind: 'interview', label: 'Finish intent.md', byHuman: false })
    expect(s.next.reason).toContain('placeholders')
  })

  test('missing sections block readiness and are named', () => {
    const s = deriveRun(input({ docs: { intent: intent('draft', { missingSections: ['Constraints', 'Open Questions'] }) } }))
    const g = gate(s, 'intent.approve')
    expect(g.ready).toBe(false)
    expect(g.blockedBy).toEqual(['intent.md is missing Constraints, Open Questions'])
    expect(g.requirements.find((r) => r.id === 'sections')).toMatchObject({ label: 'intent.md has all five sections', ok: false, detail: 'Missing: Constraints, Open Questions' })
  })

  test('an error issue blocks readiness even with every section present', () => {
    const s = deriveRun(input({ docs: { intent: intent('draft', { issues: [{ severity: 'error', code: 'status-invalid', message: 'Status line is unreadable' }] }) } }))
    expect(gate(s, 'intent.approve').ready).toBe(false)
    expect(gate(s, 'intent.approve').blockedBy[0]).toContain('Status line is unreadable')
  })

  test('a warn issue other than placeholder does not block readiness', () => {
    const s = deriveRun(input({ docs: { intent: intent('draft', { issues: [{ severity: 'warn', code: 'no-files', message: 'whatever' }] }) } }))
    expect(gate(s, 'intent.approve').ready).toBe(true)
  })

  test('a complete draft is ready and waits for the product owner', () => {
    const s = deriveRun(input({ docs: { intent: intent('under-review') } }))
    const g = gate(s, 'intent.approve')
    expect(g.ready).toBe(true)
    expect(g.approved).toBe(false)
    expect(g.blockedBy).toEqual([])
    expect(g.requirements.filter((r) => r.by === 'human')).toEqual([
      { id: 'approved', label: 'Product owner approves intent.md', ok: false, by: 'human', detail: 'Status: under-review' },
    ])
    expect(states(s).plan).toBe('awaiting-human')
    expect(s.health).toBe('attention')
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'intent.approve', byHuman: true, auto: false, stage: 'plan' })
    expect(s.next.promptKey).toBeUndefined()
  })

  test('approval moves the loop to design and the agent can draft the spec on its own', () => {
    const s = deriveRun(input({ docs: toIntent(), record: recordApproval(record(), 'intent.approve', 'Ana', NOW) }))
    expect(states(s)).toMatchObject({ plan: 'done', design: 'active', build: 'pending' })
    expect(s.current).toBe('design')
    expect(s.progress).toBe(1 / 6)
    expect(s.next).toMatchObject({ kind: 'draft-spec', promptKey: 'draft-spec', auto: true, byHuman: false })
    expect(s.stages[0]?.summary).toBe('intent.md approved by Ana.')
    expect(gate(s, 'intent.approve').requirements.find((r) => r.id === 'approved')).toMatchObject({ ok: true, detail: 'Approved by Ana' })
  })

  test('a rejected intent returns to rework even when its content is complete', () => {
    const s = deriveRun(input({ docs: { intent: intent('rejected') } }))
    expect(states(s).plan).toBe('active')
    expect(s.health).toBe('ok')
    expect(s.next).toMatchObject({ kind: 'interview', label: 'Rework intent.md', byHuman: false })
    expect(s.next.reason).toContain('rejected')
    expect(gate(s, 'intent.approve').requirements.find((r) => r.id === 'approved')?.detail).toContain('Rejected')
  })
})

describe('design stage: spec.approve', () => {
  test('without a spec the agent drafts it (auto in semi)', () => {
    const s = deriveRun(input({ docs: toIntent() }))
    expect(s.next).toMatchObject({ kind: 'draft-spec', auto: true })
    expect(gate(s, 'spec.approve').blockedBy).toEqual(['spec.md has not been written yet'])
  })

  test('a spec without sign-off checklist or with placeholders is not ready', () => {
    const noSignoffs = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft', { checklist: { done: 0, total: 0 } }) } }))
    expect(gate(noSignoffs, 'spec.approve').blockedBy).toEqual(['spec.md has no sign-off checklist'])
    expect(noSignoffs.next).toMatchObject({ kind: 'draft-spec', label: 'Finish spec.md' })

    const placeholder = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft', { issues: [{ severity: 'warn', code: 'placeholder', message: 'x' }] }) } }))
    expect(gate(placeholder, 'spec.approve').ready).toBe(false)

    const sections = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft', { missingSections: ['Flagged Areas of Concern'] }) } }))
    expect(gate(sections, 'spec.approve').requirements.find((r) => r.id === 'sections')?.label).toBe('spec.md has all six sections')
    expect(gate(sections, 'spec.approve').ready).toBe(false)
  })

  test('open flagged concerns do not block readiness but are listed as a human requirement', () => {
    const s = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft', { flaggedConcerns: 2 }) } }))
    const g = gate(s, 'spec.approve')
    expect(g.ready).toBe(true)
    expect(g.requirements.find((r) => r.id === 'flagged')).toMatchObject({ label: '2 flagged concerns to resolve', by: 'human', ok: false })
    expect(states(s).design).toBe('awaiting-human')
    expect(s.stages[1]?.summary).toContain('2 flagged concerns to resolve')
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'spec.approve', byHuman: true })
  })

  test('a single concern reads in the singular and zero concerns read as satisfied', () => {
    const one = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft', { flaggedConcerns: 1 }) } }))
    expect(gate(one, 'spec.approve').requirements.find((r) => r.id === 'flagged')?.label).toBe('1 flagged concern to resolve')
    const none = deriveRun(input({ docs: { ...toIntent(), spec: spec('draft') } }))
    expect(gate(none, 'spec.approve').requirements.find((r) => r.id === 'flagged')).toMatchObject({ label: 'No open flagged concerns', ok: true })
  })

  test('approval opens the build stage and the agent drafts the plan', () => {
    const s = deriveRun(input({ docs: toSpec() }))
    expect(states(s)).toMatchObject({ plan: 'done', design: 'done', build: 'active' })
    expect(s.next).toMatchObject({ kind: 'draft-plan', promptKey: 'draft-plan', auto: true })
  })

  test('a rejected spec goes back to drafting', () => {
    const s = deriveRun(input({ docs: { ...toIntent(), spec: spec('rejected') } }))
    expect(states(s).design).toBe('active')
    expect(s.next).toMatchObject({ kind: 'draft-spec', label: 'Rework spec.md' })
  })

  test('a spec marked approved before the intent is approved leaves design pending and uncounted', () => {
    const s = deriveRun(input({ docs: { intent: intent('draft'), spec: spec('approved') } }))
    expect(states(s).design).toBe('pending')
    expect(s.progress).toBe(0)
  })
})

describe('build stage: plan.accept', () => {
  test('a ready plan waits for human acceptance: no code before it', () => {
    const s = deriveRun(input({ docs: { ...toSpec(), plan: plan('draft') } }))
    expect(states(s).build).toBe('awaiting-human')
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'plan.accept', byHuman: true, stage: 'build' })
    expect(gate(s, 'plan.accept').requirements.find((r) => r.by === 'human')?.label).toBe('Engineer accepts plan.md before any code')
  })

  test('a plan listing no files is not ready', () => {
    const s = deriveRun(input({ docs: { ...toSpec(), plan: plan('draft', { planFiles: [] }) } }))
    expect(gate(s, 'plan.accept').blockedBy).toEqual(['plan.md lists no files under "Files That Change"'])
    expect(s.next).toMatchObject({ kind: 'draft-plan', label: 'Finish plan.md' })
  })

  test('a plan missing a section is not ready', () => {
    const s = deriveRun(input({ docs: { ...toSpec(), plan: plan('draft', { missingSections: ['Proof of Correctness'] }) } }))
    expect(gate(s, 'plan.accept').requirements.find((r) => r.id === 'sections')?.label).toBe('plan.md has all four sections')
    expect(gate(s, 'plan.accept').blockedBy).toEqual(['plan.md is missing Proof of Correctness'])
  })

  test('accepted and in-progress plans are being implemented', () => {
    for (const status of ['accepted', 'in-progress'] as const) {
      const s = deriveRun(input({ docs: toPlanAccepted(status) }))
      expect(states(s)).toMatchObject({ build: 'active', test: 'pending' })
      expect(s.next).toMatchObject({ kind: 'implement', promptKey: 'implement', auto: true, byHuman: false })
      expect(gate(s, 'plan.accept').approved).toBe(true)
    }
  })

  test('agent-written in-progress without a recorded acceptance is not acceptance', () => {
    const s = deriveRun(input({ record: bare(), docs: { ...toSpec(), plan: plan('in-progress') } }))
    expect(gate(s, 'plan.accept')).toMatchObject({ ready: true, approved: false })
    expect(gate(s, 'plan.accept').requirements.find((r) => r.by === 'human')).toMatchObject({ ok: false })
    expect(states(s)).toMatchObject({ build: 'awaiting-human', test: 'pending' })
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'plan.accept', byHuman: true })
    expect(s.progress).toBe(2 / 6)
  })

  test('an unready plan marked in-progress without a recorded acceptance goes back to drafting', () => {
    const s = deriveRun(input({ record: bare(), docs: { ...toSpec(), plan: plan('in-progress', { planFiles: [] }) } }))
    expect(gate(s, 'plan.accept').approved).toBe(false)
    expect(states(s).build).toBe('active')
    expect(s.next).toMatchObject({ kind: 'draft-plan', label: 'Finish plan.md' })
  })

  test('a complete plan without a recorded acceptance does not finish the build stage', () => {
    const s = deriveRun(input({ record: bare(), docs: toPlanComplete() }))
    expect(gate(s, 'plan.accept').approved).toBe(false)
    expect(states(s)).toMatchObject({ build: 'awaiting-human', test: 'pending' })
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'plan.accept' })
  })

  test('in-progress and complete count once the acceptance is recorded', () => {
    const rec = recordApproval(bare(), 'plan.accept', 'Ana', NOW)
    const going = deriveRun(input({ record: rec, docs: toPlanAccepted('in-progress') }))
    expect(gate(going, 'plan.accept')).toMatchObject({ approved: true })
    expect(gate(going, 'plan.accept').requirements.find((r) => r.by === 'human')).toMatchObject({ ok: true, detail: 'Approved by Ana' })
    expect(states(going).build).toBe('active')
    expect(going.next.kind).toBe('implement')
    const finished = deriveRun(input({ record: rec, docs: toPlanComplete() }))
    expect(states(finished)).toMatchObject({ build: 'done', test: 'active' })
  })

  test('a human-written accepted status passes without a record', () => {
    const s = deriveRun(input({ record: bare(), docs: toPlanAccepted('accepted') }))
    expect(gate(s, 'plan.accept').approved).toBe(true)
    expect(states(s).build).toBe('active')
    expect(s.next.kind).toBe('implement')
  })

  test('when plan.accept is not a human gate the status trick changes nothing: ready auto-passes', () => {
    const s = deriveRun(input({ record: bare(), config: config({ humanGates: ['release.approve'] }), docs: toPlanAccepted('in-progress') }))
    expect(gate(s, 'plan.accept')).toMatchObject({ kind: 'machine', approved: true })
  })

  test('a complete plan finishes the build stage and starts verification', () => {
    const s = deriveRun(input({ docs: toPlanComplete() }))
    expect(states(s)).toMatchObject({ build: 'done', test: 'active' })
    expect(s.next).toMatchObject({ kind: 'verify', promptKey: 'verify', auto: true })
    expect(s.progress).toBe(3 / 6)
  })

  test('a rejected plan returns to drafting', () => {
    const s = deriveRun(input({ docs: { ...toSpec(), plan: plan('rejected') } }))
    expect(states(s).build).toBe('active')
    expect(s.next).toMatchObject({ kind: 'draft-plan', label: 'Rework plan.md' })
  })
})

describe('test stage: verify.pass', () => {
  test('no proof yet: the next step is to verify', () => {
    const s = deriveRun(input({ docs: toPlanComplete() }))
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['No proof report has been written yet'])
    expect(gate(s, 'verify.pass').kind).toBe('machine')
    expect(s.next.reason).toContain('no proof yet')
  })

  test('a fresh PASS with no tracked edits passes the gate', () => {
    const s = deriveRun(input({ docs: toVerified(), proofVerdict: 'PASS' }))
    expect(gate(s, 'verify.pass')).toMatchObject({ ready: true, approved: true, blockedBy: [] })
    expect(states(s)).toMatchObject({ test: 'done', deploy: 'active' })
    expect(s.next).toMatchObject({ kind: 'review', promptKey: 'review', auto: true })
  })

  test('a PASS after the last edit and a green test run passes the gate', () => {
    const rec = record({ proof: { lastEditAt: NOW - 3 * HOUR, lastRunAt: NOW - 2 * HOUR, lastRunPassed: true, lastCommand: 'make test' } })
    const s = deriveRun(input({ record: rec, docs: toVerified(), proofVerdict: 'PASS' }))
    expect(gate(s, 'verify.pass').approved).toBe(true)
    expect(gate(s, 'verify.pass').requirements.find((r) => r.id === 'green')).toMatchObject({ ok: true, detail: 'make test' })
  })

  test('a proof older than the last edit is stale', () => {
    const rec = record({ proof: { lastEditAt: NOW - 30 * 60_000, lastRunAt: NOW - 20 * 60_000, lastRunPassed: true, lastCommand: 'make test' } })
    const s = deriveRun(input({ record: rec, docs: { ...toPlanComplete(), proof: proof({ mtimeMs: NOW - HOUR }) }, proofVerdict: 'PASS' }))
    expect(gate(s, 'verify.pass').approved).toBe(false)
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['Source changed after the proof was written'])
    expect(states(s).test).toBe('active')
    expect(s.next).toMatchObject({ kind: 'verify' })
    expect(s.next.reason).toContain('Source changed')
  })

  test('tests not re-run after the last edit also fail the gate', () => {
    const rec = record({ proof: { lastEditAt: NOW - HOUR, lastRunAt: 0, lastRunPassed: null, lastCommand: '' } })
    const s = deriveRun(input({ record: rec, docs: { ...toPlanComplete(), proof: proof({ mtimeMs: NOW }) }, proofVerdict: 'PASS' }))
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['Tests have not been re-run since the last edit'])
  })

  test('a failed last test run names the command', () => {
    const rec = record({ proof: { lastEditAt: NOW - 2 * HOUR, lastRunAt: NOW - HOUR, lastRunPassed: false, lastCommand: 'make test' } })
    const s = deriveRun(input({ record: rec, docs: { ...toPlanComplete(), proof: proof({ mtimeMs: NOW }) }, proofVerdict: 'PASS' }))
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['make test failed on its last run'])
  })

  test('a FAIL verdict blocks the stage and the next step is to implement the fix', () => {
    const s = deriveRun(input({ docs: toVerified(), proofVerdict: 'FAIL' }))
    expect(states(s).test).toBe('blocked')
    expect(s.health).toBe('blocked')
    expect(s.current).toBe('test')
    expect(s.next).toMatchObject({ kind: 'implement', promptKey: 'implement', auto: true, stage: 'test' })
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['The verifier reported FAIL'])
  })

  test('a FAIL older than the last edit is stale: verify again instead of fixing again', () => {
    const rec = record({ proof: { lastEditAt: NOW, lastRunAt: NOW, lastRunPassed: true, lastCommand: 'make test' } })
    const s = deriveRun(input({ record: rec, docs: { ...toPlanComplete(), proof: proof({ mtimeMs: NOW - HOUR }) }, proofVerdict: 'FAIL' }))
    expect(states(s).test).toBe('active')
    expect(s.next.kind).toBe('verify')
  })

  test('a proof without a verdict line is not a pass', () => {
    const s = deriveRun(input({ docs: toVerified(), proofVerdict: null }))
    expect(gate(s, 'verify.pass').approved).toBe(false)
    expect(gate(s, 'verify.pass').blockedBy).toEqual(['The proof has no PASS verdict'])
    expect(s.next.kind).toBe('verify')
  })
})

describe('deploy stage: review.pass and release.approve', () => {
  const base = () => ({ docs: toVerified(), proofVerdict: 'PASS' as const })

  test('no review yet: run the three-pass review', () => {
    const s = deriveRun(input(base()))
    expect(states(s).deploy).toBe('active')
    expect(gate(s, 'review.pass').blockedBy).toEqual(['The three-pass review has not been written yet'])
    expect(s.next).toMatchObject({ kind: 'review', auto: true })
  })

  test('open Important findings block the stage and send the agent back to implement', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, importantOpen: 2, verdict: 'BLOCKED' } }))
    expect(states(s).deploy).toBe('blocked')
    expect(s.health).toBe('blocked')
    expect(gate(s, 'review.pass').approved).toBe(false)
    expect(gate(s, 'review.pass').blockedBy).toContain('2 Important findings are still open')
    expect(s.stages[4]?.summary).toBe('2 Important review findings open: the agent fixes them before release.')
    expect(s.next).toMatchObject({ kind: 'implement', stage: 'deploy', auto: true })
  })

  test('a BLOCKED verdict with nothing open still blocks', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, verdict: 'BLOCKED' } }))
    expect(states(s).deploy).toBe('blocked')
    expect(gate(s, 'review.pass').blockedBy).toEqual(['The reviewer marked the change BLOCKED'])
  })

  test('a review that skipped a configured pass is incomplete and gets re-run', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, passes: ['Bugs', 'compliance'] } }))
    expect(gate(s, 'review.pass').blockedBy).toEqual(['The review lacks the Security pass'])
    expect(states(s).deploy).toBe('active')
    expect(s.next.kind).toBe('review')
  })

  test('pass tags match case-insensitively and ignore brackets', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, passes: ['[Bugs]', 'SECURITY', ' compliance '] } }))
    expect(gate(s, 'review.pass').approved).toBe(true)
  })

  test('nits over the cap fail the gate unless the overflow was summarized', () => {
    const over = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, nits: 6 } }))
    expect(gate(over, 'review.pass').blockedBy).toEqual(['6 nits exceed the cap of 5'])
    expect(states(over).deploy).toBe('active')
    expect(over.next.kind).toBe('review')

    const atCap = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, nits: 5 } }))
    expect(gate(atCap, 'review.pass').approved).toBe(true)

    const summarized = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, nits: 9, nitOverflowSummarized: true } }))
    expect(gate(summarized, 'review.pass').approved).toBe(true)

    const custom = deriveRun(input({ ...base(), docs: toReviewed(), review: { ...CLEAN_REVIEW, nits: 3 }, config: config({ nitCap: 2 }) }))
    expect(gate(custom, 'review.pass').blockedBy).toEqual(['3 nits exceed the cap of 2'])
  })

  test('a clean review waits for the named human: the agent cannot pass the production gate', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: CLEAN_REVIEW }))
    expect(gate(s, 'review.pass')).toMatchObject({ ready: true, approved: true, kind: 'machine' })
    const release = gate(s, 'release.approve')
    expect(release).toMatchObject({ kind: 'human', ready: true, approved: false, stage: 'deploy' })
    expect(release.requirements.map((r) => [r.id, r.by, r.ok])).toEqual([
      ['review-pass', 'machine', true],
      ['authorized', 'human', false],
      ['grant', 'human', false],
    ])
    expect(states(s).deploy).toBe('awaiting-human')
    expect(s.health).toBe('attention')
    expect(s.next).toMatchObject({ kind: 'release', gate: 'release.approve', byHuman: true, auto: false })
    expect(s.next.promptKey).toBeUndefined()
  })

  test('a live release grant satisfies the grant requirement but is not an approval', () => {
    const s = deriveRun(input({ ...base(), docs: toReviewed(), review: CLEAN_REVIEW, releaseGranted: true }))
    const release = gate(s, 'release.approve')
    expect(release.requirements.find((r) => r.id === 'grant')?.ok).toBe(true)
    expect(release.approved).toBe(false)
    expect(states(s).deploy).toBe('awaiting-human')
  })

  test('the human release approval completes the loop and starts monitoring', () => {
    const rec = recordApproval(record(), 'release.approve', 'Rita', NOW, 'ship it')
    const s = deriveRun(input({ ...base(), record: rec, docs: toReviewed(), review: CLEAN_REVIEW, releaseGranted: true }))
    expect(gate(s, 'release.approve')).toMatchObject({ approved: true })
    expect(gate(s, 'release.approve').requirements.find((r) => r.id === 'authorized')).toMatchObject({ ok: true, detail: 'Authorized by Rita' })
    expect(states(s)).toMatchObject({ test: 'done', deploy: 'done', maintain: 'monitoring' })
    expect(s.current).toBe('maintain')
    expect(s.progress).toBe(1)
    expect(s.health).toBe('ok')
    expect(s.stages[4]?.summary).toBe('Release authorized by Rita.')
    expect(s.next).toMatchObject({ kind: 'monitor', stage: 'maintain', byHuman: false, auto: false })
  })

  test('a release approval without a clean review does not pass the gate machine requirement', () => {
    const rec = recordApproval(record(), 'release.approve', 'Rita', NOW)
    const s = deriveRun(input({ ...base(), record: rec, docs: toReviewed(), review: { ...CLEAN_REVIEW, importantOpen: 1 } }))
    expect(gate(s, 'release.approve')).toMatchObject({ ready: false, approved: false })
    expect(states(s).deploy).toBe('blocked')
  })
})

describe('review freshness: source edited after the review', () => {
  const MIN = 60_000
  // Verification is current in all of these: the proof is newer than the last edit and tests ran green after it.
  const edited = (lastEditAt: number) => record({ proof: { lastEditAt, lastRunAt: lastEditAt + MIN, lastRunPassed: true, lastCommand: 'make test' } })
  const docsWithReview = (reviewMtime: number) => ({ ...toPlanComplete(), proof: proof({ mtimeMs: NOW }), review: review({ mtimeMs: reviewMtime }) })
  const openFindings = { ...CLEAN_REVIEW, importantOpen: 2, verdict: 'BLOCKED' as const }

  test('a fresh review with open Important findings blocks the stage and the next step is implement', () => {
    const s = deriveRun(input({ record: edited(NOW - 2 * HOUR), docs: docsWithReview(NOW - 30 * MIN), proofVerdict: 'PASS', review: openFindings }))
    expect(gate(s, 'verify.pass').approved).toBe(true)
    expect(states(s).deploy).toBe('blocked')
    expect(s.health).toBe('blocked')
    expect(s.next).toMatchObject({ kind: 'implement', stage: 'deploy' })
  })

  test('an edit after a blocked review means review again, not fix again', () => {
    const s = deriveRun(input({ record: edited(NOW - 30 * MIN), docs: docsWithReview(NOW - HOUR), proofVerdict: 'PASS', review: openFindings }))
    expect(gate(s, 'verify.pass').approved).toBe(true)
    expect(states(s).deploy).toBe('active')
    expect(s.health).toBe('ok')
    expect(gate(s, 'review.pass').approved).toBe(false)
    expect(gate(s, 'review.pass').blockedBy[0]).toBe('Source changed after the review was written')
    expect(s.next).toMatchObject({ kind: 'review', stage: 'deploy', auto: true, promptKey: 'review' })
    expect(s.next.reason).toContain('Source changed after the review')
  })

  test('a clean review followed by an edit is no longer a pass', () => {
    const s = deriveRun(input({ record: edited(NOW - 30 * MIN), docs: docsWithReview(NOW - HOUR), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    const g = gate(s, 'review.pass')
    expect(g).toMatchObject({ ready: false, approved: false })
    expect(g.requirements.find((r) => r.id === 'fresh')).toMatchObject({ label: 'Nothing was edited after the review', ok: false, by: 'machine' })
    expect(states(s).deploy).toBe('active')
    expect(s.next.kind).toBe('review')
  })

  test('a release approval cannot stand on a stale review', () => {
    const rec = recordApproval(edited(NOW - 30 * MIN), 'release.approve', 'Rita', NOW)
    const s = deriveRun(input({ record: rec, docs: docsWithReview(NOW - HOUR), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(gate(s, 'release.approve')).toMatchObject({ ready: false, approved: false })
    expect(states(s)).toMatchObject({ deploy: 'active', maintain: 'pending' })
    expect(s.next.kind).toBe('review')
  })

  test('a human sign-off of review.pass does not survive a later edit either', () => {
    const cfg = config({ humanGates: [...HUMAN_GATES, 'review.pass'] })
    const rec = recordApproval(edited(NOW - 30 * MIN), 'review.pass', 'Lee', NOW - 2 * HOUR)
    const s = deriveRun(input({ config: cfg, record: rec, docs: docsWithReview(NOW - HOUR), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(gate(s, 'review.pass').approved).toBe(false)
    expect(s.next.kind).toBe('review')
  })

  test('a review written after the last edit is fresh, including at the same millisecond', () => {
    for (const reviewMtime of [NOW, NOW - MIN]) {
      const s = deriveRun(input({ record: edited(NOW - MIN), docs: docsWithReview(reviewMtime), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
      expect(gate(s, 'review.pass').approved).toBe(true)
    }
  })

  test('with no tracked edits the freshness rule is out of the way', () => {
    const s = deriveRun(input({ docs: { ...toVerified(), review: review({ mtimeMs: 0 }) }, proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(gate(s, 'review.pass').approved).toBe(true)
    expect(gate(s, 'review.pass').requirements.find((r) => r.id === 'fresh')?.ok).toBe(true)
    expect(states(s).deploy).toBe('awaiting-human')
  })

  test('a missing review reports only that it does not exist', () => {
    const s = deriveRun(input({ docs: toVerified(), proofVerdict: 'PASS' }))
    expect(gate(s, 'review.pass').blockedBy).toEqual(['The three-pass review has not been written yet'])
  })
})

describe('maintain stage', () => {
  test('is pending before the release and has no gates', () => {
    const s = deriveRun(input({ docs: toIntent() }))
    const maintain = s.stages[5]
    expect(maintain).toMatchObject({ id: 'maintain', number: 6, state: 'pending', gates: [], artifacts: [] })
    expect(maintain?.summary).toBe('Starts once the release is out.')
  })

  test('maintain is never "done": the loop closes through anomaly intents', () => {
    const rec = recordApproval(record(), 'release.approve', 'Rita', NOW)
    const s = deriveRun(input({ record: rec, docs: toReviewed(), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(s.stages.map((st) => st.state)).toEqual(['done', 'done', 'done', 'done', 'done', 'monitoring'])
    expect(currentStage(s.stages)).toBe('maintain')
  })
})

describe('config.autonomy.humanGates', () => {
  const noSpecGate = config({ humanGates: ['intent.approve', 'plan.accept', 'release.approve'] })

  test('a gate removed from humanGates is auto-passed once its machine requirements hold', () => {
    const s = deriveRun(input({ config: noSpecGate, docs: { ...toIntent(), spec: spec('draft') } }))
    const g = gate(s, 'spec.approve')
    expect(g).toMatchObject({ kind: 'machine', ready: true, approved: true })
    expect(g.requirements.every((r) => r.by === 'machine')).toBe(true)
    expect(states(s)).toMatchObject({ design: 'done', build: 'active' })
    expect(s.next.kind).toBe('draft-plan')
  })

  test('an auto-passed gate whose machine requirements fail still holds the stage', () => {
    const s = deriveRun(input({ config: noSpecGate, docs: { ...toIntent(), spec: spec('draft', { checklist: { done: 0, total: 0 } }) } }))
    expect(gate(s, 'spec.approve')).toMatchObject({ ready: false, approved: false, kind: 'machine' })
    expect(states(s).design).toBe('active')
    expect(s.next.kind).toBe('draft-spec')
  })

  test('removing intent.approve lets a ready intent flow without a person', () => {
    const s = deriveRun(input({ config: config({ humanGates: [] }), docs: { intent: intent('draft') } }))
    expect(gate(s, 'intent.approve')).toMatchObject({ kind: 'machine', approved: true })
    expect(states(s).plan).toBe('done')
  })

  test('an auto-passed gate does not override a person who rejected the artifact', () => {
    const s = deriveRun(input({ config: config({ humanGates: [] }), docs: { intent: intent('rejected') } }))
    expect(gate(s, 'intent.approve')).toMatchObject({ kind: 'machine', ready: true, approved: false })
    expect(states(s).plan).toBe('active')
    expect(s.next).toMatchObject({ kind: 'interview', label: 'Rework intent.md' })
  })

  test('removing plan.accept starts implementation as soon as the plan is ready', () => {
    const s = deriveRun(input({ config: config({ humanGates: ['release.approve'] }), docs: { ...toSpec(), plan: plan('draft') } }))
    expect(gate(s, 'plan.accept').approved).toBe(true)
    expect(states(s).build).toBe('active')
    expect(s.next).toMatchObject({ kind: 'implement', auto: true })
  })

  test('release.approve is always human, even when humanGates is empty', () => {
    const s = deriveRun(input({ config: config({ humanGates: [] }), docs: toReviewed(), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(gate(s, 'release.approve')).toMatchObject({ kind: 'human', approved: false })
    expect(s.next).toMatchObject({ kind: 'release', byHuman: true })
  })

  test('a machine gate listed in humanGates needs a person to sign it off', () => {
    const cfg = config({ humanGates: [...HUMAN_GATES, 'verify.pass'] })
    const waiting = deriveRun(input({ config: cfg, docs: toVerified(), proofVerdict: 'PASS' }))
    expect(gate(waiting, 'verify.pass')).toMatchObject({ kind: 'human', ready: true, approved: false })
    expect(gate(waiting, 'verify.pass').requirements.find((r) => r.by === 'human')?.label).toBe('A human signs off the verification')
    expect(states(waiting).test).toBe('awaiting-human')
    expect(waiting.next).toMatchObject({ kind: 'await-human', gate: 'verify.pass', byHuman: true })

    const signed = deriveRun(input({ config: cfg, docs: toVerified(), proofVerdict: 'PASS', record: recordApproval(record(), 'verify.pass', 'Lee', NOW) }))
    expect(gate(signed, 'verify.pass').approved).toBe(true)
    expect(states(signed).test).toBe('done')
  })

  test('review.pass listed in humanGates holds the deploy stage for a human', () => {
    const cfg = config({ humanGates: [...HUMAN_GATES, 'review.pass'] })
    const s = deriveRun(input({ config: cfg, docs: toReviewed(), proofVerdict: 'PASS', review: CLEAN_REVIEW }))
    expect(states(s).deploy).toBe('awaiting-human')
    expect(s.next).toMatchObject({ kind: 'await-human', gate: 'review.pass' })
  })

  test('autoKinds decides whether the agent may run a step unattended', () => {
    const s = deriveRun(input({ config: config({ autoKinds: ['verify', 'review'] }), docs: toSpec() }))
    expect(s.next).toMatchObject({ kind: 'draft-plan', auto: false, byHuman: false })
  })
})

describe('evaluateGate', () => {
  test('requirement labels read as UI sentences', () => {
    const g = evaluateGate('intent.approve', input({ docs: { intent: intent('draft') } }))
    expect(g.label).toBe('Product owner approves intent.md')
    expect(g.requirements.map((r) => r.label)).toEqual([
      'intent.md exists',
      'intent.md has all five sections',
      'intent.md has no lint errors',
      'No template placeholders left',
      'Product owner approves intent.md',
    ])
  })

  test('a missing file reports one blocker, not one per check', () => {
    const g = evaluateGate('plan.accept', input())
    expect(g.requirements.filter((r) => r.by === 'machine' && !r.ok).length).toBeGreaterThan(1)
    expect(g.blockedBy).toEqual(['plan.md has not been written yet'])
  })

  test('requirements never leak the internal problem text', () => {
    const g = evaluateGate('intent.approve', input())
    expect(Object.keys(g.requirements[0] ?? {}).sort()).toEqual(['by', 'detail', 'id', 'label', 'ok'])
  })

  test('the missing-doc path comes from config.paths with the slug expanded', () => {
    const g = evaluateGate('spec.approve', input())
    expect(g.requirements[0]?.detail).toBe('specs/add-login.spec.md')
  })

  test('a human approval is authoritative even if the machine checks disagree', () => {
    const g = evaluateGate('intent.approve', input({ docs: { intent: intent('approved', { missingSections: ['Constraints'] }) } }))
    expect(g).toMatchObject({ ready: false, approved: true })
    expect(g.blockedBy).toEqual(['intent.md is missing Constraints'])
  })
})

describe('nextAction', () => {
  test('is derived from the stage snapshots alone', () => {
    const s = deriveRun(input({ docs: toIntent() }))
    expect(nextAction(s.stages, s.record, config())).toEqual(s.next)
  })

  test('an empty stage list is idle rather than a crash', () => {
    expect(nextAction([], record(), config()).kind).toBe('idle')
  })

  test('pending stages never become the next action while an earlier one is open', () => {
    const s = deriveRun(input())
    expect(s.next.stage).toBe('plan')
  })
})

describe('run records', () => {
  test('newRunRecord starts clean', () => {
    expect(newRunRecord({ slug: 'a', title: 'A', source: 'anomaly', now: 5 })).toEqual({
      slug: 'a',
      title: 'A',
      source: 'anomaly',
      createdAt: 5,
      approvals: {},
      fix: { active: false, reproCommitted: false },
      proof: { lastEditAt: 0, lastRunAt: 0, lastRunPassed: null, lastCommand: '' },
      edits: [],
      autoTurns: 0,
      blockStreak: 0,
      verifyFailStreak: 0,
      paused: false,
    })
  })

  test('recordApproval stores who and when without mutating the record', () => {
    const r = record({ autoTurns: 4 })
    const a = recordApproval(r, 'spec.approve', 'Ana', 99, 'ok')
    expect(a.approvals['spec.approve']).toEqual({ by: 'Ana', at: 99, note: 'ok' })
    expect(r.approvals['spec.approve']).toBeUndefined()
    expect(a.autoTurns).toBe(4)
    expect(recordApproval(r, 'plan.accept', 'Bo', 1).approvals['plan.accept']).toEqual({ by: 'Bo', at: 1 })
  })

  test('recordRejection clears only that approval and resets the budget', () => {
    const r = recordApproval(recordApproval(record({ autoTurns: 7 }), 'intent.approve', 'Ana', 1), 'spec.approve', 'Ana', 2)
    const rejected = recordRejection(r, 'spec.approve')
    expect(rejected.approvals['spec.approve']).toBeUndefined()
    expect(rejected.approvals['intent.approve']).toEqual({ by: 'Ana', at: 1 })
    expect(rejected.autoTurns).toBe(0)
    expect(r.approvals['spec.approve']).toBeDefined()
    expect(r.autoTurns).toBe(7)
  })

  test('statusForApproval maps the human gates to the status that records them', () => {
    expect(statusForApproval('intent.approve')).toEqual({ kind: 'intent', status: 'approved' })
    expect(statusForApproval('spec.approve')).toEqual({ kind: 'spec', status: 'approved' })
    expect(statusForApproval('plan.accept')).toEqual({ kind: 'plan', status: 'accepted' })
    for (const g of ['verify.pass', 'review.pass', 'release.approve'] as const) expect(statusForApproval(g)).toBeNull()
  })

  test('statusForRejection sends intent to rejected and spec/plan back to draft', () => {
    expect(statusForRejection('intent.approve')).toEqual({ kind: 'intent', status: 'rejected' })
    expect(statusForRejection('spec.approve')).toEqual({ kind: 'spec', status: 'draft' })
    expect(statusForRejection('plan.accept')).toEqual({ kind: 'plan', status: 'draft' })
    for (const g of ['verify.pass', 'review.pass', 'release.approve'] as const) expect(statusForRejection(g)).toBeNull()
  })

  test('summarizeRuns projects the picker fields', () => {
    const s = deriveRun(input({ docs: { intent: intent('under-review') } }))
    expect(summarizeRuns([s])).toEqual([
      { slug: 'add-login', title: 'Add login', current: 'plan', health: 'attention', progress: 0, source: 'human', createdAt: NOW - 10 * HOUR },
    ])
  })
})

describe('snapshot shape', () => {
  test('stages carry the knowledge-base identity, artifacts, gates and plays', () => {
    const s = deriveRun(input({ docs: toSpec() }))
    expect(s.stages.map((st) => st.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(s.stages.map((st) => st.name)).toEqual(['Plan', 'Design', 'Build', 'Test', 'Deploy', 'Maintain'])
    expect(s.stages[2]?.artifacts.map((a) => a.kind)).toEqual(['plan'])
    expect(s.stages[4]?.gates.map((g) => g.id)).toEqual(['review.pass', 'release.approve'])
    expect(s.stages[2]?.plays).toEqual([3, 4, 5, 6, 7])
    expect(s.stages[2]?.summary).toBe('The agent drafts plan.md; no code until a human accepts it.')
  })

  test('missing artifacts appear as absent docs with the configured path', () => {
    const s = deriveRun(input())
    expect(s.stages[0]?.artifacts[0]).toMatchObject({ kind: 'intent', exists: false, path: 'intent/add-login.md', status: 'missing' })
  })

  test('derivation is deterministic and does not mutate its input', () => {
    const i = input({ docs: toReviewed(), proofVerdict: 'PASS', review: CLEAN_REVIEW })
    const before = JSON.stringify(i)
    expect(JSON.stringify(deriveRun(i))).toBe(JSON.stringify(deriveRun(i)))
    expect(JSON.stringify(i)).toBe(before)
  })
})
