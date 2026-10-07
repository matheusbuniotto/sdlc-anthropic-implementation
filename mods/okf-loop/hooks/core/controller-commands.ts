// `/sdlc ...` and the pane's buttons, as decisions: a Parsed command in, effects and a reply out.
// Anything that changes state needs a person: a typed command from the composer, the bridge or the
// SDK host, or a button press. A plugin or a notification cannot approve, reject, grant or reconfigure.

import type { GateId, LoopConfig, PromptKey } from '../../types'
import { renderArtifact } from './artifacts'
import { artifactPath, slugify, withGuardToggled, withMode, withPlayToggled } from './config'
import { GATE_DEFS, STATE_DIR } from './constants'
import { HELP_TEXT, isHumanOrigin, isReadOnly, type Parsed } from './commands'
import { forceNext, afterHumanGate } from './controller-autopilot'
import { bandsCheck, bandsRunbook, bandsStatus, GITIGNORE } from './controller-bands'
import { approve, reject, releaseGrant, releaseRevoke } from './controller-gates'
import {
  activeRun,
  effectiveMode,
  isoDate,
  ledger,
  note,
  queuePrompt,
  runOf,
  say,
  setRuntime,
  updateRecord,
  type Acc,
} from './controller-kit'
import { audit, configText, CONFIRM_PREFIX, scaffold, twice } from './controller-scaffold'
import type { Action } from './controller-types'
import { snapshotFor } from './controller-ingest'
import { guardViews, statusSummary } from './view'
import { newRunRecord } from './stages'
import { playLabel } from './knowledge'
import { PROMPT_STAGE } from './prompts'

type CommandAction = Extract<Action, { type: 'command' }>

const describeOrigin = (kind: string): string => (kind === 'plugin' ? 'a plugin' : kind === 'press' ? 'a press' : `a ${kind} message`)

function title(idea: string): string {
  const flat = idea.replace(/\s+/g, ' ').trim()
  const short = flat.length <= 80 ? flat : flat.slice(0, Math.max(flat.slice(0, 80).lastIndexOf(' '), 40)).trim()
  return short.charAt(0).toUpperCase() + short.slice(1)
}

function saveConfig(acc: Acc, next: LoopConfig, key: string, value: string, now: number): void {
  const m = acc.model
  acc.effects.push({ t: 'saveConfig', text: configText(next, m.configBase) })
  ledger(acc, { kind: 'config.changed', actor: 'human', summary: `Config ${key} = ${value}`, data: { key, value } }, now)
  acc.effects.push({ t: 'refresh' })
}

function startRun(acc: Acc, a: { idea: string; ref?: string }, now: number, author: string): void {
  const m = acc.model
  const c = m.config
  const runTitle = title(a.idea)
  const slug = slugify(a.ref ? `${a.ref} ${runTitle}` : runTitle, m.runs.map(r => r.record.slug))
  const source = a.ref ? 'ticket' : 'human'
  const path = artifactPath(c, 'intent', { slug })
  const tpl = m.knowledge.templates.intent
  const text = renderArtifact({
    kind: 'intent',
    template: tpl ?? FALLBACK_INTENT,
    title: runTitle,
    author: author || 'n/a',
    date: isoDate(now),
    slug,
    source: a.ref ?? 'human',
  })
  const record = newRunRecord({ slug, title: runTitle, source, now })
  acc.effects.push({ t: 'write', path, text, overwrite: false })
  acc.effects.push({ t: 'write', path: `${STATE_DIR}/.gitignore`, text: GITIGNORE, overwrite: false })
  acc.effects.push({ t: 'saveRun', record })
  acc.effects.push({ t: 'setActive', slug })
  acc.effects.push({ t: 'pane', open: true })
  ledger(acc, { kind: 'run.created', run: slug, stage: 'plan', actor: 'human', summary: `${author || 'A human'} started run ${slug}: ${runTitle}`, data: { title: runTitle, source, ...(a.ref ? { ref: a.ref } : {}), by: author || 'human' } }, now)
  ledger(acc, { kind: 'artifact.written', run: slug, stage: 'plan', actor: 'mod', summary: `Wrote ${path} from the intent template`, data: { kind: 'intent', path } }, now)
  const snapshot = snapshotFor(c, { record, docs: {}, proofVerdict: null, review: null }, [], false, now)
  acc.model = { ...m, active: slug, runs: [...m.runs, { record, docs: {}, proofVerdict: null, review: null, snapshot }] }
  acc.effects.push({ t: 'refresh' })
  note(acc, `Started ${slug}`, now)
  if (effectiveMode(c) === 'manual') {
    return say(acc, `Started run ${slug}: ${path} holds the intent skeleton. Manual mode, so nothing is queued: ask the agent to interview you, or /sdlc next.`)
  }
  const run = runOf(acc.model, slug)
  if (run) queuePrompt(acc, run, 'interview', 'human', now, { notes: a.idea })
  say(acc, `Started run ${slug}: ${path} holds the intent skeleton${a.ref ? ` (ticket ${a.ref})` : ''}. The agent will interview you to fill it in; you approve it when it is right.`)
}

