import { test, expect, describe } from 'claude-code/testing'
import type { ArtifactDoc, ArtifactKind, ArtifactStatus, GateId, NextAction, RunRecord, RunSnapshot, StageId, StageSnapshot, StageState } from '../types'
import { deriveRun, recordApproval, type DeriveInput } from '../hooks/core/stages'
import {
  autopilotView,
  consumeTurn,
  decideAutopilot,
  noteBlock,
  noteGoodStep,
  noteVerify,
  resetBudget,
  type AutopilotDecision,
} from '../hooks/core/autopilot'

const AUTONOMY = { mode: 'semi' as const, maxAutoTurns: 12, haltOnBlocks: 3, haltOnVerifyFails: 3, humanGates: [] as GateId[], autoKinds: [] as NextAction['kind'][] }
const config = (over: Partial<typeof AUTONOMY> = {}) => ({ autonomy: { ...AUTONOMY, ...over } })

function record(over: Partial<RunRecord> = {}): RunRecord {
  return {
    slug: 'add-login',
    title: 'Add login',
    source: 'human',
    createdAt: 0,
    approvals: {},
    fix: { active: false, reproCommitted: false },
    proof: { lastEditAt: 0, lastRunAt: 0, lastRunPassed: null, lastCommand: '' },
    edits: [],
    autoTurns: 0,
    blockStreak: 0,
    verifyFailStreak: 0,
    paused: false,
    ...over,
  }
}

const IDS: StageId[] = ['plan', 'design', 'build', 'test', 'deploy', 'maintain']

function stage(id: StageId, state: StageState): StageSnapshot {
  return { id, number: (IDS.indexOf(id) + 1) as StageSnapshot['number'], name: id, tagline: '', state, artifacts: [], gates: [], summary: '', plays: [] }
}

const AUTO_STEP: NextAction = { kind: 'implement', stage: 'build', label: 'Implement the accepted plan', reason: 'plan.md is accepted.', byHuman: false, auto: true, promptKey: 'implement' }
const HUMAN_STEP: NextAction = { kind: 'await-human', stage: 'design', label: 'Sign off spec.md', reason: 'spec.md is complete.', byHuman: true, auto: false, gate: 'spec.approve' }
const INTERVIEW: NextAction = { kind: 'interview', stage: 'plan', label: 'Interview the originator', reason: 'There is no intent yet.', byHuman: false, auto: false, promptKey: 'interview' }
const RELEASE: NextAction = { kind: 'release', stage: 'deploy', label: 'Authorize the release', reason: 'The review is clean.', byHuman: true, auto: false, gate: 'release.approve' }
const MONITOR: NextAction = { kind: 'monitor', stage: 'maintain', label: 'Watch the control bands', reason: 'Released.', byHuman: false, auto: false }

function snap(next: NextAction, rec: Partial<RunRecord> = {}, states?: StageState[]): RunSnapshot {
  const st = states ?? IDS.map((id): StageState => (IDS.indexOf(id) < IDS.indexOf(next.stage) ? 'done' : id === next.stage ? 'active' : 'pending'))
  return { record: record(rec), stages: IDS.map((id, i) => stage(id, st[i] ?? 'pending')), current: next.stage, next, health: 'ok', progress: 0 }
}

const decide = (s: RunSnapshot | null, mode: 'manual' | 'guided' | 'semi' = 'semi', cfg = config()) => decideAutopilot({ snapshot: s, config: cfg, mode })

