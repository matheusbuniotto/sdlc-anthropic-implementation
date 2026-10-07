// okf-loop: the shared type contract.
//
// One self-contained declaration file (the engine requires that of a plugin's
// `types`): every domain type the mod's pure core (hooks/core), its views
// (hooks/ui) and its wiring (hooks/register.tsx) agree on, plus the
// `$.state` contract at the bottom. Runtime constants live in
// hooks/core/constants.ts, never here. Modules import with
// `import type { ... } from '../../types'` (core, ui) or '../types' (register).
//
// The vocabulary is the openknowledge/INDEX.md vocabulary: six stages, a chain
// of committed artifacts, 14 plays, hook guards, statistical control bands.

// ---------------------------------------------------------------------------
// Stages, artifacts, gates
// ---------------------------------------------------------------------------

export type StageId = 'plan' | 'design' | 'build' | 'test' | 'deploy' | 'maintain'

/** Who did something. `mod` is the deterministic engine itself (guards, watcher). */
export type Actor = 'human' | 'agent' | 'mod'

/** manual: guards + ledger only. guided: the mod proposes, a human triggers.
 *  semi: the agent runs every non-human step on its own and stops at human gates. */
export type Mode = 'manual' | 'guided' | 'semi'

export type ArtifactKind = 'intent' | 'spec' | 'plan' | 'proof' | 'review' | 'incident' | 'lesson' | 'eval'

/** The union of every artifact template's Status vocabulary, plus two synthetic values. */
export type ArtifactStatus =
  | 'missing'
  | 'draft'
  | 'under-review'
  | 'approved'
  | 'rejected'
  | 'accepted'
  | 'in-progress'
  | 'complete'
  | 'unknown'

export type LintIssue = { severity: 'error' | 'warn'; code: string; message: string }

/** One committed artifact as read from disk and parsed (pure, from text). */
export type ArtifactDoc = {
  kind: ArtifactKind
  path: string
  exists: boolean
  status: ArtifactStatus
  title: string
  mtimeMs: number
  /** `## ` headings found, in order, without the numbering prefix ("1. Executive Summary" -> "Executive Summary"). */
  sections: string[]
  /** Template sections the artifact still lacks (e.g. plan without "Proof of Correctness"). */
  missingSections: string[]
  /** `- [ ]` / `- [x]` counts: open questions (intent) or sign-offs (spec). */
  checklist: { done: number; total: number }
  /** Number of entries under "Flagged Areas of Concern" (spec); 0 elsewhere. */
  flaggedConcerns: number
  /** Plan only: the repo-relative paths listed under "Files That Change" (annotations like "(new)" removed). */
  planFiles: string[]
  issues: LintIssue[]
}

export type GateId =
  | 'intent.approve'
  | 'spec.approve'
  | 'plan.accept'
  | 'verify.pass'
  | 'review.pass'
  | 'release.approve'

/** human: needs a named person. machine: a deterministic check the mod evaluates itself. */
export type GateKind = 'human' | 'machine'

export type Requirement = {
  id: string
  label: string
  ok: boolean
  /** Who owes it: a machine check, or a human decision. */
  by: 'machine' | 'human'
  detail?: string
}

export type GateReport = {
  id: GateId
  stage: StageId
  label: string
  kind: GateKind
  requirements: Requirement[]
  /** Every machine requirement holds: the gate can be put to a human (or, for a machine gate, it has passed). */
  ready: boolean
  /** The gate has been passed. */
  approved: boolean
  /** Machine requirements that fail, as short sentences. */
  blockedBy: string[]
}

// ---------------------------------------------------------------------------
// Runs: one change flowing through the loop
// ---------------------------------------------------------------------------

export type RunSource = 'human' | 'ticket' | 'anomaly'

/** Persisted at .okf/runs/<slug>.json. Facts the artifacts cannot hold. */
export type RunRecord = {
  slug: string
  title: string
  source: RunSource
  createdAt: number
  /** Audit of who passed which gate; the artifact's Status line is the other half. */
  approvals: Partial<Record<GateId, { by: string; at: number; note?: string }>>
  /** Bug-fix protocol (Play 08): when active, test files are locked. */
  fix: { active: boolean; since?: number; reproCommitted: boolean }
  /** Verification feedback loop (Play 08): last time source changed vs. last proof run. */
  proof: { lastEditAt: number; lastRunAt: number; lastRunPassed: boolean | null; lastCommand: string }
  /** Unique repo-relative source files the agent edited during this run (capped at 200); plan drift reads it. */
  edits: string[]
  /** Autopilot turns consumed since the last human gate was passed. */
  autoTurns: number
  /** Consecutive guard blocks / failed verifications since the last good step (autopilot halts on streaks). */
  blockStreak: number
  verifyFailStreak: number
  paused: boolean
}

