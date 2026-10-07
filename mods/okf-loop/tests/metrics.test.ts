import { test, expect, describe } from 'claude-code/testing'
import type { LedgerEntry, LedgerKind, MetricView, RunRecord, RunSnapshot, StageId, StageSnapshot, StageState } from '../types'
import { computeMetrics, formatDuration } from '../hooks/core/metrics'

const T0 = Date.UTC(2026, 9, 6, 8, 0, 0)
const MIN = 60_000
const HOUR = 3_600_000
const IDS: StageId[] = ['plan', 'design', 'build', 'test', 'deploy', 'maintain']

function e(kind: LedgerKind, at: number, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return { ts: T0 + at, kind, actor: 'mod', summary: kind, ...over }
}
const gate = (kind: 'gate.opened' | 'gate.approved' | 'gate.rejected', g: string, at: number, run = 'a') => e(kind, at, { run, data: { gate: g } })
const created = (run: string, at = 0) => e('run.created', at, { run, actor: 'human' })

function record(slug: string, edits: string[] = []): RunRecord {
  return {
    slug,
    title: slug,
    source: 'human',
    createdAt: 0,
    approvals: {},
    fix: { active: false, reproCommitted: false },
    proof: { lastEditAt: 0, lastRunAt: 0, lastRunPassed: null, lastCommand: '' },
    edits,
    autoTurns: 0,
    blockStreak: 0,
    verifyFailStreak: 0,
    paused: false,
  }
}

function snap(slug: string, o: { states?: StageState[]; planFiles?: string[]; edits?: string[] } = {}): RunSnapshot {
  const states = o.states ?? ['done', 'done', 'active', 'pending', 'pending', 'pending']
  const stages: StageSnapshot[] = IDS.map((id, i) => ({
    id,
    number: (i + 1) as StageSnapshot['number'],
    name: id,
    tagline: '',
    state: states[i] ?? 'pending',
    artifacts:
      id === 'build'
        ? [{ kind: 'plan', path: `plans/${slug}.plan.md`, exists: true, status: 'accepted', title: slug, mtimeMs: 0, sections: [], missingSections: [], checklist: { done: 0, total: 0 }, flaggedConcerns: 0, planFiles: o.planFiles ?? [], issues: [] }]
        : [],
    gates: [],
    summary: '',
    plays: [],
  }))
  return {
    record: record(slug, o.edits),
    stages,
    current: 'build',
    next: { kind: 'implement', stage: 'build', label: '', reason: '', byHuman: false, auto: true },
    health: 'ok',
    progress: 0,
  }
}

const DONE: StageState[] = ['done', 'done', 'done', 'done', 'done', 'monitoring']

const metrics = (entries: LedgerEntry[], snapshots: RunSnapshot[] = []) => computeMetrics({ entries, snapshots, now: T0 + 100 * HOUR })
function metric(list: MetricView[], id: string): MetricView {
  const m = list.find((x) => x.id === id)
  if (!m) throw new Error(`no metric ${id}`)
  return m
}
const one = (id: string, entries: LedgerEntry[], snapshots: RunSnapshot[] = []) => metric(metrics(entries, snapshots), id)

describe('formatDuration', () => {
  test('seconds, minutes, hours, days', () => {
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(59_999)).toBe('59s')
    expect(formatDuration(60_000)).toBe('1m')
    expect(formatDuration(7 * MIN)).toBe('7m')
    expect(formatDuration(59 * MIN + 59_000)).toBe('59m')
    expect(formatDuration(HOUR)).toBe('1h')
    expect(formatDuration(HOUR + 12 * MIN)).toBe('1h 12m')
    expect(formatDuration(23 * HOUR + 59 * MIN)).toBe('23h 59m')
    expect(formatDuration(24 * HOUR)).toBe('1d')
    expect(formatDuration(51 * HOUR)).toBe('2d 3h')
  })

  test('sub-second, negative and non-finite values are 0s', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(999)).toBe('0s')
    expect(formatDuration(-5 * MIN)).toBe('0s')
    expect(formatDuration(Number.NaN)).toBe('0s')
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s')
  })
})

