import { describe, expect, test } from 'claude-code/testing'
import { parseFrontmatter, parseYaml, stripFrontmatter } from '../hooks/core/yaml'

describe('scalars', () => {
  test('plain scalars resolve to their YAML type', () => {
    expect(parseYaml('a: 1\nb: -2.5\nc: true\nd: False\ne: null\nf: ~\ng: hello world\nh: 1e3\ni: .5')).toEqual({
      a: 1, b: -2.5, c: true, d: false, e: null, f: null, g: 'hello world', h: 1000, i: 0.5,
    })
  })

  test('versions, dates and zero-padded ids stay strings', () => {
    expect(parseYaml('v: 1.0.0\nd: 2026-10-06\nz: 007\nt: 10:30')).toEqual({ v: '1.0.0', d: '2026-10-06', z: '007', t: '10:30' })
  })

  test('quoted scalars keep their text and decode escapes', () => {
    expect(parseYaml(`a: "1"\nb: 'true'\nc: "say \\"hi\\"\\n"\nd: 'it''s'\ne: "[[wiki/links]]"\nf: "Title: with colon"`)).toEqual({
      a: '1', b: 'true', c: 'say "hi"\n', d: "it's", e: '[[wiki/links]]', f: 'Title: with colon',
    })
  })

  test('an apostrophe inside a plain scalar does not open a quote', () => {
    expect(parseYaml("a: don't # comment\nb: it's fine")).toEqual({ a: "don't", b: "it's fine" })
  })

  test('multi-line quoted and plain scalars fold to one line', () => {
    expect(parseYaml('a: "one\n  two"\nb: plain one\n  plain two\nc: 3')).toEqual({ a: 'one two', b: 'plain one plain two', c: 3 })
  })

  test('a top-level scalar or flow value parses', () => {
    expect(parseYaml('42')).toBe(42)
    expect(parseYaml('[1, 2]')).toEqual([1, 2])
    expect(parseYaml('')).toBeUndefined()
    expect(parseYaml('# only a comment\n\n')).toBeUndefined()
  })
})

describe('comments', () => {
  test('# starts a comment only after whitespace and outside quotes', () => {
    expect(parseYaml('a: x # c\nb: "x # not a comment"\nc: x#y\n# full line\nd: 1')).toEqual({
      a: 'x', b: 'x # not a comment', c: 'x#y', d: 1,
    })
  })

  test('comment-only lines between and inside blocks are skipped', () => {
    expect(parseYaml('a:\n  # note\n  - 1\n  # another\n  - 2\nb: 3')).toEqual({ a: [1, 2], b: 3 })
  })
})

describe('collections', () => {
  test('nested maps by indentation, and a key with no value is null', () => {
    expect(parseYaml('a:\n  b:\n    c: 1\n  d: 2\ne:\nf: 3')).toEqual({ a: { b: { c: 1 }, d: 2 }, e: null, f: 3 })
  })

  test('block sequences of scalars, including the key-level dash style', () => {
    expect(parseYaml('a:\n  - x\n  - "y z"\nb:\n- p\n- q\nc: 1')).toEqual({ a: ['x', 'y z'], b: ['p', 'q'], c: 1 })
  })

  test('sequences of maps, with extra keys under the dash', () => {
    const doc = 'steps:\n  - name: one\n    run: a\n  - name: two\n    with:\n      k: v\n  - plain'
    expect(parseYaml(doc)).toEqual({ steps: [{ name: 'one', run: 'a' }, { name: 'two', with: { k: 'v' } }, 'plain'] })
  })

  test('nested sequences and a dash on its own line', () => {
    expect(parseYaml('- - a\n  - b\n-\n  - c\n- d')).toEqual([['a', 'b'], ['c'], 'd'])
  })

  test('items that merely contain a colon are scalars, not maps', () => {
    expect(parseYaml('- pull_request:revert\n- "Bash(gh run view *)"\n- http://x.test/a')).toEqual([
      'pull_request:revert', 'Bash(gh run view *)', 'http://x.test/a',
    ])
  })

  test('flow collections, empty ones, nesting and multi-line', () => {
    expect(parseYaml('a: [x, "y, z", 3]\nb: []\nc: {}\nd: {k: v, n: 1}\ne: [[1, 2], [3]]\nf: [a,\n  b]')).toEqual({
      a: ['x', 'y, z', 3], b: [], c: {}, d: { k: 'v', n: 1 }, e: [[1, 2], [3]], f: ['a', 'b'],
    })
  })

  test('quoted keys, duplicate keys (last wins) and a __proto__ key stay plain data', () => {
    const doc = parseYaml('"a b": 1\nk: 1\nk: 2\n__proto__: x') as Record<string, unknown>
    expect(doc['a b']).toBe(1)
    expect(doc.k).toBe(2)
    expect(Object.getPrototypeOf(doc)).toBe(Object.prototype)
    expect(Object.keys(doc)).toContain('__proto__')
  })
})

