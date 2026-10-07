// disk -> Model. Reads nothing itself: register.tsx hands over the files as a DiskState and
// this turns them into snapshots (stages, gates, next action), guard stats, band readings
// and the provenance findings (implicit human approvals, quarantined ones).

import type {
  ArtifactDoc,
  ArtifactKind,
  ArtifactStatus,
  GateId,
  LedgerEntry,
  LoopConfig,
  RunRecord,
  RunSnapshot,
  RunSource,
} from '../../types'
import { parseArtifact, parseReview, parseVerdict } from './artifacts'
import { parseBandsYaml, parseSamples } from './bands'
import { applyUserOptions, artifactPath, parseConfig } from './config'
import { GATE_DEFS } from './constants'
import type { DiskState, Facts, Model, Quarantine, RunState, Runtime } from './controller-types'
import { NO_FACTS } from './controller-types'
import { bundledKnowledge, knowledgeFiles, loadKnowledge, mergeKnowledge } from './knowledge'
import { parseLedger } from './ledger'
import { evaluateSeries } from './spc'
import { deriveRun, newRunRecord } from './stages'

// ---------------------------------------------------------------------------
// Plugin options and config
// ---------------------------------------------------------------------------

/**
 * plugin.json `userConfig` carries sentinels ("config" / 0) so an untouched field means
 * "use .okf/config.json"; only what the person really set is returned.
 */
export function userOverrides(options: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const mode = options.mode
  if (mode === 'manual' || mode === 'guided' || mode === 'semi') out.mode = mode
  const turns = Number(options.maxAutoTurns)
  if (Number.isFinite(turns) && turns > 0) out.maxAutoTurns = turns
  const open = options.openPaneOnStart
  if (open === 'yes' || open === true) out.openPaneOnStart = true
  else if (open === 'no' || open === false) out.openPaneOnStart = false
  return out
}

/** Where the project's own knowledge lives, before anything else is known. */
export function knowledgeRootOf(configText: string | null): string {
  return parseConfig(configText ?? '').config.knowledge.root
}

/** The repo paths of the project's own knowledge worth reading for this config text. */
export function knowledgePaths(configText: string | null): string[] {
  return knowledgeFiles(knowledgeRootOf(configText))
}

export function resolveConfig(
  configText: string | null,
  userOptions: Record<string, unknown>,
  files: Record<string, string>,
): Pick<Model, 'fileConfig' | 'config' | 'overridden' | 'configBase' | 'configIssues' | 'knowledge'> {
  const first = parseConfig(configText ?? '')
  const root = first.config.knowledge.root
  const bundled = bundledKnowledge()
  const knowledge = Object.keys(files).length > 0 ? mergeKnowledge(bundled, loadKnowledge(files, root)) : bundled
  const parsed = parseConfig(configText ?? '', { plays: knowledge.plays })
  const config = applyUserOptions(parsed.config, userOptions)
  let configBase: unknown = null
  try {
    configBase = configText && configText.trim() !== '' ? JSON.parse(configText) : null
  } catch {
    configBase = null
  }
  return {
    fileConfig: parsed.config,
    config,
    overridden: {
      mode: userOptions.mode !== undefined,
      maxAutoTurns: userOptions.maxAutoTurns !== undefined,
      openPaneOnStart: userOptions.openPaneOnStart !== undefined,
    },
    configBase,
    configIssues: parsed.issues,
    knowledge,
  }
}

// ---------------------------------------------------------------------------
// Run records
// ---------------------------------------------------------------------------

const rec = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const count = (v: unknown): number => Math.max(0, Math.round(num(v, 0)))

