import { test, expect, describe } from 'claude-code/testing'
import type { LedgerEntry, LedgerKind } from '../types'
import {
  DEFAULT_LEDGER_FILTER,
  appendEntry,
  auditMarkdown,
  describeEntry,
  filterLedger,
  ledgerIcon,
  makeEntry,
  parseLedger,
  toLine,
} from '../hooks/core/ledger'

const T0 = Date.UTC(2026, 9, 6, 9, 0, 0)
const MIN = 60_000

const ALL_KINDS: LedgerKind[] = [
  'run.created',
  'stage.entered',
  'artifact.written',
  'gate.opened',
  'gate.approved',
  'gate.rejected',
  'guard.blocked',
  'proof.pass',
  'proof.fail',
  'autopilot.queued',
  'autopilot.halted',
  'release.granted',
  'release.revoked',
  'band.sample',
  'band.breach',
  'incident.intent',
  'play.toggled',
  'config.changed',
  'scaffold.created',
  'lesson.recorded',
  'agent.verdict',
]

function entry(kind: LedgerKind, at: number, over: Partial<LedgerEntry> = {}): LedgerEntry {
  return { ts: T0 + at * MIN, kind, actor: 'mod', summary: `${kind} summary`, ...over }
}

describe('makeEntry / toLine / parseLedger', () => {
  test('makeEntry stamps the time and keeps the fields', () => {
    expect(makeEntry({ kind: 'run.created', actor: 'human', summary: 'x', run: 'a', data: { by: 'Ana' } }, 42)).toEqual({
      kind: 'run.created',
      actor: 'human',
      summary: 'x',
      run: 'a',
      data: { by: 'Ana' },
      ts: 42,
    })
  })

  test('makeEntry lets the explicit time win', () => {
    const forged = { kind: 'run.created', actor: 'mod', summary: 'x', ts: 1 } as unknown as Omit<LedgerEntry, 'ts'>
    expect(makeEntry(forged, 2).ts).toBe(2)
  })

  test('toLine is one line of JSON with a stable key order', () => {
    const line = toLine({ ts: 5, kind: 'gate.approved', run: 'r', stage: 'plan', actor: 'human', summary: 'multi\nline', data: { gate: 'intent.approve', by: 'Ana' } })
    expect(line.includes('\n')).toBe(false)
    expect(line).toBe('{"ts":5,"kind":"gate.approved","run":"r","stage":"plan","actor":"human","summary":"multi\\nline","data":{"gate":"intent.approve","by":"Ana"}}')
  })

  test('optional fields are omitted, not written as null', () => {
    expect(toLine({ ts: 1, kind: 'config.changed', actor: 'mod', summary: 's' })).toBe('{"ts":1,"kind":"config.changed","actor":"mod","summary":"s"}')
  })

  test('entries survive a round trip through the file format', () => {
    const entries = [
      entry('run.created', 0, { run: 'a', actor: 'human', data: { title: 'Add "login"', n: 3, ok: true, none: null } }),
      entry('gate.approved', 5, { run: 'a', stage: 'plan', data: { gate: 'intent.approve' } }),
      entry('config.changed', 6, { summary: 'päyload | with, odd "chars" \\ and unicode ✔' }),
    ]
    const text = entries.reduce((acc, e) => appendEntry(acc, e), '')
    expect(parseLedger(text)).toEqual(entries)
  })

  test('parseLedger tolerates blank, torn and foreign lines and keeps the rest', () => {
    const good1 = toLine(entry('run.created', 0, { run: 'a' }))
    const good2 = toLine(entry('proof.pass', 2, { run: 'a' }))
    const text = [
      '',
      good1,
      '   ',
      '{"ts": 12, "kind": "proof.pa',
      'not json at all',
      '[1,2,3]',
      '"a string"',
      'null',
      '42',
      '{"kind":"run.created","actor":"mod","summary":"no ts"}',
      '{"ts":"yesterday","kind":"run.created","actor":"mod","summary":"bad ts"}',
      '{"ts":5,"actor":"mod","summary":"no kind"}',
      '{"ts":5,"kind":"","actor":"mod","summary":"empty kind"}',
      good2,
      '',
    ].join('\n')
    expect(parseLedger(text).map((e) => e.kind)).toEqual(['run.created', 'proof.pass'])
  })

  test('parseLedger copes with CRLF line endings', () => {
    const text = `${toLine(entry('run.created', 0))}\r\n${toLine(entry('proof.pass', 1))}\r\n`
    expect(parseLedger(text)).toHaveLength(2)
  })

  test('parseLedger normalises odd fields instead of dropping the line', () => {
    const [e] = parseLedger('{"ts":9,"kind":"gate.approved","actor":"robot","stage":"warp","run":7,"summary":12,"data":{"a":"x","b":{"deep":1},"c":[1],"d":null,"e":1.5,"f":false}}')
    expect(e).toEqual({ ts: 9, kind: 'gate.approved', actor: 'mod', summary: '', data: { a: 'x', d: null, e: 1.5, f: false } })
  })

  test('parseLedger keeps kinds it does not know: a newer mod may have written them', () => {
    const [e] = parseLedger('{"ts":1,"kind":"future.kind","actor":"agent","summary":"later"}')
    expect(e?.kind).toBe('future.kind' as LedgerKind)
    expect(e?.actor).toBe('agent')
  })

  test('parseLedger keeps the newest `limit` entries in file order', () => {
    const text = [0, 1, 2, 3, 4].reduce((acc, i) => appendEntry(acc, entry('band.sample', i, { summary: `s${i}` })), '')
    expect(parseLedger(text, 2).map((e) => e.summary)).toEqual(['s3', 's4'])
    expect(parseLedger(text, 5)).toHaveLength(5)
    expect(parseLedger(text, 99)).toHaveLength(5)
    expect(parseLedger(text, 0)).toEqual([])
    expect(parseLedger(text)).toHaveLength(5)
    expect(parseLedger('', 3)).toEqual([])
  })
})

