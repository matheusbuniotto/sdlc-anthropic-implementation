import { describe, expect, test } from 'claude-code/testing'
import {
  DEFAULT_CONFIG,
  applyUserOptions,
  artifactGlob,
  artifactPath,
  diffFromDefaults,
  normalizePlays,
  parseConfig,
  serializeConfig,
  slugify,
  withGuardToggled,
  withMode,
  withPlayToggled,
} from '../hooks/core/config'
import { DEFAULT_PLAYS } from '../hooks/core/constants'
import { DEFAULT_PRODUCTION_PATTERNS, DEFAULT_SECRET_PATTERNS } from '../hooks/core/guards'
import { bundledKnowledge } from '../hooks/core/knowledge'

const plays = bundledKnowledge().plays
const parse = (v: unknown) => parseConfig(v)

describe('DEFAULT_CONFIG', () => {
  test('autonomy, plays and ui follow the spec', () => {
    expect(DEFAULT_CONFIG.version).toBe(1)
    expect(DEFAULT_CONFIG.knowledge.root).toBe('openknowledge')
    expect(DEFAULT_CONFIG.autonomy).toEqual({
      mode: 'semi',
      maxAutoTurns: 12,
      haltOnBlocks: 3,
      haltOnVerifyFails: 3,
      humanGates: ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve'],
      autoKinds: ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'],
    })
    expect(DEFAULT_CONFIG.plays.enabled).toEqual([...DEFAULT_PLAYS])
    expect(DEFAULT_CONFIG.ui).toEqual({ openPaneOnStart: false, showBand: true })
    expect(DEFAULT_CONFIG.policySkills).toEqual(['.claude/skills/**/SKILL.md', 'CLAUDE.md'])
  })

  test('paths are the §3 artifact locations', () => {
    expect(DEFAULT_CONFIG.paths).toEqual({
      intent: 'intent/{slug}.md',
      spec: 'specs/{slug}.spec.md',
      plan: 'plans/{slug}.plan.md',
      proof: 'proofs/{slug}.proof.md',
      review: 'reviews/{slug}.review.md',
      incident: 'intent/incident-{date}.md',
      lesson: 'lessons/{date}-{slug}.md',
      eval: 'evals/{slug}.json',
      claudeMd: 'CLAUDE.md',
      reviewPolicy: 'REVIEW.md',
      bands: 'bands.yaml',
      ciWorkflow: '.github/workflows/agent-evals.yml',
      managedSettings: '.okf/enterprise-managed-settings.json',
      productionGate: '.claude/hooks/production-gate.sh',
    })
  })

  test('guards: protected paths include .okf/**, which also stays plan-first exempt', () => {
    const g = DEFAULT_CONFIG.guards
    expect(g.protectedPaths).toEqual([
      'schemas/generated/**',
      'api/v1/frozen/**',
      '.env',
      '.env.*',
      '**/.env',
      '**/.env.*',
      'secrets/**',
      '.okf/**',
    ])
    expect(g.planFirstExempt).toContain('.okf/**')
    expect(g.planFirstExempt).toEqual([
      '**/*.md',
      'intent/**',
      'specs/**',
      'plans/**',
      'proofs/**',
      'reviews/**',
      'lessons/**',
      'evals/**',
      '.okf/**',
      '.claude/**',
      'openknowledge/**',
    ])
    expect(g.disabled).toEqual([])
    expect(g.testGlobs).toEqual(['tests/**', 'test/**', '__tests__/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go'])
    expect(g.credentialPaths).toEqual(['~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '**/.env', '**/.env.*', 'secrets/**'])
    expect(g.protectedBranches).toEqual(['main', 'master'])
    expect(g.destructiveSql).toBe(true)
    expect(g.blockNetwork).toBe(false)
    expect(g.grantMinutes).toBe(15)
  })

  test('secret and production patterns come from guards.ts, not a copy', () => {
    expect(DEFAULT_CONFIG.guards.secretPatterns).toEqual(DEFAULT_SECRET_PATTERNS)
    expect(DEFAULT_CONFIG.guards.productionPatterns).toEqual(DEFAULT_PRODUCTION_PATTERNS)
  })

  test('verify, review and bands defaults', () => {
    expect(DEFAULT_CONFIG.verify.commands).toEqual([
      'make test',
      'make lint',
      'make build',
      'npm test',
      'npm run test',
      'npm run lint',
      'pnpm test',
      'yarn test',
      'pytest',
      'cargo test',
      'go test',
      'bun test',
    ])
    expect(DEFAULT_CONFIG.review.nitCap).toBe(5)
    expect(DEFAULT_CONFIG.review.passes).toEqual([
      { tag: 'Bugs', title: 'Logic & Regressions' },
      { tag: 'Security', title: 'Security & Privacy' },
      { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
    ])
    expect(DEFAULT_CONFIG.review.ignorePaths).toEqual(['src/gen/**', 'build/**', '*.min.js', 'package-lock.json', 'yarn.lock'])
    expect(DEFAULT_CONFIG.bands).toEqual({ enabled: false, sources: [], window: 30, tier3: 'propose', runbook: [] })
  })

  test('the default plays are a valid adoption: every prerequisite is enabled', () => {
    expect(normalizePlays([...DEFAULT_PLAYS], plays)).toEqual({ enabled: [...DEFAULT_PLAYS], issues: [] })
  })
})

describe('parseConfig: input handling', () => {
  test('empty text and null give the defaults with no issues', () => {
    for (const input of ['', '  \n', undefined, null]) {
      const r = parse(input)
      expect(r.config).toEqual(DEFAULT_CONFIG)
      expect(r.issues).toEqual([])
    }
  })

  test('invalid JSON, arrays and scalars give the defaults and one issue', () => {
    expect(parse('{ nope').issues[0]).toContain('not valid JSON')
    expect(parse('{ nope').config).toEqual(DEFAULT_CONFIG)
    expect(parse('[1,2]').issues).toEqual(['config must be a JSON object; defaults used'])
    expect(parse(42).issues).toEqual(['config must be a JSON object; defaults used'])
    expect(parse('"text"').issues).toEqual(['config must be a JSON object; defaults used'])
  })

  test('accepts a JSON string with a BOM and an already parsed object', () => {
    expect(parse('﻿{"autonomy":{"mode":"guided"}}').config.autonomy.mode).toBe('guided')
    expect(parse({ autonomy: { mode: 'manual' } }).config.autonomy.mode).toBe('manual')
  })

  test('a partial file is deep-merged over the defaults', () => {
    const r = parse('{"autonomy":{"mode":"guided"},"ui":{"showBand":false},"guards":{"grantMinutes":30}}')
    expect(r.issues).toEqual([])
    expect(r.config.autonomy.mode).toBe('guided')
    expect(r.config.autonomy.maxAutoTurns).toBe(12)
    expect(r.config.ui).toEqual({ openPaneOnStart: false, showBand: false })
    expect(r.config.guards.grantMinutes).toBe(30)
    expect(r.config.guards.protectedBranches).toEqual(['main', 'master'])
    expect(r.config.paths).toEqual(DEFAULT_CONFIG.paths)
  })

  test('the result never aliases DEFAULT_CONFIG', () => {
    const r = parse('')
    r.config.plays.enabled.push(14)
    r.config.guards.protectedPaths.push('x')
    r.config.paths.intent = 'x/{slug}.md'
    expect(DEFAULT_CONFIG.plays.enabled).toEqual([...DEFAULT_PLAYS])
    expect(DEFAULT_CONFIG.guards.protectedPaths).toHaveLength(8)
    expect(DEFAULT_CONFIG.paths.intent).toBe('intent/{slug}.md')
  })

  test('unknown keys at any level are issues and ignored', () => {
    const r = parse({ colour: 'red', autonomy: { speed: 9 }, guards: { zap: true }, paths: { poem: 'x' }, bands: { sources: [{ metric: 'a', argv: ['x'], extra: 1 }] } })
    expect(r.issues).toContain('unknown key "colour" ignored')
    expect(r.issues).toContain('unknown key "autonomy.speed" ignored')
    expect(r.issues).toContain('unknown key "guards.zap" ignored')
    expect(r.issues).toContain('unknown key "paths.poem" ignored')
    expect(r.issues).toContain('unknown key "bands.sources[0].extra" ignored')
    expect(r.config.autonomy).toEqual(DEFAULT_CONFIG.autonomy)
  })

  test('$schema is kept; a wrong version is reported and read as 1', () => {
    const r = parse({ $schema: './s.json', version: 2 })
    expect(r.config.$schema).toBe('./s.json')
    expect(r.config.version).toBe(1)
    expect(r.issues).toEqual(['version 2 is not supported (expected 1); read as version 1'])
  })

  test('a section of the wrong type falls back to its defaults', () => {
    const r = parse({ autonomy: 'fast', guards: [], review: 3 })
    expect(r.config).toEqual(DEFAULT_CONFIG)
    expect(r.issues).toEqual(['autonomy must be an object; defaults used', 'guards must be an object; defaults used', 'review must be an object; defaults used'])
  })

  test('hostile input never throws', () => {
    const inputs: unknown[] = [
      { autonomy: { humanGates: 5, autoKinds: { a: 1 }, maxAutoTurns: {} } },
      { plays: { enabled: 'all' } },
      { guards: { secretPatterns: [null, 1, { name: 3 }], disabled: 'x', productionPatterns: [{}] } },
      { bands: { sources: 'x', window: [] }, review: { passes: [null, {}], ignorePaths: 1 } },
      { paths: { intent: 5, spec: null, plan: [] } },
      { policySkills: 9, verify: { commands: [1, '', null] } },
      JSON.parse('{"__proto__":{"x":1},"constructor":{"y":2}}'),
    ]
    for (const input of inputs) {
      const r = parse(input)
      expect(r.config.version).toBe(1)
      expect(r.config.autonomy.humanGates).toContain('release.approve')
      expect(Array.isArray(r.config.guards.secretPatterns)).toBe(true)
    }
  })
})

describe('parseConfig: autonomy', () => {
  test('numbers clamp and round, with an issue naming the key', () => {
    const r = parse({ autonomy: { maxAutoTurns: 500, haltOnBlocks: 0, haltOnVerifyFails: 2.6 } })
    expect(r.config.autonomy.maxAutoTurns).toBe(100)
    expect(r.config.autonomy.haltOnBlocks).toBe(1)
    expect(r.config.autonomy.haltOnVerifyFails).toBe(3)
    expect(r.issues).toEqual(['autonomy.maxAutoTurns 500 is outside 1..100; using 100', 'autonomy.haltOnBlocks 0 is outside 1..20; using 1'])
  })

  test('numeric strings are read; other strings keep the default', () => {
    expect(parse({ autonomy: { maxAutoTurns: '7' } }).config.autonomy.maxAutoTurns).toBe(7)
    const bad = parse({ autonomy: { maxAutoTurns: 'lots', haltOnBlocks: Number.NaN } })
    expect(bad.config.autonomy.maxAutoTurns).toBe(12)
    expect(bad.config.autonomy.haltOnBlocks).toBe(3)
    expect(bad.issues).toHaveLength(2)
  })

  test('an unknown mode keeps the default', () => {
    const r = parse({ autonomy: { mode: 'turbo' } })
    expect(r.config.autonomy.mode).toBe('semi')
    expect(r.issues).toEqual(['autonomy.mode must be one of manual | guided | semi; kept semi'])
  })

  test('humanGates always contains release.approve and is kept in gate order', () => {
    const r = parse({ autonomy: { humanGates: ['plan.accept', 'intent.approve'] } })
    expect(r.config.autonomy.humanGates).toEqual(['intent.approve', 'plan.accept', 'release.approve'])
    expect(r.issues).toEqual(['autonomy.humanGates: release.approve always needs a human; restored'])
    expect(parse({ autonomy: { humanGates: [] } }).config.autonomy.humanGates).toEqual(['release.approve'])
    expect(parse({ autonomy: { humanGates: ['release.approve', 'review.pass', 'review.pass'] } }).config.autonomy.humanGates).toEqual(['review.pass', 'release.approve'])
  })

  test('unknown gates and kinds are dropped with an issue', () => {
    const r = parse({ autonomy: { humanGates: ['spec.approve', 'deploy.now', 'release.approve'], autoKinds: ['verify', 'dance'] } })
    expect(r.config.autonomy.humanGates).toEqual(['spec.approve', 'release.approve'])
    expect(r.config.autonomy.autoKinds).toEqual(['verify'])
    expect(r.issues).toEqual(['autonomy.autoKinds: unknown value "dance"; dropped', 'autonomy.humanGates: unknown value "deploy.now"; dropped'])
  })
})

describe('parseConfig: plays respect prerequisites', () => {
  test('a play whose prerequisite is off is switched off, with the reason', () => {
    const r = parse({ plays: { enabled: [11] } })
    expect(r.config.plays.enabled).toEqual([])
    expect(r.issues).toEqual(['Play 11 needs Play 07, which is not enabled; Play 11 switched off'])
  })

  test('dropping one can orphan another: the chain is followed', () => {
    const r = parse({ plays: { enabled: [5, 6, 10, 11] } })
    expect(r.config.plays.enabled).toEqual([5, 6])
    expect(r.issues).toHaveLength(2)
    expect(r.issues[0]).toContain('Play 11 needs Play 07')
    expect(r.issues[1]).toContain('Play 10 needs Play 11')
  })

  test('a valid custom adoption is kept, sorted and de-duplicated', () => {
    const r = parse({ plays: { enabled: [8, 7, 7, 11, 1] } })
    expect(r.config.plays.enabled).toEqual([1, 7, 8, 11])
    expect(r.issues).toEqual([])
  })

  test('an explicit empty list means nothing adopted', () => {
    expect(parse({ plays: { enabled: [] } }).config.plays.enabled).toEqual([])
  })

  test('non-play values are dropped; numbers the knowledge base lacks are kept for a project override', () => {
    const r = parse({ plays: { enabled: [1, 'x', 1.5, 0, 100, 15] } })
    expect(r.config.plays.enabled).toEqual([1, 15])
    expect(r.issues).toHaveLength(4)
    expect(parse({ plays: { enabled: 'all' } }).issues).toEqual(['plays.enabled must be a list of play numbers; defaults used'])
  })

  test('prerequisites are checked against the plays passed in', () => {
    const lax = plays.map((p) => (p.n === 11 ? { ...p, prerequisites: [] } : p))
    expect(parseConfig({ plays: { enabled: [11] } }, { plays: lax }).config.plays.enabled).toEqual([11])
  })
})

describe('parseConfig: paths', () => {
  test('custom relative patterns are accepted and normalized', () => {
    const r = parse({ paths: { intent: './docs\\intents/{slug}.md', incident: 'ops/{date}.md', bands: 'ops/bands.yaml' } })
    expect(r.issues).toEqual([])
    expect(r.config.paths.intent).toBe('docs/intents/{slug}.md')
    expect(r.config.paths.incident).toBe('ops/{date}.md')
    expect(r.config.paths.bands).toBe('ops/bands.yaml')
  })

  test('unsafe or unusable patterns keep the default', () => {
    const r = parse({
      paths: { intent: '/etc/{slug}.md', spec: '../x/{slug}.md', plan: 'plans/plan.md', proof: 'p/{id}.md', review: '~/r/{slug}.md', eval: '' },
    })
    expect(r.config.paths.intent).toBe('intent/{slug}.md')
    expect(r.config.paths.spec).toBe('specs/{slug}.spec.md')
    expect(r.config.paths.plan).toBe('plans/{slug}.plan.md')
    expect(r.config.paths.proof).toBe('proofs/{slug}.proof.md')
    expect(r.config.paths.review).toBe('reviews/{slug}.review.md')
    expect(r.config.paths.eval).toBe('evals/{slug}.json')
    expect(r.issues).toHaveLength(6)
    expect(r.issues[0]).toContain('must be relative')
    expect(r.issues[2]).toContain('must contain {slug}')
    expect(r.issues[3]).toContain('unknown placeholder {id}')
  })

  test('knowledge.root must be a relative directory', () => {
    expect(parse({ knowledge: { root: './docs/ok/' } }).config.knowledge.root).toBe('docs/ok')
    const bad = parse({ knowledge: { root: '../../x' } })
    expect(bad.config.knowledge.root).toBe('openknowledge')
    expect(bad.issues).toHaveLength(1)
  })
})

describe('parseConfig: guards, verify, review, bands, ui', () => {
  test('lists replace the defaults; non-strings are dropped; guard ids are validated', () => {
    const r = parse({
      guards: { disabled: ['plan-first', 'nope'], protectedPaths: ['vendor/**', 5, '  '], protectedBranches: ['release'], destructiveSql: false, blockNetwork: true, grantMinutes: 9999 },
    })
    expect(r.config.guards.disabled).toEqual(['plan-first'])
    expect(r.config.guards.protectedPaths).toEqual(['vendor/**'])
    expect(r.config.guards.protectedBranches).toEqual(['release'])
    expect(r.config.guards.destructiveSql).toBe(false)
    expect(r.config.guards.blockNetwork).toBe(true)
    expect(r.config.guards.grantMinutes).toBe(480)
    expect(r.issues).toHaveLength(4)
  })

  test('regular expressions are validated; a leading (?i) is accepted', () => {
    const r = parse({
      guards: {
        secretPatterns: [{ name: 'ok', pattern: 'abc[0-9]+' }, { name: 'ci', pattern: '(?i)token=\\w+' }, { name: 'bad', pattern: '([' }, { pattern: 'x' }],
        productionPatterns: ['deploy.*prod', '(unclosed'],
      },
    })
    expect(r.config.guards.secretPatterns).toEqual([
      { name: 'ok', pattern: 'abc[0-9]+' },
      { name: 'ci', pattern: '(?i)token=\\w+' },
    ])
    expect(r.config.guards.productionPatterns).toEqual(['deploy.*prod'])
    expect(r.issues).toHaveLength(3)
  })

  test('the default secret patterns all validate', () => {
    expect(parse({ guards: { secretPatterns: DEFAULT_SECRET_PATTERNS, productionPatterns: DEFAULT_PRODUCTION_PATTERNS } }).issues).toEqual([])
  })

  test('verify commands and review settings', () => {
    const r = parse({
      verify: { commands: ['just ci', 'just ci', ' '] },
      review: { nitCap: 99, passes: [{ tag: 'Perf', title: 'Performance' }, { tag: 'Perf', title: 'dup' }, { tag: '1x', title: 'bad' }], ignorePaths: ['dist/**'] },
    })
    expect(r.config.verify.commands).toEqual(['just ci'])
    expect(r.config.review.nitCap).toBe(50)
    expect(r.config.review.passes).toEqual([{ tag: 'Perf', title: 'Performance' }])
    expect(r.config.review.ignorePaths).toEqual(['dist/**'])
    expect(parse({ review: { nitCap: 0 } }).config.review.nitCap).toBe(0)
  })

  test('review passes with no valid entry fall back to the three defaults', () => {
    const r = parse({ review: { passes: [{ tag: '', title: '' }] } })
    expect(r.config.review.passes).toEqual(DEFAULT_CONFIG.review.passes)
    expect(r.issues[r.issues.length - 1]).toBe('review.passes has no valid pass; defaults used')
  })

  test('band sources are validated: plain metric names, argv, parse, interval, duplicates', () => {
    const r = parse({
      bands: {
        enabled: true,
        window: 3,
        tier3: 'runbook',
        runbook: ['make rollback'],
        sources: [
          { metric: 'ci_failure_rate', description: 'CI failures', argv: ['gh', 'run', 'list'], parse: 'json:a.b.0.c', intervalMinutes: 0, higherIsWorse: false },
          { metric: 'latency', argv: ['./p99.sh'] },
          { metric: '../escape', argv: ['x'] },
          { metric: 'noargv', argv: [] },
          { metric: 'badparse', argv: ['x'], parse: 'xml' },
          { metric: 'latency', argv: ['dup'] },
        ],
      },
    })
    expect(r.config.bands.enabled).toBe(true)
    expect(r.config.bands.window).toBe(8)
    expect(r.config.bands.tier3).toBe('runbook')
    expect(r.config.bands.runbook).toEqual(['make rollback'])
    expect(r.config.bands.sources).toEqual([
      { metric: 'ci_failure_rate', description: 'CI failures', argv: ['gh', 'run', 'list'], parse: 'json:a.b.0.c', intervalMinutes: 1, higherIsWorse: false },
      { metric: 'latency', description: '', argv: ['./p99.sh'], parse: 'number', intervalMinutes: 60, higherIsWorse: true },
    ])
    expect(r.issues).toHaveLength(6)
  })
})

describe('serializeConfig and diffFromDefaults', () => {
  test('pretty JSON with a trailing newline and a stable key order, $schema first', () => {
    const text = serializeConfig({ ...DEFAULT_CONFIG, $schema: '../mods/okf-loop/schemas/okf-config.schema.json' })
    expect(text.endsWith('\n')).toBe(true)
    expect(text.startsWith('{\n  "$schema": "../mods/okf-loop/schemas/okf-config.schema.json",\n  "version": 1,')).toBe(true)
    const keys = Object.keys(JSON.parse(text) as object)
    expect(keys).toEqual(['$schema', 'version', 'knowledge', 'autonomy', 'plays', 'paths', 'guards', 'verify', 'review', 'bands', 'ui', 'policySkills'])
    expect(serializeConfig(DEFAULT_CONFIG)).not.toContain('$schema')
  })

  test('round trips through parseConfig', () => {
    const custom = parse({
      autonomy: { mode: 'guided', maxAutoTurns: 4 },
      plays: { enabled: [1, 2, 3, 7] },
      paths: { plan: 'work/{slug}.md' },
      guards: { disabled: ['plan-first'], grantMinutes: 5 },
      bands: { enabled: true, sources: [{ metric: 'm', argv: ['x'] }] },
    }).config
    expect(parse(serializeConfig(custom)).config).toEqual(custom)
    expect(parse(serializeConfig(DEFAULT_CONFIG))).toEqual({ config: DEFAULT_CONFIG, issues: [] })
  })

  test('unknown top-level keys of the previous file survive a rewrite', () => {
    const text = serializeConfig(DEFAULT_CONFIG, { note: 'mine', version: 1, autonomy: {} })
    const out = JSON.parse(text) as Record<string, unknown>
    expect(out.note).toBe('mine')
    expect(Object.keys(out)[Object.keys(out).length - 1]).toBe('note')
  })

  test('diffFromDefaults is empty for the defaults and minimal otherwise', () => {
    expect(diffFromDefaults(DEFAULT_CONFIG)).toEqual({})
    const custom = parse({ autonomy: { mode: 'manual' }, guards: { protectedBranches: ['main'] }, paths: { spec: 'specs/{slug}.md' } }).config
    expect(diffFromDefaults(custom)).toEqual({
      autonomy: { mode: 'manual' },
      paths: { spec: 'specs/{slug}.md' },
      guards: { protectedBranches: ['main'] },
    })
  })

  test('diffFromDefaults replaces arrays whole and round-trips', () => {
    const custom = withPlayToggled(DEFAULT_CONFIG, 9, plays).config
    const diff = diffFromDefaults(custom)
    expect(diff).toEqual({ plays: { enabled: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] } })
    expect(parse(JSON.stringify(diff)).config).toEqual(custom)
    expect(diffFromDefaults({ ...DEFAULT_CONFIG, $schema: './s.json' })).toEqual({ $schema: './s.json' })
  })
})

describe('withPlayToggled', () => {
  const enabled = (c: typeof DEFAULT_CONFIG) => c.plays.enabled

  test('enabling a play whose prerequisites are on succeeds and keeps the list sorted', () => {
    const r = withPlayToggled(DEFAULT_CONFIG, 9, plays)
    expect(r.ok).toBe(true)
    expect(enabled(r.config)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(r.reason).toBe('Play 09 · Continuous Evals in CI enabled.')
    expect(enabled(DEFAULT_CONFIG)).toEqual([...DEFAULT_PLAYS])
  })

  test('enabling a play with a prerequisite off is refused and says which', () => {
    const r = withPlayToggled(DEFAULT_CONFIG, 12, plays)
    expect(r.ok).toBe(true)
    const off = withPlayToggled(DEFAULT_CONFIG, 13, plays)
    expect(off.ok).toBe(false)
    expect(off.config).toBe(DEFAULT_CONFIG)
    expect(off.reason).toContain('Play 13 · Closing the Loop with Statistical Control Bands cannot be enabled yet')
    expect(off.reason).toContain('Play 09')
    expect(off.reason).toContain('Play 12')
    expect(off.reason).toContain('Enable those first.')
  })

  test('disabling a play an enabled play depends on is refused', () => {
    const r = withPlayToggled(DEFAULT_CONFIG, 7, plays)
    expect(r.ok).toBe(false)
    expect(r.config).toBe(DEFAULT_CONFIG)
    expect(r.reason).toBe('Play 07 · Hooks as Build-Time Guardrails cannot be disabled: Play 11 · Hooks as Non-Negotiable Approval Gates depends on it. Disable that first.')
    const many = withPlayToggled(withPlayToggled(DEFAULT_CONFIG, 12, plays).config, 11, plays)
    expect(many.ok).toBe(false)
    expect(many.reason).toContain('Play 10')
    expect(many.reason).toContain('Play 12')
    expect(many.reason).toContain('depend on it')
  })

  test('disabling from the top of a chain works, then its prerequisite can go', () => {
    const a = withPlayToggled(DEFAULT_CONFIG, 10, plays)
    expect(a.ok).toBe(true)
    expect(a.reason).toBe('Play 10 · Dual-Direction AI in the PR Review Loop disabled.')
    const b = withPlayToggled(a.config, 11, plays)
    expect(b.ok).toBe(true)
    const c = withPlayToggled(b.config, 7, plays)
    expect(c.ok).toBe(true)
    expect(enabled(c.config)).toEqual([1, 2, 3, 4, 5, 6, 8])
  })

  test('an entry point toggles on and off freely, and an unknown play is refused', () => {
    const off = withPlayToggled(DEFAULT_CONFIG, 8, plays)
    expect(off.ok).toBe(false)
    expect(off.reason).toContain('Play 04')
    const noTwelve = withPlayToggled({ ...DEFAULT_CONFIG, plays: { enabled: [] } }, 5, plays)
    expect(noTwelve.ok).toBe(true)
    const unknown = withPlayToggled(DEFAULT_CONFIG, 99, plays)
    expect(unknown.ok).toBe(false)
    expect(unknown.reason).toBe('Play 99 does not exist in the knowledge base.')
    expect(unknown.config).toBe(DEFAULT_CONFIG)
  })

  test('an adopted play the knowledge base lacks can still be switched off', () => {
    const c = { ...DEFAULT_CONFIG, plays: { enabled: [1, 15] } }
    const r = withPlayToggled(c, 15, plays)
    expect(r.ok).toBe(true)
    expect(enabled(r.config)).toEqual([1])
  })
})

describe('withGuardToggled and withMode', () => {
  test('a guard toggles in and out of guards.disabled, in guard order', () => {
    const a = withGuardToggled(DEFAULT_CONFIG, 'test-lock')
    expect(a.guards.disabled).toEqual(['test-lock'])
    const b = withGuardToggled(a, 'protect-paths')
    expect(b.guards.disabled).toEqual(['protect-paths', 'test-lock'])
    expect(withGuardToggled(b, 'test-lock').guards.disabled).toEqual(['protect-paths'])
    expect(DEFAULT_CONFIG.guards.disabled).toEqual([])
    expect(withGuardToggled(DEFAULT_CONFIG, 'bogus' as 'test-lock')).toBe(DEFAULT_CONFIG)
  })

  test('withMode sets a valid mode and ignores an invalid one', () => {
    expect(withMode(DEFAULT_CONFIG, 'manual').autonomy.mode).toBe('manual')
    expect(withMode(DEFAULT_CONFIG, 'manual').autonomy.maxAutoTurns).toBe(12)
    expect(withMode(DEFAULT_CONFIG, 'turbo' as 'semi')).toBe(DEFAULT_CONFIG)
  })
})

describe('artifactPath and artifactGlob', () => {
  test('expand {slug} and {date}', () => {
    expect(artifactPath(DEFAULT_CONFIG, 'intent', { slug: 'refunds' })).toBe('intent/refunds.md')
    expect(artifactPath(DEFAULT_CONFIG, 'spec', { slug: 'refunds' })).toBe('specs/refunds.spec.md')
    expect(artifactPath(DEFAULT_CONFIG, 'incident', { date: '2026-10-06' })).toBe('intent/incident-2026-10-06.md')
    expect(artifactPath(DEFAULT_CONFIG, 'lesson', { slug: 'x', date: '2026-10-06' })).toBe('lessons/2026-10-06-x.md')
    expect(artifactPath(DEFAULT_CONFIG, 'claudeMd', {})).toBe('CLAUDE.md')
  })

  test('a missing value leaves the placeholder visible; a slug cannot add a directory or climb out', () => {
    expect(artifactPath(DEFAULT_CONFIG, 'lesson', { slug: 'x' })).toBe('lessons/{date}-x.md')
    expect(artifactPath(DEFAULT_CONFIG, 'plan', {})).toBe('plans/{slug}.plan.md')
    expect(artifactPath(DEFAULT_CONFIG, 'plan', { slug: '../../etc/passwd' })).toBe('plans/.-.-etc-passwd.plan.md')
    expect(artifactPath(DEFAULT_CONFIG, 'plan', { slug: '$& $1' })).toBe('plans/$& $1.plan.md')
  })

  test('uses the configured patterns', () => {
    const c = parse({ paths: { plan: 'work/{date}/{slug}/plan.md' } }).config
    expect(artifactPath(c, 'plan', { slug: 's', date: '2026-01-02' })).toBe('work/2026-01-02/s/plan.md')
    expect(artifactGlob(c, 'plan')).toBe('work/*/*/plan.md')
  })

  test('artifactGlob turns {slug} (and {date}) into *', () => {
    expect(artifactGlob(DEFAULT_CONFIG, 'intent')).toBe('intent/*.md')
    expect(artifactGlob(DEFAULT_CONFIG, 'spec')).toBe('specs/*.spec.md')
    expect(artifactGlob(DEFAULT_CONFIG, 'incident')).toBe('intent/incident-*.md')
    expect(artifactGlob(DEFAULT_CONFIG, 'bands')).toBe('bands.yaml')
  })
})

describe('slugify', () => {
  test('kebab-case ascii', () => {
    expect(slugify('Refund self-service for claims')).toBe('refund-self-service-for-claims')
    expect(slugify('  Add OAuth2 / SSO login!! ')).toBe('add-oauth2-sso-login')
    expect(slugify('Café déjà vu')).toBe('cafe-deja-vu')
  })

  test('at most 48 characters, without a trailing hyphen', () => {
    const s = slugify('A very long title that keeps going and going well past the limit of forty-eight characters')
    expect(s.length).toBeLessThanOrEqual(48)
    expect(s.endsWith('-')).toBe(false)
    expect(s.startsWith('a-very-long-title')).toBe(true)
  })

  test('nothing sluggable falls back to "change"', () => {
    expect(slugify('')).toBe('change')
    expect(slugify('!!! ???')).toBe('change')
    expect(slugify('日本語')).toBe('change')
  })

  test('is unique against existing slugs by -2, -3, ignoring case', () => {
    expect(slugify('Refunds', ['refunds'])).toBe('refunds-2')
    expect(slugify('Refunds', ['refunds', 'REFUNDS-2'])).toBe('refunds-3')
    expect(slugify('Refunds', ['other'])).toBe('refunds')
  })

  test('the suffix still fits in 48 characters', () => {
    const long = 'x'.repeat(60)
    const first = slugify(long)
    expect(first).toHaveLength(48)
    const second = slugify(long, [first])
    expect(second).toHaveLength(48)
    expect(second.endsWith('-2')).toBe(true)
  })
})

describe('applyUserOptions', () => {
  test('mode, maxAutoTurns and openPaneOnStart override the file', () => {
    const c = applyUserOptions(DEFAULT_CONFIG, { mode: 'guided', maxAutoTurns: 5, openPaneOnStart: true })
    expect(c.autonomy.mode).toBe('guided')
    expect(c.autonomy.maxAutoTurns).toBe(5)
    expect(c.ui.openPaneOnStart).toBe(true)
    expect(DEFAULT_CONFIG.autonomy.mode).toBe('semi')
  })

  test('bad values are ignored; numbers clamp; strings are read', () => {
    const c = applyUserOptions(DEFAULT_CONFIG, { mode: 'turbo', maxAutoTurns: 'x', openPaneOnStart: 'maybe' })
    expect(c).toEqual(DEFAULT_CONFIG)
    expect(applyUserOptions(DEFAULT_CONFIG, { maxAutoTurns: 1000 }).autonomy.maxAutoTurns).toBe(100)
    expect(applyUserOptions(DEFAULT_CONFIG, { maxAutoTurns: '9', openPaneOnStart: 'true' }).autonomy.maxAutoTurns).toBe(9)
    expect(applyUserOptions(DEFAULT_CONFIG, { maxAutoTurns: '9', openPaneOnStart: 'true' }).ui.openPaneOnStart).toBe(true)
    expect(applyUserOptions(DEFAULT_CONFIG, {})).toEqual(DEFAULT_CONFIG)
  })
})