describe('computeMetrics: shape', () => {
  test('an empty ledger yields every metric as n/a, in the knowledge base order', () => {
    const list = metrics([])
    expect(list.map((m) => m.id)).toEqual([
      'elicitation-latency',
      'intent-survival',
      'design-compression',
      'requirements-rework',
      'plan-to-proof',
      'plan-drift',
      'first-pass-green',
      'failed-verifications',
      'gate-wait',
      'guard-interceptions',
      'breach-to-intent',
      'parallel-runs',
    ])
    for (const m of list) {
      expect(m).toMatchObject({ value: 'n/a', raw: null, status: 'n/a' })
      expect(m.hint.length).toBeGreaterThan(10)
      expect(m.hint.includes('\n')).toBe(false)
    }
  })

  test('stage and kind follow the leading/lagging matrix', () => {
    const list = metrics([])
    expect(list.map((m) => `${m.stage}:${m.kind}`)).toEqual([
      'plan:leading',
      'plan:lagging',
      'design:leading',
      'design:lagging',
      'build:leading',
      'build:lagging',
      'test:leading',
      'test:lagging',
      'deploy:leading',
      'deploy:lagging',
      'maintain:leading',
      'all:leading',
    ])
  })

  test('targets are shown where the playbook states one', () => {
    const list = metrics([])
    const targets = Object.fromEntries(list.filter((m) => m.target).map((m) => [m.id, m.target]))
    expect(targets).toEqual({
      'elicitation-latency': '< 2 hours',
      'plan-drift': '0% outside the plan',
      'first-pass-green': '≥ 90%',
      'breach-to-intent': '< 5 minutes',
      'parallel-runs': '2–3',
    })
  })

  test('the input is never mutated and entry order does not matter', () => {
    const entries = [created('a'), gate('gate.approved', 'intent.approve', HOUR), gate('gate.approved', 'spec.approve', 2 * HOUR)]
    const copy = JSON.stringify(entries)
    const forward = metrics(entries)
    expect(JSON.stringify(entries)).toBe(copy)
    expect(metrics([...entries].reverse())).toEqual(forward)
  })
})

describe('Plan metrics', () => {
  test('elicitation latency is the median run.created to intent.approve time', () => {
    const entries = [
      created('a'),
      gate('gate.approved', 'intent.approve', HOUR, 'a'),
      created('b'),
      gate('gate.approved', 'intent.approve', 3 * HOUR, 'b'),
    ]
    expect(one('elicitation-latency', entries)).toMatchObject({ value: '2h', raw: 2 * HOUR, status: 'good', target: '< 2 hours' })
  })

  test('it is a median, not a mean', () => {
    const entries = [created('a'), created('b'), created('c'), gate('gate.approved', 'intent.approve', HOUR, 'a'), gate('gate.approved', 'intent.approve', HOUR, 'b'), gate('gate.approved', 'intent.approve', 10 * HOUR, 'c')]
    expect(one('elicitation-latency', entries)).toMatchObject({ value: '1h', raw: HOUR, status: 'good' })
  })

  test('thresholds: good up to 2h, warn up to 8h, bad beyond', () => {
    const at = (ms: number) => one('elicitation-latency', [created('a'), gate('gate.approved', 'intent.approve', ms, 'a')])
    expect(at(2 * HOUR).status).toBe('good')
    expect(at(2 * HOUR + MIN).status).toBe('warn')
    expect(at(8 * HOUR).status).toBe('warn')
    expect(at(8 * HOUR + MIN).status).toBe('bad')
    expect(at(30 * MIN).value).toBe('30m')
  })

  test('uses the first approval and ignores runs that were never approved', () => {
    const entries = [created('a'), gate('gate.approved', 'intent.approve', HOUR, 'a'), gate('gate.approved', 'intent.approve', 9 * HOUR, 'a'), created('b')]
    expect(one('elicitation-latency', entries).raw).toBe(HOUR)
  })

  test('a gate named only in the summary still counts', () => {
    const entries = [created('a'), e('gate.approved', HOUR, { run: 'a', summary: 'intent.approve approved by Ana' })]
    expect(one('elicitation-latency', entries).raw).toBe(HOUR)
  })

  test('entries without a run do not pair across runs', () => {
    const entries = [created('a'), e('gate.approved', HOUR, { data: { gate: 'intent.approve' } })]
    expect(one('elicitation-latency', entries).status).toBe('n/a')
  })

  test('an even number of runs averages the two middle values', () => {
    const entries = [created('a'), created('b'), gate('gate.approved', 'intent.approve', HOUR, 'a'), gate('gate.approved', 'intent.approve', 3 * HOUR, 'b')]
    expect(one('elicitation-latency', entries).raw).toBe(2 * HOUR)
  })

  test('intent survival is approved over approved plus rejected', () => {
    const decisions = (ok: number, no: number) => [
      ...Array.from({ length: ok }, (_, i) => gate('gate.approved', 'intent.approve', i, `ok${i}`)),
      ...Array.from({ length: no }, (_, i) => gate('gate.rejected', 'intent.approve', i, `no${i}`)),
    ]
    expect(one('intent-survival', decisions(3, 1))).toMatchObject({ value: '75%', raw: 75, status: 'good' })
    expect(one('intent-survival', decisions(1, 1))).toMatchObject({ value: '50%', status: 'warn' })
    expect(one('intent-survival', decisions(1, 3))).toMatchObject({ value: '25%', status: 'bad' })
    expect(one('intent-survival', decisions(0, 2))).toMatchObject({ value: '0%', raw: 0, status: 'bad' })
    expect(one('intent-survival', decisions(1, 2)).value).toBe('33%')
  })

  test('other gates do not count toward intent survival', () => {
    expect(one('intent-survival', [gate('gate.rejected', 'spec.approve', 0)]).status).toBe('n/a')
  })
})