describe('appendEntry', () => {
  const e = entry('run.created', 0, { run: 'a' })

  test('into an empty file writes one terminated line', () => {
    expect(appendEntry('', e)).toBe(`${toLine(e)}\n`)
  })

  test('adds the missing trailing newline before appending', () => {
    const torn = toLine(entry('proof.pass', 1))
    expect(appendEntry(torn, e)).toBe(`${torn}\n${toLine(e)}\n`)
  })

  test('never doubles a newline that is already there', () => {
    const base = `${toLine(entry('proof.pass', 1))}\n`
    expect(appendEntry(base, e)).toBe(`${base}${toLine(e)}\n`)
  })

  test('appending is append-only: the old bytes are a prefix of the new file', () => {
    const base = appendEntry('', e)
    expect(appendEntry(base, entry('proof.fail', 3)).startsWith(base)).toBe(true)
  })
})

describe('filterLedger', () => {
  const entries = [
    entry('run.created', 0, { run: 'a', actor: 'human', summary: 'Started add-login' }),
    entry('gate.approved', 1, { run: 'a', data: { gate: 'intent.approve', by: 'Ana' }, summary: 'intent approved' }),
    entry('guard.blocked', 2, { run: 'b', actor: 'agent', summary: 'plan-first: write refused', data: { guard: 'plan-first' } }),
    entry('proof.fail', 3, { run: 'b', summary: 'make test failed' }),
    entry('config.changed', 4, { summary: 'autonomy.mode = guided' }),
  ]

  test('the default filter keeps everything', () => {
    expect(DEFAULT_LEDGER_FILTER).toEqual({ kinds: null, run: null, query: '' })
    expect(filterLedger(entries, DEFAULT_LEDGER_FILTER)).toEqual(entries)
  })

  test('by kind', () => {
    expect(filterLedger(entries, { ...DEFAULT_LEDGER_FILTER, kinds: ['gate.approved', 'proof.fail'] }).map((e) => e.kind)).toEqual(['gate.approved', 'proof.fail'])
    expect(filterLedger(entries, { ...DEFAULT_LEDGER_FILTER, kinds: [] })).toEqual([])
  })

  test('by run drops entries of other runs and of no run', () => {
    expect(filterLedger(entries, { ...DEFAULT_LEDGER_FILTER, run: 'b' }).map((e) => e.kind)).toEqual(['guard.blocked', 'proof.fail'])
  })

  test('by query: case-insensitive over summary, kind, actor and data', () => {
    const q = (query: string) => filterLedger(entries, { ...DEFAULT_LEDGER_FILTER, query }).map((e) => e.kind)
    expect(q('ADD-LOGIN')).toEqual(['run.created'])
    expect(q('intent.approve')).toEqual(['gate.approved'])
    expect(q('ana')).toEqual(['gate.approved'])
    expect(q('agent')).toEqual(['guard.blocked'])
    expect(q('proof.')).toEqual(['proof.fail'])
    expect(q('  plan-first  ')).toEqual(['guard.blocked'])
    expect(q('zzz')).toEqual([])
  })

  test('filters combine', () => {
    expect(filterLedger(entries, { kinds: ['guard.blocked', 'proof.fail'], run: 'b', query: 'make' }).map((e) => e.kind)).toEqual(['proof.fail'])
  })

  test('does not reorder or mutate', () => {
    const copy = [...entries]
    filterLedger(entries, { kinds: ['proof.fail'], run: null, query: '' })
    expect(entries).toEqual(copy)
  })
})

