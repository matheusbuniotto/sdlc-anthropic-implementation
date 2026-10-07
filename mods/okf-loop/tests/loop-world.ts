// A tiny in-memory world for the controller tests: a virtual disk, the same effect semantics
// register.tsx has (write-if-missing, status edits, ledger appends, ...) and the same
// perform loop (reduce, run effects, refresh when asked). Lets a test drive the whole Loop
// through derived snapshots without any fs, process or engine.

import type { LedgerEntry, RunRecord } from '../types'
import { appendTwiceRule, setArtifactStatus } from '../hooks/core/artifacts'
import { parseCommand, type Parsed } from '../hooks/core/commands'
import type { GuardInput, GuardVerdict } from '../types'
import {
  NO_FACTS,
  activeRun,
  artifactReadPaths,
  bandFile,
  blankModel,
  classifyTool,
  existencePaths,
  judge,
  knowledgePaths,
  parseRunRecord,
  reduce,
  resolveConfig,
  userOverrides,
  type Action,
  type DiskFile,
  type DiskState,
  type Effect,
  type Facts,
  type Model,
} from '../hooks/core/controller'
import { appendEntry, parseLedger } from '../hooks/core/ledger'
import { STATE_FILES } from '../hooks/core/constants'
import { PROMPT_KEYS } from '../hooks/core/prompts'
import { newRunRecord } from '../hooks/core/stages'

export const NOW = Date.UTC(2026, 9, 6, 15, 30, 0)
export const MIN = 60_000

// ---------------------------------------------------------------------------
// Artifact texts that parse as complete (or as drafts) for the stage derivation
// ---------------------------------------------------------------------------

export function intentText(status = 'draft', title = 'Add rate limiting'): string {
  return `# Intent: ${title}

**Author:** Ana
**Status:** ${status}
**Date:** 2026-10-06
**Source Ticket / Anomaly Ref:** n/a

## Problem
Checkout calls are not rate limited, so one bot can exhaust the payment provider quota.

## Proposed Outcome
Checkout accepts at most 30 requests a minute per account and answers 429 beyond that.

## Affected Users and Systems
- **User Personas:** shoppers
- **Target Systems / Repositories:** checkout-api

## Constraints
- **Security & Auth:** no new credentials

## Open Questions
- [x] Which limit? 30 per minute.
`
}

export function specText(status = 'draft', slug = 'x'): string {
  return `# Specification: Add rate limiting

**Intent Reference:** intent/${slug}.md
**Lead Architect / PO:** Ana
**Status:** ${status}

## 1. Executive Summary & Scope
Rate limit checkout.

## 2. Requirements & Functional Contracts
- REQ-1: answer 429 after 30 requests a minute.

## 3. Technical Architecture & Interfaces
A token bucket in the gateway.

## 4. Policy Compliance Matrix
| Policy | Status |
| --- | --- |
| Security | ok |

## 5. Flagged Areas of Concern
- None

## 6. Sign-off & Progression
- [ ] Product owner signs off
- [ ] Architect signs off
`
}

export function planText(status = 'draft', files: string[] = ['src/checkout.ts', 'tests/checkout.test.ts'], slug = 'x'): string {
  return `# Plan: Add rate limiting (from specs/${slug}.spec.md)

**Author / Engineer:** Ana
**Branch:** \`feature/${slug}\`
**Status:** ${status}

## 1. Files That Change
${files.map(f => `- \`${f}\``).join('\n')}

## 2. Order of Work
1. Add the limiter.

## 3. Risks & Mitigations
- Burst traffic: warm the bucket.

## 4. Proof of Correctness
- \`make test\`
`
}

export const proofText = (verdict: 'PASS' | 'FAIL'): string => `# Proof\n\n$ make test\nok\n\n### Verification Verdict: ${verdict}\n`

export function reviewText(clean = true): string {
  return `# Review: Add rate limiting
### Pass 1 — Logic & Regressions [Bugs]
${clean ? '' : '- [ ] **Important** [Bugs] src/checkout.ts:10 — burst bypasses the limiter\n'}### Pass 2 — Security & Privacy [Security]
### Pass 3 — Specification & Architecture Alignment [Compliance]
### Review Verdict: ${clean ? 'CLEAN' : 'BLOCKED'}
`
}

// ---------------------------------------------------------------------------
// The world
// ---------------------------------------------------------------------------

type Req = Action | { type: 'refresh'; startup?: boolean }
type EffectOf<T extends Effect['t']> = Extract<Effect, { t: T }>

