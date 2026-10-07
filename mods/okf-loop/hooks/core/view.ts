// Model -> ViewModel: everything a drawing reads, assembled from derived snapshots. Pure.

import type { GuardStat, GuardView, PlayView, ViewModel } from '../../types'
import { autopilotView } from './autopilot'
import { GUARD_DEFS, GUARD_ORDER, STAGE_META } from './constants'
import { bandViews } from './controller-bands'
import { decisionFor } from './controller-autopilot'
import { activeRun, effectiveMode } from './controller-kit'
import { quarantineNote } from './controller-ingest'
import { setupItems } from './controller-scaffold'
import type { Model } from './controller-types'
import { activeGuards } from './guards'
import { playViews } from './knowledge'
import { computeMetrics } from './metrics'
import { summarizeRuns } from './stages'

const VIEW_LEDGER = 200
const TICK = 30_000

export function guardStats(model: Model): Record<string, GuardStat> {
  const out: Record<string, GuardStat> = {}
  for (const e of model.ledger) {
    if (e.kind !== 'guard.blocked' || typeof e.data?.guard !== 'string') continue
    const cur = out[e.data.guard] ?? { hits: 0, lastAt: null, lastMessage: '' }
    out[e.data.guard] = { hits: cur.hits + 1, lastAt: e.ts, lastMessage: e.summary }
  }
  return out
}

export function guardViews(model: Model): GuardView[] {
  const stats = guardStats(model)
  const state = activeGuards({ guards: model.config.guards, enabledPlays: model.config.plays.enabled })
  return GUARD_ORDER.map(id => {
    const s = state.find(g => g.id === id)
    return { ...GUARD_DEFS[id], enabled: s?.enabled ?? true, active: s?.active ?? false, stat: stats[id] ?? { hits: 0, lastAt: null, lastMessage: '' } }
  })
}

/** What the repo already carries of each play's output. */
export function playEvidence(model: Model): Record<number, { label: string; ok: boolean }[]> {
  const c = model.config
  const has = (path: string): boolean => model.exists[path] === true
  const anyDoc = (kind: 'intent' | 'spec' | 'plan' | 'proof' | 'review'): boolean => model.runs.some(r => r.docs[kind]?.exists === true)
  return {
    1: [{ label: 'an intent.md exists for a run', ok: anyDoc('intent') }],
    2: [{ label: 'a spec.md exists for a run', ok: anyDoc('spec') }],
    3: [{ label: 'a plan.md exists for a run', ok: anyDoc('plan') }],
    4: [{ label: 'more than one run is tracked', ok: model.runs.length > 1 }],
    5: [{ label: `${c.paths.claudeMd} exists`, ok: has(c.paths.claudeMd) }],
    6: [{ label: 'policy skills are configured', ok: c.policySkills.length > 0 }],
    7: [
      { label: 'protected paths are configured', ok: c.guards.protectedPaths.length > 0 },
      { label: 'secret patterns are configured', ok: c.guards.secretPatterns.length > 0 },
    ],
    8: [
      { label: 'a proof report exists for a run', ok: anyDoc('proof') },
      { label: `${c.verify.commands.length} verification commands recognised`, ok: c.verify.commands.length > 0 },
    ],
    9: [
      { label: `${c.paths.ciWorkflow} exists`, ok: has(c.paths.ciWorkflow) },
      { label: 'evals/check.sh exists', ok: has('evals/check.sh') },
    ],
    10: [
      { label: `${c.paths.reviewPolicy} exists`, ok: has(c.paths.reviewPolicy) },
      { label: 'a review exists for a run', ok: anyDoc('review') },
    ],
    11: [{ label: `${c.paths.productionGate} exists`, ok: has(c.paths.productionGate) }],
    12: [{ label: `${c.paths.managedSettings} exists`, ok: has(c.paths.managedSettings) }],
    13: [
      { label: `${c.paths.bands} exists`, ok: has(c.paths.bands) },
      { label: 'a band source is configured', ok: c.bands.sources.length > 0 },
    ],
    14: [{ label: 'a lessons/ folder exists', ok: has('lessons') }],
  }
}

/** Approvals held for a human, the active run's first. */
export function quarantinedOf(model: Model): ViewModel['quarantined'] {
  return Object.values(model.runtime.quarantine)
    .map(q => ({ slug: q.slug, gate: q.gate, path: q.path, detail: quarantineNote(q.path, q.gate) }))
    .sort((a, b) => Number(b.slug === model.active) - Number(a.slug === model.active) || a.slug.localeCompare(b.slug) || a.gate.localeCompare(b.gate))
}

