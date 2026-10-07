// LoopConfig: defaults, forgiving parsing of .okf/config.json, and the pure
// edits the commands and the pane make to it. Never reads or writes a file.

import type { BandSource, GateId, GuardId, LoopConfig, Mode, PathKey, PlayDef } from '../../types'
import { ALWAYS_HUMAN_GATES, DEFAULT_PLAYS, GATE_ORDER, GUARD_ORDER, NEXT_ACTION_KINDS, PATH_KEYS } from './constants'
import { DEFAULT_PRODUCTION_PATTERNS, DEFAULT_SECRET_PATTERNS } from './guards'
import { bundledKnowledge, dependentsOf, playByNumber, playLabel, unmetPrerequisites } from './knowledge'

const MODES: readonly Mode[] = ['manual', 'guided', 'semi']

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const DEFAULT_CONFIG: LoopConfig = {
  version: 1,
  knowledge: { root: 'openknowledge' },
  autonomy: {
    mode: 'semi',
    maxAutoTurns: 12,
    haltOnBlocks: 3,
    haltOnVerifyFails: 3,
    humanGates: ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve'],
    autoKinds: ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'],
  },
  plays: { enabled: [...DEFAULT_PLAYS] },
  paths: {
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
  },
  guards: {
    disabled: [],
    // .okf/** keeps every agent tool away from the mod's own config, ledger and run state.
    protectedPaths: [
      'schemas/generated/**',
      'api/v1/frozen/**',
      '.env',
      '.env.*',
      '**/.env',
      '**/.env.*',
      'secrets/**',
      '.okf/**',
    ],
    testGlobs: ['tests/**', 'test/**', '__tests__/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go'],
    planFirstExempt: [
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
    ],
    secretPatterns: DEFAULT_SECRET_PATTERNS.map((p) => ({ name: p.name, pattern: p.pattern })),
    productionPatterns: [...DEFAULT_PRODUCTION_PATTERNS],
    destructiveSql: true,
    protectedBranches: ['main', 'master'],
    credentialPaths: ['~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '**/.env', '**/.env.*', 'secrets/**'],
    blockNetwork: false,
    grantMinutes: 15,
  },
  verify: {
    commands: [
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
    ],
  },
  review: {
    nitCap: 5,
    passes: [
      { tag: 'Bugs', title: 'Logic & Regressions' },
      { tag: 'Security', title: 'Security & Privacy' },
      { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
    ],
    ignorePaths: ['src/gen/**', 'build/**', '*.min.js', 'package-lock.json', 'yarn.lock'],
  },
  bands: { enabled: false, sources: [], window: 30, tier3: 'propose', runbook: [] },
  ui: { openPaneOnStart: false, showBand: true },
  policySkills: ['.claude/skills/**/SKILL.md', 'CLAUDE.md'],
}

// ---------------------------------------------------------------------------
// Parsing: every problem becomes an issue, every gap is filled from the defaults
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>

const at = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

function isRec(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** The object at `path`, with unknown keys reported; null when absent or not an object. */
function section(raw: unknown, path: string, known: readonly string[], issues: string[]): Rec | null {
  if (raw === undefined) return null
  if (!isRec(raw)) {
    issues.push(`${path} must be an object; defaults used`)
    return null
  }
  for (const key of Object.keys(raw)) {
    if (!known.includes(key)) issues.push(`unknown key "${path}.${key}" ignored`)
  }
  return raw
}

function pickBool(rec: Rec, key: string, path: string, fallback: boolean, issues: string[]): boolean {
  const v = rec[key]
  if (v === undefined) return fallback
  if (typeof v === 'boolean') return v
  issues.push(`${at(path, key)} must be true or false; kept ${fallback}`)
  return fallback
}

function pickInt(rec: Rec, key: string, path: string, min: number, max: number, fallback: number, issues: string[]): number {
  const v = rec[key]
  if (v === undefined) return fallback
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN
  if (!Number.isFinite(n)) {
    issues.push(`${at(path, key)} must be a number; kept ${fallback}`)
    return fallback
  }
  const rounded = Math.round(n)
  const clamped = Math.min(max, Math.max(min, rounded))
  if (clamped !== rounded) issues.push(`${at(path, key)} ${rounded} is outside ${min}..${max}; using ${clamped}`)
  return clamped
}

function pickEnum<T extends string>(rec: Rec, key: string, path: string, allowed: readonly T[], fallback: T, issues: string[]): T {
  const v = rec[key]
  if (v === undefined) return fallback
  const hit = allowed.find((a) => a === v)
  if (hit !== undefined) return hit
  issues.push(`${at(path, key)} must be one of ${allowed.join(' | ')}; kept ${fallback}`)
  return fallback
}

/** A list of non-empty strings (trimmed, de-duplicated); `check` returns an error message to drop an entry. */
function pickStrings(
  rec: Rec,
  key: string,
  path: string,
  fallback: readonly string[],
  issues: string[],
  check?: (s: string) => string | null,
): string[] {
  const v = rec[key]
  if (v === undefined) return [...fallback]
  if (!Array.isArray(v)) {
    issues.push(`${at(path, key)} must be a list of strings; defaults used`)
    return [...fallback]
  }
  const out: string[] = []
  for (const item of v) {
    const s = typeof item === 'string' ? item.trim() : ''
    if (s === '') {
      issues.push(`${at(path, key)} has an entry that is not a non-empty string; dropped`)
      continue
    }
    const problem = check ? check(s) : null
    if (problem !== null) issues.push(`${at(path, key)}: ${problem}; dropped`)
    else if (!out.includes(s)) out.push(s)
  }
  return out
}

function pickMembers<T extends string>(
  rec: Rec,
  key: string,
  path: string,
  allowed: readonly T[],
  fallback: readonly T[],
  issues: string[],
): T[] {
  const v = rec[key]
  if (v === undefined) return [...fallback]
  if (!Array.isArray(v)) {
    issues.push(`${at(path, key)} must be a list; defaults used`)
    return [...fallback]
  }
  const out: T[] = []
  for (const item of v) {
    const hit = allowed.find((a) => a === item)
    if (hit === undefined) issues.push(`${at(path, key)}: unknown value ${JSON.stringify(item)}; dropped`)
    else if (!out.includes(hit)) out.push(hit)
  }
  return out
}

const regexProblem = (flags: string) => (source: string) => {
  try {
    new RegExp(source, flags)
    return null
  } catch {
    return `"${source}" is not a valid regular expression`
  }
}

/** Per-run artifacts must carry {slug}, or two runs would share one file. */
const SLUG_REQUIRED: readonly PathKey[] = ['intent', 'spec', 'plan', 'proof', 'review']

function pathProblem(key: PathKey, value: string): string | null {
  if (/^([/~]|[A-Za-z]:)/.test(value)) return 'must be relative to the repository'
  if (value.split('/').includes('..')) return 'must not contain ".."'
  const stray = /\{([^}]*)\}/g
  for (let m = stray.exec(value); m; m = stray.exec(value)) {
    if (m[1] !== 'slug' && m[1] !== 'date') return `has an unknown placeholder {${m[1]}} (only {slug} and {date} expand)`
  }
  if (SLUG_REQUIRED.includes(key) && !value.includes('{slug}')) return 'must contain {slug}'
  return null
}

function parseSecretPatterns(rec: Rec, path: string, fallback: LoopConfig['guards']['secretPatterns'], issues: string[]) {
  const v = rec.secretPatterns
  if (v === undefined) return clone(fallback)
  if (!Array.isArray(v)) {
    issues.push(`${path}.secretPatterns must be a list of { name, pattern }; defaults used`)
    return clone(fallback)
  }
  const out: LoopConfig['guards']['secretPatterns'] = []
  v.forEach((item, i) => {
    const where = `${path}.secretPatterns[${i}]`
    if (!isRec(item) || typeof item.name !== 'string' || typeof item.pattern !== 'string' || item.name.trim() === '' || item.pattern === '') {
      issues.push(`${where} needs a non-empty name and pattern; dropped`)
      return
    }
    const problem = regexProblem('')(item.pattern)
    if (problem) issues.push(`${where}: ${problem}; dropped`)
    else out.push({ name: item.name.trim(), pattern: item.pattern })
  })
  return out
}

const BAND_METRIC = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/

function parseBandSources(rec: Rec, issues: string[]): BandSource[] {
  const v = rec.sources
  if (v === undefined) return []
  if (!Array.isArray(v)) {
    issues.push('bands.sources must be a list; none used')
    return []
  }
  const out: BandSource[] = []
  v.forEach((item, i) => {
    const where = `bands.sources[${i}]`
    const s = section(item, where, ['metric', 'description', 'argv', 'parse', 'intervalMinutes', 'higherIsWorse'], issues)
    if (!s) return
    const metric = typeof s.metric === 'string' ? s.metric.trim() : ''
    // The metric names a file under .okf/bands/, so it must be a plain token.
    if (!BAND_METRIC.test(metric)) {
      issues.push(`${where}.metric must be a plain name like "ci_failure_rate"; entry dropped`)
      return
    }
    if (out.some((o) => o.metric === metric)) {
      issues.push(`${where}.metric "${metric}" is listed twice; the later entry is dropped`)
      return
    }
    const argv = Array.isArray(s.argv) ? s.argv.filter((a): a is string => typeof a === 'string' && a !== '') : []
    if (argv.length === 0 || (Array.isArray(s.argv) && argv.length !== s.argv.length)) {
      issues.push(`${where}.argv must be a non-empty list of strings (a command, no shell); entry dropped`)
      return
    }
    const parse = typeof s.parse === 'string' && s.parse.trim() !== '' ? s.parse.trim() : 'number'
    if (parse !== 'number' && !/^json:\S+$/.test(parse)) {
      issues.push(`${where}.parse must be "number" or "json:path.to.value"; entry dropped`)
      return
    }
    out.push({
      metric,
      description: typeof s.description === 'string' ? s.description : '',
      argv,
      parse,
      intervalMinutes: pickInt(s, 'intervalMinutes', where, 1, 10080, 60, issues),
      higherIsWorse: pickBool(s, 'higherIsWorse', where, true, issues),
    })
  })
  return out
}

function parseReviewPasses(rec: Rec, fallback: LoopConfig['review']['passes'], issues: string[]) {
  const v = rec.passes
  if (v === undefined) return clone(fallback)
  if (!Array.isArray(v)) {
    issues.push('review.passes must be a list of { tag, title }; defaults used')
    return clone(fallback)
  }
  const out: LoopConfig['review']['passes'] = []
  v.forEach((item, i) => {
    const where = `review.passes[${i}]`
    const p = section(item, where, ['tag', 'title'], issues)
    const tag = typeof p?.tag === 'string' ? p.tag.trim() : ''
    const title = typeof p?.title === 'string' ? p.title.trim() : ''
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(tag) || title === '') {
      issues.push(`${where} needs a tag like "Bugs" (letters, digits, - _) and a title; dropped`)
    } else if (out.some((o) => o.tag === tag)) {
      issues.push(`${where}.tag "${tag}" is listed twice; dropped`)
    } else out.push({ tag, title })
  })
  if (out.length === 0) {
    issues.push('review.passes has no valid pass; defaults used')
    return clone(fallback)
  }
  return out
}

function cleanRoot(value: string): string | null {
  const r = value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  if (r === '' || /^([/~]|[A-Za-z]:)/.test(r) || r.split('/').includes('..')) return null
  return r
}

/**
 * Switch off every play whose prerequisites are not adopted (repeating, because
 * dropping one can orphan another). Numbers the knowledge base does not define
 * are kept: the project's own openknowledge/ may add plays this list lacks.
 */
export function normalizePlays(enabled: number[], plays: PlayDef[]): { enabled: number[]; issues: string[] } {
  let kept = [...new Set(enabled)].sort((a, b) => a - b)
  const issues: string[] = []
  for (;;) {
    const orphan = kept.find((n) => unmetPrerequisites(plays, n, kept).length > 0)
    if (orphan === undefined) break
    const missing = unmetPrerequisites(plays, orphan, kept)
    issues.push(
      `Play ${pad2(orphan)} needs ${missing.map((m) => `Play ${pad2(m)}`).join(' and ')}, which ${missing.length > 1 ? 'are' : 'is'} not enabled; Play ${pad2(orphan)} switched off`,
    )
    kept = kept.filter((n) => n !== orphan)
  }
  return { enabled: kept, issues }
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n))