export class World {
  files = new Map<string, DiskFile>()
  model: Model = blankModel()
  now: number
  prompts: EffectOf<'prompt'>[] = []
  toasts: string[] = []
  spawns: EffectOf<'spawn'>[] = []
  processes: EffectOf<'process'>[] = []
  bandChecks: string[][] = []
  execs: string[] = []
  panes: boolean[] = []
  grantUntil: number | null = null
  envToken = false
  options: Record<string, unknown> = {}
  facts: Facts = { ...NO_FACTS }
  author = 'Ana'
  cwd = '/work/proj'

  constructor(o: { now?: number; config?: object | string; options?: Record<string, unknown> } = {}) {
    this.now = o.now ?? NOW
    this.options = userOverrides(o.options ?? {})
    if (o.config !== undefined) this.put(STATE_FILES.config, typeof o.config === 'string' ? o.config : JSON.stringify(o.config))
  }

  /** A person's editor, or a fixture: write a file now. */
  put(path: string, text: string): void {
    this.files.set(path, { text, mtimeMs: this.now })
  }

  text(path: string): string | undefined {
    return this.files.get(path)?.text
  }

  advance(ms: number): void {
    this.now += ms
  }

  disk(): DiskState {
    const configText = this.text(STATE_FILES.config) ?? null
    const knowledgeFiles: Record<string, string> = {}
    for (const p of knowledgePaths(configText)) {
      const t = this.text(p)
      if (t !== undefined) knowledgeFiles[p] = t
    }
    const config = resolveConfig(configText, this.options, knowledgeFiles).config
    const runFiles: Record<string, string> = {}
    for (const [path, f] of this.files) {
      const m = /^\.okf\/runs\/(.+)\.json$/.exec(path)
      if (m?.[1]) runFiles[m[1]] = f.text
    }
    const artifacts: Record<string, DiskFile> = {}
    for (const p of artifactReadPaths(config, Object.keys(runFiles))) {
      const f = this.files.get(p)
      if (f) artifacts[p] = f
    }
    const bandSamples: Record<string, string> = {}
    for (const s of config.bands.sources) {
      const t = this.text(bandFile(s.metric))
      if (t !== undefined) bandSamples[s.metric] = t
    }
    const exists: Record<string, boolean> = {}
    for (const p of existencePaths(config)) exists[p] = this.files.has(p)
    const promptOverrides: DiskState['promptOverrides'] = {}
    for (const k of PROMPT_KEYS) {
      const t = this.text(`${STATE_FILES.promptsDir}/${k}.md`)
      if (t !== undefined) promptOverrides[k] = t
    }
    return {
      cwd: this.cwd,
      home: '/home/ana',
      project: 'proj',
      configText,
      userOptions: this.options,
      knowledgeFiles,
      activeText: this.text(STATE_FILES.active) ?? null,
      ledgerText: this.text(STATE_FILES.ledger) ?? null,
      runFiles,
      artifacts,
      bandSamples,
      bandsSpecText: config.bands.enabled ? (this.text(config.paths.bands) ?? null) : null,
      exists,
      promptOverrides,
      grantUntil: this.grantUntil,
      envToken: this.envToken,
    }
  }

  private apply(effects: Effect[]): Req[] {
    const follow: Req[] = []
    const entries: LedgerEntry[] = []
    for (const e of effects) {
      switch (e.t) {
        case 'write':
          if (e.overwrite || !this.files.has(e.path)) {
            this.put(e.path, e.text)
            if (e.exec) this.execs.push(e.path)
          }
          break
        case 'edit': {
          const cur = this.text(e.path)
          if (e.edit.kind === 'status') {
            if (cur !== undefined) this.put(e.path, setArtifactStatus(cur, e.edit.artifact, e.edit.status))
          } else this.put(e.path, appendTwiceRule(cur ?? e.edit.seed, e.edit.lesson, e.edit.date))
          break
        }
        case 'append': {
          const cur = this.text(e.path) ?? ''
          this.put(e.path, `${cur}${cur === '' || cur.endsWith('\n') ? '' : '\n'}${e.line}\n`)
          break
        }
        case 'ledger':
          entries.push(e.entry)
          break
        case 'saveRun':
          this.put(`${STATE_FILES.runsDir}/${e.record.slug}.json`, JSON.stringify(e.record, null, 2))
          break
        case 'saveConfig':
          this.put(STATE_FILES.config, e.text)
          break
        case 'setActive':
          this.put(STATE_FILES.active, `${e.slug}\n`)
          break
        case 'prompt':
          this.prompts.push(e)
          break
        case 'toast':
          this.toasts.push(e.text)
          break
        case 'pane':
          this.panes.push(e.open)
          break
        case 'refresh':
          follow.push({ type: 'refresh' })
          break
        case 'grant':
          this.grantUntil = e.until
          break
        case 'spawn':
          this.spawns.push(e)
          break
        case 'process':
          this.processes.push(e)
          break
        case 'bands':
          this.bandChecks.push(e.metrics)
          break
      }
    }
    if (entries.length > 0) {
      let text = this.text(STATE_FILES.ledger) ?? ''
      for (const entry of entries) text = appendEntry(text, entry)
      this.put(STATE_FILES.ledger, text)
    }
    return follow
  }

