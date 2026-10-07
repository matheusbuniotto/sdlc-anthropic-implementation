// `/sdlc ...` argument parsing: text in, a `Parsed` command out. Pure. Anything that
// changes state is decided in controller.ts; this file only reads what the person typed.

import type { GateId, GuardId, Mode } from '../../types'
import { GUARD_ORDER } from './constants'

export type Parsed =
  | { cmd: 'open' }
  | { cmd: 'status' }
  | { cmd: 'help' }
  | { cmd: 'init'; item?: string }
  | { cmd: 'new'; idea: string; ref?: string }
  | { cmd: 'next' }
  | { cmd: 'approve'; gate: GateId | null }
  | { cmd: 'reject'; gate: GateId | null; reason: string }
  | { cmd: 'mode'; mode: Mode }
  | { cmd: 'pause'; toggle?: boolean }
  | { cmd: 'resume' }
  | { cmd: 'use'; slug: string }
  | { cmd: 'plays'; action: 'list' | 'enable' | 'disable' | 'toggle'; n?: number }
  | { cmd: 'guards'; toggle?: GuardId }
  | { cmd: 'fix'; description: string }
  | { cmd: 'fixed' }
  | { cmd: 'release'; action: 'grant' | 'revoke'; minutes?: number }
  | { cmd: 'twice'; lesson: string }
  | { cmd: 'lesson'; title: string }
  | { cmd: 'bands'; action: 'check' | 'status' | 'runbook' }
  | { cmd: 'worktree'; name: string }
  | { cmd: 'audit' }
  | { cmd: 'reload' }
  | { cmd: 'error'; message: string }

export const HELP_TEXT = [
  'okf-loop · /sdlc runs openknowledge/INDEX.md: intent > spec > plan > proof > review > bands.',
  '',
  '/sdlc                          open the Loop pane',
  '/sdlc status                   where the run is, who owes the next move',
  '/sdlc new [--ref T-1] <idea>   start a run from an idea (or a ticket id)',
  '/sdlc next                     do the next agent step now',
  '/sdlc approve [gate]           pass a human gate (intent spec plan release)',
  '/sdlc reject [gate] <reason>   send a gate back with feedback for the agent',
  '/sdlc mode manual|guided|semi  how much the loop does on its own',
  '/sdlc pause | resume           stop or continue the autopilot on this run',
  '/sdlc use <slug>               switch the active run',
  '/sdlc fix <bug> | fixed        bug-fix protocol: lock tests after the repro is committed',
  '/sdlc release grant [min]      let the agent run production commands for a while',
  '/sdlc release revoke           take the grant back',
  '/sdlc plays [enable|disable N] adopt or drop a play (prerequisites enforced)',
  '/sdlc guards                   the guards and how often each fired',
  '/sdlc twice <lesson>           add a line to CLAUDE.md "Things Claude Gets Wrong"',
  '/sdlc lesson <title>           have the agent write the post-mortem for this run',
  '/sdlc worktree <name>          how to work on this run in an isolated worktree',
  '/sdlc bands [check|status|runbook]  control bands (Stage 6)',
  '/sdlc init [item]              scaffold CLAUDE.md, REVIEW.md, bands.yaml, CI evals, ...',
  '/sdlc audit                    write .okf/AUDIT.md from the ledger',
  '/sdlc reload                   re-read config, knowledge and runs',
].join('\n')

const GATES: Record<string, GateId> = {
  'intent.approve': 'intent.approve',
  intent: 'intent.approve',
  'spec.approve': 'spec.approve',
  spec: 'spec.approve',
  'plan.accept': 'plan.accept',
  plan: 'plan.accept',
  accept: 'plan.accept',
  'verify.pass': 'verify.pass',
  verify: 'verify.pass',
  'review.pass': 'review.pass',
  review: 'review.pass',
  'release.approve': 'release.approve',
  release: 'release.approve',
}

export function parseGate(word: string): GateId | null {
  return GATES[word.trim().toLowerCase()] ?? null
}

export const GATE_NAMES = 'intent.approve, spec.approve, plan.accept, verify.pass, review.pass, release.approve'

function split(text: string): [string, string] {
  const t = text.trim()
  const m = /^(\S+)\s*([\s\S]*)$/.exec(t)
  return m ? [m[1] ?? '', (m[2] ?? '').trim()] : ['', '']
}

const err = (message: string): Parsed => ({ cmd: 'error', message })