const TOP_KEYS = ['$schema', 'version', 'knowledge', 'autonomy', 'plays', 'paths', 'guards', 'verify', 'review', 'bands', 'ui', 'policySkills']

/**
 * Deep-merge `input` (a JSON string or an already parsed value) over the defaults.
 * Never throws. Pass `opts.plays` (the merged knowledge) so prerequisites are checked
 * against the project's own plays; the bundled ones are used otherwise.
 */
export function parseConfig(input: string | unknown, opts: { plays?: PlayDef[] } = {}): { config: LoopConfig; issues: string[] } {
  const issues: string[] = []
  const config = clone(DEFAULT_CONFIG)

  let raw: unknown = input
  if (typeof input === 'string') {
    if (input.trim() === '') return { config, issues }
    try {
      raw = JSON.parse(input.replace(/^﻿/, ''))
    } catch (err) {
      issues.push(`config is not valid JSON (${err instanceof Error ? err.message : String(err)}); defaults used`)
      return { config, issues }
    }
  }
  if (raw === undefined || raw === null) return { config, issues }
  if (!isRec(raw)) {
    issues.push('config must be a JSON object; defaults used')
    return { config, issues }
  }

  for (const key of Object.keys(raw)) if (!TOP_KEYS.includes(key)) issues.push(`unknown key "${key}" ignored`)
  if (typeof raw.$schema === 'string' && raw.$schema.trim() !== '') config.$schema = raw.$schema.trim()
  if (raw.version !== undefined && raw.version !== 1) issues.push(`version ${JSON.stringify(raw.version)} is not supported (expected 1); read as version 1`)

  const knowledge = section(raw.knowledge, 'knowledge', ['root'], issues)
  if (knowledge && knowledge.root !== undefined) {
    const root = typeof knowledge.root === 'string' ? cleanRoot(knowledge.root) : null
    if (root === null) issues.push('knowledge.root must be a relative directory like "openknowledge"; kept the default')
    else config.knowledge.root = root
  }

  const a = section(raw.autonomy, 'autonomy', ['mode', 'maxAutoTurns', 'haltOnBlocks', 'haltOnVerifyFails', 'humanGates', 'autoKinds'], issues)
  if (a) {
    const d = DEFAULT_CONFIG.autonomy
    config.autonomy.mode = pickEnum(a, 'mode', 'autonomy', MODES, d.mode, issues)
    config.autonomy.maxAutoTurns = pickInt(a, 'maxAutoTurns', 'autonomy', 1, 100, d.maxAutoTurns, issues)
    config.autonomy.haltOnBlocks = pickInt(a, 'haltOnBlocks', 'autonomy', 1, 20, d.haltOnBlocks, issues)
    config.autonomy.haltOnVerifyFails = pickInt(a, 'haltOnVerifyFails', 'autonomy', 1, 20, d.haltOnVerifyFails, issues)
    config.autonomy.autoKinds = pickMembers(a, 'autoKinds', 'autonomy', NEXT_ACTION_KINDS, d.autoKinds, issues)
    const gates = pickMembers(a, 'humanGates', 'autonomy', GATE_ORDER, d.humanGates, issues)
    if (a.humanGates !== undefined && Array.isArray(a.humanGates) && !gates.includes('release.approve')) {
      issues.push('autonomy.humanGates: release.approve always needs a human; restored')
    }
    config.autonomy.humanGates = withAlwaysHuman(gates)
  }

  const plays = section(raw.plays, 'plays', ['enabled'], issues)
  if (plays && plays.enabled !== undefined) {
    if (!Array.isArray(plays.enabled)) issues.push('plays.enabled must be a list of play numbers; defaults used')
    else {
      const numbers: number[] = []
      for (const item of plays.enabled) {
        if (typeof item === 'number' && Number.isInteger(item) && item >= 1 && item <= 99) numbers.push(item)
        else issues.push(`plays.enabled: ${JSON.stringify(item)} is not a play number (1..99); dropped`)
      }
      config.plays.enabled = numbers
    }
  }
  const normalized = normalizePlays(config.plays.enabled, opts.plays ?? bundledKnowledge().plays)
  config.plays.enabled = normalized.enabled
  issues.push(...normalized.issues)

  const paths = section(raw.paths, 'paths', PATH_KEYS, issues)
  if (paths) {
    for (const key of PATH_KEYS) {
      const v = paths[key]
      if (v === undefined) continue
      const value = typeof v === 'string' ? v.trim().replace(/\\/g, '/').replace(/^\.\//, '') : ''
      const problem = value === '' ? 'must be a non-empty path' : pathProblem(key, value)
      if (problem !== null) issues.push(`paths.${key} ${problem}; kept "${DEFAULT_CONFIG.paths[key]}"`)
      else config.paths[key] = value
    }
  }

  const g = section(
    raw.guards,
    'guards',
    [
      'disabled',
      'protectedPaths',
      'testGlobs',
      'planFirstExempt',
      'secretPatterns',
      'productionPatterns',
      'destructiveSql',
      'protectedBranches',
      'credentialPaths',
      'blockNetwork',
      'grantMinutes',
    ],
    issues,
  )
  if (g) {
    const d = DEFAULT_CONFIG.guards
    const t = config.guards
    t.disabled = pickMembers(g, 'disabled', 'guards', GUARD_ORDER, d.disabled, issues)
    t.protectedPaths = pickStrings(g, 'protectedPaths', 'guards', d.protectedPaths, issues)
    t.testGlobs = pickStrings(g, 'testGlobs', 'guards', d.testGlobs, issues)
    t.planFirstExempt = pickStrings(g, 'planFirstExempt', 'guards', d.planFirstExempt, issues)
    t.secretPatterns = parseSecretPatterns(g, 'guards', d.secretPatterns, issues)
    t.productionPatterns = pickStrings(g, 'productionPatterns', 'guards', d.productionPatterns, issues, regexProblem('i'))
    t.destructiveSql = pickBool(g, 'destructiveSql', 'guards', d.destructiveSql, issues)
    t.protectedBranches = pickStrings(g, 'protectedBranches', 'guards', d.protectedBranches, issues)
    t.credentialPaths = pickStrings(g, 'credentialPaths', 'guards', d.credentialPaths, issues)
    t.blockNetwork = pickBool(g, 'blockNetwork', 'guards', d.blockNetwork, issues)
    t.grantMinutes = pickInt(g, 'grantMinutes', 'guards', 1, 480, d.grantMinutes, issues)
  }

  const verify = section(raw.verify, 'verify', ['commands'], issues)
  if (verify) config.verify.commands = pickStrings(verify, 'commands', 'verify', DEFAULT_CONFIG.verify.commands, issues)

  const review = section(raw.review, 'review', ['nitCap', 'passes', 'ignorePaths'], issues)
  if (review) {
    const d = DEFAULT_CONFIG.review
    config.review.nitCap = pickInt(review, 'nitCap', 'review', 0, 50, d.nitCap, issues)
    config.review.passes = parseReviewPasses(review, d.passes, issues)
    config.review.ignorePaths = pickStrings(review, 'ignorePaths', 'review', d.ignorePaths, issues)
  }

  const bands = section(raw.bands, 'bands', ['enabled', 'sources', 'window', 'tier3', 'runbook'], issues)
  if (bands) {
    const d = DEFAULT_CONFIG.bands
    config.bands.enabled = pickBool(bands, 'enabled', 'bands', d.enabled, issues)
    config.bands.sources = parseBandSources(bands, issues)
    // evaluateSeries waits for 8 samples by default, so a shorter window could never fire.
    config.bands.window = pickInt(bands, 'window', 'bands', 8, 500, d.window, issues)
    config.bands.tier3 = pickEnum(bands, 'tier3', 'bands', ['propose', 'runbook'] as const, d.tier3, issues)
    config.bands.runbook = pickStrings(bands, 'runbook', 'bands', d.runbook, issues)
  }

  const ui = section(raw.ui, 'ui', ['openPaneOnStart', 'showBand'], issues)
  if (ui) {
    config.ui.openPaneOnStart = pickBool(ui, 'openPaneOnStart', 'ui', DEFAULT_CONFIG.ui.openPaneOnStart, issues)
    config.ui.showBand = pickBool(ui, 'showBand', 'ui', DEFAULT_CONFIG.ui.showBand, issues)
  }

  if (raw.policySkills !== undefined) {
    config.policySkills = pickStrings({ policySkills: raw.policySkills }, 'policySkills', '', DEFAULT_CONFIG.policySkills, issues)
  }

  return { config, issues }
}

function withAlwaysHuman(gates: GateId[]): GateId[] {
  const set = new Set<GateId>([...gates, ...ALWAYS_HUMAN_GATES])
  return GATE_ORDER.filter((g) => set.has(g))
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Stable key order, `$schema` first. `base` is the previously parsed file: its unknown top-level keys are kept, not erased. */
export function serializeConfig(config: LoopConfig, base?: unknown): string {
  const c = config
  const ordered: Rec = {}
  if (c.$schema) ordered.$schema = c.$schema
  ordered.version = 1
  ordered.knowledge = { root: c.knowledge.root }
  ordered.autonomy = {
    mode: c.autonomy.mode,
    maxAutoTurns: c.autonomy.maxAutoTurns,
    haltOnBlocks: c.autonomy.haltOnBlocks,
    haltOnVerifyFails: c.autonomy.haltOnVerifyFails,
    humanGates: c.autonomy.humanGates,
    autoKinds: c.autonomy.autoKinds,
  }
  ordered.plays = { enabled: c.plays.enabled }
  const paths: Rec = {}
  for (const key of PATH_KEYS) paths[key] = c.paths[key]
  ordered.paths = paths
  ordered.guards = {
    disabled: c.guards.disabled,
    protectedPaths: c.guards.protectedPaths,
    testGlobs: c.guards.testGlobs,
    planFirstExempt: c.guards.planFirstExempt,
    secretPatterns: c.guards.secretPatterns,
    productionPatterns: c.guards.productionPatterns,
    destructiveSql: c.guards.destructiveSql,
    protectedBranches: c.guards.protectedBranches,
    credentialPaths: c.guards.credentialPaths,
    blockNetwork: c.guards.blockNetwork,
    grantMinutes: c.guards.grantMinutes,
  }
  ordered.verify = { commands: c.verify.commands }
  ordered.review = { nitCap: c.review.nitCap, passes: c.review.passes, ignorePaths: c.review.ignorePaths }
  ordered.bands = {
    enabled: c.bands.enabled,
    sources: c.bands.sources,
    window: c.bands.window,
    tier3: c.bands.tier3,
    runbook: c.bands.runbook,
  }
  ordered.ui = { openPaneOnStart: c.ui.openPaneOnStart, showBand: c.ui.showBand }
  ordered.policySkills = c.policySkills
  if (isRec(base)) {
    for (const key of Object.keys(base)) if (!TOP_KEYS.includes(key) && ordered[key] === undefined) ordered[key] = base[key]
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

function patch(value: unknown, base: unknown): unknown {
  if (isRec(value) && isRec(base)) {
    const out: Rec = {}
    for (const key of Object.keys(value)) {
      const p = patch(value[key], base[key])
      if (p !== undefined) out[key] = p
    }
    return Object.keys(out).length > 0 ? out : undefined
  }
  return sameJson(value, base) ? undefined : value
}

/** Only what differs from DEFAULT_CONFIG (arrays replace whole); `{}` for a default config. parseConfig(JSON of it) round-trips. */
export function diffFromDefaults(config: LoopConfig): Record<string, unknown> {
  const out: Rec = {}
  if (config.$schema) out.$schema = config.$schema
  const p = patch(config, DEFAULT_CONFIG)
  if (isRec(p)) {
    for (const key of Object.keys(p)) if (key !== '$schema') out[key] = p[key]
  }
  return out
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * Enable or disable play `n` (a toggle). Enabling needs every prerequisite adopted;
 * disabling is refused while an adopted play depends on it. A refusal returns the
 * config untouched and says why.
 */
export function withPlayToggled(
  config: LoopConfig,
  n: number,
  plays: PlayDef[],
): { config: LoopConfig; ok: boolean; reason: string } {
  const enabled = config.plays.enabled
  if (!enabled.includes(n) && !playByNumber(plays, n)) {
    return { config, ok: false, reason: `Play ${pad2(n)} does not exist in the knowledge base.` }
  }
  if (enabled.includes(n)) {
    const dependents = dependentsOf(plays, n, enabled)
    if (dependents.length > 0) {
      const names = dependents.map((d) => playLabel(plays, d)).join(', ')
      return {
        config,
        ok: false,
        reason: `${playLabel(plays, n)} cannot be disabled: ${names} ${dependents.length > 1 ? 'depend' : 'depends'} on it. Disable ${dependents.length > 1 ? 'those' : 'that'} first.`,
      }
    }
    return {
      config: { ...config, plays: { ...config.plays, enabled: enabled.filter((x) => x !== n) } },
      ok: true,
      reason: `${playLabel(plays, n)} disabled.`,
    }
  }
  const unmet = unmetPrerequisites(plays, n, enabled)
  if (unmet.length > 0) {
    const names = unmet.map((u) => playLabel(plays, u)).join(', ')
    return {
      config,
      ok: false,
      reason: `${playLabel(plays, n)} cannot be enabled yet: it needs ${names}. Enable ${unmet.length > 1 ? 'those' : 'that'} first.`,
    }
  }
  return {
    config: { ...config, plays: { ...config.plays, enabled: [...enabled, n].sort((a, b) => a - b) } },
    ok: true,
    reason: `${playLabel(plays, n)} enabled.`,
  }
}

export function withGuardToggled(config: LoopConfig, id: GuardId): LoopConfig {
  if (!GUARD_ORDER.includes(id)) return config
  const off = config.guards.disabled.includes(id)
  const disabled = off ? config.guards.disabled.filter((g) => g !== id) : GUARD_ORDER.filter((g) => g === id || config.guards.disabled.includes(g))
  return { ...config, guards: { ...config.guards, disabled } }
}

export function withMode(config: LoopConfig, mode: Mode): LoopConfig {
  if (!MODES.includes(mode)) return config
  return { ...config, autonomy: { ...config.autonomy, mode } }
}

// ---------------------------------------------------------------------------
// Artifact paths and slugs
// ---------------------------------------------------------------------------

/** A slug or date never gets to add a directory level or climb out of it. */
const segment = (s: string): string => s.replace(/[\\/]+/g, '-').replace(/\.{2,}/g, '.')

/** Expand {slug} and {date}; a placeholder without a value stays visible. */
export function artifactPath(config: LoopConfig, key: PathKey, vars: { slug?: string; date?: string }): string {
  return config.paths[key]
    .replace(/\{slug\}/g, () => (vars.slug === undefined ? '{slug}' : segment(vars.slug)))
    .replace(/\{date\}/g, () => (vars.date === undefined ? '{date}' : segment(vars.date)))
}

/** The path as a glob over every run: {slug} and {date} become `*`. */
export function artifactGlob(config: LoopConfig, key: PathKey): string {
  return config.paths[key].replace(/\{slug\}|\{date\}/g, '*')
}

const SLUG_MAX = 48

/** kebab-case, at most 48 characters, unique against `existing` by a -2, -3 … suffix. */
export function slugify(title: string, existing: string[] = []): string {
  let base = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '')
  if (base === '') base = 'change'
  const taken = new Set(existing.map((s) => s.toLowerCase()))
  if (!taken.has(base)) return base
  for (let i = 2; ; i++) {
    const suffix = `-${i}`
    const candidate = `${base.slice(0, SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

// ---------------------------------------------------------------------------
// plugin.json userConfig
// ---------------------------------------------------------------------------

function asBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  if (v === 'true') return true
  if (v === 'false') return false
  return null
}

/** The plugin's userConfig (mode, maxAutoTurns, openPaneOnStart) beats the file. Bad values are ignored. */
export function applyUserOptions(config: LoopConfig, options: Record<string, unknown>): LoopConfig {
  const next = clone(config)
  const mode = MODES.find((m) => m === options.mode)
  if (mode) next.autonomy.mode = mode
  const turns = typeof options.maxAutoTurns === 'string' && options.maxAutoTurns.trim() !== '' ? Number(options.maxAutoTurns) : options.maxAutoTurns
  if (typeof turns === 'number' && Number.isFinite(turns)) next.autonomy.maxAutoTurns = Math.min(100, Math.max(1, Math.round(turns)))
  const open = asBool(options.openPaneOnStart)
  if (open !== null) next.ui.openPaneOnStart = open
  return next
}
