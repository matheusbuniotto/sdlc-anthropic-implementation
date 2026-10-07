// Gates: who may pass them and the bookkeeping around them. A human gate is passed by a
// person (a command, a press) or by a person editing the artifact; the mod records every
// one. An approval the files claim but the mod cannot vouch for is quarantined (see ingest).

import type { GateId, GateReport, GuardVerdict, PromptKey, RunSnapshot, StageSnapshot } from '../../types'
import { noteBlock, resetBudget } from './autopilot'
import { afterHumanGate } from './controller-autopilot'
import { quarantineKey, quarantineNote, type Finding } from './controller-ingest'
import {
  activeRun,
  dropQuarantine,
  effectiveMode,
  ledger,
  note,
  putRun,
  queuePrompt,
  runOf,
  say,
  setRuntime,
  toast,
  updateRecord,
  withDocStatus,
  type Acc,
} from './controller-kit'
import type { Model, Via } from './controller-types'
import { GATE_DEFS, GUARD_DEFS } from './constants'
import { recordApproval, recordRejection, statusForApproval, statusForRejection } from './stages'

export function findGate(snap: RunSnapshot, id: GateId): { report: GateReport; stage: StageSnapshot } | undefined {
  for (const stage of snap.stages) {
    const report = stage.gates.find(g => g.id === id)
    if (report) return { report, stage }
  }
  return undefined
}

/** The human gate a person can pass right now: the current stage's first, else any open one. */
export function waitingGate(snap: RunSnapshot): GateId | undefined {
  const open = (s: StageSnapshot): GateReport | undefined => s.gates.find(g => g.kind === 'human' && g.ready && !g.approved)
  const here = snap.stages.find(s => s.id === snap.current)
  return (here && open(here)?.id) ?? snap.stages.filter(s => s.state !== 'pending').map(open).find(Boolean)?.id
}

/** The stage prompt that reworks a gate's artifact. A rejected spec or plan reads as a finished draft again, so the next action alone cannot say. */
const REDRAFT: Partial<Record<GateId, PromptKey>> = {
  'intent.approve': 'interview',
  'spec.approve': 'draft-spec',
  'plan.accept': 'draft-plan',
  'verify.pass': 'verify',
  'review.pass': 'review',
}

const artifactPathOf = (snap: RunSnapshot, gate: GateId): string | undefined => {
  const kind = GATE_DEFS[gate].artifact
  return kind ? snap.stages.flatMap(s => s.artifacts).find(a => a.kind === kind)?.path : undefined
}

// ---------------------------------------------------------------------------
// approve / reject
// ---------------------------------------------------------------------------

export function approve(acc: Acc, gate: GateId | null, now: number, via: Via, author: string): void {
  const run = activeRun(acc.model)
  if (!run) return say(acc, 'There is no active run. Start one with /sdlc new <idea>.')
  const snap = run.snapshot
  const target = gate ?? snap.next.gate ?? waitingGate(snap)
  if (!target) return say(acc, `Nothing waits for your approval. ${snap.next.reason}`)
  if (target === 'release.approve') return releaseGrant(acc, undefined, now, via, author)
  const found = findGate(snap, target)
  if (!found) return say(acc, `Gate ${target} does not exist on this run.`)
  const { report, stage } = found
  if (report.kind !== 'human') return say(acc, `${target} is a machine gate: it passes by itself once its checks hold${report.blockedBy.length ? ` (now: ${report.blockedBy.join('; ')})` : ''}.`)
  if (report.approved) return say(acc, `${target} is already approved.`)
  if (stage.state === 'pending') return say(acc, `${target} is not open yet: ${stage.summary}`)
  if (!report.ready) return say(acc, `${target} is not ready for you: ${report.blockedBy.join('; ') || 'a machine check fails'}.`)

  const slug = run.record.slug
  const by = author.trim() || 'human'
  const edit = statusForApproval(target)
  dropQuarantine(acc, slug, target)
  updateRecord(acc, slug, r => resetBudget(recordApproval(r, target, by, now, via === 'press' ? 'pressed in the pane' : undefined)), now)
  const path = artifactPathOf(snap, target)
  // A plan the agent already moved on (in-progress, complete) keeps its status: only the record is missing.
  const beyond = edit?.kind === 'plan' && ['in-progress', 'complete'].includes(run.docs.plan?.status ?? '')
  if (edit && path && !beyond) {
    acc.effects.push({ t: 'edit', path, edit: { kind: 'status', artifact: edit.kind, status: edit.status } })
    putRun(acc, slug, s => withDocStatus(s, edit.kind, edit.status), now, false)
  }
  ledger(
    acc,
    { kind: 'gate.approved', run: slug, stage: report.stage, actor: 'human', summary: `${by} approved ${target}: ${report.label}`, data: { gate: target, by, via, ...(path ? { path } : {}) } },
    now,
  )
  acc.effects.push({ t: 'refresh' })
  say(acc, `Approved ${target}.`)
  note(acc, `Approved ${target}`, now)
  afterHumanGate(acc, slug, now)
}