/** A run record, defensively: bad fields fall back to a fresh record's values, the file name is the slug. */
export function parseRunRecord(text: string, slug: string): { record: RunRecord | null; issue?: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { record: null, issue: `.okf/runs/${slug}.json is not valid JSON (${err instanceof Error ? err.message : String(err)}); run skipped` }
  }
  const o = rec(raw)
  if (!o) return { record: null, issue: `.okf/runs/${slug}.json is not a JSON object; run skipped` }
  const source: RunSource = o.source === 'ticket' || o.source === 'anomaly' ? o.source : 'human'
  const record = newRunRecord({ slug, title: typeof o.title === 'string' && o.title.trim() !== '' ? o.title : slug, source, now: num(o.createdAt, 0) })
  const approvals = rec(o.approvals)
  if (approvals) {
    for (const gate of Object.keys(GATE_DEFS) as GateId[]) {
      const a = rec(approvals[gate])
      if (a && typeof a.by === 'string') record.approvals[gate] = { by: a.by, at: num(a.at, 0), ...(typeof a.note === 'string' && a.note !== '' ? { note: a.note } : {}) }
    }
  }
  const fix = rec(o.fix)
  if (fix) {
    record.fix = { active: fix.active === true, reproCommitted: fix.reproCommitted === true, ...(typeof fix.since === 'number' ? { since: fix.since } : {}) }
  }
  const proof = rec(o.proof)
  if (proof) {
    record.proof = {
      lastEditAt: num(proof.lastEditAt, 0),
      lastRunAt: num(proof.lastRunAt, 0),
      lastRunPassed: typeof proof.lastRunPassed === 'boolean' ? proof.lastRunPassed : null,
      lastCommand: typeof proof.lastCommand === 'string' ? proof.lastCommand : '',
    }
  }
  if (Array.isArray(o.edits)) record.edits = [...new Set(o.edits.filter((e): e is string => typeof e === 'string'))].slice(0, 200)
  record.autoTurns = count(o.autoTurns)
  record.blockStreak = count(o.blockStreak)
  record.verifyFailStreak = count(o.verifyFailStreak)
  record.paused = o.paused === true
  return { record }
}

// ---------------------------------------------------------------------------
// Artifacts and derivation
// ---------------------------------------------------------------------------

export const CORE_KINDS = ['intent', 'spec', 'plan', 'proof', 'review'] as const
type CoreKind = (typeof CORE_KINDS)[number]

/** Every artifact path register.tsx should read for these runs. */
export function artifactReadPaths(config: LoopConfig, slugs: string[]): string[] {
  const out = new Set<string>()
  for (const slug of slugs) for (const kind of CORE_KINDS) out.add(artifactPath(config, kind, { slug }))
  return [...out]
}

export const GATED: { kind: 'intent' | 'spec' | 'plan'; gate: GateId; status: 'approved' | 'accepted' }[] = [
  { kind: 'intent', gate: 'intent.approve', status: 'approved' },
  { kind: 'spec', gate: 'spec.approve', status: 'approved' },
  { kind: 'plan', gate: 'plan.accept', status: 'accepted' },
]

export const quarantineNote = (file: string, gate: GateId): string =>
  `${file} says approved but changed while the agent was working: confirm with /sdlc approve ${gate}`

export function quarantineKey(slug: string, gate: GateId): string {
  return `${slug}:${gate}`
}

/** A quarantine entry in the ledger that nothing has superseded (survives a reload): the file is unchanged since. */
function quarantineInLedger(ledger: LedgerEntry[], slug: string, gate: GateId, docMtime: number): LedgerEntry | null {
  let q: LedgerEntry | null = null
  for (const e of ledger) if (e.kind === 'guard.blocked' && e.run === slug && e.data?.quarantine === true && e.data.gate === gate) q = e
  if (!q) return null
  const at = q.ts
  if (ledger.some(e => e.kind === 'gate.approved' && e.run === slug && e.data?.gate === gate && e.ts > at)) return null
  return docMtime > at + 1000 ? null : q
}

export function releaseOpen(runtime: Pick<Runtime, 'grantUntil' | 'envToken'>, now: number): boolean {
  return runtime.envToken || (runtime.grantUntil !== null && runtime.grantUntil > now)
}

