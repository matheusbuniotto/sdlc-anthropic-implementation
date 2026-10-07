import { describe, expect, test } from 'claude-code/testing'
import type { BandReading, BandSource, BandSpec } from '../types'
import {
  diagnoseToolList,
  dueSources,
  extractMetric,
  incidentIntentMarkdown,
  incidentSlug,
  parseBandsYaml,
  parseSamples,
  sampleLine,
} from '../hooks/core/bands'
import { parseFrontmatter } from '../hooks/core/yaml'

// openknowledge/templates/bands.template.yaml, verbatim
const TEMPLATE = `---
id: okf-template-bands
title: "Template: Statistical Control Bands (bands.yaml)"
type: template
stage: stage-6-maintain
last_updated: "2026-10-06"
summary: Template for defining statistical process control bands for production metrics and mapping breaches to autonomous agent actions.
---

# Statistical Control Bands Specification
# Used by deterministic observability scripts to trigger autonomous agents

metric: ci_test_failure_rate
description: "Percentage of CI test runs failing on the main branch over rolling window"
baseline: rolling_30d
interval: 1h
rules: western_electric

tiers:
  # 1-Sigma: Standard variance. Informational only.
  1sigma:
    action: log
    notify: false

  # 2-Sigma: Statistical drift or early degradation detected.
  # Invoke Claude headlessly with read-only tools to diagnose root cause.
  2sigma:
    action: diagnose
    tools:
      - "Read"
      - "Grep"
      - "Bash(gh run view *)"
      - "Bash(gh pr list *)"
    output_format: intent_markdown
    destination: "intent/anomaly-\${DATE}.md"

  # 3-Sigma: Critical anomaly or catastrophic breach.
  # Authorize autonomous mitigation through pre-approved runbooks or revert PRs.
  3sigma:
    action: propose
    routes:
      - pull_request:revert
      - runbook:rollback-deploy
    escalation:
      channel: "#inc-checkout"
      priority: P1
`

const SPEC = parseBandsYaml(TEMPLATE) as BandSpec

describe('parseBandsYaml', () => {
  test('maps the real template into a BandSpec', () => {
    expect(SPEC).toEqual({
      metric: 'ci_test_failure_rate',
      description: 'Percentage of CI test runs failing on the main branch over rolling window',
      baseline: 'rolling_30d',
      interval: '1h',
      rules: 'western_electric',
      tiers: {
        '1sigma': { action: 'log', notify: false },
        '2sigma': {
          action: 'diagnose',
          tools: ['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)'],
          outputFormat: 'intent_markdown',
          destination: 'intent/anomaly-${DATE}.md',
        },
        '3sigma': {
          action: 'propose',
          routes: ['pull_request:revert', 'runbook:rollback-deploy'],
          escalation: { channel: '#inc-checkout', priority: 'P1' },
        },
      },
    })
    expect(parseFrontmatter(TEMPLATE).data.id).toBe('okf-template-bands')
  })

  test('Play 13 shape: tools as a comma string (commas inside parentheses survive), routes as a list', () => {
    const spec = parseBandsYaml(
      'metric: m\nrules: simple\ntiers:\n  1sigma:\n    action: log\n    notify: true\n  2sigma:\n    action: diagnose\n    tools: "Read,Grep,Bash(git log --format=%H,%s)"\n  3sigma:\n    action: propose\n    routes:\n      - pull_request\n      - runbook:rollback-deploy\n',
    )
    expect(spec?.rules).toBe('simple')
    expect(spec?.tiers['1sigma']).toEqual({ action: 'log', notify: true })
    expect(spec?.tiers['2sigma'].tools).toEqual(['Read', 'Grep', 'Bash(git log --format=%H,%s)'])
    expect(spec?.tiers['3sigma'].routes).toEqual(['pull_request', 'runbook:rollback-deploy'])
  })

  test('missing parts get the template defaults; tier keys may be spelled 1-sigma or tier2', () => {
    const spec = parseBandsYaml('metric: errors\ntiers:\n  tier2:\n    action: investigate\n  3-sigma:\n    routes: runbook:restart\n')
    expect(spec).toEqual({
      metric: 'errors',
      description: '',
      baseline: 'rolling_30d',
      interval: '1h',
      rules: 'western_electric',
      tiers: {
        '1sigma': { action: 'log', notify: false },
        '2sigma': { action: 'investigate', tools: [], outputFormat: 'intent_markdown', destination: 'intent/incident-${DATE}.md' },
        '3sigma': { action: 'propose', routes: ['runbook:restart'], escalation: { channel: '', priority: '' } },
      },
    })
  })

  test('a bands.yaml without front-matter parses the same; no metric or garbage is null, never a throw', () => {
    expect(parseBandsYaml('metric: m\ntiers: {}\n')?.metric).toBe('m')
    expect(parseBandsYaml('')).toBeNull()
    expect(parseBandsYaml('tiers:\n  1sigma:\n    action: log\n')).toBeNull()
    expect(parseBandsYaml('- just\n- a list')).toBeNull()
    expect(parseBandsYaml('{{{ not yaml')).toBeNull()
  })
})