export function reject(acc: Acc, gate: GateId | null, reason: string, now: number, via: Via, author: string): void {
  const run = activeRun(acc.model)
  if (!run) return say(acc, 'There is no active run. Start one with /sdlc new <idea>.')
  const text = reason.trim()
  if (text === '') return say(acc, 'Say why, so the agent can redraft: /sdlc reject [gate] <reason>.')
  const snap = run.snapshot
  const target = gate ?? snap.next.gate ?? waitingGate(snap)
  if (!target) return say(acc, 'Nothing waits for your decision.')
  if (target === 'release.approve') return say(acc, 'There is no release to reject: nothing is authorized. /sdlc release revoke takes back a live grant.')
  const found = findGate(snap, target)
  if (!found) return say(acc, `Gate ${target} does not exist on this run.`)
  if (found.report.kind !== 'human') return say(acc, `${target} is a machine gate; rework the artifact instead.`)
  if (found.stage.state === 'pending') return say(acc, `${target} is not open yet.`)

  const slug = run.record.slug
  const by = author.trim() || 'human'
  const edit = statusForRejection(target)
  dropQuarantine(acc, slug, target)
  updateRecord(acc, slug, r => recordRejection(r, target), now)
  const path = artifactPathOf(snap, target)
  if (edit && path) {
    acc.effects.push({ t: 'edit', path, edit: { kind: 'status', artifact: edit.kind, status: edit.status } })
    putRun(acc, slug, s => withDocStatus(s, edit.kind, edit.status), now, false)
  }
  ledger(
    acc,
    { kind: 'gate.rejected', run: slug, stage: found.report.stage, actor: 'human', summary: `${by} rejected ${target}: ${text}`, data: { gate: target, by, via, reason: text, ...(path ? { path } : {}) } },
    now,
  )
  acc.effects.push({ t: 'refresh' })
  note(acc, `Rejected ${target}`, now)
  const next = runOf(acc.model, slug)
  const key = REDRAFT[target]
  if (next && key && effectiveMode(acc.model.config) !== 'manual') {
    queuePrompt(acc, next, key, 'human', now, { gateFeedback: text })
    say(acc, `Rejected ${target}. Queued a redraft with your feedback.`)
  } else {
    say(acc, `Rejected ${target}. Your feedback is in the ledger; ask the agent to rework it.`)
  }
}

// ---------------------------------------------------------------------------
// The release grant (Play 11): a window in host memory, never a file
// ---------------------------------------------------------------------------

