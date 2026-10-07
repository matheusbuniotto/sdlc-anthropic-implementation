// The wiring: the only file that touches `$`. It reads the disk into a DiskState, feeds actions to the
// pure controller (hooks/core/controller.ts) and performs the effects that come back. Every decision
// lives in the core; this file only does I/O, serializes it, and mounts the views.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BandReading, GateId, GuardInput, GuardVerdict, UiActions, UiState, ViewModel } from '../types'
import { AGENT_DEFS, systemSection } from './core/prompts'
import { setArtifactStatus, appendTwiceRule } from './core/artifacts'
import { parseCommand, type Parsed } from './core/commands'
import { STATE_FILES } from './core/constants'
import {
  activeRun,
  artifactReadPaths,
  bandFile,
  blankModel,
  classifyTool,
  dueMetrics,
  effectiveMode,
  existencePaths,
  judge,
  knowledgePaths,
  knowledgeRootOf,
  NO_FACTS,
  reduce,
  resolveConfig,
  userOverrides,
  type Action,
  type DiskFile,
  type DiskState,
  type Effect,
  type Model,
} from './core/controller'
import { appendEntry } from './core/ledger'
import { PROMPT_KEYS, buildPrompt } from './core/prompts'
import { buildView } from './core/view'
import { renderBand, statusText } from './ui/Band'
import { renderPane } from './ui/Pane'
import type { PaneElements } from './ui/elements'
import { DEFAULT_LEDGER_FILTER } from './core/ledger'

const PANE = 'sdlc-loop'
const POLL_MS = 5000
const OUTBOX_MS = 20
const DIAGNOSIS_TIMEOUT_MS = 10 * 60_000

const INITIAL_UI: UiState = { tab: 'loop', selectedPlay: null, ledgerFilter: DEFAULT_LEDGER_FILTER, draftIdea: '', bandExpanded: false, bandHidden: false }

const viewAtom = atom({ plugin: 'okf-loop', key: 'view' } as const, null)
const uiAtom = atom({ plugin: 'okf-loop', key: 'ui' } as const, INITIAL_UI)
const grantAtom = atom({ plugin: 'okf-loop', key: 'grantUntil' } as const, null)

// ---------------------------------------------------------------------------
// Module state. A hot reload wipes it all; every bit is rebuilt from disk, the state atoms or the store.
// ---------------------------------------------------------------------------

let model: Model | undefined
let queue: Promise<unknown> = Promise.resolve()
let lastViewJson = ''
let lastStatus: string | undefined
let lastSection = ''
let cachedAuthor: string | undefined
let userOpts: Record<string, unknown> = {}
let busy = false
let started = false
// The project's own knowledge files change rarely: read them at start, on /sdlc reload, and every few minutes.
let knowledgeCache: { root: string; at: number; files: Record<string, string> } | undefined
const KNOWLEDGE_TTL_MS = 5 * 60_000
// Prompts the mod wants to send. The engine refuses `$.prompt.submit` from inside a command.run hook (it would
// wait on the very turn that hook holds), so they leave from a timer, a dispatch of their own.
const outbox: string[] = []
let outboxTimer = false
const measuring = new Set<string>()
// What the agent was seen doing: the provenance of any approval that appears in a file (see ingest).
let activityAt = 0
let turnActive = false
let backgroundWork = false

type Req = Action | { type: 'refresh'; startup?: boolean; knowledge?: boolean }

// ---------------------------------------------------------------------------
// Small I/O helpers
// ---------------------------------------------------------------------------

async function nowOf($: EngineInterface): Promise<number> {
  try {
    return await $.clock.now()
  } catch {
    return Date.now()
  }
}

async function readText($: EngineInterface, path: string): Promise<string | null> {
  try {
    const text = await $.fs.read(path)
    return typeof text === 'string' ? text : null
  } catch {
    return null
  }
}

async function readFile($: EngineInterface, path: string): Promise<DiskFile | null> {
  const text = await readText($, path)
  if (text === null) return null
  let mtimeMs = 0
  try {
    mtimeMs = (await $.fs.stat(path)).mtimeMs
  } catch {
    mtimeMs = 0
  }
  return { text, mtimeMs }
}