describe('extractMetric', () => {
  test("'number': a bare number, with whitespace, a percent sign, or noise before it", () => {
    expect(extractMetric('0.12\n', 'number')).toBe(0.12)
    expect(extractMetric('  42  ', 'number')).toBe(42)
    expect(extractMetric('-3.5e2', 'number')).toBe(-350)
    expect(extractMetric('12.5%', 'number')).toBe(12.5)
    expect(extractMetric('running checks...\n7\n', 'number')).toBe(7)
  })

  test("'number': not a number is null", () => {
    expect(extractMetric('', 'number')).toBeNull()
    expect(extractMetric('n/a', 'number')).toBeNull()
    expect(extractMetric('NaN', 'number')).toBeNull()
    expect(extractMetric('Infinity', 'number')).toBeNull()
    expect(extractMetric('1,5', 'number')).toBeNull()
  })

  test("'json:a.b.0.c' walks objects and array indexes", () => {
    const out = '{"a":{"b":[{"c":3.5},{"c":9}]},"rate":"0.25","ok":true}'
    expect(extractMetric(out, 'json:a.b.0.c')).toBe(3.5)
    expect(extractMetric(out, 'json:a.b.1.c')).toBe(9)
    expect(extractMetric(out, 'json:rate')).toBe(0.25)
    expect(extractMetric('[4, 5]', 'json:1')).toBe(5)
    expect(extractMetric('7', 'json:')).toBe(7)
  })

  test("'json:': a missing path, a non-number, bad JSON and unknown modes are null", () => {
    expect(extractMetric('{"a":1}', 'json:b')).toBeNull()
    expect(extractMetric('{"a":[1]}', 'json:a.5')).toBeNull()
    expect(extractMetric('{"a":true}', 'json:a')).toBeNull()
    expect(extractMetric('{"a":{"b":1}}', 'json:a')).toBeNull()
    expect(extractMetric('{"a":', 'json:a')).toBeNull()
    expect(extractMetric('{}', 'json:constructor')).toBeNull()
    expect(extractMetric('1', 'regex:(\\d+)')).toBeNull()
  })

  test('the JSON on the last line is found behind log noise', () => {
    expect(extractMetric('warming up\n{"p99": 120}\n', 'json:p99')).toBe(120)
  })
})