/** The snapshot for a run state, with quarantined approvals held closed. */
export function snapshotFor(
  config: LoopConfig,
  s: Pick<RunState, 'record' | 'docs' | 'proofVerdict' | 'review'>,
  quarantined: Quarantine[],
  releaseGranted: boolean,
  now: number,
): RunSnapshot {
  const docs: Partial<Record<ArtifactKind, ArtifactDoc>> = { ...s.docs }
  for (const q of quarantined) {
    const kind = GATE_DEFS[q.gate].artifact
    const doc = kind ? docs[kind] : undefined
    if (kind && doc) docs[kind] = { ...doc, status: 'under-review' }
  }
  const snap = deriveRun({ record: s.record, docs, proofVerdict: s.proofVerdict, review: s.review, config, releaseGranted, now })
  for (const stage of snap.stages) {
    for (const gate of stage.gates) {
      const q = quarantined.find(x => x.gate === gate.id)
      if (!q) continue
      gate.requirements = gate.requirements.map(r =>
        r.by === 'human' && (r.id === 'approved' || r.id === 'accepted') ? { ...r, ok: false, detail: quarantineNote(q.path, q.gate) } : r,
      )
    }
  }
  return snap
}

export type Finding = { slug: string; gate: GateId; path: string; verdict: 'implicit' | 'quarantine' }

export function freshRuntime(): Runtime {
  return {
    grantUntil: null,
    envToken: false,
    pending: null,
    halted: {},
    toastAt: {},
    notice: '',
    noticeAt: 0,
    seen: {},
    lastRefreshAt: 0,
    quarantine: {},
    countedProof: {},
    passed: {},
    stageOf: {},
  }
}

export function blankModel(): Model {
  const knowledge = bundledKnowledge()
  const parsed = parseConfig('', { plays: knowledge.plays })
  return {
    ready: false,
    now: 0,
    cwd: '',
    home: '',
    project: '',
    fileConfig: parsed.config,
    config: parsed.config,
    overridden: { mode: false, maxAutoTurns: false, openPaneOnStart: false },
    configBase: null,
    configIssues: [],
    knowledge,
    runs: [],
    active: null,
    ledger: [],
    exists: {},
    promptOverrides: {},
    bands: { samples: {}, readings: {}, lastCheckedAt: {}, breached: {}, proposals: {}, lastSampleLedgerAt: {}, spec: null },
    runtime: freshRuntime(),
  }
}

const TIER_RANK = { 'in-control': 0, '1sigma': 1, '2sigma': 2, '3sigma': 3 } as const

/**
 * Derive the Model from disk. `prev` carries the runtime state that is not on disk (autopilot flags, rate
 * limits, what the statuses were at the last refresh); `facts` is what register.tsx saw the agent do since.
 * A status that newly reads approved with no record is an implicit human approval only if the agent was
 * idle meanwhile; otherwise it is quarantined (the agent cannot be ruled out as the writer).
 */
