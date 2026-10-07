// Autopilot: the decision to queue the agent's next step or stop and hand over.
// Pure and deterministic. The doctrine: it may chain every non-human step,
// but it halts at the next human gate, on budget, on streaks, or when paused.
// Callers pass the *effective* mode: with Play 04 disabled, `semi` degrades to `guided` upstream.

import type { AutopilotView, GateId, LoopConfig, Mode, NextAction, RunRecord, RunSnapshot } from '../../types'

export type AutopilotDecision =
  | { kind: 'run'; action: NextAction; code: 'running'; reason: string }
  | { kind: 'suggest'; action: NextAction; code: 'guided'; reason: string }
  | {
      kind: 'halt'
      code: 'manual' | 'paused' | 'human-gate' | 'needs-human' | 'budget' | 'blocked-streak' | 'verify-fail-streak' | 'no-run' | 'done'
      reason: string
      action?: NextAction
    }

type Autonomy = Pick<LoopConfig, 'autonomy'>

const GATE_WAIT: Record<GateId, string> = {
  'intent.approve': 'the product owner to approve intent.md',
  'spec.approve': 'a human to sign off spec.md and its flagged concerns',
  'plan.accept': 'a human to accept plan.md before any code is written',
  'verify.pass': 'a human to sign off the verification',
  'review.pass': 'a human to sign off the review',
  'release.approve': 'a named human to authorize the release',
}

function isHumanStep(action: NextAction): boolean {
  return action.byHuman || action.kind === 'await-human' || action.kind === 'release'
}

export function decideAutopilot(args: { snapshot: RunSnapshot | null; config: Autonomy; mode: Mode }): AutopilotDecision {
  const { snapshot, config, mode } = args
  if (!snapshot) return { kind: 'halt', code: 'no-run', reason: 'There is no active run: describe a change with /sdlc new to start the loop.' }
  const { next, record } = snapshot
  const a = config.autonomy
  const halt = (code: Extract<AutopilotDecision, { kind: 'halt' }>['code'], reason: string): AutopilotDecision => ({ kind: 'halt', code, reason, action: next })

  if (mode === 'manual') return halt('manual', 'Manual mode: the mod only guards and records, so nothing is queued for you.')
  if (record.paused) return halt('paused', `Autopilot is paused on "${record.slug}"; resume it to continue.`)
  if (snapshot.stages.every((s) => s.state === 'done' || s.state === 'monitoring')) {
    return halt('done', 'Every stage is done: the change is released and now under monitoring.')
  }
  if (isHumanStep(next)) {
    const wait = next.gate ? GATE_WAIT[next.gate] : 'a human decision'
    return halt('human-gate', `Halted at a human gate: waiting for ${wait}.`)
  }
  if (!next.auto) {
    if (mode === 'guided') return { kind: 'suggest', action: next, code: 'guided', reason: `Next step: ${next.label}. ${next.reason}` }
    const why = next.kind === 'interview'
      ? 'the intent has to come from the originator, so autopilot waits for you to describe or answer the interview'
      : `"${next.label}" is not an unattended step in this configuration`
    return halt('needs-human', `Autopilot needs you here: ${why}.`)
  }
  if (record.autoTurns >= a.maxAutoTurns) {
    return halt('budget', `Autopilot used its ${a.maxAutoTurns} turns since the last human gate; run /sdlc next to continue or raise autonomy.maxAutoTurns.`)
  }
  if (record.blockStreak >= a.haltOnBlocks) {
    return halt('blocked-streak', `Halted after ${record.blockStreak} guard blocks in a row (limit ${a.haltOnBlocks}): check what the agent keeps attempting.`)
  }
  if (record.verifyFailStreak >= a.haltOnVerifyFails) {
    return halt('verify-fail-streak', `Halted after ${record.verifyFailStreak} failed verifications in a row (limit ${a.haltOnVerifyFails}): fix the cause or revise the plan.`)
  }
  if (mode === 'guided') return { kind: 'suggest', action: next, code: 'guided', reason: `Next step: ${next.label}. ${next.reason}` }
  return { kind: 'run', action: next, code: 'running', reason: `${next.label}: ${next.reason}` }
}

export function consumeTurn(record: RunRecord): RunRecord {
  return { ...record, autoTurns: record.autoTurns + 1 }
}

// After a human gate: the person has spoken, so the agent gets a fresh budget.
export function resetBudget(record: RunRecord): RunRecord {
  return { ...record, autoTurns: 0, blockStreak: 0, verifyFailStreak: 0 }
}

export function noteBlock(record: RunRecord): RunRecord {
  return { ...record, blockStreak: record.blockStreak + 1 }
}

export function noteGoodStep(record: RunRecord): RunRecord {
  return { ...record, blockStreak: 0 }
}

export function noteVerify(record: RunRecord, passed: boolean): RunRecord {
  return { ...record, verifyFailStreak: passed ? 0 : record.verifyFailStreak + 1 }
}

export function autopilotView(args: { decision: AutopilotDecision | null; record: RunRecord | null; config: Autonomy; mode: Mode }): AutopilotView {
  const { decision, record, config, mode } = args
  const budgetMax = config.autonomy.maxAutoTurns
  const budgetLeft = Math.max(0, budgetMax - (record?.autoTurns ?? 0))
  const paused = record?.paused ?? false
  if (!decision) {
    return { mode, paused, budgetLeft, budgetMax, state: 'idle', reason: record ? 'Autopilot has not looked at this run yet.' : 'There is no active run.' }
  }
  return { mode, paused, budgetLeft, budgetMax, state: decision.code, reason: decision.reason }
}