async function listNames($: EngineInterface, dir: string, suffix: string): Promise<string[]> {
  try {
    const entries = await $.fs.list(dir)
    return entries.filter(e => e.kind === 'file' && e.name.endsWith(suffix)).map(e => e.name.slice(0, e.name.length - suffix.length))
  } catch {
    return []
  }
}

async function exists($: EngineInterface, path: string): Promise<boolean> {
  try {
    return await $.fs.exists(path)
  } catch {
    return false
  }
}

async function authorName($: EngineInterface): Promise<string> {
  if (cachedAuthor !== undefined) return cachedAuthor
  let name = ''
  try {
    const run = await $.process.run(['git', 'config', 'user.name'], { timeoutMs: 5000 })
    if (run.exitCode === 0) name = run.stdout.trim()
  } catch {
    name = ''
  }
  if (name === '') name = (await $.env.get('USER')) ?? ''
  cachedAuthor = name === '' ? 'human' : name
  return cachedAuthor
}

// ---------------------------------------------------------------------------
// Disk -> DiskState (two phases: config decides which knowledge and artifact files to read)
// ---------------------------------------------------------------------------

async function readDisk($: EngineInterface, fresh: boolean): Promise<DiskState> {
  let cwd = ''
  try {
    cwd = await $.session.cwd()
  } catch {
    cwd = ''
  }
  const home = (await $.env.get('HOME')) ?? ''
  const envToken = ((await $.env.get('RELEASE_APPROVAL')) ?? '') !== ''
  const configText = await readText($, STATE_FILES.config)

  const root = knowledgeRootOf(configText)
  const at = await nowOf($)
  if (fresh || !knowledgeCache || knowledgeCache.root !== root || at - knowledgeCache.at > KNOWLEDGE_TTL_MS) {
    const files: Record<string, string> = {}
    await Promise.all(
      knowledgePaths(configText).map(async path => {
        const text = await readText($, path)
        if (text !== null) files[path] = text
      }),
    )
    knowledgeCache = { root, at, files }
  }
  const knowledgeFiles = knowledgeCache.files
  const config = resolveConfig(configText, userOpts, knowledgeFiles).config

  const slugs = await listNames($, STATE_FILES.runsDir, '.json')
  const runFiles: Record<string, string> = {}
  const artifacts: Record<string, DiskFile> = {}
  const bandSamples: Record<string, string> = {}
  const exist: Record<string, boolean> = {}
  const promptOverrides: DiskState['promptOverrides'] = {}
  const promptNames = new Set(await listNames($, STATE_FILES.promptsDir, '.md'))
  const [activeText, ledgerText, bandsSpecText] = await Promise.all([
    readText($, STATE_FILES.active),
    readText($, STATE_FILES.ledger),
    config.bands.enabled ? readText($, config.paths.bands) : Promise.resolve(null),
    ...slugs.map(async slug => {
      const text = await readText($, `${STATE_FILES.runsDir}/${slug}.json`)
      if (text !== null) runFiles[slug] = text
    }),
    ...artifactReadPaths(config, slugs).map(async path => {
      const file = await readFile($, path)
      if (file) artifacts[path] = file
    }),
    ...(config.bands.enabled ? config.bands.sources : []).map(async s => {
      const text = await readText($, bandFile(s.metric))
      if (text !== null) bandSamples[s.metric] = text
    }),
    ...existencePaths(config).map(async path => {
      exist[path] = await exists($, path)
    }),
    ...PROMPT_KEYS.filter(k => promptNames.has(k)).map(async key => {
      const text = await readText($, `${STATE_FILES.promptsDir}/${key}.md`)
      if (text !== null) promptOverrides[key] = text
    }),
  ])
  const grantUntil = await read($, grantAtom)
  return {
    cwd,
    home,
    project: cwd.split('/').filter(Boolean).pop() ?? '',
    configText,
    userOptions: userOpts,
    knowledgeFiles,
    activeText,
    ledgerText,
    runFiles,
    artifacts,
    bandSamples,
    bandsSpecText,
    exists: exist,
    promptOverrides,
    grantUntil,
    envToken,
  }
}

// ---------------------------------------------------------------------------
// Effects: the only place the controller's decisions touch the world
// ---------------------------------------------------------------------------

type Diag = { metric: string; reading: BandReading; startedAt: number }