describe('decideAutopilot: check order', () => {
  test('no run', () => {
    for (const mode of ['manual', 'guided', 'semi'] as const) {
      expect(decide(null, mode)).toMatchObject({ kind: 'halt', code: 'no-run' })
    }
    expect(decide(null).reason).toContain('/sdlc new')
  })

  test('manual mode never queues anything, whatever else is true', () => {
    const d = decide(snap(AUTO_STEP, { paused: true }), 'manual')
    expect(d).toMatchObject({ kind: 'halt', code: 'manual' })
    expect(d.reason).toContain('Manual mode')
  })

  test('paused beats everything after the mode', () => {
    const d = decide(snap(HUMAN_STEP, { paused: true, autoTurns: 99 }))
    expect(d).toMatchObject({ kind: 'halt', code: 'paused' })
    expect(d.reason).toContain('"add-login"')
  })

  test('every stage done or monitoring is done', () => {
    const d = decide(snap(MONITOR, {}, ['done', 'done', 'done', 'done', 'done', 'monitoring']))
    expect(d).toMatchObject({ kind: 'halt', code: 'done' })
    expect(d.reason).toContain('monitoring')
  })

  test('a stage still pending or blocked keeps the run open', () => {
    expect(decide(snap(AUTO_STEP, {}, ['done', 'done', 'active', 'pending', 'pending', 'pending'])).kind).toBe('run')
  })

  test('a human gate halts and names the gate', () => {
    const d = decide(snap(HUMAN_STEP))
    expect(d).toMatchObject({ kind: 'halt', code: 'human-gate', action: HUMAN_STEP })
    expect(d.reason).toBe('Halted at a human gate: waiting for a human to sign off spec.md and its flagged concerns.')
  })

  test('the release step is a human gate, in every mode that can run', () => {
    for (const mode of ['guided', 'semi'] as const) {
      const d = decide(snap(RELEASE), mode)
      expect(d).toMatchObject({ kind: 'halt', code: 'human-gate' })
      expect(d.reason).toContain('authorize the release')
    }
  })

  test('each gate has its own sentence', () => {
    const wait = (gate: GateId) => decide(snap({ ...HUMAN_STEP, gate })).reason
    expect(wait('intent.approve')).toContain('intent.md')
    expect(wait('plan.accept')).toContain('plan.md')
    expect(wait('verify.pass')).toContain('verification')
    expect(wait('review.pass')).toContain('review')
  })

  test('byHuman alone is enough to halt at a gate', () => {
    expect(decide(snap({ ...AUTO_STEP, byHuman: true, auto: false }))).toMatchObject({ kind: 'halt', code: 'human-gate' })
  })

  test('a human gate beats an exhausted budget and streaks', () => {
    const d = decide(snap(HUMAN_STEP, { autoTurns: 50, blockStreak: 9, verifyFailStreak: 9 }))
    expect(d).toMatchObject({ code: 'human-gate' })
  })

  test('a step the agent may not run unattended needs a human in semi', () => {
    const d = decide(snap(INTERVIEW))
    expect(d).toMatchObject({ kind: 'halt', code: 'needs-human', action: INTERVIEW })
    expect(d.reason).toContain('originator')
  })

  test('a configured-away kind needs a human in semi and names the step', () => {
    const d = decide(snap({ ...AUTO_STEP, auto: false }))
    expect(d).toMatchObject({ kind: 'halt', code: 'needs-human' })
    expect(d.reason).toContain('Implement the accepted plan')
  })

  test('the same non-auto step is only a suggestion in guided mode', () => {
    const d = decide(snap(INTERVIEW), 'guided')
    expect(d).toMatchObject({ kind: 'suggest', code: 'guided', action: INTERVIEW })
    expect(d.reason).toContain('Interview the originator')
  })

  test('budget: reaching maxAutoTurns halts (>=, not >)', () => {
    expect(decide(snap(AUTO_STEP, { autoTurns: 11 })).kind).toBe('run')
    const d = decide(snap(AUTO_STEP, { autoTurns: 12 }))
    expect(d).toMatchObject({ kind: 'halt', code: 'budget', action: AUTO_STEP })
    expect(d.reason).toContain('12 turns')
    expect(decide(snap(AUTO_STEP, { autoTurns: 3 }), 'semi', config({ maxAutoTurns: 3 }))).toMatchObject({ code: 'budget' })
  })

  test('a zero budget halts at once', () => {
    expect(decide(snap(AUTO_STEP), 'semi', config({ maxAutoTurns: 0 }))).toMatchObject({ code: 'budget' })
  })

  test('block streak halts at haltOnBlocks', () => {
    expect(decide(snap(AUTO_STEP, { blockStreak: 2 })).kind).toBe('run')
    const d = decide(snap(AUTO_STEP, { blockStreak: 3 }))
    expect(d).toMatchObject({ kind: 'halt', code: 'blocked-streak' })
    expect(d.reason).toContain('3 guard blocks')
    expect(decide(snap(AUTO_STEP, { blockStreak: 1 }), 'semi', config({ haltOnBlocks: 1 }))).toMatchObject({ code: 'blocked-streak' })
  })

  test('verify-fail streak halts at haltOnVerifyFails', () => {
    expect(decide(snap(AUTO_STEP, { verifyFailStreak: 2 })).kind).toBe('run')
    const d = decide(snap(AUTO_STEP, { verifyFailStreak: 3 }))
    expect(d).toMatchObject({ kind: 'halt', code: 'verify-fail-streak' })
    expect(d.reason).toContain('3 failed verifications')
  })

  test('budget beats the block streak, which beats the verify-fail streak', () => {
    expect(decide(snap(AUTO_STEP, { autoTurns: 12, blockStreak: 3, verifyFailStreak: 3 }))).toMatchObject({ code: 'budget' })
    expect(decide(snap(AUTO_STEP, { blockStreak: 3, verifyFailStreak: 3 }))).toMatchObject({ code: 'blocked-streak' })
  })

  test('guided mode suggests an auto step but still honours the budget and streaks', () => {
    const d = decide(snap(AUTO_STEP), 'guided')
    expect(d).toMatchObject({ kind: 'suggest', code: 'guided', action: AUTO_STEP })
    expect(d.reason).toBe('Next step: Implement the accepted plan. plan.md is accepted.')
    expect(decide(snap(AUTO_STEP, { autoTurns: 12 }), 'guided')).toMatchObject({ code: 'budget' })
    expect(decide(snap(AUTO_STEP, { blockStreak: 3 }), 'guided')).toMatchObject({ code: 'blocked-streak' })
  })

  test('semi runs an auto step', () => {
    const d = decide(snap(AUTO_STEP, { autoTurns: 4 }))
    expect(d).toMatchObject({ kind: 'run', code: 'running', action: AUTO_STEP })
    expect(d.reason).toBe('Implement the accepted plan: plan.md is accepted.')
  })

  test('every snapshot-based halt carries the action it interrupted', () => {
    for (const d of [decide(snap(AUTO_STEP), 'manual'), decide(snap(AUTO_STEP, { paused: true })), decide(snap(HUMAN_STEP)), decide(snap(INTERVIEW))]) {
      expect(d.kind === 'halt' && d.action !== undefined).toBe(true)
    }
    expect(decide(null)).toEqual({ kind: 'halt', code: 'no-run', reason: expect.any(String) })
  })
})