describe('Design metrics', () => {
  test('design compression is the median intent-to-spec approval time', () => {
    const entries = [gate('gate.approved', 'intent.approve', 0, 'a'), gate('gate.approved', 'spec.approve', 30 * MIN, 'a'), gate('gate.approved', 'intent.approve', 0, 'b'), gate('gate.approved', 'spec.approve', 90 * MIN, 'b')]
    expect(one('design-compression', entries)).toMatchObject({ value: '1h', raw: HOUR, status: 'good' })
    expect(one('design-compression', [gate('gate.approved', 'intent.approve', 0), gate('gate.approved', 'spec.approve', 5 * HOUR)]).status).toBe('warn')
    expect(one('design-compression', [gate('gate.approved', 'intent.approve', 0), gate('gate.approved', 'spec.approve', 30 * HOUR)]).status).toBe('bad')
  })

  test('design compression is n/a until a spec approval follows an intent approval', () => {
    expect(one('design-compression', [gate('gate.approved', 'intent.approve', 0)]).status).toBe('n/a')
    expect(one('design-compression', [gate('gate.approved', 'spec.approve', 0)]).status).toBe('n/a')
  })

  test('requirements rework counts spec writes after the plan was accepted', () => {
    const spec = (at: number, run = 'a') => e('artifact.written', at, { run, data: { kind: 'spec', path: 'specs/a.spec.md' } })
    const base = [gate('gate.approved', 'plan.accept', HOUR)]
    expect(one('requirements-rework', [...base, spec(0), spec(30 * MIN)])).toMatchObject({ value: '0 rewrites', raw: 0, status: 'good' })
    expect(one('requirements-rework', [...base, spec(2 * HOUR)])).toMatchObject({ value: '1 rewrite', raw: 1, status: 'warn' })
    expect(one('requirements-rework', [...base, spec(2 * HOUR), spec(3 * HOUR)])).toMatchObject({ value: '2 rewrites', status: 'warn' })
    expect(one('requirements-rework', [...base, spec(2 * HOUR), spec(3 * HOUR), spec(4 * HOUR)])).toMatchObject({ value: '3 rewrites', raw: 3, status: 'bad' })
  })

  test('only spec writes of the same run count', () => {
    const entries = [
      gate('gate.approved', 'plan.accept', HOUR, 'a'),
      e('artifact.written', 2 * HOUR, { run: 'a', data: { kind: 'plan' } }),
      e('artifact.written', 2 * HOUR, { run: 'b', data: { kind: 'spec' } }),
      e('artifact.written', 2 * HOUR, { data: { kind: 'spec' } }),
    ]
    expect(one('requirements-rework', entries).raw).toBe(0)
  })

  test('requirements rework is n/a when no plan was ever accepted', () => {
    expect(one('requirements-rework', [e('artifact.written', 0, { run: 'a', data: { kind: 'spec' } })]).status).toBe('n/a')
  })
})

