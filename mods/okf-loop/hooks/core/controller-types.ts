// The controller's vocabulary: what register.tsx reads from disk (DiskState), the
// derived world the pure core decides on (Model), what happens (Action) and what the
// wiring must then do (Effect). All plain data, so every decision is testable.

import type {
  ArtifactDoc,
  ArtifactKind,
  ArtifactStatus,
  BandReading,
  BandSpec,
  GateId,
  GuardInput,
  GuardVerdict,
  Knowledge,
  LedgerEntry,
  LoopConfig,
  PromptKey,
  RunRecord,
  RunSnapshot,
  Tier,
} from '../../types'
import type { Parsed } from './commands'
import type { DeriveInput } from './stages'

// ---------------------------------------------------------------------------
// Disk
// ---------------------------------------------------------------------------

export type DiskFile = { text: string; mtimeMs: number }

/** Everything register.tsx reads. A missing or unreadable file is simply absent (null / not in the map). */
export type DiskState = {
  cwd: string
  home: string
  project: string
  configText: string | null
  /** Only the plugin options the person actually set (see userOverrides). */
  userOptions: Record<string, unknown>
  /** Files of the project's own knowledge root that exist, keyed by repo-relative path. */
  knowledgeFiles: Record<string, string>
  activeText: string | null
  ledgerText: string | null
  /** `.okf/runs/<slug>.json` texts by slug. */
  runFiles: Record<string, string>
  /** Artifact files of every run, keyed by repo-relative path. */
  artifacts: Record<string, DiskFile>
  /** `.okf/bands/<metric>.jsonl` texts by metric. */
  bandSamples: Record<string, string>
  bandsSpecText: string | null
  /** Existence checks (setup items, play evidence). */
  exists: Record<string, boolean>
  /** `.okf/prompts/<key>.md` texts that exist. */
  promptOverrides: Partial<Record<PromptKey, string>>
  /** A human release grant, from the `grantUntil` state atom (host memory). */
  grantUntil: number | null
  /** RELEASE_APPROVAL is set in the environment. */
  envToken: boolean
}

/** What register.tsx observed about the agent since the last refresh (provenance of human approvals). */
export type Facts = { activityAt: number; turnActive: boolean; backgroundWork: boolean }
export const NO_FACTS: Facts = { activityAt: 0, turnActive: false, backgroundWork: false }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

export type RunState = {
  record: RunRecord
  /** The artifacts as the files say (a quarantined approval still reads approved here). */
  docs: Partial<Record<ArtifactKind, ArtifactDoc>>
  proofVerdict: DeriveInput['proofVerdict']
  review: DeriveInput['review']
  snapshot: RunSnapshot
}

export type Quarantine = { slug: string; gate: GateId; path: string; at: number }

export type BandRuntime = {
  samples: Record<string, { at: number; value: number }[]>
  readings: Record<string, BandReading>
  lastCheckedAt: Record<string, number>
  /** The tier a metric is currently breaching at (>= 2sigma), cleared when it drops. */
  breached: Record<string, Tier>
  /** 3sigma proposals awaiting a human. */
  proposals: Record<string, { at: number; reading: BandReading }>
  lastSampleLedgerAt: Record<string, number>
  spec: BandSpec | null
}

export type Runtime = {
  grantUntil: number | null
  envToken: boolean
  /** A prompt the mod queued whose turn has not completed yet; `sig` is the run's state when it was queued. */
  pending: { slug: string; sig: string; key: PromptKey; at: number } | null
  /** slug -> the halt code last announced (a halt is ledgered once per distinct code). */
  halted: Record<string, string>
  toastAt: Record<string, number>
  notice: string
  noticeAt: number
  /** slug -> artifact statuses as of the last refresh (to see a status flip). */
  seen: Record<string, Partial<Record<ArtifactKind, ArtifactStatus>>>
  lastRefreshAt: number
  /** Approvals the file claims but the mod cannot vouch for, keyed `slug:gate`. */
  quarantine: Record<string, Quarantine>
  /** slug -> proof mtime whose verdict was already counted toward the verify streak. */
  countedProof: Record<string, number>
  /** `slug:gate` -> a machine gate passed at the last refresh (a pass is ledgered when it flips on). */
  passed: Record<string, boolean>
  /** slug -> the stage the run was in at the last refresh. */
  stageOf: Record<string, string>
}

export type Model = {
  ready: boolean
  now: number
  cwd: string
  home: string
  project: string
  /** The config file as parsed (no plugin options): what saving writes. */
  fileConfig: LoopConfig
  /** The effective config: file + the plugin options the person set. */
  config: LoopConfig
  overridden: { mode: boolean; maxAutoTurns: boolean; openPaneOnStart: boolean }
  /** The parsed JSON of the file, to keep unknown keys when saving. */
  configBase: unknown
  configIssues: string[]
  knowledge: Knowledge
  runs: RunState[]
  active: string | null
  ledger: LedgerEntry[]
  exists: Record<string, boolean>
  promptOverrides: Partial<Record<PromptKey, string>>
  bands: BandRuntime
  runtime: Runtime
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Via = 'command' | 'press'

export type Action =
  | { type: 'disk'; disk: DiskState; now: number; startup?: boolean; facts?: Facts }
  | { type: 'command'; cmd: Parsed; now: number; origin: string; via: Via; author: string }
  | { type: 'turn.complete'; now: number; reason: 'answer' | 'aborted' | 'refusal' | 'error'; answer: string }
  | { type: 'tool.done'; now: number; input: GuardInput; isError: boolean }
  | { type: 'guard.blocked'; now: number; tool: string; verdict: Extract<GuardVerdict, { allow: false }> }
  | { type: 'band.measured'; now: number; metric: string; stdout: string; ok: boolean; error?: string }
  | { type: 'band.diagnosis'; now: number; metric: string; reading: BandReading; diagnosis: string; author: string }

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export type EditOp =
  | { kind: 'status'; artifact: ArtifactKind; status: ArtifactStatus }
  | { kind: 'twice'; lesson: string; date: string; seed: string }

export type Effect =
  | { t: 'write'; path: string; text: string; overwrite: boolean; exec?: boolean }
  /** Read the file fresh, apply the pure edit, write it back. */
  | { t: 'edit'; path: string; edit: EditOp }
  | { t: 'append'; path: string; line: string }
  | { t: 'ledger'; entry: LedgerEntry }
  | { t: 'saveRun'; record: RunRecord }
  | { t: 'saveConfig'; text: string }
  | { t: 'setActive'; slug: string }
  | { t: 'prompt'; key: PromptKey; text: string; slug: string; by: 'autopilot' | 'human' }
  | { t: 'toast'; text: string }
  | { t: 'pane'; open: boolean }
  /** Read the disk again; `knowledge` also re-reads the project's own knowledge files (otherwise they are cached). */
  | { t: 'refresh'; knowledge?: boolean }
  | { t: 'grant'; until: number | null }
  | { t: 'spawn'; metric: string; reading: BandReading; prompt: string; description: string }
  | { t: 'process'; argv: string[]; purpose: 'runbook'; label: string }
  | { t: 'bands'; metrics: string[] }

export type Reduced = { model: Model; effects: Effect[]; reply?: string }