describe('budget and streak bookkeeping', () => {
  test('consumeTurn adds one and leaves the input alone', () => {
    const r = record({ autoTurns: 2 })
    expect(consumeTurn(r).autoTurns).toBe(3)
    expect(r.autoTurns).toBe(2)
  })

  test('resetBudget clears the turns and both streaks, nothing else', () => {
    const r = record({ autoTurns: 9, blockStreak: 2, verifyFailStreak: 2, paused: true })
    expect(resetBudget(r)).toEqual({ ...r, autoTurns: 0, blockStreak: 0, verifyFailStreak: 0 })
  })

  test('noteBlock and noteGoodStep', () => {
    const r = noteBlock(noteBlock(record()))
    expect(r.blockStreak).toBe(2)
    expect(noteGoodStep(r).blockStreak).toBe(0)
    expect(noteGoodStep(r).verifyFailStreak).toBe(0)
  })

  test('noteVerify counts failures in a row and a pass clears them', () => {
    const failed = noteVerify(noteVerify(record(), false), false)
    expect(failed.verifyFailStreak).toBe(2)
    expect(noteVerify(failed, true).verifyFailStreak).toBe(0)
    expect(noteVerify(record(), true).verifyFailStreak).toBe(0)
  })

  test('streaks drive the decision end to end', () => {
    let r = record()
    for (let i = 0; i < 3; i++) r = noteBlock(r)
    expect(decide({ ...snap(AUTO_STEP), record: r })).toMatchObject({ code: 'blocked-streak' })
    expect(decide({ ...snap(AUTO_STEP), record: resetBudget(r) }).kind).toBe('run')
    expect(decide({ ...snap(AUTO_STEP), record: noteGoodStep(r) }).kind).toBe('run')
  })
})