export type StageState = 'pending' | 'active' | 'awaiting-human' | 'done' | 'blocked' | 'monitoring'

export type StageSnapshot = {
  id: StageId
  number: 1 | 2 | 3 | 4 | 5 | 6
  name: string
  tagline: string
  state: StageState
  artifacts: ArtifactDoc[]
  gates: GateReport[]
  /** One sentence for the node card: what holds the stage now. */
  summary: string
  /** Play numbers that belong to this stage. */
  plays: number[]
}

export type NextActionKind =
  | 'interview'
  | 'draft-spec'
  | 'draft-plan'
  | 'implement'
  | 'verify'
  | 'review'
  | 'await-human'
  | 'release'
  | 'monitor'
  | 'idle'

export type PromptKey =
  | 'interview'
  | 'draft-spec'
  | 'draft-plan'
  | 'implement'
  | 'verify'
  | 'review'
  | 'release'
  | 'fix'
  | 'incident'
  | 'lesson'

export type NextAction = {
  kind: NextActionKind
  stage: StageId
  label: string
  reason: string
  /** Only a human can do it (a gate, or an interview). */
  byHuman: boolean
  gate?: GateId
  /** Prompt the engine would queue to make the agent do it. Absent for human-only steps. */
  promptKey?: PromptKey
  /** Autopilot may run it unattended in `semi` mode, per config. */
  auto: boolean
}

export type RunSnapshot = {
  record: RunRecord
  stages: StageSnapshot[]
  current: StageId
  next: NextAction
  health: 'ok' | 'attention' | 'blocked'
  /** 0..1 over the five lifecycle stages' gates passed. */
  progress: number
}

export type RunSummary = {
  slug: string
  title: string
  current: StageId
  health: RunSnapshot['health']
  progress: number
  source: RunSource
  createdAt: number
}

// ---------------------------------------------------------------------------
// Plays and the knowledge base (openknowledge/INDEX.md)
// ---------------------------------------------------------------------------

export type TemplateName =
  | 'intent'
  | 'spec'
  | 'plan'
  | 'claude-context'
  | 'review-policy'
  | 'verifier-agent'
  | 'bands'
  | 'ci-evals-workflow'
  | 'managed-settings'
  | 'production-gate'

export type PlayDef = {
  /** 1..14 */
  n: number
  /** Front-matter id, e.g. "okf-play-07-guardrail-hooks". */
  id: string
  title: string
  stage: StageId
  entryPoint: boolean
  /** Play numbers this play depends on (from front-matter `prerequisites`). */
  prerequisites: number[]
  outputs: string[]
  summary: string
  /** Path relative to the knowledge root, e.g. "plays/play-07-build-guardrail-hooks.md". */
  path: string
  tags: string[]
}

export type StageDoc = { id: StageId; number: number; title: string; summary: string; path: string }

export type Knowledge = {
  /** bundled: the snapshot generated from this repo's openknowledge/. repo: parsed live from the project's knowledge root. */
  source: 'bundled' | 'repo'
  root: string
  title: string
  version: string
  summary: string
  plays: PlayDef[]
  stages: StageDoc[]
  /** Template bodies with the wiki front-matter stripped. */
  templates: Partial<Record<TemplateName, string>>
  /** Problems found while parsing (missing front-matter, unknown stage, bad prerequisite). */
  issues: string[]
}

export type PlayView = PlayDef & {
  enabled: boolean
  /** Prerequisites that are not enabled. */
  unmet: number[]
  /** Enabled plays that need this one (blocks disabling it). */
  dependents: number[]
  /** What in the mod makes the play real: guards, commands, scaffolds. */
  enforcedBy: string[]
  /** Does the repo carry the play's output yet. */
  evidence: { label: string; ok: boolean }[]
}

// ---------------------------------------------------------------------------
// Guards: Plays 07, 08, 11 and the enterprise-security governance doc
// ---------------------------------------------------------------------------

export type GuardId =
  | 'protect-paths'
  | 'secret-leak'
  | 'test-lock'
  | 'plan-first'
  | 'production-gate'
  | 'destructive-sql'
  | 'credential-shield'
  | 'separation-of-duties'
  | 'gate-integrity'

export type GuardDef = {
  id: GuardId
  label: string
  /** The play that asks for it. */
  play: number
  stage: StageId
  summary: string
}

export type GuardInput = {
  tool: string
  filePath?: string
  /** The text being written (Write content, Edit new_string). */
  content?: string
  command?: string
}

export type GuardRunContext = {
  /** The run the session is working on; null when none (guards that need a run then allow). */
  slug: string
  current: StageId
  planAccepted: boolean
  fixActive: boolean
}