describe('dueSources', () => {
  const src = (metric: string, intervalMinutes: number): BandSource => ({
    metric, description: '', argv: ['echo', '1'], parse: 'number', intervalMinutes, higherIsWorse: true,
  })
  const MIN = 60_000

  test('never-checked sources are due; checked ones wait out their interval', () => {
    const sources = [src('a', 10), src('b', 60), src('c', 5)]
    const now = 1_000 * MIN
    const due = dueSources(sources, { a: now - 9 * MIN, b: now - 60 * MIN }, now)
    expect(due.map(s => s.metric)).toEqual(['b', 'c'])
  })

  test('an interval below one minute counts as one minute; a checked-at of 0 is a real timestamp', () => {
    const now = 10 * MIN
    expect(dueSources([src('a', 0)], { a: now - 30_000 }, now)).toEqual([])
    expect(dueSources([src('a', 0)], { a: now - MIN }, now)).toHaveLength(1)
    expect(dueSources([src('a', 5)], { a: 0 }, now)).toHaveLength(1)
    expect(dueSources([], {}, now)).toEqual([])
  })
})

describe('samples', () => {
  test('sampleLine is one JSON line without a newline, and parseSamples reads it back', () => {
    expect(sampleLine(1_700_000_000_000, 0.25)).toBe('{"at":1700000000000,"value":0.25}')
    expect(parseSamples(`${sampleLine(1, 2)}\n${sampleLine(3, 4)}\n`)).toEqual([{ at: 1, value: 2 }, { at: 3, value: 4 }])
  })

  test('blank and corrupt lines are skipped; out-of-order lines are sorted; numeric strings count', () => {
    const text = ['{"at":3,"value":30}', '', 'not json', '{"at":1,"value":10}', '{"at":2}', '{"value":5}', '{"at":"2","value":"20"}', '[1,2]', '{"at":4,"value":'].join('\n')
    expect(parseSamples(text)).toEqual([{ at: 1, value: 10 }, { at: 2, value: 20 }, { at: 3, value: 30 }])
  })

  test('limit keeps the newest samples', () => {
    const text = [1, 2, 3, 4, 5].map(n => sampleLine(n, n * 10)).join('\n')
    expect(parseSamples(text, 2)).toEqual([{ at: 4, value: 40 }, { at: 5, value: 50 }])
    expect(parseSamples(text, 99)).toHaveLength(5)
  })

  test('a non-finite value is written as null and read back as no sample', () => {
    expect(sampleLine(1, Number.NaN)).toBe('{"at":1,"value":null}')
    expect(parseSamples(sampleLine(1, Number.NaN))).toEqual([])
  })
})

