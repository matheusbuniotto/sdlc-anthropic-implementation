// The guards' side of the controller: build the GuardContext from the model, and keep the
// bookkeeping of what the agent did (proof runs, source edits, artifact writes, the repro commit).

import type { ArtifactKind, GuardContext, GuardInput, GuardVerdict, PathKey } from '../../types'
import { noteGoodStep, noteVerify } from './autopilot'
import { artifactGlob } from './config'
import { activeRun, ledger, setRuntime, updateRecord, type Acc } from './controller-kit'
import type { Model } from './controller-types'
import { evaluateGuards, isProofCommand, matchesAny, normalizePath } from './guards'

const ARTIFACT_KEYS: { key: PathKey; kind: ArtifactKind }[] = [
  { key: 'intent', kind: 'intent' },
  { key: 'spec', kind: 'spec' },
  { key: 'plan', kind: 'plan' },
  { key: 'proof', kind: 'proof' },
  { key: 'review', kind: 'review' },
  { key: 'incident', kind: 'incident' },
  { key: 'lesson', kind: 'lesson' },
  { key: 'eval', kind: 'eval' },
]

export function guardContext(model: Model, release: GuardContext['release']): GuardContext {
  const run = activeRun(model)
  const plan = run?.snapshot.stages.flatMap(s => s.gates).find(g => g.id === 'plan.accept')
  return {
    guards: model.config.guards,
    verify: model.config.verify,
    paths: model.config.paths,
    enabledPlays: model.config.plays.enabled,
    cwd: model.cwd,
    home: model.home,
    run: run
      ? { slug: run.record.slug, current: run.snapshot.current, planAccepted: plan?.approved === true, fixActive: run.record.fix.active && run.record.fix.reproCommitted }
      : null,
    release,
  }
}

export function judge(model: Model, input: GuardInput, release: GuardContext['release']): GuardVerdict {
  return evaluateGuards(input, guardContext(model, release))
}

export type ToolKind = { kind: 'source'; path: string } | { kind: 'artifact'; path: string; artifact: ArtifactKind } | { kind: 'proof' } | { kind: 'commit' }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const COMMIT = /(?:^|[;&|(]\s*)git\s+(?:(?:-c\s+\S+|-C\s+\S+|--[\w-]+(?:=\S+)?)\s+)*commit(?:\s|$)/

/** What, if anything, a finished tool call means for the run's bookkeeping. Pure, cheap: register asks before dispatching. */
export function classifyTool(model: Model, input: GuardInput): ToolKind | null {
  const run = activeRun(model)
  if (!run) return null
  const c = model.config
  if (EDIT_TOOLS.has(input.tool) && input.filePath) {
    const rel = normalizePath(input.filePath, model.cwd, model.home)
    if (rel.startsWith('/') || rel.startsWith('~')) return null
    if (rel === '.okf' || rel.startsWith('.okf/')) return null
    const hit = ARTIFACT_KEYS.find(a => matchesAny(rel, [artifactGlob(c, a.key)]))
    if (hit) return { kind: 'artifact', path: rel, artifact: hit.kind }
    return matchesAny(rel, c.guards.planFirstExempt) ? null : { kind: 'source', path: rel }
  }
  if (input.tool === 'Bash' && input.command) {
    if (isProofCommand(input.command, c.verify.commands)) return { kind: 'proof' }
    if (run.record.fix.active && !run.record.fix.reproCommitted && COMMIT.test(input.command)) return { kind: 'commit' }
  }
  return null
}

/** After an allowed tool call ran: proof tracker, edit tracker, artifact writes, the repro commit. */
export function onToolDone(acc: Acc, a: { now: number; input: GuardInput; isError: boolean }): void {
  const { now, input } = a
  const run = activeRun(acc.model)
  const what = classifyTool(acc.model, input)
  if (!run || !what) return
  const slug = run.record.slug
  switch (what.kind) {
    case 'source': {
      if (a.isError) return
      updateRecord(
        acc,
        slug,
        r => noteGoodStep({ ...r, proof: { ...r.proof, lastEditAt: now }, edits: r.edits.includes(what.path) ? r.edits : [...r.edits, what.path].slice(-200) }),
        now,
      )
      return
    }
    case 'artifact': {
      if (a.isError) return
      const last = acc.model.runtime.toastAt[`artifact:${what.path}`]
      if (last === undefined || now - last > 60_000) {
        setRuntime(acc, { toastAt: { ...acc.model.runtime.toastAt, [`artifact:${what.path}`]: now } })
        ledger(acc, { kind: 'artifact.written', run: slug, stage: run.snapshot.current, actor: 'agent', summary: `The agent wrote ${what.path}`, data: { kind: what.artifact, path: what.path } }, now)
      }
      return
    }
    case 'proof': {
      const passed = !a.isError
      const command = (input.command ?? '').trim().slice(0, 200)
      updateRecord(acc, slug, r => {
        const next = noteVerify({ ...r, proof: { ...r.proof, lastRunAt: now, lastRunPassed: passed, lastCommand: command } }, passed)
        return passed ? noteGoodStep(next) : next
      }, now)
      ledger(
        acc,
        { kind: passed ? 'proof.pass' : 'proof.fail', run: slug, stage: 'test', actor: 'agent', summary: `${command} ${passed ? 'passed' : 'failed'}`, data: { command } },
        now,
      )
      return
    }
    case 'commit': {
      if (a.isError) return
      updateRecord(acc, slug, r => ({ ...r, fix: { ...r.fix, reproCommitted: true } }), now)
      ledger(acc, { kind: 'agent.verdict', run: slug, stage: 'test', actor: 'agent', summary: 'The reproduction test is committed: tests are locked until the bug is fixed.', data: { kind: 'repro-committed' } }, now)
    }
  }
}