export function releaseGrant(acc: Acc, minutes: number | undefined, now: number, via: Via, author: string): void {
  const mins = minutes ?? acc.model.config.guards.grantMinutes
  const until = now + mins * 60_000
  const by = author.trim() || 'human'
  acc.effects.push({ t: 'grant', until })
  setRuntime(acc, { grantUntil: until })
  ledger(acc, { kind: 'release.granted', actor: 'human', summary: `${by} granted a ${mins}-minute release window`, data: { minutes: mins, until, by, via } }, now)
  note(acc, `Release grant for ${mins} min`, now)
  const run = activeRun(acc.model)
  const found = run ? findGate(run.snapshot, 'release.approve') : undefined
  if (!run || !found || !found.report.ready || found.report.approved) {
    return say(acc, `Release grant live for ${mins} minutes: production commands are unlocked until then.${run ? '' : ' (No run is waiting for release.)'}`)
  }
  const slug = run.record.slug
  updateRecord(acc, slug, r => resetBudget(recordApproval(r, 'release.approve', by, now, `grant ${mins}m`)), now)
  ledger(acc, { kind: 'gate.approved', run: slug, stage: 'deploy', actor: 'human', summary: `${by} authorized the release`, data: { gate: 'release.approve', by, via, minutes: mins } }, now)
  acc.effects.push({ t: 'refresh' })
  const mode = effectiveMode(acc.model.config)
  const fresh = runOf(acc.model, slug)
  if (mode !== 'manual' && fresh) {
    queuePrompt(acc, fresh, 'release', 'human', now)
    say(acc, `Release authorized by ${by} for ${mins} minutes. The agent was told it may deploy inside the window.`)
  } else {
    say(acc, `Release authorized by ${by} for ${mins} minutes (manual mode: you run the deploy).`)
  }
}

export function releaseRevoke(acc: Acc, now: number, by: string, why: 'human' | 'expired'): void {
  acc.effects.push({ t: 'grant', until: null })
  const had = acc.model.runtime.grantUntil !== null
  setRuntime(acc, { grantUntil: null })
  if (why === 'human') {
    ledger(acc, { kind: 'release.revoked', actor: 'human', summary: `${by || 'A human'} revoked the release window`, data: { by: by || 'human', reason: 'revoked' } }, now)
    say(acc, had ? 'Release grant revoked: production commands are blocked again.' : 'There was no live grant.')
    if (acc.model.runtime.envToken) say(acc, 'RELEASE_APPROVAL is still set in the environment; unset it to lock production.')
  } else {
    ledger(acc, { kind: 'release.revoked', actor: 'mod', summary: 'The release window expired', data: { reason: 'expired' } }, now)
    toast(acc, 'grant-expired', 'Release grant expired: production commands are blocked again.', now)
  }
}

// ---------------------------------------------------------------------------
// After every refresh
// ---------------------------------------------------------------------------

function lastTs(model: Model, run: string, gate: GateId, kinds: string[]): number {
  let ts = -1
  for (const e of model.ledger) {
    if (e.run === run && kinds.includes(e.kind) && e.data?.gate === gate) ts = Math.max(ts, e.ts)
  }
  return ts
}

const gateFile = (snap: RunSnapshot, gate: GateId): string => (gate === 'release.approve' ? 'the release' : (artifactPathOf(snap, gate) ?? gate))