describe('ledgerIcon', () => {
  test('every kind has exactly one glyph', () => {
    for (const k of ALL_KINDS) expect([...ledgerIcon(k)].length).toBe(1)
  })

  test('gates, proofs and guards read at a glance', () => {
    expect(ledgerIcon('gate.approved')).toBe('✔')
    expect(ledgerIcon('gate.rejected')).toBe('✖')
    expect(ledgerIcon('proof.pass')).toBe('✔')
    expect(ledgerIcon('proof.fail')).toBe('✖')
    expect(ledgerIcon('gate.opened')).toBe('◆')
    expect(ledgerIcon('autopilot.queued')).toBe('▶')
    expect(ledgerIcon('guard.blocked')).toBe('⚑')
    expect(ledgerIcon('artifact.written')).toBe('✎')
  })

  test('an unknown kind still gets a glyph', () => {
    expect(ledgerIcon('future.kind' as LedgerKind)).toBe('·')
  })
})

describe('describeEntry', () => {
  test('gate events name the person and the gate', () => {
    expect(describeEntry(entry('gate.approved', 0, { actor: 'human', run: 'add-login', data: { gate: 'intent.approve', by: 'Ana' } }))).toBe('Ana approved intent.approve on add-login.')
    expect(describeEntry(entry('gate.approved', 0, { actor: 'mod', run: 'add-login', data: { gate: 'verify.pass' } }))).toBe('Gate verify.pass passed its machine checks on add-login.')
    expect(describeEntry(entry('gate.rejected', 0, { actor: 'human', data: { gate: 'spec.approve', by: 'Bo', reason: 'scope is too wide' } }))).toBe('Bo rejected spec.approve: scope is too wide.')
    expect(describeEntry(entry('gate.opened', 0, { run: 'r', data: { gate: 'plan.accept' } }))).toBe('Gate plan.accept is ready for a human decision on r.')
  })

  test('run, stage, artifact and proof events', () => {
    expect(describeEntry(entry('run.created', 0, { actor: 'human', run: 'add-login', data: { title: 'Add login' } }))).toBe('A human started run add-login: Add login.')
    expect(describeEntry(entry('stage.entered', 0, { run: 'add-login', stage: 'build' }))).toBe('Run add-login entered the Build stage.')
    expect(describeEntry(entry('artifact.written', 0, { actor: 'agent', run: 'r', data: { kind: 'spec', path: 'specs/r.spec.md' } }))).toBe('The agent wrote specs/r.spec.md on r.')
    expect(describeEntry(entry('proof.pass', 0, { run: 'r', data: { command: 'make test' } }))).toBe('Verification command "make test" passed on r.')
    expect(describeEntry(entry('proof.fail', 0, {}))).toBe('A verification run failed.')
  })

  test('guard, autopilot, release and band events', () => {
    expect(describeEntry(entry('guard.blocked', 0, { actor: 'agent', summary: 'Production deploys need a grant', data: { guard: 'production-gate' } }))).toBe('The production-gate guard stopped the agent: Production deploys need a grant.')
    expect(describeEntry(entry('autopilot.queued', 0, { run: 'r', data: { action: 'verify' } }))).toBe('Autopilot queued the verify step on r.')
    expect(describeEntry(entry('release.granted', 0, { actor: 'human', data: { by: 'Rita', minutes: 15 } }))).toBe('Rita granted a release window of 15 minutes.')
    expect(describeEntry(entry('release.revoked', 0, { actor: 'human' }))).toBe('A human revoked the release window.')
    expect(describeEntry(entry('band.breach', 0, { data: { metric: 'ci_failure_rate', tier: '2sigma' } }))).toBe('Metric ci_failure_rate breached its control band (2sigma).')
    expect(describeEntry(entry('incident.intent', 0, { data: { metric: 'ci_failure_rate' } }))).toBe('An incident intent was written for ci_failure_rate.')
  })

  test('a missing data key falls back to the writer summary, and an empty summary to the kind', () => {
    expect(describeEntry(entry('gate.approved', 0, { summary: 'intent approved by Ana' }))).toBe('Intent approved by Ana.')
    expect(describeEntry(entry('config.changed', 0, { summary: 'autonomy.mode set to guided.' }))).toBe('autonomy.mode set to guided.')
    expect(describeEntry(entry('play.toggled', 0, { summary: '' }))).toBe('play.toggled.')
  })

  test('always one tidy sentence', () => {
    const long = describeEntry(entry('agent.verdict', 0, { summary: `line one\nline two ${'x'.repeat(400)}` }))
    expect(long.includes('\n')).toBe(false)
    expect(long.length).toBeLessThan(205)
    expect(long.endsWith('…') || long.endsWith('.')).toBe(true)
    for (const k of ALL_KINDS) expect(describeEntry(entry(k, 0))).toMatch(/[.!?…]$/)
  })
})

