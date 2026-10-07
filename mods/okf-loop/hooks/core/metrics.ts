// Leading and lagging metrics (governance/leading-and-lagging-metrics.md),
// computed from the ledger and the derived run snapshots. Pure: no clock reads.
// Durations are milliseconds in `raw`; rates are percentages (0-100); counts are counts.
// Where the playbook states a target it is shown as `target`; where it does not,
// the status thresholds below are working defaults ("the Loop runs in hours").

import type { LedgerEntry, LedgerKind, MetricView, RunSnapshot } from '../../types'

const MIN = 60_000
const HOUR = 3_600_000

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`
  const d = Math.floor(h / 24)
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  const hi = s[mid] ?? 0
  return s.length % 2 === 1 ? hi : Math.round(((s[mid - 1] ?? hi) + hi) / 2)
}

type Status = MetricView['status']
type Spec = Omit<MetricView, 'value' | 'raw' | 'status'>

const na = (spec: Spec): MetricView => ({ ...spec, value: 'n/a', raw: null, status: 'n/a' })
const view = (spec: Spec, value: string, raw: number, status: Status, hint?: string): MetricView => ({ ...spec, ...(hint ? { hint } : {}), value, raw, status })

// Lower is better: good up to `good`, warn up to `warn`, bad beyond.
const lowIsGood = (v: number, good: number, warn: number): Status => (v <= good ? 'good' : v <= warn ? 'warn' : 'bad')

function gateOf(e: LedgerEntry): string | null {
  const g = e.data?.gate
  if (typeof g === 'string' && g !== '') return g
  // Older or hand-written lines may carry the gate only in the summary.
  const m = /\b(intent\.approve|spec\.approve|plan\.accept|verify\.pass|review\.pass|release\.approve)\b/.exec(e.summary)
  return m?.[1] ?? null
}

function byRun(entries: LedgerEntry[]): Map<string, LedgerEntry[]> {
  const map = new Map<string, LedgerEntry[]>()
  for (const e of entries) {
    if (e.run === undefined) continue
    const list = map.get(e.run)
    if (list) list.push(e)
    else map.set(e.run, [e])
  }
  return map
}

const firstTs = (es: LedgerEntry[], kind: LedgerKind, gate?: string): number | null =>
  es.find((e) => e.kind === kind && (gate === undefined || gateOf(e) === gate))?.ts ?? null

// Per run, the time from one ledger event to a later one (negative spans are clock noise: dropped).
function spans(runs: Map<string, LedgerEntry[]>, from: (es: LedgerEntry[]) => number | null, to: (es: LedgerEntry[]) => number | null): number[] {
  const out: number[] = []
  for (const es of runs.values()) {
    const a = from(es)
    const b = to(es)
    if (a !== null && b !== null && b >= a) out.push(b - a)
  }
  return out
}

function rateMetric(spec: Spec, num: number, den: number, status: (rate: number) => Status): MetricView {
  if (den === 0) return na(spec)
  const rate = (num / den) * 100
  return view(spec, `${Math.round(rate)}%`, rate, status(rate))
}

function durationMetric(spec: Spec, values: number[], good: number, warn: number): MetricView {
  const m = median(values)
  return m === null ? na(spec) : view(spec, formatDuration(m), m, lowIsGood(m, good, warn))
}

// ---------------------------------------------------------------------------
// Plan drift: edited files outside the plan (glob and directory aware, local to this module)
// ---------------------------------------------------------------------------

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '*') {
      if (glob.charAt(i + 1) === '*') {
        re += '.*'
        i++
        if (glob.charAt(i + 1) === '/') i++
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`)
}

