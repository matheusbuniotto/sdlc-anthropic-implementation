// The autopilot's side of the controller: what to do after a human gate, at the end of an
// agent turn, and when a person forces the next step. decideAutopilot (autopilot.ts) is the
// pure decision; this turns it into ledger entries, toasts and queued prompts.

import type { GateId } from '../../types'
import { consumeTurn, decideAutopilot, noteVerify, type AutopilotDecision } from './autopilot'
import { effectiveMode, activeRun, ledger, note, queuePrompt, runOf, runSig, say, setRuntime, toast, updateRecord, type Acc } from './controller-kit'
import type { Model, RunState } from './controller-types'

/** A queued prompt unanswered this long is assumed lost (a /clear, a reload) and no longer blocks the autopilot. */
const PENDING_STALE_MS = 30 * 60_000

export const decisionFor = (model: Model, run: RunState | undefined): AutopilotDecision =>
  decideAutopilot({ snapshot: run?.snapshot ?? null, config: model.config, mode: effectiveMode(model.config) })

const gateHelp = (gate: GateId | undefined): string =>
  gate === 'release.approve' ? '/sdlc release grant (or the Authorize button)' : `/sdlc approve${gate ? ` ${gate}` : ''} (or the Approve button)`

/** Say why the autopilot stopped: once per distinct code, a toast when a person must act. */
function announceHalt(acc: Acc, run: RunState, d: Extract<AutopilotDecision, { kind: 'halt' }>, chain: boolean, now: number): void {
  const slug = run.record.slug
  if (!chain && d.code !== 'human-gate') return
  if (acc.model.runtime.halted[slug] === d.code) return
  setRuntime(acc, { halted: { ...acc.model.runtime.halted, [slug]: d.code } })
  ledger(
    acc,
    { kind: 'autopilot.halted', run: slug, stage: run.snapshot.current, actor: 'mod', summary: d.reason, data: { code: d.code, ...(d.action ? { action: d.action.kind } : {}) } },
    now,
  )
  const gate = d.action?.gate
  if (d.code === 'human-gate') {
    const doc = gate && d.action ? run.snapshot.stages.find(s => s.id === d.action?.stage)?.artifacts[0] : undefined
    const what = gate === 'release.approve' ? 'The release awaits your authorization' : `${doc?.exists ? doc.path : 'The next artifact'} is ready for your sign-off`
    toast(acc, `gate:${slug}:${gate ?? 'human'}`, `${what}: ${gateHelp(gate)}`, now)
  } else if (d.code === 'budget' || d.code === 'blocked-streak' || d.code === 'verify-fail-streak') {
    toast(acc, `halt:${slug}:${d.code}`, `Autopilot stopped: ${d.reason}`, now)
  }
}

function haltNow(acc: Acc, run: RunState, code: string, reason: string, now: number): void {
  const slug = run.record.slug
  if (acc.model.runtime.halted[slug] === code) return
  setRuntime(acc, { halted: { ...acc.model.runtime.halted, [slug]: code } })
  ledger(acc, { kind: 'autopilot.halted', run: slug, stage: run.snapshot.current, actor: 'mod', summary: reason, data: { code } }, now)
  toast(acc, `halt:${slug}:${code}`, `Autopilot stopped: ${reason}`, now)
}

/** A human gate just passed (or autopilot was resumed): start the next step in semi, suggest it in guided. */
export function afterHumanGate(acc: Acc, slug: string, now: number): void {
  const run = runOf(acc.model, slug)
  if (!run) return
  const d = decisionFor(acc.model, run)
  const inFlight = acc.model.runtime.pending
  if (d.kind === 'run' && inFlight !== null && now - inFlight.at < PENDING_STALE_MS) {
    // One step at a time: the queued prompt has not been answered yet.
    return say(acc, 'The agent is still on the step already queued; the autopilot continues when it ends.')
  }
  if (d.kind === 'run') {
    const next = d.action
    const bumped = updateRecord(acc, slug, consumeTurn, now)
    if (bumped && next.promptKey) {
      queuePrompt(acc, bumped, next.promptKey, 'autopilot', now)
      say(acc, `Autopilot queued: ${next.label}.`)
    }
  } else if (d.kind === 'suggest') {
    say(acc, `Next step: ${d.action.label}. Run /sdlc next to start it.`)
    note(acc, `Next: ${d.action.label}`, now)
  } else if (d.kind === 'halt') {
    announceHalt(acc, run, d, false, now)
    if (d.code === 'human-gate' || d.code === 'needs-human') say(acc, d.reason)
  }
}

