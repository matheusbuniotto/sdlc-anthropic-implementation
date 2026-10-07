// LoopConfig: the pure edits the commands and the pane make to it, its serialization,
// artifact paths and slugs. Defaults live in config-defaults.ts and parsing in
// config-parse.ts; both are re-exported so callers import everything from here.

import type { GuardId, LoopConfig, Mode, PathKey, PlayDef } from '../../types'
import { GUARD_ORDER, PATH_KEYS } from './constants'
import { DEFAULT_CONFIG, MODES, clone } from './config-defaults'
import { TOP_KEYS, isRec, pad2 } from './config-parse'
import { dependentsOf, playByNumber, playLabel, unmetPrerequisites } from './knowledge'

export { DEFAULT_CONFIG } from './config-defaults'
export { normalizePlays, parseConfig } from './config-parse'

type Rec = Record<string, unknown>

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