describe('Build metrics', () => {
  test('plan-to-proof time runs from plan acceptance to the verify gate passing', () => {
    const entries = [gate('gate.approved', 'plan.accept', 0, 'a'), gate('gate.approved', 'verify.pass', 90 * MIN, 'a')]
    expect(one('plan-to-proof', entries)).toMatchObject({ value: '1h 30m', raw: 90 * MIN, status: 'good' })
    expect(one('plan-to-proof', [gate('gate.approved', 'plan.accept', 0), gate('gate.approved', 'verify.pass', 10 * HOUR)]).status).toBe('warn')
    expect(one('plan-to-proof', [gate('gate.approved', 'plan.accept', 0)]).status).toBe('n/a')
  })

  test('plan drift is the share of edited files the plan did not list', () => {
    const planned = ['src/login.ts', 'tests/login.test.ts']
    const run = (edits: string[]) => snap('a', { planFiles: planned, edits })
    expect(one('plan-drift', [], [run(['src/login.ts', 'tests/login.test.ts'])])).toMatchObject({ value: '0%', raw: 0, status: 'good', target: '0% outside the plan' })
    expect(one('plan-drift', [], [run(['src/login.ts', 'tests/login.test.ts', 'src/a.ts', 'src/b.ts'])])).toMatchObject({ value: '50%', status: 'bad' })
    expect(one('plan-drift', [], [run(['src/login.ts', 'tests/login.test.ts', 'a', 'b', 'c'])])).toMatchObject({ value: '60%', status: 'bad' })
    expect(one('plan-drift', [], [snap('a', { planFiles: ['a', 'b', 'c', 'd', 'e'], edits: ['a', 'b', 'c', 'd', 'x'] })])).toMatchObject({ value: '20%', status: 'warn' })
  })

  test('plan drift understands directories and globs and pools runs', () => {
    const a = snap('a', { planFiles: ['src/auth/', 'docs/*.md', 'lib/**/*.ts', './web/app.tsx'], edits: ['src/auth/login.ts', 'src/auth/deep/x.ts', 'docs/readme.md', 'docs/sub/readme.md', 'lib/a/b/c.ts', 'web/app.tsx'] })
    expect(one('plan-drift', [], [a])).toMatchObject({ raw: (1 / 6) * 100 })
    const b = snap('b', { planFiles: ['x.ts'], edits: ['y.ts', 'x.ts'] })
    expect(one('plan-drift', [], [a, b]).raw).toBe((2 / 8) * 100)
  })

  test('plan drift is n/a without edits or without a plan file list', () => {
    expect(one('plan-drift', [], [snap('a', { planFiles: ['x.ts'], edits: [] })]).status).toBe('n/a')
    expect(one('plan-drift', [], [snap('a', { planFiles: [], edits: ['x.ts'] })]).status).toBe('n/a')
    expect(one('plan-drift', [], []).status).toBe('n/a')
  })
})