  /** The perform loop of register.tsx: reduce, run effects, refresh when asked. Returns the reply of the first action. */
  send(first: Req): string | undefined {
    const todo: Req[] = this.model.ready || (first.type === 'refresh' && first.startup) ? [first] : [{ type: 'refresh', startup: true }, first]
    let reply: string | undefined
    let refreshes = 0
    for (let i = 0; todo.length > 0 && i < 16; i++) {
      const req = todo.shift() as Req
      const action: Action = req.type === 'refresh' ? { type: 'disk', disk: this.disk(), now: this.now, ...(req.startup ? { startup: true } : {}), facts: { ...this.facts } } : req
      const out = reduce(this.model, action)
      this.model = out.model
      if (req === first) reply = out.reply
      for (const f of this.apply(out.effects)) {
        if (f.type === 'refresh' && (refreshes++ >= 3 || todo.some(t => t.type === 'refresh'))) continue
        todo.push(f)
      }
    }
    return reply
  }

  boot(): this {
    this.send({ type: 'refresh', startup: true })
    return this
  }

  refresh(): void {
    this.send({ type: 'refresh' })
  }

  /** A command typed at the prompt (or from `origin`). */
  run(text: string, o: { origin?: string; via?: 'command' | 'press' } = {}): string {
    return this.cmd(parseCommand(text), o)
  }

  cmd(cmd: Parsed, o: { origin?: string; via?: 'command' | 'press' } = {}): string {
    return (
      this.send({ type: 'command', cmd, now: this.now, origin: o.origin ?? 'composer', via: o.via ?? 'command', author: this.author }) ?? ''
    )
  }

  turnComplete(answer = 'Done.', reason: 'answer' | 'aborted' | 'refusal' | 'error' = 'answer'): void {
    this.refresh()
    this.facts.turnActive = false
    this.send({ type: 'turn.complete', now: this.now, reason, answer })
  }

  get ledger(): LedgerEntry[] {
    return parseLedger(this.text(STATE_FILES.ledger) ?? '')
  }

  ledgerOf(kind: LedgerEntry['kind']): LedgerEntry[] {
    return this.ledger.filter(e => e.kind === kind)
  }

  record(slug: string): RunRecord {
    const text = this.text(`${STATE_FILES.runsDir}/${slug}.json`)
    const parsed = text === undefined ? null : parseRunRecord(text, slug).record
    return parsed ?? newRunRecord({ slug, title: slug, source: 'human', now: this.now })
  }

  /** What register.tsx does after an allowed tool call: only calls that mean something are dispatched. */
  tool(input: GuardInput, isError = false): void {
    if (classifyTool(this.model, input) === null) return
    this.send({ type: 'tool.done', now: this.now, input, isError })
  }

  /** The guards' verdict for a call, as register.tsx asks it (release facts from the world). */
  judge(input: GuardInput): GuardVerdict {
    return judge(this.model, input, { envToken: this.envToken, grantActive: this.grantUntil !== null && this.grantUntil > this.now })
  }

  /** A guarded call that is denied, with the bookkeeping register.tsx does for a denial. */
  denied(input: GuardInput): GuardVerdict {
    const verdict = this.judge(input)
    if (!verdict.allow) this.send({ type: 'guard.blocked', now: this.now, tool: input.tool, verdict })
    return verdict
  }

  edit(path: string, content = 'x'): GuardInput {
    return { tool: 'Edit', filePath: `${this.cwd}/${path}`, content }
  }

  bash(command: string): GuardInput {
    return { tool: 'Bash', command }
  }

  measured(metric: string, value: number | string): void {
    this.send({ type: 'band.measured', now: this.now, metric, stdout: String(value), ok: true })
  }

  /** The run state of the active run (throws in a test when there is none). */
  get active(): NonNullable<ReturnType<typeof activeRun>> {
    const r = activeRun(this.model)
    if (!r) throw new Error('no active run')
    return r
  }

  /** The last prompt the mod queued, or undefined. */
  get lastPrompt(): EffectOf<'prompt'> | undefined {
    return this.prompts[this.prompts.length - 1]
  }
}

/** A world with one run already started by `/sdlc new` (manual mode keeps the prompt queue empty). */
export function startedWorld(mode: 'manual' | 'guided' | 'semi' = 'semi', idea = 'add rate limiting'): World {
  const w = new World({ config: { autonomy: { mode } } }).boot()
  w.run(`new ${idea}`)
  return w
}