/** Grant expiry, quarantines, implicit approvals, machine gate passes, stage changes, newly open gates. */
export function afterIngest(acc: Acc, prev: Model | undefined, findings: Finding[], now: number): void {
  const startup = prev === undefined
  const grant = acc.model.runtime.grantUntil
  if (grant !== null && grant <= now) releaseRevoke(acc, now, '', 'expired')

  for (const f of findings) {
    const run = runOf(acc.model, f.slug)
    if (!run) continue
    if (f.verdict === 'quarantine') {
      const text = quarantineNote(f.path, f.gate)
      ledger(acc, { kind: 'guard.blocked', run: f.slug, stage: GATE_DEFS[f.gate].stage, actor: 'mod', summary: text, data: { guard: 'gate-integrity', gate: f.gate, quarantine: true, path: f.path } }, now)
      toast(acc, `quarantine:${quarantineKey(f.slug, f.gate)}`, text, now, 600_000)
      note(acc, text, now)
      continue
    }
    updateRecord(acc, f.slug, r => resetBudget(recordApproval(r, f.gate, 'file', now, 'status edited in the file')), now)
    ledger(acc, { kind: 'gate.approved', run: f.slug, stage: GATE_DEFS[f.gate].stage, actor: 'human', summary: `${f.path} was approved in the file (${f.gate})`, data: { gate: f.gate, by: 'file', via: 'file', path: f.path } }, now)
    acc.effects.push({ t: 'refresh' })
    if (!startup && f.slug === acc.model.active) afterHumanGate(acc, f.slug, now)
  }

  for (const run of acc.model.runs) {
    const slug = run.record.slug
    const snap = run.snapshot
    const was = prev?.runtime.stageOf[slug]
    if (was !== undefined && was !== snap.current) {
      ledger(acc, { kind: 'stage.entered', run: slug, stage: snap.current, actor: 'mod', summary: `${slug} entered ${snap.current}`, data: { from: was } }, now)
    }
    for (const stage of snap.stages) {
      if (stage.state === 'pending') continue
      for (const gate of stage.gates) {
        const key = `${slug}:${gate.id}`
        if (gate.kind === 'machine') {
          const before = prev?.runtime.passed[key]
          const hasEntry = acc.model.ledger.some(e => e.kind === 'gate.approved' && e.run === slug && e.data?.gate === gate.id)
          if (gate.approved && (prev ? before === false : !hasEntry)) {
            ledger(acc, { kind: 'gate.approved', run: slug, stage: gate.stage, actor: 'mod', summary: `${gate.id} passed its machine checks`, data: { gate: gate.id, via: 'auto' } }, now)
          }
          continue
        }
        if (!gate.ready || gate.approved || acc.model.runtime.quarantine[key]) continue
        const opened = lastTs(acc.model, slug, gate.id, ['gate.opened'])
        const closed = Math.max(lastTs(acc.model, slug, gate.id, ['gate.approved', 'gate.rejected']), quarantineTs(acc.model, slug, gate.id))
        if (opened !== -1 && opened >= closed) continue
        ledger(acc, { kind: 'gate.opened', run: slug, stage: gate.stage, actor: 'mod', summary: `${gate.id} is ready for a human: ${gateFile(snap, gate.id)}`, data: { gate: gate.id } }, now)
        const what = gate.id === 'release.approve' ? 'The release awaits your authorization: /sdlc release grant' : `${gateFile(snap, gate.id)} is ready for your sign-off: /sdlc approve ${gate.id}`
        toast(acc, `gate:${slug}:${gate.id}`, what, now)
      }
    }
  }
}

function quarantineTs(model: Model, run: string, gate: GateId): number {
  let ts = -1
  for (const e of model.ledger) if (e.kind === 'guard.blocked' && e.run === run && e.data?.quarantine === true && e.data.gate === gate) ts = Math.max(ts, e.ts)
  return ts
}

/** A guard stopped the agent: ledger it, count it toward the block streak, toast (rate limited). */
export function blocked(acc: Acc, a: { now: number; tool: string; verdict: Extract<GuardVerdict, { allow: false }> }): void {
  const { verdict, now } = a
  const run = activeRun(acc.model)
  ledger(
    acc,
    {
      kind: 'guard.blocked',
      ...(run ? { run: run.record.slug, stage: run.snapshot.current } : {}),
      actor: 'mod',
      summary: verdict.message,
      data: { guard: verdict.guard, play: verdict.play, tool: a.tool, ...(verdict.match ? { match: verdict.match } : {}) },
    },
    now,
  )
  if (run) updateRecord(acc, run.record.slug, noteBlock, now)
  const why = (verdict.message.split('\n')[0] ?? '').replace(/^okf-loop · Play \d+ · [^:]+:\s*/, '')
  toast(acc, `guard:${verdict.guard}`, `${GUARD_DEFS[verdict.guard].label} stopped the agent: ${why}`, now)
}