describe('Test metrics', () => {
  const proofs = (pass: number, fail: number) => [
    ...Array.from({ length: pass }, (_, i) => e('proof.pass', i, { run: 'a' })),
    ...Array.from({ length: fail }, (_, i) => e('proof.fail', 100 + i, { run: 'a' })),
  ]

  test('first-pass green rate is proof.pass over all proofs, target at least 90%', () => {
    expect(one('first-pass-green', proofs(9, 1))).toMatchObject({ value: '90%', raw: 90, status: 'good', target: '≥ 90%' })
    expect(one('first-pass-green', proofs(3, 1))).toMatchObject({ value: '75%', status: 'warn' })
    expect(one('first-pass-green', proofs(1, 1))).toMatchObject({ value: '50%', status: 'bad' })
    expect(one('first-pass-green', proofs(4, 0))).toMatchObject({ value: '100%', status: 'good' })
    expect(one('first-pass-green', proofs(0, 2))).toMatchObject({ value: '0%', status: 'bad' })
    expect(one('first-pass-green', proofs(2, 1)).value).toBe('67%')
  })

  test('failed verifications counts proof.fail', () => {
    expect(one('failed-verifications', proofs(5, 0))).toMatchObject({ value: '0 failed', raw: 0, status: 'good' })
    expect(one('failed-verifications', proofs(1, 2))).toMatchObject({ value: '2 failed', raw: 2, status: 'warn' })
    expect(one('failed-verifications', proofs(0, 3)).status).toBe('warn')
    expect(one('failed-verifications', proofs(0, 4)).status).toBe('bad')
  })

  test('both are n/a before any verification ran, even with other entries', () => {
    const other = [e('config.changed', 0)]
    expect(one('first-pass-green', other).status).toBe('n/a')
    expect(one('failed-verifications', other).status).toBe('n/a')
  })
})

describe('Deploy metrics', () => {
  test('gate wait is the median time from gate.opened to gate.approved', () => {
    const entries = [
      gate('gate.opened', 'spec.approve', 0, 'a'),
      gate('gate.approved', 'spec.approve', 20 * MIN, 'a'),
      gate('gate.opened', 'release.approve', HOUR, 'a'),
      gate('gate.approved', 'release.approve', HOUR + 40 * MIN, 'a'),
      gate('gate.opened', 'plan.accept', 0, 'b'),
      gate('gate.approved', 'plan.accept', 2 * HOUR, 'b'),
    ]
    expect(one('gate-wait', entries)).toMatchObject({ value: '40m', raw: 40 * MIN, status: 'good' })
  })

  test('thresholds: good up to 1h, warn up to 8h, bad beyond', () => {
    const wait = (ms: number) => one('gate-wait', [gate('gate.opened', 'spec.approve', 0), gate('gate.approved', 'spec.approve', ms)])
    expect(wait(HOUR).status).toBe('good')
    expect(wait(HOUR + MIN).status).toBe('warn')
    expect(wait(8 * HOUR).status).toBe('warn')
    expect(wait(9 * HOUR).status).toBe('bad')
  })

  test('a rejection voids the wait and the reopened gate is measured from its new opening', () => {
    const entries = [
      gate('gate.opened', 'spec.approve', 0),
      gate('gate.rejected', 'spec.approve', 5 * HOUR),
      gate('gate.opened', 'spec.approve', 6 * HOUR),
      gate('gate.approved', 'spec.approve', 6 * HOUR + 10 * MIN),
    ]
    expect(one('gate-wait', entries).raw).toBe(10 * MIN)
  })

  test('a gate that is still waiting, or approved without being opened, is not counted', () => {
    expect(one('gate-wait', [gate('gate.opened', 'spec.approve', 0)]).status).toBe('n/a')
    expect(one('gate-wait', [gate('gate.approved', 'verify.pass', 0)]).status).toBe('n/a')
  })

  test('guard interceptions count guard.blocked and group them by guard', () => {
    const blocks = [
      ...['production-gate', 'production-gate', 'production-gate', 'protect-paths', 'protect-paths'].map((g, i) => e('guard.blocked', i, { actor: 'agent', data: { guard: g } })),
    ]
    expect(one('guard-interceptions', blocks)).toMatchObject({ value: '5 blocked', raw: 5, status: 'warn' })
    expect(one('guard-interceptions', blocks).hint).toBe('Times a guard refused the agent: 3 production-gate, 2 protect-paths.')
  })

  test('ties are listed alphabetically and an unnamed guard is "unknown"', () => {
    const blocks = [e('guard.blocked', 0, { data: { guard: 'test-lock' } }), e('guard.blocked', 1, { data: { guard: 'plan-first' } }), e('guard.blocked', 2)]
    expect(one('guard-interceptions', blocks).hint).toBe('Times a guard refused the agent: 1 plan-first, 1 test-lock, 1 unknown.')
  })

  test('no interceptions in a live ledger is a clean zero; an empty ledger is n/a', () => {
    expect(one('guard-interceptions', [e('proof.pass', 0)])).toMatchObject({ value: '0 blocked', raw: 0, status: 'good' })
    expect(one('guard-interceptions', [e('proof.pass', 0)]).hint).toBe('Times a guard refused the agent.')
    expect(one('guard-interceptions', []).status).toBe('n/a')
  })
})

