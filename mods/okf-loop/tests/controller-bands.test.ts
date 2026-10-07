import { test, expect, describe } from 'claude-code/testing'

import { MIN, World, startedWorld } from './loop-world'

const SLUG = 'add-rate-limiting'

describe('Stage 6 control bands', () => {
  const config = {
    bands: {
      enabled: true,
      window: 10,
      tier3: 'runbook',
      runbook: ['./rollback.sh', 'prod'],
      sources: [{ metric: 'ci_failure_rate', description: 'CI failure rate', argv: ['./rate.sh'], parse: 'number', intervalMinutes: 5, higherIsWorse: true }],
    },
  }

  function steady(w: World, n = 10): void {
    for (let i = 0; i < n; i++) {
      w.advance(10 * MIN)
      w.measured('ci_failure_rate', 0.1 + (i % 2) * 0.04)
    }
  }

  test('no source configured: the whole feature is silent', () => {
    const w = new World().boot()
    expect(w.model.bands.samples).toEqual({})
    expect(w.run('bands')).toContain('Bands are off')
    expect(w.run('bands check')).toContain('No band source')
    expect(w.bandChecks).toEqual([])
  })

  test('sources are due on their interval and a check now asks the wiring to measure them', () => {
    const w = new World({ config }).boot()
    expect(w.run('bands check')).toContain('Checking 1 band source')
    expect(w.bandChecks).toEqual([['ci_failure_rate']])
  })

  test('samples are appended to a file; a quiet series raises nothing', () => {
    const w = new World({ config }).boot()
    steady(w)
    expect(w.text('.okf/bands/ci_failure_rate.jsonl')?.trim().split('\n').length).toBe(10)
    expect(w.model.bands.readings.ci_failure_rate?.tier).toMatch(/in-control|1sigma/)
    expect(w.ledgerOf('band.breach')).toEqual([])
    expect(w.spawns).toEqual([])
    expect(w.ledgerOf('band.sample').length).toBe(1)
  })

  test('a number that is not there is a toast, not a sample', () => {
    const w = new World({ config }).boot()
    w.send({ type: 'band.measured', now: w.now, metric: 'ci_failure_rate', stdout: 'oops', ok: true })
    expect(w.files.has('.okf/bands/ci_failure_rate.jsonl')).toBe(false)
    expect(w.toasts.some(t => t.includes('no number found'))).toBe(true)
  })

  test('2sigma: a read-only diagnosis is spawned once, then the harness writes the incident intent and opens a run', () => {
    const w = new World({ config }).boot()
    steady(w)
    w.advance(10 * MIN)
    w.measured('ci_failure_rate', 0.17)
    expect(w.model.bands.readings.ci_failure_rate?.tier).toBe('2sigma')
    expect(w.ledgerOf('band.breach').length).toBe(1)
    expect(w.spawns.length).toBe(1)
    expect(w.spawns[0]?.prompt).toContain('READ-ONLY')
    expect(w.toasts.some(t => t.includes('2σ breach'))).toBe(true)
    // the same breach is not re-announced while the tier holds
    w.advance(10 * MIN)
    w.measured('ci_failure_rate', 0.17)
    expect(w.spawns.length).toBe(1)
    expect(w.ledgerOf('band.breach').length).toBe(1)

    const spawn = w.spawns[0]
    if (!spawn) throw new Error('no spawn')
    w.advance(MIN)
    w.send({ type: 'band.diagnosis', now: w.now, metric: 'ci_failure_rate', reading: spawn.reading, diagnosis: '### Signature\nretry storm after abc123', author: 'Ana' })
    const slug = w.model.runs.find(r => r.record.source === 'anomaly')?.record.slug
    expect(slug).toBe('incident-2026-10-06-ci-failure-rate')
    const intent = w.text(`intent/${slug}.md`) ?? ''
    expect(intent).toContain('ANOMALY-ci_failure_rate-2026-10-06')
    expect(intent).toContain('retry storm after abc123')
    expect(intent).toContain('**Status:** draft')
    expect(w.record(slug ?? '').source).toBe('anomaly')
    expect(w.ledgerOf('incident.intent')[0]?.data).toMatchObject({ metric: 'ci_failure_rate' })
    expect(w.ledgerOf('run.created').some(e => e.data?.source === 'anomaly')).toBe(true)
    expect(w.model.active).toBe(slug)
    // the incident intent is a Stage 1 artifact waiting for a human, not an action
    expect(w.active.snapshot.next.kind).toBe('await-human')
    expect(w.prompts.length).toBe(0)
  })

  test('the incident does not hijack a run the person is already working on', () => {
    const w = startedWorld('manual')
    w.run('plays enable 13')
    const cfg = JSON.parse(w.text('.okf/config.json') ?? '{}')
    w.put('.okf/config.json', JSON.stringify({ ...cfg, ...config }))
    w.refresh()
    steady(w)
    w.advance(10 * MIN)
    w.measured('ci_failure_rate', 0.5)
    const spawn = w.spawns[0]
    if (!spawn) throw new Error('no spawn')
    w.send({ type: 'band.diagnosis', now: w.now, metric: 'ci_failure_rate', reading: spawn.reading, diagnosis: '', author: 'Ana' })
    expect(w.model.active).toBe(SLUG)
    expect(w.model.runs.length).toBe(2)
  })

  test('3sigma is only ever a proposal; the runbook is a person\'s call and runs once', () => {
    const w = new World({ config }).boot()
    steady(w)
    w.advance(10 * MIN)
    w.measured('ci_failure_rate', 0.9)
    expect(w.model.bands.readings.ci_failure_rate?.tier).toBe('3sigma')
    expect(w.ledgerOf('band.breach')[0]?.data?.tier).toBe('3sigma')
    expect(Object.keys(w.model.bands.proposals)).toEqual(['ci_failure_rate'])
    expect(w.toasts.some(t => t.includes('3σ') && t.includes('/sdlc bands runbook'))).toBe(true)
    expect(w.processes).toEqual([])

    expect(w.run('bands runbook', { origin: 'plugin' })).toContain('reserved for a person')
    expect(w.processes).toEqual([])
    expect(w.run('bands runbook')).toContain('Running the runbook once')
    expect(w.processes.length).toBe(1)
    expect(w.processes[0]?.argv).toEqual(['./rollback.sh', 'prod'])
    expect(w.run('bands runbook')).toContain('no 3σ proposal')
    expect(w.processes.length).toBe(1)
  })

  test('without a runbook configured the proposal stays a proposal', () => {
    const w = new World({ config: { bands: { ...config.bands, tier3: 'propose', runbook: [] } } }).boot()
    steady(w)
    w.advance(10 * MIN)
    w.measured('ci_failure_rate', 0.9)
    expect(w.run('bands runbook')).toContain('No runbook is configured')
    expect(w.processes).toEqual([])
  })

  test('a fall in a "lower is worse" metric is the bad direction', () => {
    const lower = { bands: { ...config.bands, sources: [{ ...config.bands.sources[0], metric: 'throughput', higherIsWorse: false }] } }
    const w = new World({ config: lower }).boot()
    for (let i = 0; i < 10; i++) {
      w.advance(10 * MIN)
      w.measured('throughput', 100 + (i % 2) * 2)
    }
    w.advance(10 * MIN)
    w.measured('throughput', 200)
    expect(w.model.bands.readings.throughput?.tier).toBe('in-control')
    w.advance(10 * MIN)
    w.measured('throughput', 20)
    expect(['2sigma', '3sigma']).toContain(w.model.bands.readings.throughput?.tier)
  })

  test('/sdlc bands status shows where each metric stands', () => {
    const w = new World({ config }).boot()
    steady(w, 3)
    expect(w.run('bands')).toContain('collecting (3 samples)')
    steady(w)
    expect(w.run('bands')).toContain('ci_failure_rate:')
  })
})