describe('autopilotView', () => {
  const view = (decision: AutopilotDecision | null, rec: RunRecord | null, mode: 'manual' | 'guided' | 'semi' = 'semi', cfg = config()) =>
    autopilotView({ decision, record: rec, config: cfg, mode })

  test('a running decision shows the remaining budget', () => {
    const rec = record({ autoTurns: 4 })
    const d = decide({ ...snap(AUTO_STEP), record: rec })
    expect(view(d, rec)).toEqual({ mode: 'semi', paused: false, budgetLeft: 8, budgetMax: 12, state: 'running', reason: 'Implement the accepted plan: plan.md is accepted.' })
  })

  test('a halt exposes its code as the state', () => {
    const rec = record({ autoTurns: 12 })
    const v = view(decide({ ...snap(AUTO_STEP), record: rec }), rec)
    expect(v).toMatchObject({ state: 'budget', budgetLeft: 0, budgetMax: 12 })
    expect(v.reason).toContain('12 turns')
  })

  test('the budget never goes negative', () => {
    expect(view(null, record({ autoTurns: 30 })).budgetLeft).toBe(0)
  })

  test('guided suggestions report state guided', () => {
    const rec = record()
    expect(view(decide({ ...snap(AUTO_STEP), record: rec }, 'guided'), rec, 'guided')).toMatchObject({ mode: 'guided', state: 'guided' })
  })

  test('paused comes from the record', () => {
    const rec = record({ paused: true })
    const v = view(decide({ ...snap(AUTO_STEP), record: rec }), rec)
    expect(v).toMatchObject({ paused: true, state: 'paused' })
    expect(v.reason).toContain('paused')
  })

  test('no decision yet is idle, with or without a run', () => {
    expect(view(null, null)).toEqual({ mode: 'semi', paused: false, budgetLeft: 12, budgetMax: 12, state: 'idle', reason: 'There is no active run.' })
    expect(view(null, record())).toMatchObject({ state: 'idle', reason: 'Autopilot has not looked at this run yet.' })
  })

  test('manual mode and no run read as halts', () => {
    expect(view(decide(null, 'manual'), null, 'manual')).toMatchObject({ mode: 'manual', state: 'no-run' })
    expect(view(decide(snap(AUTO_STEP), 'manual'), record(), 'manual')).toMatchObject({ state: 'manual' })
  })

  test('budget max follows the configuration', () => {
    expect(view(null, record({ autoTurns: 1 }), 'semi', config({ maxAutoTurns: 5 }))).toMatchObject({ budgetMax: 5, budgetLeft: 4 })
  })
})