export function ingestWith(disk: DiskState, now: number, prev?: Model, facts: Facts = NO_FACTS): { model: Model; findings: Finding[] } {
  const cfg = resolveConfig(disk.configText, disk.userOptions, disk.knowledgeFiles)
  const config = cfg.config
  const ledger = parseLedger(disk.ledgerText ?? '', 2000)
  const issues = [...cfg.configIssues]
  const runtime: Runtime = { ...freshRuntime(), ...(prev?.runtime ?? {}), grantUntil: disk.grantUntil, envToken: disk.envToken, quarantine: {}, seen: {}, passed: {}, stageOf: {} }
  const granted = releaseOpen(runtime, now)
  const findings: Finding[] = []
  const runs: RunState[] = []

  for (const slug of Object.keys(disk.runFiles).sort()) {
    const parsed = parseRunRecord(disk.runFiles[slug] ?? '', slug)
    if (!parsed.record) {
      if (parsed.issue) issues.push(parsed.issue)
      continue
    }
    const record = parsed.record
    const docs: Partial<Record<CoreKind, ArtifactDoc>> = {}
    const texts: Partial<Record<CoreKind, string>> = {}
    for (const kind of CORE_KINDS) {
      const path = artifactPath(config, kind, { slug })
      const file = disk.artifacts[path]
      docs[kind] = parseArtifact(kind, path, file ? file.text : null, file ? file.mtimeMs : 0, config)
      if (file) texts[kind] = file.text
    }
    const proofVerdict = texts.proof !== undefined ? parseVerdict(texts.proof) : null
    const review = texts.review !== undefined ? parseReview(texts.review, config) : null

    const quarantined: Quarantine[] = []
    const seen: Partial<Record<ArtifactKind, ArtifactStatus>> = {}
    for (const g of GATED) {
      const doc = docs[g.kind]
      if (!doc) continue
      seen[g.kind] = doc.status
      // A gate with a record was written by the mod itself: never quarantined.
      if (!doc.exists || doc.status !== g.status || record.approvals[g.gate] !== undefined) continue
      const key = quarantineKey(slug, g.gate)
      const carried = prev?.runtime.quarantine[key]
      const old = carried ?? (() => {
        const e = quarantineInLedger(ledger, slug, g.gate, doc.mtimeMs)
        return e ? { slug, gate: g.gate, path: doc.path, at: e.ts } : undefined
      })()
      if (old) {
        quarantined.push(old)
        continue
      }
      const flipped = prev !== undefined && prev.runtime.seen[slug]?.[g.kind] !== g.status
      const suspicious = flipped && (facts.activityAt > prev.runtime.lastRefreshAt || facts.turnActive || facts.backgroundWork)
      if (suspicious) {
        quarantined.push({ slug, gate: g.gate, path: doc.path, at: now })
        findings.push({ slug, gate: g.gate, path: doc.path, verdict: 'quarantine' })
      } else {
        findings.push({ slug, gate: g.gate, path: doc.path, verdict: 'implicit' })
      }
    }
    for (const q of quarantined) runtime.quarantine[quarantineKey(q.slug, q.gate)] = q
    runtime.seen[slug] = seen
    const snapshot = snapshotFor(config, { record, docs, proofVerdict, review }, quarantined, granted, now)
    runtime.stageOf[slug] = snapshot.current
    for (const stage of snapshot.stages) for (const gate of stage.gates) runtime.passed[`${slug}:${gate.id}`] = gate.approved
    runs.push({ record, docs, proofVerdict, review, snapshot })
  }
  runs.sort((a, b) => a.record.createdAt - b.record.createdAt || a.record.slug.localeCompare(b.record.slug))

  const wanted = disk.activeText?.trim() ?? ''
  const active = runs.some(r => r.record.slug === wanted) ? wanted : (runs[runs.length - 1]?.record.slug ?? null)

  const spec = disk.bandsSpecText ? parseBandsYaml(disk.bandsSpecText) : null
  const samples: Model['bands']['samples'] = {}
  const readings: Model['bands']['readings'] = {}
  const lastCheckedAt = { ...(prev?.bands.lastCheckedAt ?? {}) }
  const breached = { ...(prev?.bands.breached ?? {}) }
  for (const src of config.bands.sources) {
    const list = parseSamples(disk.bandSamples[src.metric] ?? '', 500)
    samples[src.metric] = list
    const newest = list[list.length - 1]
    if (newest) lastCheckedAt[src.metric] = Math.max(lastCheckedAt[src.metric] ?? 0, newest.at)
    const reading = evaluateSeries(src.metric, list, { window: config.bands.window, higherIsWorse: src.higherIsWorse, rules: spec?.rules })
    if (reading) readings[src.metric] = reading
    if (!reading || TIER_RANK[reading.tier] < 2) delete breached[src.metric]
  }

  const model: Model = {
    ready: true,
    now,
    cwd: disk.cwd,
    home: disk.home,
    project: disk.project,
    ...cfg,
    configIssues: issues,
    runs,
    active,
    ledger,
    exists: disk.exists,
    promptOverrides: disk.promptOverrides,
    bands: {
      samples,
      readings,
      lastCheckedAt,
      breached,
      proposals: { ...(prev?.bands.proposals ?? {}) },
      lastSampleLedgerAt: { ...(prev?.bands.lastSampleLedgerAt ?? {}) },
      spec,
    },
    runtime: { ...runtime, lastRefreshAt: now },
  }
  return { model, findings }
}

export function ingest(disk: DiskState, now: number, prev?: Model, facts?: Facts): Model {
  return ingestWith(disk, now, prev, facts).model
}