export type GuardContext = {
  guards: LoopConfig['guards']
  verify: LoopConfig['verify']
  paths: LoopConfig['paths']
  enabledPlays: number[]
  cwd: string
  home: string
  run: GuardRunContext | null
  release: { envToken: boolean; grantActive: boolean }
}

export type GuardVerdict =
  | { allow: true }
  | { allow: false; guard: GuardId; play: number; message: string; match?: string }

export type GuardStat = { hits: number; lastAt: number | null; lastMessage: string }

export type GuardView = GuardDef & {
  enabled: boolean
  /** The owning play is adopted (a guard of a disabled play is dormant). */
  active: boolean
  stat: GuardStat
}

// ---------------------------------------------------------------------------
// Ledger: the audit trail, .okf/ledger.jsonl, one JSON object per line
// ---------------------------------------------------------------------------

export type LedgerKind =
  | 'run.created'
  | 'stage.entered'
  | 'artifact.written'
  | 'gate.opened'
  | 'gate.approved'
  | 'gate.rejected'
  | 'guard.blocked'
  | 'proof.pass'
  | 'proof.fail'
  | 'autopilot.queued'
  | 'autopilot.halted'
  | 'release.granted'
  | 'release.revoked'
  | 'band.sample'
  | 'band.breach'
  | 'incident.intent'
  | 'play.toggled'
  | 'config.changed'
  | 'scaffold.created'
  | 'lesson.recorded'
  | 'agent.verdict'

export type LedgerEntry = {
  /** Milliseconds since the epoch. */
  ts: number
  kind: LedgerKind
  run?: string
  stage?: StageId
  actor: Actor
  summary: string
  data?: Record<string, string | number | boolean | null>
}

export type LedgerFilter = { kinds: LedgerKind[] | null; run: string | null; query: string }

export type MetricView = {
  id: string
  stage: StageId | 'all'
  kind: 'leading' | 'lagging'
  label: string
  /** Formatted for display ("1h 12m", "3 blocked", "n/a"). */
  value: string
  raw: number | null
  /** The playbook's target in words, when it states one ("< 2 hours"). */
  target?: string
  status: 'good' | 'warn' | 'bad' | 'n/a'
  hint: string
}

// ---------------------------------------------------------------------------
// Stage 6: statistical control bands (Play 13)
// ---------------------------------------------------------------------------

export type Tier = 'in-control' | '1sigma' | '2sigma' | '3sigma'

export type BandSource = {
  metric: string
  description: string
  /** argv, no shell (the engine's `$.process.run`). stdout is parsed per `parse`. */
  argv: string[]
  /** 'number': stdout is a number. 'json:a.b.c': a number at that path of the JSON on stdout. */
  parse: string
  intervalMinutes: number
  /** A rising value is worse (failure rate). false: a falling value is worse (throughput). */
  higherIsWorse: boolean
}

export type BandSpec = {
  metric: string
  description: string
  /** e.g. "rolling_30d" */
  baseline: string
  interval: string
  rules: 'western_electric' | 'simple'
  tiers: {
    '1sigma': { action: string; notify: boolean }
    '2sigma': { action: string; tools: string[]; outputFormat: string; destination: string }
    '3sigma': { action: string; routes: string[]; escalation: { channel: string; priority: string } }
  }
}

export type BandReading = {
  metric: string
  at: number
  value: number
  mean: number
  sd: number
  /** Signed z-score oriented so a positive value is "worse" per `higherIsWorse`. */
  z: number
  tier: Tier
  /** Western Electric rule ids that fired, e.g. "WE1". */
  rules: string[]
  n: number
}

export type BandView = {
  metric: string
  description: string
  /** Newest last; capped (40). */
  values: number[]
  last: BandReading | null
  tier: Tier
  spec: BandSpec | null
  source: BandSource | null
}

// ---------------------------------------------------------------------------
// Config: .okf/config.json (everything customizable lives here)
// ---------------------------------------------------------------------------

export type PathKey =
  | 'intent'
  | 'spec'
  | 'plan'
  | 'proof'
  | 'review'
  | 'incident'
  | 'lesson'
  | 'eval'
  | 'claudeMd'
  | 'reviewPolicy'
  | 'bands'
  | 'ciWorkflow'
  | 'managedSettings'
  | 'productionGate'

