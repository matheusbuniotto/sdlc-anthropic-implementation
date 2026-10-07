// Stage derivation: where a run is in the Loop, computed from the committed
// artifacts (file exists + Status line) plus the little bookkeeping artifacts
// cannot hold. Pure: no I/O, time only through `now`. Git stays the source of truth.
//
// Doctrine encoded here: humans stay above the loop, the agent may act up to the
// production gate and cannot pass it, nothing is implemented without an accepted plan.

import type {
  ArtifactDoc,
  ArtifactKind,
  ArtifactStatus,
  GateId,
  GateReport,
  LoopConfig,
  NextAction,
  NextActionKind,
  PromptKey,
  Requirement,
  RunRecord,
  RunSnapshot,
  RunSource,
  RunSummary,
  StageId,
  StageSnapshot,
  StageState,
} from '../../types'
import { ALWAYS_HUMAN_GATES, GATE_DEFS, GATE_ORDER, STAGE_IDS, STAGE_META, STAGE_PLAYS } from './constants'

export type DeriveInput = {
  record: RunRecord
  docs: Partial<Record<ArtifactKind, ArtifactDoc>>
  proofVerdict: 'PASS' | 'FAIL' | null
  /** `nitOverflowSummarized` is what parseReview reports; without it a nit count over the cap fails the gate. */
  review: { passes: string[]; importantOpen: number; nits: number; verdict: 'CLEAN' | 'BLOCKED' | null; nitOverflowSummarized?: boolean } | null
  config: Pick<LoopConfig, 'autonomy' | 'review' | 'paths'>
  releaseGranted: boolean
  now: number
}

// A requirement plus the failure phrased as a problem, for `blockedBy`.
type Req = Requirement & { problem?: string }
// `veto`: the gate cannot be approved whatever else holds (a person said no, or the evidence it rests on went stale).
type Parts = { machine: Req[]; human: Req[]; humanOk: boolean; veto?: boolean }
type DocKind = 'intent' | 'spec' | 'plan'

const FILE: Record<DocKind, string> = { intent: 'intent.md', spec: 'spec.md', plan: 'plan.md' }
// REQUIRED_SECTIONS lives in artifacts.ts (not importable here): the counts only word the labels.
const SECTION_WORDS: Record<DocKind, string> = { intent: 'five', spec: 'six', plan: 'four' }
const ACCEPTED: readonly ArtifactStatus[] = ['accepted', 'in-progress', 'complete']

function req(by: Requirement['by'], id: string, label: string, ok: boolean, detail?: string, problem?: string): Req {
  const r: Req = { id, label, ok, by }
  if (detail) r.detail = detail
  if (problem) r.problem = problem
  return r
}

function absentDoc(kind: ArtifactKind, path: string): ArtifactDoc {
  return { kind, path, exists: false, status: 'missing', title: '', mtimeMs: 0, sections: [], missingSections: [], checklist: { done: 0, total: 0 }, flaggedConcerns: 0, planFiles: [], issues: [] }
}

function docOf(input: DeriveInput, kind: ArtifactKind): ArtifactDoc {
  return input.docs[kind] ?? absentDoc(kind, input.config.paths[kind].split('{slug}').join(input.record.slug))
}

function approvalNote(input: DeriveInput, gate: GateId): string | undefined {
  const a = input.record.approvals[gate]
  return a ? `Approved by ${a.by}` : undefined
}