/** Count a failed verification the verifier reported in its proof file, unless a failing proof command already was. */
function bookkeepVerify(acc: Acc, run: RunState, now: number): void {
  const doc = run.docs.proof
  const slug = run.record.slug
  if (!doc || !doc.exists || run.proofVerdict === null) return
  const prior = acc.model.runtime.countedProof[slug] ?? 0
  if (doc.mtimeMs <= prior) return
  setRuntime(acc, { countedProof: { ...acc.model.runtime.countedProof, [slug]: doc.mtimeMs } })
  if (run.proofVerdict === 'PASS') {
    updateRecord(acc, slug, r => noteVerify(r, true), now)
    return
  }
  const tracked = acc.model.ledger.some(e => e.kind === 'proof.fail' && e.run === slug && e.ts > prior && e.ts >= doc.mtimeMs - 600_000)
  if (!tracked) updateRecord(acc, slug, r => noteVerify(r, false), now)
}

/**
 * The end of a main-loop turn. The chain only continues after a turn the mod itself queued:
 * a prompt the person typed is theirs, and never triggers an unprompted follow-up.
 */
export function onTurnComplete(acc: Acc, a: { now: number; reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }): void {
  const { now } = a
  const pending = acc.model.runtime.pending
  setRuntime(acc, { pending: null })
  const run = activeRun(acc.model)
  if (!run) return
  const mode = effectiveMode(acc.model.config)
  const chain = pending !== null && pending.slug === run.record.slug
  if (a.reason !== 'answer') {
    if (chain && mode !== 'manual') haltNow(acc, run, a.reason, `the agent's turn ended with "${a.reason}", so the autopilot stopped; /sdlc next continues`, now)
    return
  }
  bookkeepVerify(acc, run, now)
  const fresh = activeRun(acc.model) ?? run
  const d = decisionFor(acc.model, fresh)
  if (d.kind === 'halt') {
    announceHalt(acc, fresh, d, chain, now)
    return
  }
  if (!chain || d.kind === 'suggest') {
    const halted = { ...acc.model.runtime.halted }
    delete halted[fresh.record.slug]
    setRuntime(acc, { halted })
    return
  }
  // d.kind === 'run' after a turn the mod queued
  if (pending && pending.sig === runSig(fresh)) {
    haltNow(acc, fresh, 'no-progress', 'the last autopilot step changed nothing (no artifact, edit or proof moved); look at what the agent said', now)
    return
  }
  if (a.answer.trim().endsWith('?')) {
    haltNow(acc, fresh, 'question', 'the agent ended its turn with a question; answer it, then /sdlc next', now)
    return
  }
  const key = d.action.promptKey
  const bumped = updateRecord(acc, fresh.record.slug, consumeTurn, now)
  if (bumped && key) queuePrompt(acc, bumped, key, 'autopilot', now)
}

/** `/sdlc next`: a person forces the next agent step, past budget and halts, but never past a human gate. */
export function forceNext(acc: Acc, now: number): void {
  const run = activeRun(acc.model)
  if (!run) return say(acc, 'There is no active run. Start one with /sdlc new <idea>.')
  const next = run.snapshot.next
  if (next.byHuman || next.kind === 'await-human' || next.kind === 'release') {
    return say(acc, `${next.label} is a human gate; the agent cannot pass it. ${next.reason} Use ${gateHelp(next.gate)}.`)
  }
  if (!next.promptKey) return say(acc, `Nothing for the agent to do: ${next.label}. ${next.reason}`)
  queuePrompt(acc, run, next.promptKey, 'human', now)
  say(acc, `Queued: ${next.label}.`)
}