function covered(file: string, planned: string[]): boolean {
  const f = file.replace(/^\.\//, '')
  return planned.some((raw) => {
    const p = raw.replace(/^\.\//, '')
    if (p === f) return true
    if (/[*?]/.test(p)) return globToRegExp(p).test(f)
    return f.startsWith(p.endsWith('/') ? p : `${p}/`)
  })
}

function planDrift(snapshots: RunSnapshot[]): { outside: number; total: number } {
  let outside = 0
  let total = 0
  for (const s of snapshots) {
    const planned = s.stages.find((st) => st.id === 'build')?.artifacts[0]?.planFiles ?? []
    // Without a plan's file list there is nothing to drift from.
    if (planned.length === 0) continue
    for (const file of s.record.edits) {
      total++
      if (!covered(file, planned)) outside++
    }
  }
  return { outside, total }
}

// ---------------------------------------------------------------------------
// Ledger pairings
// ---------------------------------------------------------------------------

// Gate wait: a human gate opening to a person passing it. A rejection voids the wait (the gate reopens).
function gateWaits(runs: Map<string, LedgerEntry[]>): number[] {
  const out: number[] = []
  for (const es of runs.values()) {
    const open = new Map<string, number>()
    for (const e of es) {
      const g = gateOf(e)
      if (g === null) continue
      if (e.kind === 'gate.opened' && !open.has(g)) open.set(g, e.ts)
      else if (e.kind === 'gate.approved') {
        const at = open.get(g)
        if (at !== undefined && e.ts >= at) out.push(e.ts - at)
        open.delete(g)
      } else if (e.kind === 'gate.rejected') open.delete(g)
    }
  }
  return out
}

// Each incident intent pairs with the latest unpaired breach before it (same metric when both name one).
function breachLatencies(entries: LedgerEntry[]): number[] {
  const out: number[] = []
  const pending: { ts: number; metric: string | null }[] = []
  const metricOf = (e: LedgerEntry) => (typeof e.data?.metric === 'string' ? e.data.metric : null)
  for (const e of entries) {
    if (e.kind === 'band.breach') pending.push({ ts: e.ts, metric: metricOf(e) })
    else if (e.kind === 'incident.intent') {
      const m = metricOf(e)
      for (let i = pending.length - 1; i >= 0; i--) {
        const b = pending[i]
        if (b && (m === null || b.metric === null || b.metric === m) && b.ts <= e.ts) {
          out.push(e.ts - b.ts)
          pending.splice(i, 1)
          break
        }
      }
    }
  }
  return out
}

function isActive(s: RunSnapshot): boolean {
  return !s.stages.every((st) => st.state === 'done' || st.state === 'monitoring')
}

export function computeMetrics(args: { entries: LedgerEntry[]; snapshots: RunSnapshot[]; now: number }): MetricView[] {
  // `now` is part of the contract for callers; every metric here is a pure function of the ledger.
  const { entries, snapshots } = args
  const ordered = entries.map((e, i) => ({ e, i })).sort((a, b) => a.e.ts - b.e.ts || a.i - b.i).map((x) => x.e)
  const runs = byRun(ordered)
  const of = (kind: LedgerKind) => ordered.filter((e) => e.kind === kind)
  const gated = (kind: LedgerKind, gate: string) => of(kind).filter((e) => gateOf(e) === gate)
  const out: MetricView[] = []

  // 1 Plan, leading
  out.push(
    durationMetric(
      { id: 'elicitation-latency', stage: 'plan', kind: 'leading', label: 'Elicitation latency', target: '< 2 hours', hint: 'Median time from a run starting to the product owner approving intent.md.' },
      spans(runs, (es) => firstTs(es, 'run.created'), (es) => firstTs(es, 'gate.approved', 'intent.approve')),
      2 * HOUR,
      8 * HOUR,
    ),
  )

  // 2 Plan, lagging
  const survSpec: Spec = { id: 'intent-survival', stage: 'plan', kind: 'lagging', label: 'Intent survival', hint: 'Share of intent decisions that approved the intent rather than rejected it.' }
  const approved = gated('gate.approved', 'intent.approve').length
  const rejected = gated('gate.rejected', 'intent.approve').length
  out.push(rateMetric(survSpec, approved, approved + rejected, (r) => (r >= 70 ? 'good' : r >= 40 ? 'warn' : 'bad')))

  // 3 Design, leading
  out.push(
    durationMetric(
      { id: 'design-compression', stage: 'design', kind: 'leading', label: 'Design compression', hint: 'Median time from intent approval to spec approval.' },
      spans(runs, (es) => firstTs(es, 'gate.approved', 'intent.approve'), (es) => firstTs(es, 'gate.approved', 'spec.approve')),
      4 * HOUR,
      24 * HOUR,
    ),
  )

  // 4 Design, lagging
  const reworkSpec: Spec = { id: 'requirements-rework', stage: 'design', kind: 'lagging', label: 'Requirements rework', hint: 'Spec rewrites after the plan was accepted: requirements that moved during the build.' }
  let rework = 0
  let accepted = 0
  for (const es of runs.values()) {
    const at = firstTs(es, 'gate.approved', 'plan.accept')
    if (at === null) continue
    accepted++
    rework += es.filter((e) => e.kind === 'artifact.written' && e.data?.kind === 'spec' && e.ts > at).length
  }
  out.push(accepted === 0 ? na(reworkSpec) : view(reworkSpec, `${rework} rewrite${rework === 1 ? '' : 's'}`, rework, rework === 0 ? 'good' : rework <= 2 ? 'warn' : 'bad'))

  // 5 Build, leading
  out.push(
    durationMetric(
      { id: 'plan-to-proof', stage: 'build', kind: 'leading', label: 'Plan-to-proof time', hint: 'Median time from plan acceptance to verification passing.' },
      spans(runs, (es) => firstTs(es, 'gate.approved', 'plan.accept'), (es) => firstTs(es, 'gate.approved', 'verify.pass')),
      4 * HOUR,
      24 * HOUR,
    ),
  )

  // 6 Build, lagging
  const driftSpec: Spec = { id: 'plan-drift', stage: 'build', kind: 'lagging', label: 'Plan drift', target: '0% outside the plan', hint: 'Share of files the agent edited that plan.md did not list.' }
  const drift = planDrift(snapshots)
  out.push(rateMetric(driftSpec, drift.outside, drift.total, (r) => (r === 0 ? 'good' : r <= 20 ? 'warn' : 'bad')))

  // 7 and 8 Test
  const passes = of('proof.pass').length
  const fails = of('proof.fail').length
  const greenSpec: Spec = { id: 'first-pass-green', stage: 'test', kind: 'leading', label: 'First-pass green rate', target: '≥ 90%', hint: 'Share of verification runs that passed.' }
  out.push(rateMetric(greenSpec, passes, passes + fails, (r) => (r >= 90 ? 'good' : r >= 75 ? 'warn' : 'bad')))
  const failSpec: Spec = { id: 'failed-verifications', stage: 'test', kind: 'lagging', label: 'Failed verifications', hint: 'Verification runs that failed; each one is a fix the agent had to make before a human looked.' }
  out.push(passes + fails === 0 ? na(failSpec) : view(failSpec, `${fails} failed`, fails, fails === 0 ? 'good' : fails <= 3 ? 'warn' : 'bad'))

  // 9 and 10 Deploy
  out.push(
    durationMetric(
      { id: 'gate-wait', stage: 'deploy', kind: 'leading', label: 'Gate wait', hint: 'Median time a human gate waited between becoming ready and being passed.' },
      gateWaits(runs),
      HOUR,
      8 * HOUR,
    ),
  )
  const blocks = of('guard.blocked')
  const guardSpec: Spec = { id: 'guard-interceptions', stage: 'deploy', kind: 'lagging', label: 'Guard interceptions', hint: 'Times a guard refused the agent.' }
  if (ordered.length === 0) out.push(na(guardSpec))
  else {
    const tally = new Map<string, number>()
    for (const e of blocks) {
      const g = typeof e.data?.guard === 'string' ? e.data.guard : 'unknown'
      tally.set(g, (tally.get(g) ?? 0) + 1)
    }
    const grouped = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([g, n]) => `${n} ${g}`).join(', ')
    out.push(view(guardSpec, `${blocks.length} blocked`, blocks.length, blocks.length === 0 ? 'good' : 'warn', grouped ? `Times a guard refused the agent: ${grouped}.` : undefined))
  }

  // 11 Maintain, leading
  const latencies = breachLatencies(ordered)
  out.push(
    durationMetric(
      { id: 'breach-to-intent', stage: 'maintain', kind: 'leading', label: 'Breach-to-intent latency', target: '< 5 minutes', hint: 'Median time from a control-band breach to the incident intent being written.' },
      latencies,
      5 * MIN,
      60 * MIN,
    ),
  )

  // 12 All, leading
  const parSpec: Spec = { id: 'parallel-runs', stage: 'all', kind: 'leading', label: 'Parallel runs', target: '2–3', hint: 'Runs still in flight; a person can only review 2-3 streams well.' }
  if (snapshots.length === 0) out.push(na(parSpec))
  else {
    const active = snapshots.filter(isActive).length
    out.push(view(parSpec, `${active} active`, active, active <= 3 ? 'good' : active <= 5 ? 'warn' : 'bad'))
  }
  return out
}
