// Shared plumbing of the reducers: an accumulator that collects effects while the model
// changes immutably, plus the small derivations (effective mode, prompt context, signatures).

import type { ArtifactKind, ArtifactStatus, GateId, LedgerEntry, LoopConfig, Mode, PathKey, PromptKey, RunRecord } from '../../types'
import { artifactPath } from './config'
import { PROMPT_STAGE, buildPrompt, type PromptContext } from './prompts'
import { quarantineKey, releaseOpen, snapshotFor } from './controller-ingest'
import type { Effect, Model, Quarantine, Reduced, RunState } from './controller-types'

export type Acc = { model: Model; effects: Effect[]; reply?: string }

export const start = (model: Model): Acc => ({ model, effects: [] })
export const done = (acc: Acc): Reduced => (acc.reply === undefined ? { model: acc.model, effects: acc.effects } : { model: acc.model, effects: acc.effects, reply: acc.reply })

export function say(acc: Acc, text: string): void {
  acc.reply = acc.reply === undefined ? text : `${acc.reply}\n${text}`
}

/** One local calendar day, YYYY-MM-DD: what artifacts and incident files are dated with. */
export function isoDate(now: number): string {
  const d = new Date(now)
  const p = (n: number): string => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** With Play 04 (auto mode and worktrees) not adopted, `semi` degrades to `guided`. */
export function effectiveMode(config: LoopConfig): Mode {
  return config.autonomy.mode === 'semi' && !config.plays.enabled.includes(4) ? 'guided' : config.autonomy.mode
}

export const runOf = (model: Model, slug: string | null): RunState | undefined => (slug === null ? undefined : model.runs.find(r => r.record.slug === slug))
export const activeRun = (model: Model): RunState | undefined => runOf(model, model.active)

export function quarantinesOf(model: Model, slug: string): Quarantine[] {
  return Object.values(model.runtime.quarantine).filter(q => q.slug === slug)
}

export function setRuntime(acc: Acc, patch: Partial<Model['runtime']>): void {
  acc.model = { ...acc.model, runtime: { ...acc.model.runtime, ...patch } }
}

export function note(acc: Acc, text: string, now: number): void {
  setRuntime(acc, { notice: text, noticeAt: now })
}

export function ledger(acc: Acc, e: Omit<LedgerEntry, 'ts'>, now: number): void {
  const entry: LedgerEntry = { ...e, ts: now }
  acc.effects.push({ t: 'ledger', entry })
  acc.model = { ...acc.model, ledger: [...acc.model.ledger, entry].slice(-2000) }
}

/** A toast at most once per `key` per `gapMs`. */
export function toast(acc: Acc, key: string, text: string, now: number, gapMs = 60_000): void {
  const last = acc.model.runtime.toastAt[key]
  if (last !== undefined && now - last < gapMs) return
  setRuntime(acc, { toastAt: { ...acc.model.runtime.toastAt, [key]: now } })
  acc.effects.push({ t: 'toast', text })
}

/** Replace a run's state (re-deriving the snapshot) and queue its record for saving. */
export function putRun(acc: Acc, slug: string, change: (s: RunState) => RunState, now: number, save = true): RunState | undefined {
  const cur = runOf(acc.model, slug)
  if (!cur) return undefined
  const next = change(cur)
  const snapshot = snapshotFor(acc.model.config, next, quarantinesOf(acc.model, slug), releaseOpen(acc.model.runtime, now), now)
  const state: RunState = { ...next, snapshot }
  acc.model = { ...acc.model, runs: acc.model.runs.map(r => (r.record.slug === slug ? state : r)) }
  if (save) {
    acc.effects = acc.effects.filter(e => !(e.t === 'saveRun' && e.record.slug === slug))
    acc.effects.push({ t: 'saveRun', record: state.record })
  }
  return state
}

export function updateRecord(acc: Acc, slug: string, fn: (r: RunRecord) => RunRecord, now: number): RunState | undefined {
  return putRun(acc, slug, s => ({ ...s, record: fn(s.record) }), now)
}

/** Predict a status the wiring is about to write, so the snapshot reflects it before the next disk read. */
export function withDocStatus(s: RunState, kind: ArtifactKind, status: ArtifactStatus): RunState {
  const doc = s.docs[kind]
  return doc ? { ...s, docs: { ...s.docs, [kind]: { ...doc, status } } } : s
}

export function dropQuarantine(acc: Acc, slug: string, gate: GateId): void {
  const key = quarantineKey(slug, gate)
  if (acc.model.runtime.quarantine[key] === undefined) return
  const q = { ...acc.model.runtime.quarantine }
  delete q[key]
  setRuntime(acc, { quarantine: q })
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

/** What the human wrote when they last sent a gate back, until that gate is approved. */
export function pendingFeedback(model: Model, slug: string): string | undefined {
  let rejected: LedgerEntry | undefined
  for (const e of model.ledger) {
    if (e.kind === 'gate.rejected' && e.run === slug && e.actor === 'human' && typeof e.data?.reason === 'string') rejected = e
  }
  if (!rejected) return undefined
  const gate = rejected.data?.gate
  const at = rejected.ts
  const approved = model.ledger.some(e => e.kind === 'gate.approved' && e.run === slug && e.data?.gate === gate && e.ts > at)
  return approved ? undefined : String(rejected.data?.reason)
}

export function promptContext(model: Model, run: RunState, key: PromptKey, now: number, extra: { notes?: string; gateFeedback?: string } = {}): PromptContext {
  const c = model.config
  const slug = run.record.slug
  const date = isoDate(now)
  const p = (k: PathKey): string => artifactPath(c, k, { slug, date })
  const stage = run.snapshot.stages.find(s => s.id === run.snapshot.current)
  const blockedBy = (stage?.gates ?? []).flatMap(g => g.blockedBy)
  const ctx: PromptContext = {
    slug,
    title: run.record.title,
    date,
    stage: PROMPT_STAGE[key],
    paths: {
      intent: p('intent'),
      spec: p('spec'),
      plan: p('plan'),
      proof: p('proof'),
      review: p('review'),
      claudeMd: p('claudeMd'),
      reviewPolicy: p('reviewPolicy'),
      incident: p('incident'),
      lesson: p('lesson'),
      eval: p('eval'),
    },
    policySkills: c.policySkills,
    knowledgeRoot: c.knowledge.root,
    verifyCommands: c.verify.commands,
    nitCap: c.review.nitCap,
    reviewPasses: c.review.passes,
  }
  const planFiles = run.docs.plan?.planFiles ?? []
  if (planFiles.length > 0) ctx.planFiles = planFiles
  if (blockedBy.length > 0) ctx.blockedBy = blockedBy
  if (extra.notes) ctx.notes = extra.notes
  const feedback = extra.gateFeedback ?? pendingFeedback(model, slug)
  if (feedback) ctx.gateFeedback = feedback
  return ctx
}

/** A fingerprint of everything an agent turn can change: equal before and after means it achieved nothing. */
export function runSig(run: RunState): string {
  const r = run.record
  const docs = Object.values(run.docs).map(d => `${d.kind}:${d.exists ? d.mtimeMs : 0}:${d.status}`)
  return JSON.stringify([run.snapshot.next.kind, run.snapshot.current, r.edits.length, r.proof.lastRunAt, r.proof.lastEditAt, Object.keys(r.approvals).length, docs])
}

/** Queue a stage prompt for `run`: ledger it, remember it is in flight, hand the text to the wiring. */
export function queuePrompt(acc: Acc, run: RunState, key: PromptKey, by: 'autopilot' | 'human', now: number, extra: { notes?: string; gateFeedback?: string } = {}): void {
  const slug = run.record.slug
  const ctx = promptContext(acc.model, run, key, now, extra)
  const text = buildPrompt(key, ctx, acc.model.promptOverrides)
  acc.effects.push({ t: 'prompt', key, text, slug, by })
  const halted = { ...acc.model.runtime.halted }
  delete halted[slug]
  setRuntime(acc, { pending: { slug, sig: runSig(run), key, at: now }, halted })
  ledger(
    acc,
    {
      kind: 'autopilot.queued',
      run: slug,
      stage: run.snapshot.current,
      actor: by === 'human' ? 'human' : 'mod',
      summary: `${by === 'human' ? 'Queued' : 'Autopilot queued'} the ${key} step: ${run.snapshot.next.label}`,
      data: { action: key, via: by },
    },
    now,
  )
}