describe('block scalars', () => {
  test('literal keeps line breaks, folded joins lines, chomping indicators apply', () => {
    const doc = 'a: |\n  one\n  two\nb: >\n  one\n  two\n\n  three\nc: |-\n  x\n\nd: |+\n  y\n\ne: end'
    expect(parseYaml(doc)).toEqual({ a: 'one\ntwo\n', b: 'one two\nthree\n', c: 'x', d: 'y\n\n', e: 'end' })
  })

  test('indentation is stripped and deeper lines keep their extra indent', () => {
    expect(parseYaml('run: |\n  if x; then\n    echo hi\n  fi\nnext: 1')).toEqual({ run: 'if x; then\n  echo hi\nfi\n', next: 1 })
  })

  test('a block scalar inside a sequence item', () => {
    expect(parseYaml('- name: s\n  run: >-\n    a\n    b\n- z')).toEqual([{ name: 's', run: 'a b' }, 'z'])
  })
})

describe('front-matter', () => {
  test('splits data from body', () => {
    const fm = parseFrontmatter('---\ntitle: "T: x"\ntags:\n  - a\n  - b\n---\n\n# Body\ntext')
    expect(fm.hasFrontmatter).toBe(true)
    expect(fm.data).toEqual({ title: 'T: x', tags: ['a', 'b'] })
    expect(fm.body).toBe('\n# Body\ntext')
    expect(stripFrontmatter('---\na: 1\n---\nbody')).toBe('body')
  })

  test('no front-matter, an empty one, a BOM and CRLF', () => {
    expect(parseFrontmatter('# just a doc')).toEqual({ data: {}, body: '# just a doc', hasFrontmatter: false })
    expect(parseFrontmatter('---\n---\nbody')).toEqual({ data: {}, body: 'body', hasFrontmatter: true })
    expect(parseFrontmatter('\uFEFF---\r\na: 1\r\n---\r\nbody').data).toEqual({ a: 1 })
    expect(parseFrontmatter('---\r\na: 1\r\nb: x\r\n---\r\nbody').body).toBe('body')
  })

  test('an unclosed block or two horizontal rules around prose is not front-matter', () => {
    expect(parseFrontmatter('---\na: 1\nno close').hasFrontmatter).toBe(false)
    const prose = '---\nSome sentence without a key.\n---\nrest'
    expect(parseFrontmatter(prose).hasFrontmatter).toBe(false)
    expect(stripFrontmatter(prose)).toBe(prose)
  })

  test('text after the closing marker, further --- lines included, is body', () => {
    const fm = parseFrontmatter('---\na: 1\n---\nbody\n---\nmore: x\n---\n')
    expect(fm.data).toEqual({ a: 1 })
    expect(fm.body).toBe('body\n---\nmore: x\n---\n')
  })
})

describe('never throws', () => {
  test('garbage yields undefined, a scalar or partial data, never an exception', () => {
    const garbage = [
      ':::', '- - - -', '{{{{', ']]]]', '"unterminated', "'x", 'a: [1, 2', 'a: {b', '\t\t- x', '- : :', '? x', '&a *b', '%YAML 1.2\n---\n', 'a:\n\t\tb: 1',
      'a: |\n', '---\n---\n---', '\u0000\u0001', 'x'.repeat(5000), `${'- '.repeat(200)}x`, `${'a:\n'.repeat(1) + '  '.repeat(60)}b: 1`,
    ]
    for (const g of garbage) {
      expect(() => parseYaml(g)).not.toThrow()
      expect(() => parseFrontmatter(g)).not.toThrow()
    }
    expect(parseFrontmatter('---\n":::\n---\nb').data).toEqual({})
  })

  test('deeply nested flow collections stop at a depth limit instead of recursing forever', () => {
    expect(() => parseYaml(`a: ${'['.repeat(500)}${']'.repeat(500)}`)).not.toThrow()
  })
})