export function parseCommand(args: string): Parsed {
  const [head, rest] = split(args)
  if (head === '') return { cmd: 'open' }
  const [first, tail] = split(rest)
  switch (head.toLowerCase()) {
    case 'open':
    case 'pane':
    case 'loop':
      return { cmd: 'open' }
    case 'status':
    case 'st':
      return { cmd: 'status' }
    case 'help':
    case '?':
    case '-h':
    case '--help':
      return { cmd: 'help' }
    case 'init':
    case 'scaffold':
      return first === '' ? { cmd: 'init' } : { cmd: 'init', item: first }
    case 'new':
    case 'start': {
      const ref = /^(?:--ref(?:=|\s+)|-r\s+)(\S+)\s*([\s\S]*)$/.exec(rest)
      const idea = (ref ? (ref[2] ?? '') : rest).trim()
      if (idea === '') return err('Describe the change in your own words: /sdlc new [--ref TICKET-1] <idea>')
      return ref?.[1] ? { cmd: 'new', idea, ref: ref[1] } : { cmd: 'new', idea }
    }
    case 'next':
    case 'continue':
      return { cmd: 'next' }
    case 'approve':
    case 'accept': {
      if (first === '') return { cmd: 'approve', gate: null }
      const gate = parseGate(first)
      return gate ? { cmd: 'approve', gate } : err(`Unknown gate "${first}". Gates: ${GATE_NAMES}.`)
    }
    case 'reject':
    case 'rework': {
      const gate = first === '' ? null : parseGate(first)
      return gate ? { cmd: 'reject', gate, reason: tail } : { cmd: 'reject', gate: null, reason: rest }
    }
    case 'mode': {
      const mode = (['manual', 'guided', 'semi'] as const).find(m => m === first.toLowerCase() || (m === 'semi' && first.toLowerCase() === 'semi-auto'))
      return mode ? { cmd: 'mode', mode } : err('Mode is one of: manual, guided, semi.')
    }
    case 'pause':
      return { cmd: 'pause' }
    case 'resume':
      return { cmd: 'resume' }
    case 'use':
    case 'switch':
    case 'select':
      return first === '' ? err('Which run? /sdlc use <slug>') : { cmd: 'use', slug: first }
    case 'plays':
    case 'play': {
      const action = first.toLowerCase()
      if (action === '' || action === 'list') return { cmd: 'plays', action: 'list' }
      if (action !== 'enable' && action !== 'disable' && action !== 'toggle') return err('Usage: /sdlc plays [list | enable N | disable N]')
      const n = Number(tail.split(/\s+/)[0])
      if (!Number.isInteger(n) || n < 1 || n > 99) return err(`Which play? /sdlc plays ${action} <number 1-14>`)
      return { cmd: 'plays', action, n }
    }
    case 'guards':
    case 'guard': {
      if (first === '' || first.toLowerCase() === 'list') return { cmd: 'guards' }
      const id = GUARD_ORDER.find(g => g === tail.split(/\s+/)[0] || g === first)
      return first.toLowerCase() === 'toggle' && id ? { cmd: 'guards', toggle: id } : err(`Usage: /sdlc guards [toggle <${GUARD_ORDER.join('|')}>]`)
    }
    case 'fix':
      return rest === '' ? err('Describe the bug: /sdlc fix <what is broken>') : { cmd: 'fix', description: rest }
    case 'fixed':
      return { cmd: 'fixed' }
    case 'release': {
      const action = first.toLowerCase()
      if (action === 'revoke') return { cmd: 'release', action: 'revoke' }
      if (action !== 'grant') return err('Usage: /sdlc release grant [minutes] | /sdlc release revoke')
      if (tail === '') return { cmd: 'release', action: 'grant' }
      const minutes = Number(tail.split(/\s+/)[0])
      return Number.isFinite(minutes) && minutes >= 1 && minutes <= 480
        ? { cmd: 'release', action: 'grant', minutes: Math.round(minutes) }
        : err('Minutes must be between 1 and 480.')
    }
    case 'twice':
      return rest === '' ? err('What did Claude get wrong? /sdlc twice <lesson>') : { cmd: 'twice', lesson: rest }
    case 'lesson':
      return rest === '' ? err('Title the lesson: /sdlc lesson <title>') : { cmd: 'lesson', title: rest }
    case 'bands':
    case 'band': {
      const action = first.toLowerCase()
      if (action === '' || action === 'status') return { cmd: 'bands', action: 'status' }
      if (action === 'check' || action === 'runbook') return { cmd: 'bands', action }
      return err('Usage: /sdlc bands [status | check | runbook]')
    }
    case 'worktree':
    case 'wt':
      return /^[\w./-]{1,60}$/.test(first) ? { cmd: 'worktree', name: first } : err('Name the worktree: /sdlc worktree <name> (letters, digits, - _ . /)')
    case 'audit':
    case 'export':
      return { cmd: 'audit' }
    case 'reload':
    case 'refresh':
      return { cmd: 'reload' }
    default:
      return err(`Unknown command "${head}". /sdlc help lists what exists.`)
  }
}

/** Commands anyone (even a plugin or the model) may run: they read, or only write derived files. */
export function isReadOnly(cmd: Parsed): boolean {
  switch (cmd.cmd) {
    case 'open':
    case 'status':
    case 'help':
    case 'worktree':
    case 'audit':
    case 'reload':
    case 'error':
      return true
    case 'plays':
      return cmd.action === 'list'
    case 'guards':
      return cmd.toggle === undefined
    case 'bands':
      return cmd.action !== 'runbook'
    default:
      return false
  }
}

/** The origin kinds that are a person: Enter at the prompt, the Remote Control bridge, the SDK host. */
export function isHumanOrigin(kind: string): boolean {
  return kind === 'composer' || kind === 'bridge' || kind === 'sdk'
}
