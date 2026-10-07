import { describe, expect, test } from 'claude-code/testing'
import { STAGE_PLAYS, TEMPLATE_FILES, TEMPLATE_NAMES } from '../hooks/core/constants'
import {
  bundledKnowledge,
  dependentsOf,
  knowledgeFiles,
  knowledgeRelPaths,
  loadKnowledge,
  mergeKnowledge,
  playByNumber,
  playLabel,
  playViews,
  playsByStage,
  prerequisitesOf,
  stripWikiFrontmatter,
  topologicalPlayOrder,
  unmetPrerequisites,
  validatePlayGraph,
} from '../hooks/core/knowledge'

// The graph as INDEX.md's Playbook Directory states it (the front-matter agrees; the mermaid drawing omits some edges).
const INDEX_GRAPH: Record<number, number[]> = {
  1: [],
  2: [1],
  3: [2],
  4: [3, 8],
  5: [],
  6: [5],
  7: [],
  8: [],
  9: [5, 8],
  10: [5, 6, 11],
  11: [7],
  12: [10, 11],
  13: [1, 9, 10, 12],
  14: [13],
}

const INDEX_MD = `---
id: okf-ai-native-sdlc-index
title: The AI-Native SDLC Master Knowledge Index
type: index
version: 1.0.0
status: active
last_updated: "2026-10-06"
tags:
  - ai-native-sdlc
summary: Master index and knowledge graph of the AI-Native SDLC.
---

# The AI-Native SDLC Master Knowledge Base
`

const PLAY_07 = `---
id: okf-play-07-guardrail-hooks
title: "Play 07: Hooks as Build-Time Guardrails"
type: play
stage: stage-3-build
entry_point: true
prerequisites: []
outputs:
  - ".claude/settings.json"
  - ".claude/hooks/*"
last_updated: "2026-10-06"
tags:
  - build
  - hooks
summary: How to configure deterministic PreToolUse hooks.
related_links:
  - "[[openknowledge/stages/03-build]]"
---

# Play 07
`

const PLAY_13 = `---
id: okf-play-13-control-bands
title: "Play 13: Closing the Loop with Statistical Control Bands"
type: play
stage: stage-6-maintain
entry_point: false
prerequisites:
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "[[openknowledge/plays/play-09-continuous-evals-ci]]"
  - "[[openknowledge/plays/play-10-ai-pr-review-loop]]"
  - "[[openknowledge/plays/play-12-cicd-pipeline-and-sandboxing]]"
outputs:
  - "bands.yaml"
tags:
  - maintain
summary: Statistical control bands close the loop.
---
`

const STAGE_03 = `---
id: okf-stage-03-build
title: "Stage 3: Build — Plan Mode, Guardrails & Parallel Implementation"
type: stage
stage_number: 3
summary: How implementation shifts from hand-coding to architectural interrogation.
---
`

const WIKI_TEMPLATE = `---
id: okf-template-intent
title: "Template: Stage 1 intent.md"
type: template
stage: stage-1-plan
---

# Intent: [Short Descriptive Title]
`