describe('autopilot over real derived snapshots', () => {
  const NOW = Date.UTC(2026, 9, 6, 12, 0, 0)
  const PATHS = { intent: 'intent/{slug}.md', spec: 'specs/{slug}.spec.md', plan: 'plans/{slug}.plan.md', proof: 'proofs/{slug}.proof.md', review: 'reviews/{slug}.review.md', incident: '', lesson: '', eval: '', claudeMd: '', reviewPolicy: '', bands: '', ciWorkflow: '', managedSettings: '', productionGate: '' }
  const derive = (docs: DeriveInput['docs'], rec: RunRecord, extra: Partial<DeriveInput> = {}) =>
    deriveRun({
      record: rec,
      docs,
      proofVerdict: null,
      review: null,
      releaseGranted: false,
      now: NOW,
      config: {
        autonomy: { ...AUTONOMY, humanGates: ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve'], autoKinds: ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'] },
        review: { nitCap: 5, passes: [{ tag: 'Bugs', title: '' }, { tag: 'Security', title: '' }, { tag: 'Compliance', title: '' }], ignorePaths: [] },
        paths: PATHS,
      },
      ...extra,
    })
  const doc = (kind: ArtifactKind, status: ArtifactStatus = 'draft', over: Partial<ArtifactDoc> = {}): ArtifactDoc => ({
    kind, path: `${kind}/x.md`, exists: true, status, title: 'x', mtimeMs: NOW, sections: [], missingSections: [], checklist: { done: 0, total: 2 }, flaggedConcerns: 0, planFiles: ['src/a.ts'], issues: [], ...over,
  })

  test('semi mode chains every agent step and halts at each human gate, never passing one', () => {
    const rec = record()
    // The plan acceptance a human recorded; the plan reads in-progress/complete only after it.
    const accepted = recordApproval(rec, 'plan.accept', 'Ana', NOW)
    const review = { passes: ['Bugs', 'Security', 'Compliance'], importantOpen: 0, nits: 0, verdict: 'CLEAN' as const }
    const steps: { snapshot: RunSnapshot; code: string; kind: string }[] = [
      { snapshot: derive({}, rec), code: 'needs-human', kind: 'interview' },
      { snapshot: derive({ intent: doc('intent') }, rec), code: 'human-gate', kind: 'await-human' },
      { snapshot: derive({ intent: doc('intent', 'approved') }, rec), code: 'running', kind: 'draft-spec' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec') }, rec), code: 'human-gate', kind: 'await-human' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved') }, rec), code: 'running', kind: 'draft-plan' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan') }, rec), code: 'human-gate', kind: 'await-human' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'accepted') }, accepted), code: 'running', kind: 'implement' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'complete') }, accepted), code: 'running', kind: 'verify' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'complete'), proof: doc('proof') }, accepted, { proofVerdict: 'PASS' }), code: 'running', kind: 'review' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'complete'), proof: doc('proof'), review: doc('review') }, accepted, { proofVerdict: 'PASS', review }), code: 'human-gate', kind: 'release' },
      { snapshot: derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'complete'), proof: doc('proof'), review: doc('review') }, recordApproval(accepted, 'release.approve', 'Rita', NOW), { proofVerdict: 'PASS', review }), code: 'done', kind: 'monitor' },
    ]
    for (const [i, step] of steps.entries()) {
      const d = decide(step.snapshot)
      expect([i, d.code]).toEqual([i, step.code])
      expect([i, d.action?.kind]).toEqual([i, step.kind])
    }
  })

  test('with the agent blocked from fixing a failing proof, the verify-fail streak ends the autonomy', () => {
    let rec = recordApproval(record(), 'plan.accept', 'Ana', NOW)
    const failing = () => derive({ intent: doc('intent', 'approved'), spec: doc('spec', 'approved'), plan: doc('plan', 'complete'), proof: doc('proof') }, rec, { proofVerdict: 'FAIL' })
    expect(decide(failing())).toMatchObject({ kind: 'run', action: { kind: 'implement' } })
    for (let i = 0; i < 3; i++) rec = noteVerify(rec, false)
    expect(decide(failing())).toMatchObject({ kind: 'halt', code: 'verify-fail-streak' })
  })
})