// The knowledge base's real front-matter shapes (verified against every file under openknowledge/ by
// the scratchpad script; the test environment has no fs, so representative blocks are embedded).
describe('the openknowledge front-matters', () => {
  const PLAY_13 = `---
id: okf-play-13-control-bands
title: "Play 13: Closing the Loop with Statistical Control Bands"
type: play
stage: stage-6-maintain
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "[[openknowledge/plays/play-09-continuous-evals-ci]]"
outputs:
  - "bands.yaml"
  - "intent/<incident-diagnosis>.md"
last_updated: "2026-10-06"
tags:
  - maintain
  - closed-loop
summary: How to set up deterministic statistical control bands that invoke headless agents to diagnose production anomalies and synthesize intent.md to close the SDLC loop.
related_links:
  - "[[openknowledge/stages/06-maintain]]"
---

# Play 13`

  test('a play', () => {
    const fm = parseFrontmatter(PLAY_13)
    expect(fm.hasFrontmatter).toBe(true)
    expect(fm.data.id).toBe('okf-play-13-control-bands')
    expect(fm.data.title).toBe('Play 13: Closing the Loop with Statistical Control Bands')
    expect(fm.data.entry_point).toBe(false)
    expect(fm.data.prerequisites).toEqual(['[[openknowledge/plays/play-01-capture-intent]]', '[[openknowledge/plays/play-09-continuous-evals-ci]]'])
    expect(fm.data.outputs).toEqual(['bands.yaml', 'intent/<incident-diagnosis>.md'])
    expect(fm.data.last_updated).toBe('2026-10-06')
    expect(Object.keys(fm.data)).toHaveLength(11)
    expect(fm.body.trim()).toBe('# Play 13')
  })

  test('an empty prerequisites list', () => {
    expect(parseFrontmatter('---\nid: p\nentry_point: true\nprerequisites: []\noutputs:\n  - ".claude/hooks/*"\n---\n').data).toEqual({
      id: 'p', entry_point: true, prerequisites: [], outputs: ['.claude/hooks/*'],
    })
  })

  test('INDEX.md: version 1.0.0 is a string, status is plain', () => {
    const fm = parseFrontmatter('---\nid: okf-ai-native-sdlc-index\ntitle: The AI-Native SDLC Master Knowledge Index\ntype: index\nversion: 1.0.0\nstatus: active\nlast_updated: "2026-10-06"\nsummary: Master index based on the Anthropic Technical Playbook by Louis Claxton et al.\n---\n')
    expect(fm.data.version).toBe('1.0.0')
    expect(fm.data.title).toBe('The AI-Native SDLC Master Knowledge Index')
  })

  test('a stage with stage_number, and an agent template with comma-separated tools', () => {
    expect(parseFrontmatter('---\nid: s\nstage_number: 3\nsummary: x\n---\n').data.stage_number).toBe(3)
    expect(parseFrontmatter('---\nname: verifier\ndescription: Independent agent executed after task completion\ntools: Bash, Read\n---\nbody').data).toEqual({
      name: 'verifier', description: 'Independent agent executed after task completion', tools: 'Bash, Read',
    })
  })

  test('a template whose title carries a colon in quotes', () => {
    expect(parseFrontmatter('---\nid: okf-template-intent\ntitle: "Template: Stage 1 intent.md"\ntype: template\n---\n').data.title).toBe('Template: Stage 1 intent.md')
  })

  test('bands.template.yaml: parseYaml skips the front-matter and reads the YAML body', () => {
    const text = `---
id: okf-template-bands
title: "Template: Statistical Control Bands (bands.yaml)"
type: template
---

# Statistical Control Bands Specification
# Used by deterministic observability scripts to trigger autonomous agents

metric: ci_test_failure_rate
baseline: rolling_30d
tiers:
  # 2-Sigma: Statistical drift
  2sigma:
    action: diagnose
    tools:
      - "Read"
      - "Bash(gh run view *)"
    destination: "intent/anomaly-\${DATE}.md"
  3sigma:
    routes:
      - pull_request:revert
    escalation:
      channel: "#inc-checkout"
      priority: P1`
    expect(parseYaml(text)).toEqual({
      metric: 'ci_test_failure_rate',
      baseline: 'rolling_30d',
      tiers: {
        '2sigma': { action: 'diagnose', tools: ['Read', 'Bash(gh run view *)'], destination: 'intent/anomaly-${DATE}.md' },
        '3sigma': { routes: ['pull_request:revert'], escalation: { channel: '#inc-checkout', priority: 'P1' } },
      },
    })
    expect(parseFrontmatter(text).data.title).toBe('Template: Statistical Control Bands (bands.yaml)')
  })

  test('a GitHub workflow (no front-matter) with block scalars parses', () => {
    const wf = `name: Agent Continuous Evals

on:
  pull_request:
    paths:
      - 'CLAUDE.md'
  schedule:
    # nightly
    - cron: '0 2 * * *'
  workflow_dispatch:

jobs:
  suite:
    runs-on: ubuntu-latest
    steps:
      - name: Run
        env:
          KEY: \${{ secrets.KEY }}
        run: |
          mkdir -p evals/results
          for f in evals/*.json; do
            echo "$f"
          done
`
    const doc = parseYaml(wf) as { on: Record<string, unknown>; jobs: { suite: { steps: Record<string, unknown>[] } } }
    expect(doc.on.workflow_dispatch).toBeNull()
    expect(doc.on.schedule).toEqual([{ cron: '0 2 * * *' }])
    const step = doc.jobs.suite.steps[0]
    expect(step?.env).toEqual({ KEY: '${{ secrets.KEY }}' })
    expect(step?.run).toBe('mkdir -p evals/results\nfor f in evals/*.json; do\n  echo "$f"\ndone\n')
  })
})