const FALLBACK_INTENT = `# Intent: [Short Descriptive Title]

**Author:** [Name]
**Status:** draft
**Date:** [YYYY-MM-DD]
**Source Ticket / Anomaly Ref:** [n/a]

## Problem
[Describe in plain language what hurts and who it hurts.]

## Proposed Outcome
[What is true when this is done.]

## Affected Users and Systems
- **User Personas:** [who]

## Constraints
- **Out of Scope:** [what not]

## Open Questions
- [ ] [Question]
`

function lessonNotes(acc: Acc, slug: string, heading: string): string {
  const kinds = new Set(['band.breach', 'incident.intent', 'proof.fail', 'guard.blocked', 'gate.rejected'])
  const recent = acc.model.ledger.filter(e => (e.run === slug || e.run === undefined) && kinds.has(e.kind)).slice(-6)
  const lines = recent.map(e => `- ${new Date(e.ts).toISOString().slice(0, 16).replace('T', ' ')} ${e.kind}: ${e.summary.split('\n')[0]}`)
  return [`Lesson title: ${heading}`, lines.length > 0 ? `Recent events:\n${lines.join('\n')}` : ''].filter(Boolean).join('\n')
}

function playsCommand(acc: Acc, cmd: Extract<Parsed, { cmd: 'plays' }>, now: number): void {
  const m = acc.model
  const enabled = m.config.plays.enabled
  if (cmd.action === 'list' || cmd.n === undefined) {
    return say(
      acc,
      m.knowledge.plays
        .map(p => {
          const unmet = p.prerequisites.filter(q => !enabled.includes(q))
          return `${enabled.includes(p.n) ? '[x]' : '[ ]'} ${playLabel(m.knowledge.plays, p.n)}${!enabled.includes(p.n) && unmet.length ? ` (needs ${unmet.map(u => `Play ${String(u).padStart(2, '0')}`).join(', ')})` : ''}`
        })
        .join('\n'),
    )
  }
  const n = cmd.n
  const on = enabled.includes(n)
  if (cmd.action === 'enable' && on) return say(acc, `${playLabel(m.knowledge.plays, n)} is already adopted.`)
  if (cmd.action === 'disable' && !on) return say(acc, `${playLabel(m.knowledge.plays, n)} is not adopted.`)
  const res = withPlayToggled(m.fileConfig, n, m.knowledge.plays)
  if (!res.ok) return say(acc, res.reason)
  acc.model = { ...m, fileConfig: res.config, config: { ...m.config, plays: res.config.plays } }
  acc.effects.push({ t: 'saveConfig', text: configText(res.config, m.configBase) })
  ledger(acc, { kind: 'play.toggled', actor: 'human', summary: res.reason, data: { play: n, enabled: !on } }, now)
  acc.effects.push({ t: 'refresh' })
  note(acc, res.reason, now)
  say(acc, res.reason)
  if (n === 4 && on && acc.model.config.autonomy.mode === 'semi') say(acc, 'Without Play 04 the semi mode runs as guided: the mod proposes, you trigger.')
}

function fixCommand(acc: Acc, description: string, now: number): void {
  const run = activeRun(acc.model)
  if (!run) return say(acc, 'Start or select a run first: /sdlc new <idea>, /sdlc use <slug>.')
  const slug = run.record.slug
  const updated = updateRecord(acc, slug, r => ({ ...r, fix: { active: true, since: now, reproCommitted: false } }), now)
  ledger(acc, { kind: 'agent.verdict', run: slug, stage: 'test', actor: 'human', summary: `Bug-fix protocol started: ${description}`, data: { kind: 'fix-started' } }, now)
  acc.effects.push({ t: 'refresh' })
  note(acc, 'Bug-fix protocol on', now)
  if (effectiveMode(acc.model.config) !== 'manual' && updated) {
    queuePrompt(acc, updated, 'fix', 'human', now, { notes: description })
    return say(acc, 'Bug-fix protocol started: the agent writes a failing test first. Tests lock once the repro is committed. /sdlc fixed closes it.')
  }
  say(acc, 'Bug-fix protocol started (manual mode): write the failing test, commit it (tests lock), fix the code, then /sdlc fixed.')
}