function statusDetail(doc: ArtifactDoc, note?: string): string | undefined {
  if (!doc.exists) return undefined
  if (doc.status === 'rejected') return 'Rejected: rework it, then ask again'
  return note ?? `Status: ${doc.status}`
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

function docParts(kind: DocKind, input: DeriveInput): Req[] {
  const doc = docOf(input, kind)
  const file = FILE[kind]
  const errors = doc.issues.filter((i) => i.severity === 'error')
  const missing = doc.missingSections.join(', ')
  const parts: Req[] = [
    req('machine', 'exists', `${file} exists`, doc.exists, doc.path, `${file} has not been written yet`),
    req('machine', 'sections', `${file} has all ${SECTION_WORDS[kind]} sections`, doc.exists && doc.missingSections.length === 0, missing ? `Missing: ${missing}` : undefined, `${file} is missing ${missing || 'required sections'}`),
    req('machine', 'lint', `${file} has no lint errors`, doc.exists && errors.length === 0, errors[0]?.message, `${file} has errors: ${errors.map((i) => i.message).join('; ')}`),
    req('machine', 'placeholders', 'No template placeholders left', doc.exists && !doc.issues.some((i) => i.code === 'placeholder'), undefined, `${file} still contains template placeholders`),
  ]
  if (kind === 'spec') {
    const { done, total } = doc.checklist
    parts.push(req('machine', 'signoffs', 'Sign-off checklist is present', doc.exists && total > 0, total > 0 ? `${done}/${total} signed off` : undefined, 'spec.md has no sign-off checklist'))
  }
  if (kind === 'plan') {
    const n = doc.planFiles.length
    parts.push(req('machine', 'files', 'Files That Change lists at least one file', doc.exists && n > 0, n > 0 ? `${n} file${n === 1 ? '' : 's'}` : undefined, 'plan.md lists no files under "Files That Change"'))
  }
  return parts
}

function verifyParts(input: DeriveInput): Parts {
  const proof = docOf(input, 'proof')
  const p = input.record.proof
  const verdict = input.proofVerdict
  const fresh = proof.exists && proof.mtimeMs >= p.lastEditAt
  // lastEditAt 0: no source edit was tracked, so there is nothing to re-run after.
  const green = p.lastEditAt === 0 || (p.lastRunPassed === true && p.lastRunAt >= p.lastEditAt)
  const cmd = p.lastCommand || 'The test command'
  return {
    machine: [
      req('machine', 'exists', 'Proof report exists', proof.exists, proof.path, 'No proof report has been written yet'),
      req('machine', 'verdict', 'Verifier verdict is PASS', proof.exists && verdict === 'PASS', verdict ? `Verdict: ${verdict}` : 'No verdict line', verdict === 'FAIL' ? 'The verifier reported FAIL' : 'The proof has no PASS verdict'),
      req('machine', 'fresh', 'Nothing was edited after the proof', fresh, undefined, 'Source changed after the proof was written'),
      req('machine', 'green', 'Tests passed after the last edit', green, p.lastEditAt === 0 ? 'No edits tracked' : p.lastCommand || undefined, p.lastRunPassed === false ? `${cmd} failed on its last run` : 'Tests have not been re-run since the last edit'),
    ],
    human: [],
    humanOk: false,
  }
}

const norm = (s: string): string => s.replace(/[[\]]/g, '').trim().toLowerCase()

// Same freshness rule as the proof: source edited after the review makes it history, not evidence.
function reviewStale(input: DeriveInput): boolean {
  const doc = docOf(input, 'review')
  return doc.exists && doc.mtimeMs < input.record.proof.lastEditAt
}

function reviewParts(input: DeriveInput): Parts {
  const doc = docOf(input, 'review')
  const rev = input.review ?? { passes: [], importantOpen: 0, nits: 0, verdict: null }
  const cap = input.config.review.nitCap
  const have = new Set(rev.passes.map(norm))
  const missing = input.config.review.passes.map((p) => p.tag).filter((t) => !have.has(norm(t)))
  const nitsOk = rev.nits <= cap || rev.nitOverflowSummarized === true
  const open = rev.importantOpen
  const stale = reviewStale(input)
  return {
    veto: stale,
    machine: [
      req('machine', 'exists', 'Review file exists', doc.exists, doc.path, 'The three-pass review has not been written yet'),
      req('machine', 'fresh', 'Nothing was edited after the review', doc.exists && !stale, undefined, 'Source changed after the review was written'),
      req('machine', 'passes', `All ${input.config.review.passes.length} review passes are recorded`, doc.exists && missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : undefined, `The review lacks the ${missing.join(', ')} pass`),
      req('machine', 'important', 'No open Important findings', doc.exists && open === 0, open > 0 ? `${open} open` : undefined, `${open} Important finding${open === 1 ? ' is' : 's are'} still open`),
      req('machine', 'nits', `Nits stay within the cap of ${cap}`, doc.exists && nitsOk, `${rev.nits} nit${rev.nits === 1 ? '' : 's'}`, `${rev.nits} nits exceed the cap of ${cap}`),
      req('machine', 'verdict', 'Review verdict is not BLOCKED', doc.exists && rev.verdict !== 'BLOCKED', rev.verdict ? `Verdict: ${rev.verdict}` : undefined, 'The reviewer marked the change BLOCKED'),
    ],
    human: [],
    humanOk: false,
  }
}

function partsFor(id: GateId, input: DeriveInput): Parts {
  const approval = input.record.approvals[id]
  switch (id) {
    case 'intent.approve': {
      const doc = docOf(input, 'intent')
      const ok = doc.status === 'approved'
      return { machine: docParts('intent', input), human: [req('human', 'approved', 'Product owner approves intent.md', ok, statusDetail(doc, ok ? approvalNote(input, id) : undefined))], humanOk: ok, veto: doc.status === 'rejected' }
    }
    case 'spec.approve': {
      const doc = docOf(input, 'spec')
      const ok = doc.status === 'approved'
      const n = doc.flaggedConcerns
      // Open concerns never block readiness (the human resolves them) but the card must show them.
      const flagged = ok && n > 0 ? `${n} flagged concern${n === 1 ? '' : 's'} resolved at sign-off` : n > 0 ? `${n} flagged concern${n === 1 ? '' : 's'} to resolve` : 'No open flagged concerns'
      return {
        machine: docParts('spec', input),
        human: [
          req('human', 'flagged', flagged, ok || n === 0, n > 0 && !ok ? 'Resolve each with the policy owner before signing off' : undefined),
          req('human', 'approved', 'Product owner approves spec.md', ok, statusDetail(doc, ok ? approvalNote(input, id) : undefined)),
        ],
        humanOk: ok,
        veto: doc.status === 'rejected',
      }
    }
    case 'plan.accept': {
      const doc = docOf(input, 'plan')
      // The agent may legitimately write in-progress/complete itself, so those only
      // count once a human acceptance was recorded (the wiring records a hand-edited `accepted`).
      const ok = doc.status === 'accepted' || (ACCEPTED.includes(doc.status) && approval !== undefined)
      return { machine: docParts('plan', input), human: [req('human', 'accepted', 'Engineer accepts plan.md before any code', ok, statusDetail(doc, ok ? approvalNote(input, id) : undefined))], humanOk: ok, veto: doc.status === 'rejected' }
    }
    case 'verify.pass':
      return verifyParts(input)
    case 'review.pass':
      return reviewParts(input)
    case 'release.approve': {
      const review = evaluateGate('review.pass', input)
      const grant = input.releaseGranted
      return {
        machine: [req('machine', 'review-pass', 'Three-pass review is clean', review.approved, review.blockedBy[0], review.blockedBy[0] ?? 'The review has not been signed off')],
        human: [
          req('human', 'authorized', 'A named human authorizes the release', approval !== undefined, approval ? `Authorized by ${approval.by}` : undefined),
          req('human', 'grant', 'Release grant or RELEASE_APPROVAL token is live', grant, grant ? 'Production commands are unlocked' : 'Production commands stay blocked until a human grants'),
        ],
        humanOk: approval !== undefined,
        // No release on a review that is not (or no longer) passing.
        veto: !review.approved,
      }
    }
  }
}

const SIGNOFF: Record<'verify.pass' | 'review.pass', string> = { 'verify.pass': 'A human signs off the verification', 'review.pass': 'A human signs off the review' }

// config.autonomy.humanGates: a listed gate needs a person; release.approve always does.
// A gate not listed is auto-passed once its machine requirements hold: the human
// requirement is dropped and approval is implicit (approved === ready).
export function evaluateGate(id: GateId, input: DeriveInput): GateReport {
  const def = GATE_DEFS[id]
  const needsHuman = ALWAYS_HUMAN_GATES.includes(id) || input.config.autonomy.humanGates.includes(id)
  const parts = partsFor(id, input)
  if ((id === 'verify.pass' || id === 'review.pass') && needsHuman) {
    const signed = input.record.approvals[id]
    parts.human = [req('human', 'signoff', SIGNOFF[id], signed !== undefined, signed ? `Signed by ${signed.by}` : undefined)]
    parts.humanOk = signed !== undefined
  }
  const ready = parts.machine.every((r) => r.ok)
  const first = parts.machine[0]
  // A missing file fails every check; reporting only that one keeps the list useful.
  const failing = first && first.id === 'exists' && !first.ok ? [first] : parts.machine.filter((r) => !r.ok)
  const requirements: Requirement[] = [...parts.machine, ...(needsHuman ? parts.human : [])].map(({ problem: _p, ...r }) => r)
  return {
    id,
    stage: def.stage,
    label: def.label,
    kind: needsHuman ? 'human' : 'machine',
    requirements,
    ready,
    approved: (needsHuman ? parts.humanOk : ready) && !parts.veto,
    blockedBy: failing.map((r) => r.problem ?? r.label),
  }
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

const PENDING_TEXT: Record<StageId, string> = {
  plan: '',
  design: 'Starts when intent.md is approved.',
  build: 'Starts when spec.md is approved.',
  test: 'Starts when the plan is implemented and marked complete.',
  deploy: 'Starts when verification passes.',
  maintain: 'Starts once the release is out.',
}

function blockedText(gate: GateReport): string {
  const [first, ...rest] = gate.blockedBy
  if (!first) return 'a requirement is not met'
  return rest.length > 0 ? `${first} (+${rest.length} more)` : first
}

// Rework (Status rejected) wins over readiness: the human said no.
function docState(gate: GateReport, doc: ArtifactDoc): StageState {
  if (gate.approved) return 'done'
  if (doc.status === 'rejected') return 'active'
  return gate.ready ? 'awaiting-human' : 'active'
}

type CoreKind = 'intent' | 'spec' | 'plan' | 'proof' | 'review'
type Facts = { input: DeriveInput; gates: Record<GateId, GateReport>; docs: Record<CoreKind, ArtifactDoc>; reviewBlocked: boolean; verifyFailed: boolean }

function rawStates(f: Facts): Record<Exclude<StageId, 'maintain'>, StageState> {
  const g = f.gates
  const planDoc = f.docs.plan
  const review = g['review.pass']
  let deploy: StageState
  if (g['release.approve'].approved && review.approved) deploy = 'done'
  else if (!review.approved) deploy = f.reviewBlocked ? 'blocked' : review.ready ? 'awaiting-human' : 'active'
  else deploy = 'awaiting-human'
  let build: StageState = docState(g['plan.accept'], planDoc)
  if (build === 'done' && planDoc.status !== 'complete') build = 'active'
  let test: StageState
  if (g['verify.pass'].approved) test = 'done'
  else if (f.verifyFailed) test = 'blocked'
  else test = g['verify.pass'].ready ? 'awaiting-human' : 'active'
  return { plan: docState(g['intent.approve'], f.docs.intent), design: docState(g['spec.approve'], f.docs.spec), build, test, deploy }
}

function summaryFor(id: StageId, state: StageState, f: Facts): string {
  const g = f.gates
  const d = f.docs
  if (state === 'pending') return PENDING_TEXT[id]
  const rejected = (doc: ArtifactDoc, file: string) => (doc.status === 'rejected' ? `${file} was rejected and needs rework.` : null)
  switch (id) {
    case 'plan':
      if (state === 'done') {
        const by = f.input.record.approvals['intent.approve']?.by
        return by ? `intent.md approved by ${by}.` : 'intent.md approved.'
      }
      if (state === 'awaiting-human') return 'intent.md is complete and waits for the product owner.'
      if (!d.intent.exists) return 'No intent yet: the originator describes the problem and the agent interviews them.'
      return rejected(d.intent, 'intent.md') ?? `intent.md is not ready: ${blockedText(g['intent.approve'])}.`
    case 'design':
      if (state === 'done') return 'spec.md signed off.'
      if (state === 'awaiting-human') {
        const n = d.spec.flaggedConcerns
        return `spec.md is ready for sign-off${n > 0 ? ` with ${n} flagged concern${n === 1 ? '' : 's'} to resolve` : ''}.`
      }
      if (!d.spec.exists) return 'The agent drafts spec.md from the approved intent.'
      return rejected(d.spec, 'spec.md') ?? `spec.md is not ready: ${blockedText(g['spec.approve'])}.`
    case 'build':
      if (state === 'done') return 'The plan is implemented and marked complete.'
      if (state === 'awaiting-human') return 'plan.md is ready: no code is written until a human accepts it.'
      if (g['plan.accept'].approved) return 'plan.md is accepted: the agent implements it, then marks the plan complete.'
      if (!d.plan.exists) return 'The agent drafts plan.md; no code until a human accepts it.'
      return rejected(d.plan, 'plan.md') ?? `plan.md is not ready: ${blockedText(g['plan.accept'])}.`
    case 'test':
      if (state === 'done') return 'Verification passed on the final diff.'
      if (state === 'blocked') return 'The last verification failed: fix the code, never the tests, then verify again.'
      if (state === 'awaiting-human') return 'Verification passed and waits for a human sign-off.'
      if (!d.proof.exists) return 'The verifier has not reported yet.'
      return `Verification is not current: ${blockedText(g['verify.pass'])}.`
    case 'deploy': {
      if (state === 'done') {
        const by = f.input.record.approvals['release.approve']?.by
        return by ? `Release authorized by ${by}.` : 'Release authorized.'
      }
      if (state === 'blocked') {
        const n = f.input.review?.importantOpen ?? 0
        return n > 0 ? `${n} Important review finding${n === 1 ? '' : 's'} open: the agent fixes them before release.` : 'The reviewer marked the change BLOCKED.'
      }
      if (state === 'awaiting-human') return g['review.pass'].approved ? 'Review is clean: only a named human can authorize the release.' : 'The review waits for a human sign-off.'
      if (!d.review.exists) return 'The three-pass review has not run yet.'
      return `The review is not clean: ${blockedText(g['review.pass'])}.`
    }
    case 'maintain':
      return 'Monitoring: a control-band breach feeds a new intent.'
  }
}

const STAGE_GATES: Record<StageId, GateId[]> = {
  plan: ['intent.approve'],
  design: ['spec.approve'],
  build: ['plan.accept'],
  test: ['verify.pass'],
  deploy: ['review.pass', 'release.approve'],
  maintain: [],
}
const STAGE_ARTIFACT: Record<StageId, CoreKind | null> = { plan: 'intent', design: 'spec', build: 'plan', test: 'proof', deploy: 'review', maintain: null }

export function deriveRun(input: DeriveInput): RunSnapshot {
  const gates = Object.fromEntries(GATE_ORDER.map((id) => [id, evaluateGate(id, input)])) as Record<GateId, GateReport>
  const kinds: CoreKind[] = ['intent', 'spec', 'plan', 'proof', 'review']
  const docs = Object.fromEntries(kinds.map((k) => [k, docOf(input, k)])) as Record<CoreKind, ArtifactDoc>
  const rev = input.review
  // A blocked review that predates the latest edit is stale: review again rather than fix again.
  const reviewBlocked = docs.review.exists && !reviewStale(input) && rev !== null && (rev.importantOpen > 0 || rev.verdict === 'BLOCKED')
  // A FAIL older than the last edit is stale: the fix was made, so the next step is to verify again, not to fix again.
  const verifyFailed = docs.proof.exists && input.proofVerdict === 'FAIL' && docs.proof.mtimeMs >= input.record.proof.lastEditAt
  const facts: Facts = { input, gates, docs, reviewBlocked, verifyFailed }
  const raw = rawStates(facts)

  let prevDone = true
  const stages: StageSnapshot[] = STAGE_IDS.map((id) => {
    const state: StageState = !prevDone ? 'pending' : id === 'maintain' ? 'monitoring' : raw[id]
    prevDone = state === 'done'
    const meta = STAGE_META[id]
    const kind = STAGE_ARTIFACT[id]
    return {
      id,
      number: meta.number,
      name: meta.name,
      tagline: meta.tagline,
      state,
      artifacts: kind ? [docs[kind]] : [],
      gates: STAGE_GATES[id].map((g) => gates[g]),
      summary: summaryFor(id, state, facts),
      plays: [...STAGE_PLAYS[id]],
    }
  })

  const passed = stages.filter((s) => s.state !== 'pending').flatMap((s) => s.gates).filter((g) => g.approved).length
  return {
    record: input.record,
    stages,
    current: currentStage(stages),
    next: nextAction(stages, input.record, input.config),
    health: stages.some((s) => s.state === 'blocked') ? 'blocked' : stages.some((s) => s.state === 'awaiting-human') ? 'attention' : 'ok',
    progress: passed / GATE_ORDER.length,
  }
}

export function currentStage(stages: StageSnapshot[]): StageId {
  return (stages.find((s) => s.state !== 'done') ?? stages[stages.length - 1])?.id ?? 'plan'
}

// ---------------------------------------------------------------------------
// Next action
// ---------------------------------------------------------------------------

const AWAIT_LABEL: Record<GateId, string> = {
  'intent.approve': 'Approve intent.md',
  'spec.approve': 'Sign off spec.md',
  'plan.accept': 'Accept plan.md',
  'verify.pass': 'Sign off the verification',
  'review.pass': 'Sign off the review',
  'release.approve': 'Authorize the release',
}

export function nextAction(stages: StageSnapshot[], _record: RunRecord, config: Pick<LoopConfig, 'autonomy'>): NextAction {
  const stage = stages.find((s) => s.state !== 'done') ?? stages[stages.length - 1]
  const make = (kind: NextActionKind, id: StageId, label: string, reason: string, o: { gate?: GateId; promptKey?: PromptKey } = {}): NextAction => {
    const byHuman = kind === 'await-human' || kind === 'release'
    const action: NextAction = { kind, stage: id, label, reason, byHuman, auto: !byHuman && config.autonomy.autoKinds.includes(kind) }
    if (o.gate) action.gate = o.gate
    if (o.promptKey) action.promptKey = o.promptKey
    return action
  }
  if (!stage) return { kind: 'idle', stage: 'plan', label: 'Nothing to do', reason: 'The run has no stages.', byHuman: false, auto: false }
  const gate = (id: GateId) => stage.gates.find((g) => g.id === id)
  const doc = stage.artifacts[0]
  const id = stage.id
  const hold = (g: GateReport, file: string) => (doc?.status === 'rejected' ? `${file} was rejected; rework it.` : `${blockedText(g)}.`)

  if (stage.state === 'monitoring' || id === 'maintain') {
    return make('monitor', 'maintain', 'Watch the control bands', 'The release is out; a control-band breach opens an anomaly intent that restarts the loop.')
  }
  if (stage.state === 'pending') {
    return make('idle', id, 'Waiting', PENDING_TEXT[id] || 'An earlier stage has to finish first.')
  }

  switch (id) {
    case 'plan': {
      const g = gate('intent.approve')
      if (!doc?.exists) return make('interview', id, 'Interview the originator', 'There is no intent yet: capture it from the originator in their own words.', { promptKey: 'interview' })
      if (!g || !g.ready || doc.status === 'rejected') return make('interview', id, doc.status === 'rejected' ? 'Rework intent.md' : 'Finish intent.md', g ? hold(g, 'intent.md') : 'intent.md is not ready.', { promptKey: 'interview' })
      return make('await-human', id, AWAIT_LABEL['intent.approve'], 'intent.md is complete: the product owner decides whether it moves to Design.', { gate: 'intent.approve' })
    }
    case 'design': {
      const g = gate('spec.approve')
      if (!doc?.exists) return make('draft-spec', id, 'Draft spec.md', 'intent.md is approved: turn it into a spec, applying the policy skills.', { promptKey: 'draft-spec' })
      if (!g || !g.ready || doc.status === 'rejected') return make('draft-spec', id, doc.status === 'rejected' ? 'Rework spec.md' : 'Finish spec.md', g ? hold(g, 'spec.md') : 'spec.md is not ready.', { promptKey: 'draft-spec' })
      return make('await-human', id, AWAIT_LABEL['spec.approve'], 'spec.md is complete: a human signs it off and resolves its flagged concerns.', { gate: 'spec.approve' })
    }
    case 'build': {
      const g = gate('plan.accept')
      if (g?.approved) return make('implement', id, 'Implement the accepted plan', 'plan.md is accepted: implement it, keep the plan in sync, then mark it complete.', { promptKey: 'implement' })
      if (!doc?.exists) return make('draft-plan', id, 'Draft plan.md', 'spec.md is approved: write the plan before touching any code.', { promptKey: 'draft-plan' })
      if (!g || !g.ready || doc.status === 'rejected') return make('draft-plan', id, doc.status === 'rejected' ? 'Rework plan.md' : 'Finish plan.md', g ? hold(g, 'plan.md') : 'plan.md is not ready.', { promptKey: 'draft-plan' })
      return make('await-human', id, AWAIT_LABEL['plan.accept'], 'plan.md is complete: no code is written until a human accepts it.', { gate: 'plan.accept' })
    }
    case 'test': {
      const g = gate('verify.pass')
      if (stage.state === 'blocked') return make('implement', id, 'Fix the failing verification', 'The verifier reported FAIL: fix the implementation (never the tests), then verify again.', { promptKey: 'implement' })
      if (g && g.ready && !g.approved) return make('await-human', id, AWAIT_LABEL['verify.pass'], 'Verification passed: a human signs it off.', { gate: 'verify.pass' })
      const why = doc?.exists ? `The proof is not current: ${g ? blockedText(g) : 'a requirement is not met'}.` : 'There is no proof yet: have the verifier prove the change.'
      return make('verify', id, 'Verify the change', why, { promptKey: 'verify' })
    }
    case 'deploy': {
      const review = gate('review.pass')
      if (stage.state === 'blocked') return make('implement', id, 'Resolve the review findings', review ? `${blockedText(review)}.` : 'The review is blocked.', { promptKey: 'implement' })
      if (review && !review.approved) {
        if (review.ready) return make('await-human', id, AWAIT_LABEL['review.pass'], 'The review is clean: a human signs it off.', { gate: 'review.pass' })
        const why = doc?.exists ? `The review is not clean: ${blockedText(review)}.` : 'There is no review yet: run the three-pass review.'
        return make('review', id, 'Run the three-pass review', why, { promptKey: 'review' })
      }
      return make('release', id, AWAIT_LABEL['release.approve'], 'The review is clean: only a named human can authorize the release, and the agent cannot pass this gate.', { gate: 'release.approve' })
    }
  }
}

// ---------------------------------------------------------------------------
// Run records
// ---------------------------------------------------------------------------

export function newRunRecord(args: { slug: string; title: string; source: RunSource; now: number }): RunRecord {
  return {
    slug: args.slug,
    title: args.title,
    source: args.source,
    createdAt: args.now,
    approvals: {},
    fix: { active: false, reproCommitted: false },
    proof: { lastEditAt: 0, lastRunAt: 0, lastRunPassed: null, lastCommand: '' },
    edits: [],
    autoTurns: 0,
    blockStreak: 0,
    verifyFailStreak: 0,
    paused: false,
  }
}

export function recordApproval(record: RunRecord, gate: GateId, by: string, now: number, note?: string): RunRecord {
  const entry: { by: string; at: number; note?: string } = { by, at: now }
  if (note) entry.note = note
  return { ...record, approvals: { ...record.approvals, [gate]: entry } }
}

export function recordRejection(record: RunRecord, gate: GateId): RunRecord {
  const approvals = { ...record.approvals }
  delete approvals[gate]
  return { ...record, approvals, autoTurns: 0 }
}

export function statusForApproval(gate: GateId): { kind: ArtifactKind; status: ArtifactStatus } | null {
  switch (gate) {
    case 'intent.approve':
      return { kind: 'intent', status: 'approved' }
    case 'spec.approve':
      return { kind: 'spec', status: 'approved' }
    case 'plan.accept':
      return { kind: 'plan', status: 'accepted' }
    default:
      return null
  }
}

export function statusForRejection(gate: GateId): { kind: ArtifactKind; status: ArtifactStatus } | null {
  switch (gate) {
    case 'intent.approve':
      return { kind: 'intent', status: 'rejected' }
    case 'spec.approve':
      return { kind: 'spec', status: 'draft' }
    case 'plan.accept':
      return { kind: 'plan', status: 'draft' }
    default:
      return null
  }
}

export function summarizeRuns(snapshots: RunSnapshot[]): RunSummary[] {
  return snapshots.map((s) => ({
    slug: s.record.slug,
    title: s.record.title,
    current: s.current,
    health: s.health,
    progress: s.progress,
    source: s.record.source,
    createdAt: s.record.createdAt,
  }))
}