export type LoopConfig = {
  $schema?: string
  version: 1
  knowledge: { root: string }
  autonomy: {
    mode: Mode
    /** Autopilot turns allowed between two human gates. */
    maxAutoTurns: number
    /** Halt the autopilot after this many guard blocks in a row. */
    haltOnBlocks: number
    /** Halt after this many failed verifications in a row. */
    haltOnVerifyFails: number
    /** Which gates need a human. Removing one is allowed but the production gate always keeps its human. */
    humanGates: GateId[]
    /** Next-action kinds the autopilot may run unattended in `semi`. */
    autoKinds: NextActionKind[]
  }
  /** Adopted play numbers. Prerequisites must be adopted too. */
  plays: { enabled: number[] }
  /** Artifact locations. `{slug}` and `{date}` (YYYY-MM-DD) expand. */
  paths: Record<PathKey, string>
  guards: {
    disabled: GuardId[]
    protectedPaths: string[]
    testGlobs: string[]
    /** Always editable even before a plan is accepted (artifacts, docs, the mod's own files). */
    planFirstExempt: string[]
    secretPatterns: { name: string; pattern: string }[]
    /** Regexes tested against Bash commands: a match is a production deploy. */
    productionPatterns: string[]
    destructiveSql: boolean
    protectedBranches: string[]
    credentialPaths: string[]
    /** Block network fetchers (curl, wget, WebFetch), as the managed-settings template does. Off by default. */
    blockNetwork: boolean
    /** Minutes a human release grant stays valid. */
    grantMinutes: number
  }
  verify: { commands: string[] }
  review: { nitCap: number; passes: { tag: string; title: string }[]; ignorePaths: string[] }
  bands: {
    enabled: boolean
    sources: BandSource[]
    /** Rolling window length in samples. */
    window: number
    /** propose: a 3-sigma breach is a proposal a human approves. runbook: run `runbook` once approved by a human press. */
    tier3: 'propose' | 'runbook'
    runbook: string[]
  }
  ui: { openPaneOnStart: boolean; showBand: boolean }
  /** Globs of policy skills / docs the design stage must load (Play 02, Play 06). */
  policySkills: string[]
}

// ---------------------------------------------------------------------------
// The view model: everything a drawing reads (one atom, replaced on refresh)
// ---------------------------------------------------------------------------

export type SetupItem = {
  id: string
  label: string
  path: string
  play: number
  exists: boolean
  /** Template the scaffold is cut from; absent when it is generated otherwise. */
  template?: TemplateName
  hint: string
}

export type AutopilotView = {
  mode: Mode
  paused: boolean
  budgetLeft: number
  budgetMax: number
  /** Why it is running or why it stopped, in a sentence. */
  reason: string
  /** Machine-readable halt code, or 'running' / 'idle'. */
  state: string
}

export type ViewModel = {
  ready: boolean
  now: number
  cwd: string
  config: LoopConfig
  configIssues: string[]
  knowledge: { source: Knowledge['source']; root: string; title: string; issues: string[] }
  plays: PlayView[]
  runs: RunSummary[]
  active: RunSnapshot | null
  guards: GuardView[]
  release: { envToken: boolean; grantUntil: number | null }
  autopilot: AutopilotView
  ledger: LedgerEntry[]
  metrics: MetricView[]
  bands: BandView[]
  setup: SetupItem[]
  /** Transient one-line message of the last command or press ("Spec approved."). */
  notice: string
}

// ---------------------------------------------------------------------------
// UI-only state and the callbacks the pure views are handed
// ---------------------------------------------------------------------------

export type UiTab = 'loop' | 'plays' | 'guards' | 'ledger' | 'setup'

export type UiState = {
  tab: UiTab
  selectedPlay: number | null
  ledgerFilter: LedgerFilter
  /** Text typed in the "new run" field. */
  draftIdea: string
  /** Show the band above the prompt expanded. */
  bandExpanded: boolean
  /** The person hid the band for this session. */
  bandHidden: boolean
}

/** What a pure view may call. The wiring (register.tsx) builds these over `$`; a view never sees `$`. */
export type UiActions = {
  setTab(tab: UiTab): void
  selectPlay(n: number | null): void
  setLedgerFilter(filter: LedgerFilter): void
  setDraftIdea(text: string): void
  newRun(idea: string): void
  selectRun(slug: string): void
  approve(gate: GateId): void
  reject(gate: GateId): void
  runNext(): void
  setMode(mode: Mode): void
  togglePause(): void
  togglePlay(n: number): void
  toggleGuard(id: GuardId): void
  grantRelease(minutes: number): void
  revokeRelease(): void
  scaffold(itemId: string): void
  scaffoldAll(): void
  exportAudit(): void
  checkBands(): void
  reloadKnowledge(): void
  toggleBand(): void
  hideBand(): void
  openPane(): void
  closePane(): void
}

declare module 'claude-code' {
  interface PluginState {
    'okf-loop': {
      view: ViewModel | null
      ui: UiState
      /** Epoch ms until which a human release grant is valid. Held in host memory only, so no tool can forge or extend it. */
      grantUntil: number | null
    }
  }
}