describe('bundled knowledge snapshot', () => {
  const k = bundledKnowledge()

  test('is the repo knowledge base: title, 14 plays, 6 stages, 10 templates, no issues', () => {
    expect(k.source).toBe('bundled')
    expect(k.root).toBe('openknowledge')
    expect(k.title).toBe('The AI-Native SDLC Master Knowledge Index')
    expect(k.version).toBe('1.0.0')
    expect(k.summary).toContain('knowledge graph')
    expect(k.plays).toHaveLength(14)
    expect(k.stages).toHaveLength(6)
    expect(Object.keys(k.templates).sort()).toEqual([...TEMPLATE_NAMES].sort())
    expect(k.issues).toEqual([])
  })

  test('plays are numbered 1..14 with front-matter fields', () => {
    expect(k.plays.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    for (const p of k.plays) {
      expect(p.id).toMatch(/^okf-play-\d\d-/)
      expect(p.title).toMatch(/^Play \d\d: /)
      expect(p.summary.length).toBeGreaterThan(20)
      expect(p.path).toMatch(/^plays\/play-\d\d-.+\.md$/)
      expect(p.path).toContain(`play-${p.n < 10 ? '0' : ''}${p.n}-`)
      expect(p.tags.length).toBeGreaterThan(0)
      expect(p.outputs.length).toBeGreaterThan(0)
    }
  })

  test('the dependency graph equals INDEX.md and every prerequisite resolves', () => {
    for (const p of k.plays) expect(p.prerequisites).toEqual(INDEX_GRAPH[p.n])
    expect(validatePlayGraph(k.plays)).toEqual([])
    expect(prerequisitesOf(k.plays, 13)).toEqual([1, 9, 10, 12])
  })

  test('entry points are plays 1, 5, 7 and 8 and have no prerequisites', () => {
    const entry = k.plays.filter((p) => p.entryPoint).map((p) => p.n)
    expect(entry).toEqual([1, 5, 7, 8])
    for (const p of k.plays) expect(p.entryPoint).toBe(p.prerequisites.length === 0)
  })

  test('stages agree with the STAGE_PLAYS constant and stage-N-name front-matter maps to a stage id', () => {
    const by = playsByStage(k.plays)
    for (const id of ['plan', 'design', 'build', 'test', 'deploy', 'maintain'] as const) {
      expect(by[id].map((p) => p.n)).toEqual(STAGE_PLAYS[id])
    }
    expect(playByNumber(k.plays, 7)?.stage).toBe('build')
    expect(playByNumber(k.plays, 13)?.stage).toBe('maintain')
  })

  test('six stage docs, numbered 1..6, filed under the knowledge paths', () => {
    expect(k.stages.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6])
    expect(k.stages.map((s) => s.id)).toEqual(['plan', 'design', 'build', 'test', 'deploy', 'maintain'])
    expect(k.stages[0]?.path).toBe('stages/01-plan.md')
    expect(k.stages[5]?.title).toContain('Maintain')
  })

  test('templates keep their real shape: wiki front-matter stripped, scripts executable-shaped', () => {
    for (const name of TEMPLATE_NAMES) {
      const body = k.templates[name] ?? ''
      expect(body.length).toBeGreaterThan(100)
      expect(body).not.toContain('okf-template-')
      expect(body.endsWith('\n')).toBe(true)
    }
    expect(k.templates.intent).toMatch(/^# Intent: \[Short Descriptive Title\]/)
    expect(k.templates.spec).toMatch(/^# Specification: /)
    expect(k.templates.plan).toMatch(/^# Plan: /)
    expect(k.templates['claude-context']).toMatch(/^# \[Repository \/ Microservice Name\]/)
    expect(k.templates['production-gate']).toMatch(/^#!\/bin\/bash\n/)
    expect(k.templates['ci-evals-workflow']).toMatch(/^name: Agent Continuous Evals/)
    expect(k.templates.bands).toMatch(/^# Statistical Control Bands Specification/)
    expect(JSON.parse(k.templates['managed-settings'] ?? '{}').allowManagedHooksOnly).toBe(true)
  })

  test('the verifier agent template keeps its own front-matter (it is the agent definition, not wiki metadata)', () => {
    expect(k.templates['verifier-agent']).toMatch(/^---\nname: verifier\n/)
    expect(k.templates['verifier-agent']).toContain('### Verification Verdict: [PASS | FAIL]')
  })

  test('returns fresh copies each call', () => {
    const a = bundledKnowledge()
    a.plays[0]?.prerequisites.push(99)
    a.plays.pop()
    expect(bundledKnowledge().plays).toHaveLength(14)
    expect(bundledKnowledge().plays[0]?.prerequisites).toEqual([])
  })
})

describe('knowledgeFiles', () => {
  test('lists INDEX, 6 stages, 14 plays, 10 templates under the root', () => {
    const files = knowledgeFiles('openknowledge')
    expect(files).toHaveLength(1 + 6 + 14 + 10)
    expect(files[0]).toBe('openknowledge/INDEX.md')
    expect(files).toContain('openknowledge/stages/03-build.md')
    expect(files).toContain('openknowledge/plays/play-07-build-guardrail-hooks.md')
    for (const name of TEMPLATE_NAMES) expect(files).toContain(`openknowledge/${TEMPLATE_FILES[name]}`)
  })

  test('honours a custom root and cleans slashes', () => {
    expect(knowledgeFiles('./docs/ok/')[0]).toBe('docs/ok/INDEX.md')
    expect(knowledgeFiles('')[0]).toBe('openknowledge/INDEX.md')
    expect(knowledgeRelPaths()[0]).toBe('INDEX.md')
  })
})

describe('loadKnowledge', () => {
  test('parses INDEX, plays, stages and templates from root-relative keys', () => {
    const k = loadKnowledge(
      {
        'INDEX.md': INDEX_MD,
        'plays/play-07-build-guardrail-hooks.md': PLAY_07,
        'plays/play-13-closing-the-loop-control-bands.md': PLAY_13,
        'stages/03-build.md': STAGE_03,
        'templates/intent.template.md': WIKI_TEMPLATE,
      },
      'openknowledge',
    )
    expect(k.source).toBe('repo')
    expect(k.title).toBe('The AI-Native SDLC Master Knowledge Index')
    expect(k.version).toBe('1.0.0')
    expect(k.issues).toEqual([])
    expect(k.plays.map((p) => p.n)).toEqual([7, 13])
    const p7 = playByNumber(k.plays, 7)
    expect(p7).toEqual({
      n: 7,
      id: 'okf-play-07-guardrail-hooks',
      title: 'Play 07: Hooks as Build-Time Guardrails',
      stage: 'build',
      entryPoint: true,
      prerequisites: [],
      outputs: ['.claude/settings.json', '.claude/hooks/*'],
      summary: 'How to configure deterministic PreToolUse hooks.',
      path: 'plays/play-07-build-guardrail-hooks.md',
      tags: ['build', 'hooks'],
    })
    expect(playByNumber(k.plays, 13)?.prerequisites).toEqual([1, 9, 10, 12])
    expect(playByNumber(k.plays, 13)?.stage).toBe('maintain')
    expect(k.stages).toEqual([
      {
        id: 'build',
        number: 3,
        title: 'Stage 3: Build — Plan Mode, Guardrails & Parallel Implementation',
        summary: 'How implementation shifts from hand-coding to architectural interrogation.',
        path: 'stages/03-build.md',
      },
    ])
    expect(k.templates.intent).toBe('# Intent: [Short Descriptive Title]\n')
  })

  test('accepts keys that still carry the root prefix and backslashes', () => {
    const k = loadKnowledge({ 'openknowledge/plays/play-07-build-guardrail-hooks.md': PLAY_07, 'openknowledge\\INDEX.md': INDEX_MD }, 'openknowledge')
    expect(k.plays.map((p) => p.n)).toEqual([7])
    expect(k.title).toBe('The AI-Native SDLC Master Knowledge Index')
    expect(k.issues).toEqual([])
  })

  test('never throws: empty input reports what is missing', () => {
    const k = loadKnowledge({}, 'openknowledge')
    expect(k.plays).toEqual([])
    expect(k.stages).toEqual([])
    expect(k.templates).toEqual({})
    expect(k.issues).toEqual(['INDEX.md: not found', 'plays/: no play-NN-*.md files found'])
  })

  test('a play without front-matter falls back to the file name and heading, and says so', () => {
    const k = loadKnowledge({ 'INDEX.md': INDEX_MD, 'plays/play-08-feedback.md': '# Verification loops\n\nbody' }, 'openknowledge')
    const p = playByNumber(k.plays, 8)
    expect(p?.title).toBe('Verification loops')
    expect(p?.id).toBe('okf-play-08-feedback')
    expect(p?.stage).toBe('test')
    expect(p?.prerequisites).toEqual([])
    expect(k.issues.some((i) => i.startsWith('plays/play-08-feedback.md: no front-matter'))).toBe(true)
  })

  test('bad stage, bad prerequisite, self prerequisite and a mismatched id are recorded, not fatal', () => {
    const odd = `---
id: okf-play-02-something
title: "Play 03: Odd"
stage: someday
prerequisites:
  - "[[openknowledge/plays/play-01-capture-intent]]"
  - "not a link"
  - "[[openknowledge/plays/play-03-odd]]"
  - 1
---
`
    const k = loadKnowledge({ 'INDEX.md': INDEX_MD, 'plays/play-03-odd.md': odd }, 'openknowledge')
    const p = playByNumber(k.plays, 3)
    expect(p?.prerequisites).toEqual([1])
    expect(p?.stage).toBe('build')
    const text = k.issues.join('\n')
    expect(text).toContain('stage "someday"')
    expect(text).toContain('"not a link" does not name a play')
    expect(text).toContain('lists itself')
    expect(text).toContain('disagrees with the file name')
  })

  test('a duplicate play number keeps the first file; a stage outside 1..6 is skipped', () => {
    const k = loadKnowledge(
      {
        'INDEX.md': INDEX_MD,
        'plays/play-07-a.md': PLAY_07,
        'plays/play-07-b.md': PLAY_07.replace('Hooks as', 'Duplicate'),
        'stages/09-extra.md': '---\ntitle: Extra\nstage_number: 9\n---\n',
      },
      'openknowledge',
    )
    expect(k.plays).toHaveLength(1)
    expect(k.plays[0]?.title).toContain('Hooks as')
    expect(k.stages).toEqual([])
    expect(k.issues.some((i) => i.includes('a second file for play 7'))).toBe(true)
    expect(k.issues.some((i) => i.includes('outside 1..6'))).toBe(true)
  })

  test('INDEX without a title is reported; other files are ignored', () => {
    const k = loadKnowledge({ 'INDEX.md': 'just text', 'concepts/x.md': '---\ntitle: x\n---\n', 'plays/readme.md': 'x' }, 'openknowledge')
    expect(k.title).toBe('')
    expect(k.issues).toContain('INDEX.md: no front-matter')
    expect(k.issues).toContain('INDEX.md: no title')
    expect(k.plays).toEqual([])
  })

  test('numeric version in front-matter is read as text', () => {
    const k = loadKnowledge({ 'INDEX.md': '---\ntitle: T\nversion: 2\n---\n' }, 'openknowledge')
    expect(k.version).toBe('2')
  })
})

describe('stripWikiFrontmatter', () => {
  test('strips wiki front-matter but keeps a template own front-matter and plain files', () => {
    expect(stripWikiFrontmatter(WIKI_TEMPLATE)).toBe('# Intent: [Short Descriptive Title]\n')
    const agent = '---\nname: verifier\ntools: Bash, Read\n---\n\n# Verifier\n'
    expect(stripWikiFrontmatter(agent)).toBe(agent)
    const sh = '#!/bin/bash\nset -e\n'
    expect(stripWikiFrontmatter(sh)).toBe(sh)
  })
})

describe('mergeKnowledge', () => {
  const base = bundledKnowledge()

  test('override wins per play, stage and template; the rest stays; source is repo', () => {
    const override = loadKnowledge(
      {
        'INDEX.md': '---\ntitle: Acme Loop\nversion: 2.0.0\n---\n',
        'plays/play-07-build-guardrail-hooks.md': PLAY_07.replace('Hooks as Build-Time Guardrails', 'Acme Guardrails'),
        'templates/intent.template.md': WIKI_TEMPLATE.replace('Short Descriptive Title', 'Acme Title'),
      },
      'docs/ok',
    )
    const merged = mergeKnowledge(base, override)
    expect(merged.source).toBe('repo')
    expect(merged.root).toBe('docs/ok')
    expect(merged.title).toBe('Acme Loop')
    expect(merged.version).toBe('2.0.0')
    expect(merged.summary).toBe(base.summary)
    expect(merged.plays).toHaveLength(14)
    expect(playByNumber(merged.plays, 7)?.title).toContain('Acme Guardrails')
    expect(playByNumber(merged.plays, 8)?.title).toBe(playByNumber(base.plays, 8)?.title)
    expect(merged.templates.intent).toContain('Acme Title')
    expect(merged.templates.spec).toBe(base.templates.spec)
    expect(merged.stages).toHaveLength(6)
    expect(merged.issues).toEqual([])
  })

  test('keeps both sides issues and adds graph problems of the merged result', () => {
    const cyc = (n: number, p: number) =>
      `---\nid: okf-play-${n}-x\ntitle: "Play ${n}: X"\nstage: stage-3-build\nprerequisites:\n  - "[[openknowledge/plays/play-${p}-y]]"\n---\n`
    const override = loadKnowledge(
      { 'plays/play-15-new.md': cyc(15, 16), 'plays/play-16-new.md': cyc(16, 15), 'plays/play-17-new.md': cyc(17, 40) },
      'openknowledge',
    )
    const merged = mergeKnowledge({ ...base, issues: ['base issue'] }, { ...override, issues: ['override issue'] })
    expect(merged.issues[0]).toBe('base issue')
    expect(merged.issues[1]).toBe('override issue')
    expect(merged.issues.join('\n')).toContain('Dependency cycle among plays 15, 16')
    expect(merged.issues.join('\n')).toContain('Play 17: prerequisite Play 40 is not defined')
    expect(merged.plays).toHaveLength(17)
  })
})

describe('the dependency helpers', () => {
  const plays = bundledKnowledge().plays

  test('dependentsOf lists only enabled dependents', () => {
    expect(dependentsOf(plays, 11, [7, 11, 10, 12])).toEqual([10, 12])
    expect(dependentsOf(plays, 11, [7, 11])).toEqual([])
    expect(dependentsOf(plays, 7, [7, 11])).toEqual([11])
    expect(dependentsOf(plays, 99, [1])).toEqual([])
  })

  test('unmetPrerequisites and prerequisitesOf', () => {
    expect(unmetPrerequisites(plays, 13, [1, 9])).toEqual([10, 12])
    expect(unmetPrerequisites(plays, 7, [])).toEqual([])
    expect(unmetPrerequisites(plays, 4, [3, 8])).toEqual([])
    expect(unmetPrerequisites(plays, 99, [])).toEqual([])
    expect(prerequisitesOf(plays, 99)).toEqual([])
  })

  test('topologicalPlayOrder puts prerequisites first and is deterministic', () => {
    const order = topologicalPlayOrder(plays)
    expect([...order].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    for (const p of plays) for (const q of p.prerequisites) expect(order.indexOf(q)).toBeLessThan(order.indexOf(p.n))
    expect(order).toEqual(topologicalPlayOrder([...plays].reverse()))
    expect(order.slice(0, 3)).toEqual([1, 2, 3])
  })

  test('topologicalPlayOrder survives a cycle and an unknown prerequisite', () => {
    const base = bundledKnowledge().plays[0]
    if (!base) throw new Error('no play')
    const a = { ...base, n: 1, prerequisites: [2] }
    const b = { ...base, n: 2, prerequisites: [1] }
    const c = { ...base, n: 3, prerequisites: [77] }
    expect(topologicalPlayOrder([a, b, c])).toEqual([3, 1, 2])
  })

  test('playLabel drops the "Play NN:" prefix of the title', () => {
    expect(playLabel(plays, 7)).toBe('Play 07 · Hooks as Build-Time Guardrails')
    expect(playLabel(plays, 99)).toBe('Play 99')
  })
})

describe('playViews', () => {
  test('adds enabled, unmet, dependents, enforcement and evidence', () => {
    const plays = bundledKnowledge().plays
    const views = playViews({
      plays,
      enabled: [7, 11],
      evidence: { 7: [{ label: '.claude/settings.json', ok: true }] },
    })
    expect(views).toHaveLength(14)
    const v7 = views.find((v) => v.n === 7)
    expect(v7?.enabled).toBe(true)
    expect(v7?.dependents).toEqual([11])
    expect(v7?.unmet).toEqual([])
    expect(v7?.enforcedBy).toContain('Protect-paths guard')
    expect(v7?.evidence).toEqual([{ label: '.claude/settings.json', ok: true }])
    const v10 = views.find((v) => v.n === 10)
    expect(v10?.enabled).toBe(false)
    expect(v10?.unmet).toEqual([5, 6])
    expect(v10?.evidence).toEqual([])
    expect(views.find((v) => v.n === 1)?.title).toContain('Capture')
  })
})