function confirm(acc: Acc, id: string, now: number, a: CommandAction): void {
  const [slug, gate] = id.slice(CONFIRM_PREFIX.length).split(':')
  if (!slug || !gate || !(gate in GATE_DEFS)) return say(acc, `Unknown item "${id}".`)
  if (acc.model.active !== slug && runOf(acc.model, slug)) acc.model = { ...acc.model, active: slug }
  approve(acc, gate as GateId, now, a.via, a.author)
}

/** Run one command. `a.via` is how it arrived; a press is a person by construction. */
export function runCommand(acc: Acc, a: CommandAction): void {
  const { cmd, now } = a
  if (!isReadOnly(cmd) && a.via !== 'press' && !isHumanOrigin(a.origin)) {
    return say(
      acc,
      `"/sdlc ${cmd.cmd}" changes state and is reserved for a person (typed at the prompt, the bridge or the SDK host, or a button press). It came from ${describeOrigin(a.origin)}, so it was refused.`,
    )
  }
  const m = acc.model
  switch (cmd.cmd) {
    case 'error':
      return say(acc, cmd.message)
    case 'help':
      return say(acc, HELP_TEXT)
    case 'open': {
      acc.effects.push({ t: 'pane', open: true })
      const run = activeRun(m)
      return say(acc, run ? `Loop pane open: ${run.record.slug} at ${run.snapshot.current}.` : 'Loop pane open. No run yet: describe a change with /sdlc new <idea>.')
    }
    case 'status':
      return say(acc, statusSummary(m, now))
    case 'reload':
      acc.effects.push({ t: 'refresh', knowledge: true })
      return say(acc, 'Reloading config, knowledge, runs and the ledger from disk.')
    case 'init':
      if (cmd.item?.startsWith(CONFIRM_PREFIX)) return confirm(acc, cmd.item, now, a)
      return scaffold(acc, cmd.item, now)
    case 'new':
      return startRun(acc, cmd, now, a.author)
    case 'next':
      return forceNext(acc, now)
    case 'approve':
      return approve(acc, cmd.gate, now, a.via, a.author)
    case 'reject':
      return reject(acc, cmd.gate, cmd.reason, now, a.via, a.author)
    case 'mode': {
      const next = withMode(m.fileConfig, cmd.mode)
      acc.model = { ...m, fileConfig: next, config: m.overridden.mode ? m.config : withMode(m.config, cmd.mode) }
      saveConfig(acc, next, 'autonomy.mode', cmd.mode, now)
      note(acc, `Mode ${cmd.mode}`, now)
      say(acc, `Mode set to ${cmd.mode} in .okf/config.json.`)
      if (m.overridden.mode) say(acc, `The plugin option "Autonomy mode" still forces ${m.config.autonomy.mode}: change it in /config to let the file decide.`)
      else if (cmd.mode === 'semi' && !m.config.plays.enabled.includes(4)) say(acc, 'Play 04 is not adopted, so semi runs as guided until you /sdlc plays enable 4.')
      return
    }
    case 'pause': {
      const run = activeRun(m)
      if (!run) return say(acc, 'There is no active run.')
      const paused = cmd.toggle ? !run.record.paused : true
      if (!paused) return resumeRun(acc, run.record.slug, now)
      updateRecord(acc, run.record.slug, r => ({ ...r, paused: true }), now)
      ledger(acc, { kind: 'autopilot.halted', run: run.record.slug, stage: run.snapshot.current, actor: 'human', summary: 'A human paused the autopilot', data: { code: 'paused' } }, now)
      acc.effects.push({ t: 'refresh' })
      return say(acc, `Autopilot paused on ${run.record.slug}. /sdlc resume continues it.`)
    }
    case 'resume': {
      const run = activeRun(m)
      return run ? resumeRun(acc, run.record.slug, now) : say(acc, 'There is no active run.')
    }
    case 'use': {
      if (!runOf(m, cmd.slug)) return say(acc, `No run "${cmd.slug}". Runs: ${m.runs.map(r => r.record.slug).join(', ') || 'none'}.`)
      acc.model = { ...m, active: cmd.slug }
      acc.effects.push({ t: 'setActive', slug: cmd.slug })
      acc.effects.push({ t: 'refresh' })
      return say(acc, `Active run: ${cmd.slug}.`)
    }
    case 'plays':
      return playsCommand(acc, cmd, now)
    case 'guards': {
      if (cmd.toggle) {
        const next = withGuardToggled(m.fileConfig, cmd.toggle)
        const off = next.guards.disabled.includes(cmd.toggle)
        acc.model = { ...m, fileConfig: next, config: { ...m.config, guards: { ...m.config.guards, disabled: next.guards.disabled } } }
        saveConfig(acc, next, `guards.${cmd.toggle}`, off ? 'off' : 'on', now)
        return say(acc, `Guard ${cmd.toggle} is now ${off ? 'OFF: it no longer protects anything' : 'on'}.`)
      }
      return say(
        acc,
        guardViews(m)
          .map(g => `${g.enabled ? (g.active ? 'on     ' : 'dormant') : 'off    '} ${g.id.padEnd(21)} Play ${String(g.play).padStart(2, '0')} · ${g.stat.hits} hit${g.stat.hits === 1 ? '' : 's'}${!g.active && g.enabled ? ' (its play is not adopted)' : ''}`)
          .join('\n'),
      )
    }
    case 'fix':
      return fixCommand(acc, cmd.description, now)
    case 'fixed': {
      const run = activeRun(m)
      if (!run || !run.record.fix.active) return say(acc, 'No bug-fix protocol is active.')
      updateRecord(acc, run.record.slug, r => ({ ...r, fix: { active: false, reproCommitted: false } }), now)
      ledger(acc, { kind: 'agent.verdict', run: run.record.slug, stage: 'test', actor: 'human', summary: 'Bug-fix protocol closed: tests are unlocked', data: { kind: 'fix-closed' } }, now)
      acc.effects.push({ t: 'refresh' })
      return say(acc, 'Bug-fix protocol closed: tests are unlocked.')
    }
    case 'release':
      return cmd.action === 'grant' ? releaseGrant(acc, cmd.minutes, now, a.via, a.author) : releaseRevoke(acc, now, a.author, 'human')
    case 'twice':
      return twice(acc, cmd.lesson, now)
    case 'lesson': {
      const run = activeRun(m)
      if (!run) return say(acc, 'Select a run first (/sdlc use <slug>): the lesson is written about it.')
      ledger(acc, { kind: 'lesson.recorded', run: run.record.slug, stage: 'maintain', actor: 'human', summary: `Post-mortem requested: ${cmd.title}`, data: { title: cmd.title } }, now)
      if (effectiveMode(m.config) === 'manual') return say(acc, 'Manual mode: nothing queued. /sdlc next, or ask the agent to write the post-mortem.')
      const key: PromptKey = 'lesson'
      queuePrompt(acc, run, key, 'human', now, { notes: lessonNotes(acc, run.record.slug, cmd.title) })
      return say(acc, `Queued the ${PROMPT_STAGE[key]} post-mortem: the agent writes it, you review it.`)
    }
    case 'bands':
      if (cmd.action === 'status') return bandsStatus(acc)
      if (cmd.action === 'check') return bandsCheck(acc)
      return bandsRunbook(acc, now, a.author)
    case 'worktree':
      return say(
        acc,
        `Work on this run in an isolated worktree (Play 04), from your shell:\n  claude --worktree ${cmd.name}\nThen /sdlc use ${activeRun(m)?.record.slug ?? '<slug>'} there; the run record and artifacts travel with the branch.`,
      )
    case 'audit':
      return audit(acc, now)
  }
}

function resumeRun(acc: Acc, slug: string, now: number): void {
  const run = runOf(acc.model, slug)
  if (!run) return
  const was = run.record.paused
  updateRecord(acc, slug, r => ({ ...r, paused: false }), now)
  setRuntime(acc, { halted: Object.fromEntries(Object.entries(acc.model.runtime.halted).filter(([k]) => k !== slug)) })
  acc.effects.push({ t: 'refresh' })
  say(acc, was ? `Autopilot resumed on ${slug}.` : `${slug} was not paused.`)
  afterHumanGate(acc, slug, now)
}