describe('incident intent', () => {
  const reading: BandReading = {
    metric: 'ci_test_failure_rate', at: Date.UTC(2026, 9, 6, 12, 30), value: 0.31, mean: 0.05, sd: 0.04, z: 6.5, tier: '3sigma', rules: ['WE1'], n: 29,
  }
  const md = incidentIntentMarkdown({
    reading, spec: SPEC, diagnosis: '## Root cause\nThe new cache key drops tenant_id.\n\n- [ ] confirm', date: '2026-10-06', author: 'okf-loop (band watcher)', sha: '8f3b21a',
  })

  test('follows the Stage-1 template: header block, anomaly ref, Status draft, the five sections in order', () => {
    const lines = md.split('\n')
    expect(lines[0]).toBe('# Intent: Investigate ci_test_failure_rate anomaly (3σ)')
    expect(md).toContain('**Author:** okf-loop (band watcher)  \n')
    expect(md).toContain('**Status:** draft  \n')
    expect(md).toContain('**Date:** 2026-10-06  \n')
    expect(md).toContain('**Source Ticket / Anomaly Ref:** ANOMALY-ci_test_failure_rate-2026-10-06  \n')
    const headings = lines.filter(l => l.startsWith('## '))
    expect(headings).toEqual(['## Problem', '## Proposed Outcome', '## Affected Users and Systems', '## Constraints', '## Open Questions'])
    expect(md.indexOf('---')).toBeGreaterThan(md.indexOf('**Source Ticket'))
  })

  test('Problem carries the metric signature, the offending SHA and the embedded diagnosis', () => {
    const problem = md.slice(md.indexOf('## Problem'), md.indexOf('## Proposed Outcome'))
    expect(problem).toContain('value 0.31 against a rolling baseline of 0.05 ± 0.04 (n=29); z = 6.50')
    expect(problem).toContain('Western Electric rules fired: WE1')
    expect(problem).toContain('`8f3b21a`')
    expect(problem).toContain('2026-10-06T12:30:00.000Z')
    expect(problem).toContain('The new cache key drops tenant_id.')
  })

  test('the diagnosis cannot inject sections or checkboxes of its own', () => {
    expect(md).toContain('##### Root cause')
    expect(md.split('\n').filter(l => /^##\s/.test(l))).toHaveLength(5)
    expect(md).toContain('- confirm')
    const checkboxes = md.split('\n').filter(l => l.startsWith('- [ ]'))
    expect(checkboxes).toHaveLength(3)
    expect(md.slice(md.indexOf('## Open Questions'))).toContain('- [ ] Does a human confirm the root cause')
  })

  test('leaves no template placeholders behind; the 3σ proposal names the routes and escalation', () => {
    expect(md).not.toMatch(/\[Short Descriptive Title\]|\[Describe in plain language|\[Full Name\]|\[YYYY-MM-DD\]/)
    expect(md).toContain('pull_request:revert, runbook:rollback-deploy')
    expect(md).toContain('#inc-checkout (P1)')
    expect(md).toContain('ci_test_failure_rate')
  })

  test('without a SHA, a spec or a diagnosis it is still a complete intent', () => {
    const bare = incidentIntentMarkdown({
      reading: { ...reading, tier: '2sigma', rules: [], z: 2.4 }, spec: null, diagnosis: '', date: '2026-10-06', author: 'a',
    })
    expect(bare).not.toContain('Offending deploy commit')
    expect(bare).toContain('# Intent: Investigate ci_test_failure_rate anomaly (2σ)')
    expect(bare).toContain('No Western Electric rule fired')
    expect(bare).toContain('returned nothing')
    expect(bare).toContain('the team escalation channel')
    expect(bare).not.toContain('Mitigation (')
    expect(bare.split('\n').filter(l => l.startsWith('## '))).toHaveLength(5)
  })
})

describe('incidentSlug', () => {
  test('incident-<date>-<metric as kebab>', () => {
    expect(incidentSlug('ci_test_failure_rate', '2026-10-06')).toBe('incident-2026-10-06-ci-test-failure-rate')
    expect(incidentSlug('Checkout 5xx Rate!', '2026-10-06')).toBe('incident-2026-10-06-checkout-5xx-rate')
  })

  test('stays within 48 characters and handles a metric with no letters', () => {
    const long = incidentSlug('a_very_long_metric_name_that_goes_on_and_on_forever', '2026-10-06')
    expect(long.length).toBeLessThanOrEqual(48)
    expect(long.endsWith('-')).toBe(false)
    expect(incidentSlug('###', '2026-10-06')).toBe('incident-2026-10-06')
  })
})

describe('diagnoseToolList', () => {
  const withTools = (tools: string[]): BandSpec => ({ ...SPEC, tiers: { ...SPEC.tiers, '2sigma': { ...SPEC.tiers['2sigma'], tools } } })

  test("uses bands.yaml's read-only list; falls back to the template's when absent or empty", () => {
    expect(diagnoseToolList(SPEC)).toEqual(['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)'])
    expect(diagnoseToolList(null)).toEqual(['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)'])
    expect(diagnoseToolList(withTools([]))).toEqual(['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)'])
  })

  test('anything that can write is stripped: Write, Edit, bare Bash, Bash(*)', () => {
    expect(diagnoseToolList(withTools(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Bash(*)', 'Grep']))).toEqual(['Read', 'Grep'])
    expect(diagnoseToolList(withTools(['Bash(git log *)', 'Bash(git log *)']))).toEqual(['Bash(git log *)'])
    expect(diagnoseToolList(withTools(['Write', 'Bash']))).toEqual(['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)'])
  })
})