describe('Maintain metrics', () => {
  const breach = (at: number, metricName?: string) => e('band.breach', at, metricName ? { data: { metric: metricName } } : {})
  const intent = (at: number, metricName?: string) => e('incident.intent', at, metricName ? { data: { metric: metricName } } : {})

  test('breach-to-intent latency pairs each incident intent with its breach', () => {
    expect(one('breach-to-intent', [breach(0, 'm'), intent(3 * MIN, 'm')])).toMatchObject({ value: '3m', raw: 3 * MIN, status: 'good', target: '< 5 minutes' })
  })

  test('thresholds: good within 5 minutes, warn within an hour, bad beyond', () => {
    const lat = (ms: number) => one('breach-to-intent', [breach(0), intent(ms)])
    expect(lat(5 * MIN).status).toBe('good')
    expect(lat(5 * MIN + 1000).status).toBe('warn')
    expect(lat(HOUR).status).toBe('warn')
    expect(lat(HOUR + MIN)).toMatchObject({ status: 'bad', value: '1h 1m' })
  })

  test('pairs by metric and takes the median over incidents', () => {
    const entries = [breach(0, 'a'), breach(MIN, 'b'), intent(2 * MIN, 'a'), intent(11 * MIN, 'b'), breach(20 * MIN, 'a'), intent(24 * MIN, 'a')]
    // a: 2m, b: 10m, a again: 4m -> median 4m
    expect(one('breach-to-intent', entries).raw).toBe(4 * MIN)
  })

  test('one breach pairs once, an intent without a breach is ignored, a breach without an intent too', () => {
    expect(one('breach-to-intent', [breach(0), intent(MIN), intent(2 * MIN)]).raw).toBe(MIN)
    expect(one('breach-to-intent', [intent(MIN)]).status).toBe('n/a')
    expect(one('breach-to-intent', [breach(0)]).status).toBe('n/a')
    expect(one('breach-to-intent', [breach(0, 'a'), intent(MIN, 'b')]).status).toBe('n/a')
  })

  test('a metric-less breach or intent pairs with whatever is nearest', () => {
    expect(one('breach-to-intent', [breach(0), intent(MIN, 'x')]).raw).toBe(MIN)
    expect(one('breach-to-intent', [breach(0, 'x'), intent(MIN)]).raw).toBe(MIN)
  })

  test('parallel runs counts runs that are not fully done', () => {
    const open = (n: number) => Array.from({ length: n }, (_, i) => snap(`r${i}`))
    expect(one('parallel-runs', [], open(2))).toMatchObject({ value: '2 active', raw: 2, status: 'good', target: '2–3' })
    expect(one('parallel-runs', [], open(1)).status).toBe('good')
    expect(one('parallel-runs', [], open(3)).status).toBe('good')
    expect(one('parallel-runs', [], open(4)).status).toBe('warn')
    expect(one('parallel-runs', [], open(5)).status).toBe('warn')
    expect(one('parallel-runs', [], open(6)).status).toBe('bad')
  })

  test('released runs do not count as parallel work; no active runs is a quiet zero', () => {
    const list = [snap('a'), snap('b', { states: DONE }), snap('c', { states: ['done', 'done', 'done', 'done', 'blocked', 'pending'] })]
    expect(one('parallel-runs', [], list).raw).toBe(2)
    expect(one('parallel-runs', [], [snap('b', { states: DONE })])).toMatchObject({ value: '0 active', raw: 0, status: 'good' })
    expect(one('parallel-runs', [], []).status).toBe('n/a')
  })
})