async function loadDiag($: EngineInterface): Promise<Record<string, Diag>> {
  try {
    const v = await $.store.get('diagnoses')
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, Diag>) : {}
  } catch {
    return {}
  }
}

async function saveDiag($: EngineInterface, diag: Record<string, Diag>): Promise<void> {
  try {
    await $.store.set('diagnoses', diag)
  } catch {
    // trivia: losing it only means the incident intent is written without the diagnosis
  }
}

async function appendLedger($: EngineInterface, entries: Extract<Effect, { t: 'ledger' }>['entry'][]): Promise<void> {
  if (entries.length === 0) return
  let text = (await readText($, STATE_FILES.ledger)) ?? ''
  for (const entry of entries) text = appendEntry(text, entry)
  await $.fs.write(STATE_FILES.ledger, text)
}

/** Run a band source's command and turn its output into a measurement action. Never throws. */
async function measure($: EngineInterface, metric: string): Promise<Action | null> {
  const source = model?.config.bands.sources.find(s => s.metric === metric)
  if (!source) return null
  const now = await nowOf($)
  try {
    const out = await $.process.run(source.argv, { timeoutMs: 20_000 })
    return { type: 'band.measured', now, metric, stdout: out.stdout, ok: out.exitCode === 0, ...(out.exitCode === 0 ? {} : { error: `exit ${out.exitCode}: ${out.stderr.trim().slice(0, 120)}` }) }
  } catch (err) {
    return { type: 'band.measured', now, metric, stdout: '', ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Off the queue: a slow process must never hold up a guard waiting behind it. A source already being measured is left alone. */
function startMeasure($: EngineInterface, metrics: string[]): void {
  const fresh = metrics.filter(m => !measuring.has(m))
  for (const m of fresh) measuring.add(m)
  if (fresh.length === 0) return
  void Promise.all(fresh.map(m => measure($, m)))
    .then(async actions => {
      for (const a of actions) if (a) await dispatch($, a).catch(() => undefined)
    })
    .finally(() => {
      for (const m of fresh) measuring.delete(m)
    })
}

async function runbook($: EngineInterface, argv: string[], label: string): Promise<void> {
  let text = `Runbook finished: ${label}`
  try {
    const out = await $.process.run(argv, { timeoutMs: 120_000 })
    text = `Runbook ${out.exitCode === 0 ? 'finished' : `failed (exit ${out.exitCode})`}: ${label}${out.stdout.trim() ? `\n${out.stdout.trim().slice(0, 300)}` : ''}`
  } catch (err) {
    text = `Runbook could not run: ${err instanceof Error ? err.message : String(err)}`
  }
  $.ui.toast(text.split('\n')[0] ?? text, { timeoutMs: 8000 })
  $.ui.log(`okf-loop · ${text}`)
}

function flushOutbox($: EngineInterface): void {
  outboxTimer = false
  for (const text of outbox.splice(0)) {
    // Not awaited: submit resolves when the turn starts, which can be long after.
    $.prompt.submit({ text }).catch(err => $.ui.log(`okf-loop: the prompt could not be queued: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' }))
  }
}

async function runEffects($: EngineInterface, effects: Effect[]): Promise<Req[]> {
  const follow: Req[] = []
  const entries: Extract<Effect, { t: 'ledger' }>['entry'][] = []
  for (const e of effects) {
    try {
      switch (e.t) {
        case 'write':
          if (e.overwrite || !(await exists($, e.path))) {
            await $.fs.write(e.path, e.text)
            if (e.exec) await $.process.run(['chmod', '+x', e.path], { timeoutMs: 5000 })
          }
          break
        case 'edit': {
          if (e.edit.kind === 'status') {
            const text = await readText($, e.path)
            if (text === null) break
            const next = setArtifactStatus(text, e.edit.artifact, e.edit.status)
            if (next !== text) await $.fs.write(e.path, next)
          } else {
            const text = (await readText($, e.path)) ?? e.edit.seed
            await $.fs.write(e.path, appendTwiceRule(text, e.edit.lesson, e.edit.date))
          }
          break
        }
        case 'append': {
          const text = (await readText($, e.path)) ?? ''
          await $.fs.write(e.path, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${e.line}\n`)
          break
        }
        case 'ledger':
          entries.push(e.entry)
          break
        case 'saveRun':
          await $.fs.write(`${STATE_FILES.runsDir}/${e.record.slug}.json`, `${JSON.stringify(e.record, null, 2)}\n`)
          break
        case 'saveConfig':
          await $.fs.write(STATE_FILES.config, e.text)
          break
        case 'setActive':
          await $.fs.write(STATE_FILES.active, `${e.slug}\n`)
          break
        case 'prompt':
          outbox.push(e.text)
          if (!outboxTimer) {
            outboxTimer = true
            $.clock.after(OUTBOX_MS, () => void flushOutbox($))
          }
          break
        case 'toast':
          $.ui.toast(e.text, { timeoutMs: 6000 })
          break
        case 'pane':
          if (e.open) await $.ui.open({ id: PANE, title: 'The Loop' })
          else await $.ui.close({ id: PANE })
          break
        case 'refresh':
          follow.push({ type: 'refresh', ...(e.knowledge ? { knowledge: true } : {}) })
          break
        case 'grant':
          await update($, grantAtom, () => e.until)
          break
        case 'spawn': {
          const now = await nowOf($)
          const author = await authorName($)
          let started = false
          try {
            const res = await $.agent.spawn({ subagentType: AGENT_DEFS.diagnoser.type, prompt: e.prompt, description: e.description })
            if (res.deny === undefined && res.agentId !== undefined) {
              const diag = await loadDiag($)
              diag[res.agentId] = { metric: e.metric, reading: e.reading, startedAt: now }
              await saveDiag($, diag)
              started = true
            }
          } catch (err) {
            started = false
            $.ui.log(`okf-loop: the diagnosis could not start: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
          }
          if (!started) follow.push({ type: 'band.diagnosis', now, metric: e.metric, reading: e.reading, diagnosis: '', author })
          break
        }
        case 'process':
          void runbook($, e.argv, e.label)
          break
        case 'bands':
          startMeasure($, e.metrics)
          break
      }
    } catch (err) {
      $.ui.log(`okf-loop: effect ${e.t} failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
  }
  try {
    await appendLedger($, entries)
  } catch (err) {
    $.ui.log(`okf-loop: the ledger could not be written: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
  return follow
}

// ---------------------------------------------------------------------------
// The serialized controller loop
// ---------------------------------------------------------------------------

async function step($: EngineInterface, req: Req): Promise<{ reply?: string; follow: Req[] }> {
  let action: Action
  if (req.type === 'refresh') {
    const disk = await readDisk($, req.startup === true || req.knowledge === true)
    action = { type: 'disk', disk, now: await nowOf($), ...(req.startup ? { startup: true } : {}), facts: { activityAt, turnActive, backgroundWork } }
  } else action = req
  const out = reduce(model ?? blankModel(), action)
  model = out.model
  const follow = await runEffects($, out.effects)
  return out.reply === undefined ? { follow } : { reply: out.reply, follow }
}

async function perform($: EngineInterface, first: Req): Promise<string | undefined> {
  const todo: Req[] = model || (first.type === 'refresh' && first.startup) ? [first] : [{ type: 'refresh', startup: true }, first]
  let reply: string | undefined
  let refreshes = 0
  for (let i = 0; todo.length > 0 && i < 16; i++) {
    const req = todo.shift() as Req
    const done = await step($, req)
    if (req === first) reply = done.reply
    for (const f of done.follow) {
      if (f.type === 'refresh' && (refreshes++ >= 3 || todo.some(t => t.type === 'refresh'))) continue
      todo.push(f)
    }
  }
  await publish($)
  return reply
}

/** One action at a time: the ledger and the run records have a single writer. Failures surface to the caller only. */
function dispatch($: EngineInterface, req: Req): Promise<string | undefined> {
  const run = queue.then(() => perform($, req))
  queue = run.catch(() => undefined)
  return run
}

function sectionKey(m: Model): string {
  const run = activeRun(m)
  return JSON.stringify([run?.record.slug, run?.snapshot.current, run?.snapshot.next.kind, run?.snapshot.next.gate, run?.record.paused, run?.record.fix, effectiveMode(m.config), m.config.plays.enabled])
}

/** Replace the view atom only when it really changed; status line and the prompt contract follow. */
async function publish($: EngineInterface): Promise<void> {
  const m = model
  if (!m) return
  const vm = buildView(m, await nowOf($))
  const json = JSON.stringify(vm)
  if (json !== lastViewJson) {
    lastViewJson = json
    await update($, viewAtom, () => vm)
  }
  const text = statusText(vm)
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
  const key = sectionKey(m)
  if (key !== lastSection) {
    if (lastSection !== '') $.ui.invalidate('prompt.section')
    lastSection = key
  }
}

// ---------------------------------------------------------------------------
// Timers and subagents
// ---------------------------------------------------------------------------

async function paneOpen($: EngineInterface): Promise<boolean> {
  try {
    return (await $.ui.panes()).some(p => p.id === PANE)
  } catch {
    return false
  }
}

async function expireDiagnoses($: EngineInterface, now: number): Promise<void> {
  const diag = await loadDiag($)
  const stale = Object.entries(diag).filter(([, d]) => now - d.startedAt > DIAGNOSIS_TIMEOUT_MS)
  if (stale.length === 0) return
  for (const [id, d] of stale) {
    delete diag[id]
    await dispatch($, { type: 'band.diagnosis', now, metric: d.metric, reading: d.reading, diagnosis: '', author: await authorName($) })
  }
  await saveDiag($, diag)
}

/** The 5 s heartbeat: pick up edits made in an editor, run due band sources. Cheap when nothing is going on. */
async function tick($: EngineInterface): Promise<void> {
  if (busy) return
  busy = true
  try {
    const m = model
    const relevant = m === undefined || m.runs.length > 0 || m.config.bands.enabled || (await exists($, STATE_FILES.runsDir)) || (await paneOpen($))
    if (!relevant) return
    await dispatch($, { type: 'refresh' })
    const now = await nowOf($)
    const fresh = model
    if (fresh) {
      startMeasure($, dueMetrics(fresh, now))
      if (fresh.config.bands.enabled) await expireDiagnoses($, now)
    }
  } catch (err) {
    $.ui.log(`okf-loop: heartbeat failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  } finally {
    busy = false
  }
}

/**
 * The heartbeat and the /sdlc command belong to this module instance. A hot reload makes a fresh one and
 * drops the old timers without raising session.start again, so any later hook starts them if they are missing.
 */
async function startUp($: EngineInterface): Promise<void> {
  if (started) return
  started = true
  try {
    $.clock.every(POLL_MS, () => void tick($))
    await $.command.register({
      name: 'sdlc',
      description: 'The AI-Native SDLC: runs, gates, guards, autopilot',
      argumentHint: '[new <idea> | status | approve | reject | next | mode | plays | guards | release | init | help]',
      immediate: true,
    })
  } catch (err) {
    started = false
    $.ui.log(`okf-loop: start-up failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

async function onSubagentTurn($: EngineInterface, agentId: string, answer: string, reason: string): Promise<void> {
  const diag = await loadDiag($)
  const hit = diag[agentId]
  if (!hit) return
  delete diag[agentId]
  await saveDiag($, diag)
  await dispatch($, { type: 'band.diagnosis', now: await nowOf($), metric: hit.metric, reading: hit.reading, diagnosis: reason === 'answer' ? answer : '', author: await authorName($) })
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

const str = (e: object, key: string): string | undefined => {
  const v = (e as Record<string, unknown>)[key]
  return typeof v === 'string' ? v : undefined
}

function guardInput(e: { readonly tool: string }): GuardInput {
  switch (e.tool) {
    case 'Edit':
      return { tool: 'Edit', filePath: str(e, 'file_path'), content: str(e, 'new_string') }
    case 'Write':
      return { tool: 'Write', filePath: str(e, 'file_path'), content: str(e, 'content') }
    case 'NotebookEdit':
      return { tool: 'NotebookEdit', filePath: str(e, 'notebook_path'), content: str(e, 'new_source') }
    case 'Bash':
      return { tool: 'Bash', command: str(e, 'command') }
    case 'Read':
      return { tool: 'Read', filePath: str(e, 'file_path') }
    default:
      return { tool: e.tool }
  }
}

/** Anything that could have written a file counts as agent activity (see the provenance of approvals). */
function noteActivity(e: { readonly tool: string }, now: number): void {
  turnActive = true
  if (e.tool === 'Read' || e.tool === 'WebFetch') return
  activityAt = Math.max(activityAt, now)
  if ((e as { run_in_background?: unknown }).run_in_background === true) backgroundWork = true
}

async function judgeCall($: EngineInterface, input: GuardInput): Promise<GuardVerdict> {
  // A failed read of the project must not stop the guards judging: they fall back to the defaults.
  if (!model) await dispatch($, { type: 'refresh', startup: true }).catch(() => undefined)
  const now = await nowOf($)
  const until = await read($, grantAtom)
  const release = { envToken: ((await $.env.get('RELEASE_APPROVAL')) ?? '') !== '', grantActive: until !== null && until > now }
  let verdict = judge(model ?? blankModel(), input, release)
  // A person may just have accepted the plan in an editor: look once more before holding the edit.
  if (!verdict.allow && verdict.guard === 'plan-first') {
    await dispatch($, { type: 'refresh' }).catch(() => undefined)
    verdict = judge(model ?? blankModel(), input, release)
  }
  return verdict
}

// ---------------------------------------------------------------------------
// Pane and band actions
// ---------------------------------------------------------------------------

/** A command that came from a button: a person by construction. */
async function press($: EngineInterface, cmd: Parsed): Promise<void> {
  try {
    const reply = await dispatch($, { type: 'command', cmd, now: await nowOf($), origin: 'press', via: 'press', author: await authorName($) })
    const first = reply?.split('\n')[0]
    if (first) $.ui.toast(first, { timeoutMs: 5000 })
  } catch (err) {
    $.ui.log(`okf-loop: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
  }
}

async function askReject($: EngineInterface, gate: GateId): Promise<void> {
  try {
    const reason = await $.ui.ask(`Why are you sending ${gate} back? The agent redrafts from your answer.`, {
      options: ['Needs more detail', 'Wrong scope', 'Contradicts a constraint'],
      header: 'Reject',
    })
    await press($, { cmd: 'reject', gate, reason })
  } catch {
    // dismissed: nothing is rejected
  }
}

function makeActions($: EngineInterface): UiActions {
  const ui = (fn: (u: UiState) => UiState): void => void update($, uiAtom, fn).catch(() => undefined)
  const go = (cmd: Parsed): void => void press($, cmd)
  return {
    setTab: tab => ui(u => ({ ...u, tab })),
    selectPlay: n => ui(u => ({ ...u, selectedPlay: n })),
    setLedgerFilter: filter => ui(u => ({ ...u, ledgerFilter: filter })),
    setDraftIdea: text => ui(u => ({ ...u, draftIdea: text })),
    newRun: idea => {
      const text = idea.trim()
      if (text === '') return
      ui(u => ({ ...u, draftIdea: '' }))
      go({ cmd: 'new', idea: text })
    },
    selectRun: slug => go({ cmd: 'use', slug }),
    approve: gate => go({ cmd: 'approve', gate }),
    // A quarantined approval is confirmed by the same path: the gate is ready, only the record is missing.
    confirm: gate => go({ cmd: 'approve', gate }),
    reject: gate => void askReject($, gate),
    runNext: () => go({ cmd: 'next' }),
    setMode: mode => go({ cmd: 'mode', mode }),
    togglePause: () => go({ cmd: 'pause', toggle: true }),
    togglePlay: n => go({ cmd: 'plays', action: 'toggle', n }),
    toggleGuard: id => go({ cmd: 'guards', toggle: id }),
    grantRelease: minutes => go({ cmd: 'release', action: 'grant', minutes }),
    revokeRelease: () => go({ cmd: 'release', action: 'revoke' }),
    scaffold: id => go({ cmd: 'init', item: id }),
    scaffoldAll: () => go({ cmd: 'init' }),
    exportAudit: () => go({ cmd: 'audit' }),
    checkBands: () => go({ cmd: 'bands', action: 'check' }),
    reloadKnowledge: () => go({ cmd: 'reload' }),
    toggleBand: () => ui(u => ({ ...u, bandExpanded: !u.bandExpanded })),
    hideBand: () => ui(u => ({ ...u, bandHidden: true })),
    openPane: () => void $.ui.open({ id: PANE, title: 'The Loop' }).catch(() => undefined),
    closePane: () => void $.ui.close({ id: PANE }).catch(() => undefined),
  }
}

const loadingView = (): ViewModel => buildView(blankModel(), 0)

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

export const register: Register = (on, options) => {
  userOpts = userOverrides(options)

  on('session.start', async ($, e, next) => {
    try {
      await dispatch($, { type: 'refresh', startup: true })
      if (model?.config.ui.openPaneOnStart) await $.ui.open({ id: PANE, title: 'The Loop' })
    } catch (err) {
      $.ui.log(`okf-loop: start-up failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    await startUp($)
    return next(e)
  })

  on('command.run', { command: 'sdlc' }, async ($, e) => {
    void startUp($)
    const cmd = parseCommand(e.args)
    try {
      const reply = await dispatch($, { type: 'command', cmd, now: await nowOf($), origin: e.origin.kind, via: 'command', author: await authorName($) })
      return { text: reply ?? 'Done.' }
    } catch (err) {
      return { text: `okf-loop: that failed (${err instanceof Error ? err.message : String(err)}).` }
    }
  })

  on('prompt.compose', async ($, e, next) => {
    void startUp($)
    const base = await next(e)
    try {
      const m = model
      if (!m) return base
      const text = systemSection({ snapshot: activeRun(m)?.snapshot ?? null, mode: effectiveMode(m.config), enabledPlays: m.config.plays.enabled, paths: m.config.paths })
      return { sections: [...base.sections, { id: 'okf-loop:contract', text, scope: 'session' }] }
    } catch {
      return base
    }
  })

  on('tool.call', { tool: ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Read', 'WebFetch'] }, async ($, e, next) => {
    void startUp($)
    const input = guardInput(e)
    noteActivity(e, await nowOf($))
    const verdict = await judgeCall($, input)
    if (!verdict.allow) {
      try {
        await dispatch($, { type: 'guard.blocked', now: await nowOf($), tool: e.tool, verdict })
      } catch {
        // the denial stands whatever the bookkeeping did
      }
      return { deny: verdict.message }
    }
    const ran = await next(e)
    noteActivity(e, await nowOf($))
    if (ran.deny === undefined) {
      try {
        if (model && classifyTool(model, input) !== null) await dispatch($, { type: 'tool.done', now: await nowOf($), input, isError: ran.isError === true })
      } catch {
        // tracking is best effort: the tool already ran
      }
    }
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'okf-loop: a guard failed, so the action is refused (fail closed).' }))

  // An MCP tool could write a file too: it counts as agent activity for the provenance of approvals.
  on('tool.call', { tool: /^mcp__/ }, async ($, e, next) => {
    noteActivity(e, await nowOf($))
    const ran = await next(e)
    noteActivity(e, await nowOf($))
    return ran
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    void startUp($)
    const result = await next(e)
    try {
      if (e.agentId !== undefined) {
        await onSubagentTurn($, e.agentId, e.answer, e.reason)
        return result
      }
      await dispatch($, { type: 'refresh' })
      turnActive = false
      await dispatch($, { type: 'turn.complete', now: await nowOf($), reason: e.reason, answer: e.answer })
      if (model) startMeasure($, dueMetrics(model, await nowOf($)))
    } catch (err) {
      $.ui.log(`okf-loop: turn bookkeeping failed: ${err instanceof Error ? err.message : String(err)}`, { to: 'debug' })
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: 'sdlc-loop' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const vm = (await read($, viewAtom)) ?? loadingView()
    const ui = await read($, uiAtom)
    const el = $.ui.resolve(e) as unknown as PaneElements
    return renderPane(el, { vm, ui, act: makeActions($), columns: e.props.bodyColumns ?? e.viewport?.columns ?? 100, rows: e.viewport?.rows ?? 30, surface: e.surface })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const vm = await read($, viewAtom)
    const ui = await read($, uiAtom)
    if (!vm || ui.bandHidden || !vm.config.ui.showBand) return next(e)
    const el = $.ui.resolve(e) as unknown as PaneElements
    const tree = renderBand(el, { vm, ui, act: makeActions($), columns: e.props.bodyColumns, surface: e.surface })
    return tree ?? next(e)
  })
}