describe('auditMarkdown', () => {
  const entries: LedgerEntry[] = [
    entry('run.created', 0, { run: 'add-login', actor: 'human', summary: 'Run started', data: { by: 'Ana', title: 'Add login', source: 'human' } }),
    entry('artifact.written', 1, { run: 'add-login', actor: 'agent', summary: 'intent written', data: { kind: 'intent', path: 'intent/add-login.md' } }),
    entry('artifact.written', 2, { run: 'add-login', actor: 'agent', summary: 'intent rewritten', data: { kind: 'intent', path: 'intent/add-login.md' } }),
    entry('gate.opened', 3, { run: 'add-login', stage: 'plan', summary: 'ready', data: { gate: 'intent.approve' } }),
    entry('gate.approved', 10, { run: 'add-login', stage: 'plan', actor: 'human', summary: 'approved', data: { gate: 'intent.approve', by: 'Ana', via: 'press', note: 'looks right | go' } }),
    entry('guard.blocked', 12, { run: 'add-login', actor: 'agent', summary: 'plan-first refused', data: { guard: 'plan-first' } }),
    entry('proof.fail', 30, { run: 'add-login', summary: 'tests failed', data: { command: 'make test' } }),
    entry('proof.pass', 40, { run: 'add-login', summary: 'tests passed', data: { command: 'make test' } }),
    entry('gate.approved', 90, { run: 'add-login', actor: 'human', summary: 'release', data: { gate: 'release.approve', by: 'Rita' } }),
    entry('band.sample', 100, { summary: 'sample' }),
    entry('config.changed', 101, { summary: 'autonomy.mode = guided' }),
    entry('run.created', 110, { run: 'fix-5xx', actor: 'mod', summary: 'Incident run', data: { source: 'anomaly' } }),
  ]
  const md = auditMarkdown(entries, { project: 'checkout', generatedAt: T0 + 200 * MIN })

  test('opens with the project, generation time, scope and entry count', () => {
    expect(md.startsWith('# Audit trail: checkout\n')).toBe(true)
    expect(md).toContain('Generated 2026-10-06 12:20:00 UTC · scope: all runs · 12 ledger entries')
    expect(md).toContain('First entry 2026-10-06 09:00:00 UTC · last entry 2026-10-06 10:50:00 UTC')
    expect(md).toContain('cannot pass it')
  })

  test('has the summary, chain of custody and chronological log sections in order', () => {
    const at = (h: string) => md.indexOf(h)
    expect(at('## Summary')).toBeGreaterThan(0)
    expect(at('## Chain of custody')).toBeGreaterThan(at('## Summary'))
    expect(at('## Chronological log')).toBeGreaterThan(at('## Chain of custody'))
  })

  test('the summary counts gates, verifications and interceptions', () => {
    expect(md).toContain('| Gates approved | Gates rejected | Verifications | Guard interceptions | Release grants |')
    expect(md).toContain('| 2 | 0 | 1 passed / 1 failed | 1 | 0 |')
  })

  test('one section per run, in first-seen order, with who originated it and who released', () => {
    expect(md.indexOf('### add-login')).toBeLessThan(md.indexOf('### fix-5xx'))
    expect(md).toContain('- Originated by: Ana on 2026-10-06 09:00:00 UTC')
    expect(md).toContain('- Gates passed: intent.approve, release.approve')
    expect(md).toContain('- Release authorized by: Rita on 2026-10-06 10:30:00 UTC')
    expect(md).toContain('- Guard interceptions: 1')
    expect(md).toContain('- Release authorized by: not authorized')
    expect(md).toContain('- Originated by: mod on 2026-10-06 10:50:00 UTC')
  })

  test('the custody table reads stage, artifact, who and when, evidence', () => {
    expect(md).toContain('| Stage | Artifact | Who | When (UTC) | Evidence |')
    expect(md).toContain('| Plan | intent/add-login.md | agent | 2026-10-06 09:02:00 UTC | 2 writes, first 2026-10-06 09:01:00 UTC |')
    expect(md).toContain('| Plan | intent.approve | Ana | 2026-10-06 09:10:00 UTC | human approval; via press; looks right \\| go |')
    expect(md).toContain('| Test | proof | mod | 2026-10-06 09:30:00 UTC | make test FAILED |')
    expect(md).toContain('| Test | proof | mod | 2026-10-06 09:40:00 UTC | make test passed |')
    expect(md).toContain('| Deploy | release.approve | Rita | 2026-10-06 10:30:00 UTC | human approval |')
  })

  test('custody rows are ordered by stage, then by time', () => {
    const section = md.slice(md.indexOf('### add-login'), md.indexOf('### fix-5xx'))
    const order = ['Plan', 'Test', 'Deploy']
    const rows = section.split('\n').filter((l) => order.some((s) => l.startsWith(`| ${s} |`)))
    const stages = rows.map((r) => order.indexOf((r.split(' | ')[0] ?? '').replace('| ', '')))
    expect(stages.length).toBe(6)
    expect(stages).toEqual([...stages].sort((a, b) => a - b))
    const plan = rows.filter((r) => r.startsWith('| Plan |')).map((r) => r.split(' | ')[3])
    expect(plan).toEqual([...plan].sort())
  })

  test('the chronological log lists every entry but band samples, with icon, actor and a sentence', () => {
    expect(md).toContain('| Time (UTC) | Run | Actor | Event | Detail |')
    expect(md).toContain('| 2026-10-06 09:10:00 UTC | add-login | Ana | ✔ gate.approved | Ana approved intent.approve on add-login. |')
    expect(md).toContain('| 2026-10-06 10:41:00 UTC | — | mod | ≡ config.changed | autonomy.mode = guided. |')
    expect(md).not.toContain('band.sample |')
    expect(md).toContain('_1 band sample omitted from the log')
  })

  test('pipes in free text cannot break a table row', () => {
    for (const line of md.split('\n').filter((l) => l.startsWith('| ') && l.includes('looks right'))) {
      expect(line.replace(/\\\|/g, '').split('|').length).toBe(7)
    }
  })

  test('ends with a checksum that changes when an entry changes', () => {
    const sum = (text: string) => /Checksum of the (\d+) entries above .*`([0-9a-f]{8})`/.exec(text)
    expect(sum(md)?.[1]).toBe('12')
    const tampered = auditMarkdown(entries.map((e, i) => (i === 4 ? { ...e, summary: 'edited' } : e)), { project: 'checkout', generatedAt: T0 + 200 * MIN })
    expect(sum(tampered)?.[2]).not.toBe(sum(md)?.[2])
    expect(sum(auditMarkdown(entries, { project: 'checkout', generatedAt: 1 }))?.[2]).toBe(sum(md)?.[2])
  })

  test('is deterministic', () => {
    expect(auditMarkdown(entries, { project: 'checkout', generatedAt: T0 })).toBe(auditMarkdown(entries, { project: 'checkout', generatedAt: T0 }))
  })

  test('a run scope keeps only that run', () => {
    const one = auditMarkdown(entries, { project: 'checkout', generatedAt: T0, run: 'fix-5xx' })
    expect(one).toContain('scope: run `fix-5xx` · 1 ledger entry')
    expect(one).toContain('### fix-5xx')
    expect(one).not.toContain('### add-login')
    expect(one).not.toContain('config.changed')
  })

  test('entries are ordered by time even when the file is not', () => {
    const shuffled = auditMarkdown([...entries].reverse(), { project: 'checkout', generatedAt: T0 })
    const log = (text: string) => text.slice(text.indexOf('## Chronological log'), text.indexOf('_1 band sample'))
    expect(log(shuffled)).toBe(log(md))
  })

  test('an empty ledger still produces a document', () => {
    const empty = auditMarkdown([], { project: 'checkout', generatedAt: T0 })
    expect(empty).toContain('# Audit trail: checkout')
    expect(empty).toContain('0 ledger entries')
    expect(empty).toContain('_No ledger entries yet._')
    expect(auditMarkdown(entries, { project: 'checkout', generatedAt: T0, run: 'nope' })).toContain('_No ledger entries yet._')
  })

  test('project-level events without a run are in the log but have no custody section', () => {
    const only = auditMarkdown([entry('config.changed', 0, { summary: 'x' })], { project: 'p', generatedAt: T0 })
    expect(only).toContain('_No run-scoped events._')
    expect(only).toContain('config.changed')
  })

  test('a run with no custody events says so', () => {
    const quiet = auditMarkdown([entry('stage.entered', 0, { run: 'r', stage: 'plan', summary: 'entered' })], { project: 'p', generatedAt: T0 })
    expect(quiet).toContain('_No custody events recorded for this run._')
  })

  test('a gate rejection and a lesson appear as custody evidence', () => {
    const doc = auditMarkdown(
      [
        entry('gate.rejected', 0, { run: 'r', actor: 'human', summary: 'no', data: { gate: 'spec.approve', by: 'Bo', reason: 'too broad' } }),
        entry('lesson.recorded', 1, { run: 'r', summary: 'cache key lesson', data: { path: 'lessons/2026-10-06-cache.md' } }),
        entry('incident.intent', 2, { run: 'r', data: { metric: 'm', path: 'intent/incident-2026-10-06.md' } }),
        entry('release.granted', 3, { run: 'r', actor: 'human', data: { by: 'Rita', minutes: 15 } }),
      ],
      { project: 'p', generatedAt: T0 },
    )
    expect(doc).toContain('| Design | spec.approve | Bo | 2026-10-06 09:00:00 UTC | rejected: too broad |')
    expect(doc).toContain('| Maintain | lessons/2026-10-06-cache.md | mod | 2026-10-06 09:01:00 UTC | cache key lesson |')
    expect(doc).toContain('| Maintain | intent/incident-2026-10-06.md | mod | 2026-10-06 09:02:00 UTC | anomaly: m |')
    expect(doc).toContain('| Deploy | release grant | Rita | 2026-10-06 09:03:00 UTC | granted for 15 min |')
  })
})