export function buildView(model: Model, now: number): ViewModel {
  const run = activeRun(model)
  const mode = effectiveMode(model.config)
  const rt = model.runtime
  // Coarse time: the view only changes (and redraws) when something real did, or twice a minute.
  const tick = Math.floor(now / TICK) * TICK
  const snapshots = model.runs.map(r => r.snapshot)
  return {
    ready: model.ready,
    now: tick,
    cwd: model.cwd,
    config: model.config,
    configIssues: model.configIssues,
    knowledge: { source: model.knowledge.source, root: model.knowledge.root, title: model.knowledge.title, issues: model.knowledge.issues },
    plays: playViews({ plays: model.knowledge.plays, enabled: model.config.plays.enabled, evidence: playEvidence(model) }) as PlayView[],
    runs: summarizeRuns(snapshots),
    active: run?.snapshot ?? null,
    guards: guardViews(model),
    release: { envToken: rt.envToken, grantUntil: rt.grantUntil !== null && rt.grantUntil > now ? rt.grantUntil : null },
    autopilot: autopilotView({ decision: decisionFor(model, run), record: run?.record ?? null, config: model.config, mode }),
    ledger: model.ledger.slice(-VIEW_LEDGER),
    metrics: computeMetrics({ entries: model.ledger, snapshots, now }),
    bands: bandViews(model),
    setup: setupItems(model),
    quarantined: quarantinedOf(model),
    notice: rt.notice !== '' && now - rt.noticeAt < 30_000 ? rt.notice : '',
  }
}

const left = (ms: number): string => `${Math.max(1, Math.round(ms / 60_000))}m`

/** `/sdlc status`: a compact summary a person can read at a glance. */
export function statusSummary(model: Model, now: number): string {
  const vm = buildView(model, now)
  const run = vm.active
  const a = vm.autopilot
  const lines: string[] = []
  const cfgMode = vm.config.autonomy.mode
  lines.push(`Mode ${a.mode}${a.mode !== cfgMode ? ` (configured ${cfgMode}; Play 04 is not adopted)` : ''} · knowledge: ${vm.knowledge.source === 'repo' ? `repo ${vm.knowledge.root}/` : 'bundled snapshot'} · ${vm.config.plays.enabled.length} plays adopted`)
  if (!run) {
    lines.push(vm.runs.length > 0 ? `No active run (${vm.runs.length} exist: /sdlc use <slug>).` : 'No run yet: describe a change with /sdlc new <idea>.')
  } else {
    const meta = STAGE_META[run.current]
    const stage = run.stages.find(s => s.id === run.current)
    lines.push(`Run ${run.record.slug} "${run.record.title}" · Stage ${meta.number}/6 ${meta.name} (${stage?.state ?? 'active'}) · ${Math.round(run.progress * 100)}% · health ${run.health}`)
    lines.push(`Next: ${run.next.label}. ${run.next.reason}`)
    const gate = stage?.gates.find(g => !g.approved)
    if (gate) {
      const owner = gate.kind === 'human' ? (gate.ready ? 'you (ready)' : 'you, once the machine checks hold') : 'a machine check'
      lines.push(`Gate owed: ${gate.id}, by ${owner}${gate.blockedBy.length ? `. Blocked by: ${gate.blockedBy.join('; ')}` : ''}`)
    } else lines.push('Gate owed: none right now.')
    lines.push(`Autopilot: ${a.state}${a.paused ? ' (paused)' : ''}, ${a.budgetMax - a.budgetLeft}/${a.budgetMax} turns used. ${a.reason}`)
    if (run.record.fix.active) lines.push(`Bug-fix protocol: ${run.record.fix.reproCommitted ? 'repro committed, tests are locked' : 'waiting for the failing repro test to be committed'}.`)
  }
  const waiting = Object.values(model.runtime.quarantine)
  for (const q of waiting) lines.push(`⚠ ${q.path} says approved but changed while the agent was working: confirm with /sdlc approve ${q.gate}`)
  lines.push(
    vm.release.grantUntil !== null
      ? `Release: grant live, ${left(vm.release.grantUntil - now)} left${vm.release.envToken ? ' (and RELEASE_APPROVAL is set)' : ''}.`
      : vm.release.envToken
        ? 'Release: RELEASE_APPROVAL is set; production commands are unlocked.'
        : 'Release: locked (no grant; /sdlc release grant).',
  )
  const hits = vm.guards.reduce((n, g) => n + g.stat.hits, 0)
  lines.push(`Guards: ${vm.guards.filter(g => g.active && g.enabled).length}/${vm.guards.length} enforcing, ${hits} interception${hits === 1 ? '' : 's'} on record.`)
  const metrics = vm.metrics.filter(m => m.status !== 'n/a').slice(0, 4)
  if (metrics.length > 0) lines.push(`Metrics: ${metrics.map(m => `${m.label} ${m.value} (${m.status})`).join(' · ')}`)
  const hot = vm.bands.filter(b => b.tier === '2sigma' || b.tier === '3sigma')
  if (hot.length > 0) lines.push(`Bands: ${hot.map(b => `${b.metric} ${b.tier}`).join(', ')}`)
  if (vm.runs.length > 1) lines.push(`Runs: ${vm.runs.map(r => `${r.slug} (${STAGE_META[r.current].name})`).join(', ')}`)
  if (vm.configIssues.length > 0) lines.push(`⚠ ${vm.configIssues.length} config issue${vm.configIssues.length === 1 ? '' : 's'} in .okf/config.json: ${vm.configIssues[0]}`)
  return lines.join('\n')
}
