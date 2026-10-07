// What a Bash command writes, touches and merges (built on guards-bash.ts): written paths
// for protect-paths / plan-first / test-lock, touched paths for the credential shield, and the
// push / merge / approve checks of separation-of-duties. Best effort and pure.

import { ASSIGNMENT, analyzeBash, gitSubcommand, type ShellCommand } from './guards-bash'
import { matchesAny } from './guards-paths'

// ---------------------------------------------------------------------------
// Written and touched paths
// ---------------------------------------------------------------------------

export type WriteKind = 'write' | 'remove' | 'touch'
export type Write = { path: string; kind: WriteKind }

const WRITE_OPS = new Set(['>', '>>', '>|', '&>', '&>>', '<>'])
const DEV_TARGET = /^\/dev\/(?:null|stdout|stderr|stdin|tty|zero|full|random|urandom|fd\/\d+)$/
const HOME_WORD = /^(?:~|\$HOME|\$\{HOME\})(?:\/|$)/

function positionals(args: string[], withArg: readonly string[] = []): string[] {
  const out: string[] = []
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (literal) out.push(a)
    else if (a === '--') literal = true
    else if (a.startsWith('-') && a.length > 1) {
      if (withArg.includes(a)) i++
    } else if (a !== '') out.push(a)
  }
  return out
}

function optionValue(args: string[], short: string[], long: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? ''
    if (short.includes(a) || long.includes(a)) return args[i + 1] ?? null
    for (const l of long) if (a.startsWith(`${l}=`)) return a.slice(l.length + 1)
  }
  return null
}

function inDir(dir: string | null, p: string): string {
  return dir === null || p.startsWith('/') || HOME_WORD.test(p) || /^[A-Za-z]:[\\/]/.test(p) ? p : `${dir}/${p}`
}

/** `cd x` inside the same command line shifts what later relative paths mean. */
function nextDir(dir: string | null, args: string[]): string | null {
  const target = positionals(args)[0]
  if (target === undefined) return '~'
  if (target === '-' || target.includes('$')) return null
  return inDir(dir, target)
}

const CP_ARGS = ['-t', '-S', '--target-directory', '--suffix', '-m', '--mode', '-o', '--owner', '-g', '--group']
const RSYNC_ARGS = ['-e', '--rsh', '--exclude', '--include', '--exclude-from', '--include-from', '-f', '--filter', '--port', '--backup-dir', '--log-file', '--files-from', '--partial-dir', '--bwlimit', '--timeout']

function inPlaceFiles(program: string, args: string[]): string[] {
  const inPlace = args.some(a =>
    program === 'sed' ? /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place') : /^-[a-zA-Z]*i/.test(a),
  )
  if (!inPlace) return []
  const scriptFlags = program === 'sed' ? ['-e', '-f', '--expression', '--file'] : ['-e', '-E']
  const scripted = args.some(a => scriptFlags.includes(a) || a.startsWith('--expression=') || a.startsWith('--file='))
  const pos = positionals(args, [...scriptFlags, ...(program === 'sed' ? ['-l', '--line-length'] : ['-I'])])
  return scripted ? pos : pos.slice(1)
}

/** Every path a command line writes, removes or touches, in order (best effort). */
export function bashWrites(cmds: ShellCommand[]): Write[] {
  const out: Write[] = []
  let dir: string | null = null
  const add = (p: string | null | undefined, kind: WriteKind): void => {
    if (p) out.push({ path: inDir(dir, p), kind })
  }
  for (const cmd of cmds) {
    for (const r of cmd.redirects) if (WRITE_OPS.has(r.op) && r.target !== '' && !DEV_TARGET.test(r.target)) add(r.target, 'write')
    const a = cmd.argv.slice(1)
    switch (cmd.program) {
      case 'cd':
      case 'pushd':
        dir = nextDir(dir, a)
        break
      case 'tee':
        for (const p of positionals(a)) add(p, 'write')
        break
      case 'sed':
      case 'perl':
        for (const p of inPlaceFiles(cmd.program, a)) add(p, 'write')
        break
      case 'cp':
      case 'install':
      case 'rsync': {
        if (cmd.program === 'install' && a.includes('-d')) {
          for (const p of positionals(a, CP_ARGS)) add(p, 'touch')
          break
        }
        const pos = positionals(a, cmd.program === 'rsync' ? RSYNC_ARGS : CP_ARGS)
        add(optionValue(a, ['-t'], ['--target-directory']) ?? (pos.length >= 2 ? pos[pos.length - 1] : null), 'write')
        break
      }
      case 'mv': {
        const pos = positionals(a, CP_ARGS)
        const target = optionValue(a, ['-t'], ['--target-directory'])
        for (const p of target === null ? pos.slice(0, -1) : pos) add(p, 'remove')
        add(target ?? (pos.length >= 2 ? pos[pos.length - 1] : null), 'write')
        break
      }
      case 'rm':
      case 'unlink':
      case 'rmdir':
      case 'shred':
        for (const p of positionals(a)) add(p, 'remove')
        break
      case 'touch':
        for (const p of positionals(a, ['-d', '-t', '-r', '--date', '--reference', '--time'])) add(p, 'touch')
        break
      case 'mkdir':
        for (const p of positionals(a, ['-m', '--mode', '-Z', '--context'])) add(p, 'touch')
        break
      case 'truncate':
        for (const p of positionals(a, ['-s', '--size', '-r', '--reference'])) add(p, 'write')
        break
      case 'dd':
        for (const w of a) if (w.startsWith('of=')) add(w.slice(3), 'write')
        break
      case 'ln': {
        const pos = positionals(a, ['-t', '-S', '--target-directory', '--suffix'])
        if (pos.length >= 2) add(pos[pos.length - 1], 'write')
        break
      }
      case 'curl':
        add(optionValue(a, ['-o'], ['--output']), 'write')
        break
      case 'wget':
        add(optionValue(a, ['-O'], ['--output-document']), 'write')
        add(optionValue(a, ['-P'], ['--directory-prefix']), 'write')
        break
      case 'find':
        if (a.includes('-delete')) {
          const starts = a.findIndex(w => w.startsWith('-') || w === '(' || w === '!')
          for (const p of starts < 0 ? a : a.slice(0, starts)) add(p, 'remove')
        }
        break
      case 'git': {
        const { sub, args } = gitSubcommand(cmd.argv)
        if (sub === 'rm') for (const p of positionals(args)) add(p, 'remove')
        if (sub === 'mv') {
          const pos = positionals(args)
          for (const p of pos.slice(0, -1)) add(p, 'remove')
          add(pos[pos.length - 1], 'write')
        }
        break
      }
      default:
    }
  }
  return out
}

export function bashWrittenPaths(command: string): string[] {
  return [...new Set(bashWrites(analyzeBash(command)).map(w => w.path))]
}

const PATTERN_PROGRAMS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack'])
const SCRIPT_PROGRAMS = new Set(['sed', 'awk', 'gawk', 'jq', 'yq'])

/** Arguments that name files (not search patterns, scripts or messages), for the credential shield. */
export function touchedPaths(cmds: ShellCommand[]): string[] {
  const out: string[] = []
  let dir: string | null = null
  for (const cmd of cmds) {
    for (const r of cmd.redirects) if (r.op !== '<<<' && r.target !== '') out.push(inDir(dir, r.target))
    for (const w of cmd.words) if (ASSIGNMENT.test(w)) out.push(inDir(dir, w.slice(w.indexOf('=') + 1)))
    const p = cmd.program
    let args = cmd.argv.slice(1)
    if (p === 'cd' || p === 'pushd') {
      out.push(...positionals(args).map(x => inDir(dir, x)))
      dir = nextDir(dir, args)
      continue
    }
    if (p === 'echo' || p === 'printf') continue
    if (PATTERN_PROGRAMS.has(p) || SCRIPT_PROGRAMS.has(p)) {
      const explicit = args.some(a => a === '-e' || a === '-f' || a === '--regexp' || a === '--file')
      const kept: string[] = []
      let dropped = explicit
      for (let i = 0; i < args.length; i++) {
        const a = args[i] ?? ''
        if (a === '-e' || a === '--regexp') i++
        else if (!a.startsWith('-') && !dropped) dropped = true
        else kept.push(a)
      }
      args = kept
    } else if (p === 'find') {
      const first = args.findIndex(w => w.startsWith('-') || w === '(' || w === '!')
      args = first < 0 ? args : args.slice(0, first)
    } else if (p === 'git') {
      args = args.filter((x, i) => args[i - 1] !== '-m' && args[i - 1] !== '--message' && x !== '-m')
    }
    for (const a of args) {
      if (a.startsWith('-')) {
        const eq = a.indexOf('=')
        if (eq > 0) out.push(inDir(dir, a.slice(eq + 1)))
      } else if (a !== '') out.push(inDir(dir, a))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Separation of duties: pushes to protected branches, merging, approving
// ---------------------------------------------------------------------------

const PUSH_ARG_FLAGS = ['-o', '--push-option', '--receive-pack', '--exec', '--repo']
const GH_ARG_FLAGS = ['-R', '--repo', '-H', '--hostname', '-X', '--method', '-f', '-F', '--field', '--raw-field', '-q', '--jq', '-t', '--template', '--input', '--cache', '-b', '--body', '-B', '--base', '-s', '--subject', '-A', '--author-email']

function pushViolation(args: string[], protectedBranches: string[]): string | null {
  const flags = args.filter(a => a.startsWith('-'))
  if (flags.includes('--all') || flags.includes('--mirror')) return 'pushes every branch, protected ones included'
  const pos = positionals(args, PUSH_ARG_FLAGS)
  for (const spec of pos.slice(1)) {
    const dst = (spec.replace(/^\+/, '').split(':').pop() ?? '').replace(/^refs\/heads\//, '')
    if (dst !== '' && matchesAny(dst, protectedBranches)) return `pushes to the protected branch "${dst}"`
  }
  return null
}

function hostingViolation(program: string, argv: string[], protectedBranches: string[]): string | null {
  const args = argv.slice(1)
  const pos = positionals(args, GH_ARG_FLAGS)
  const sub = pos[0]
  const sub2 = pos[1]
  if (program === 'glab' && sub === 'mr' && (sub2 === 'merge' || sub2 === 'approve')) return `${sub2 === 'merge' ? 'merges' : 'approves'} a merge request`
  if (program !== 'gh') return null
  if (sub === 'pr' && sub2 === 'merge') return 'merges a pull request'
  if (sub === 'pr' && sub2 === 'review' && args.some(a => a === '--approve' || a === '-a')) return 'approves a pull request'
  if (sub !== 'api' || sub2 === undefined) return null
  if (/\/(?:pulls\/\d+\/merge|merges)(?:[/?]|$)/.test(sub2)) return 'merges through the GitHub API'
  if (/\/pulls\/\d+\/reviews/.test(sub2) && args.some(a => /event=APPROVE/i.test(a))) return 'approves a pull request through the GitHub API'
  const ref = /\/git\/refs\/heads\/(.+)$/.exec(sub2)
  const method = (optionValue(args, ['-X'], ['--method']) ?? (args.some(a => a === '-f' || a === '-F') ? 'POST' : 'GET')).toUpperCase()
  if (ref?.[1] && method !== 'GET' && matchesAny(ref[1], protectedBranches)) return `rewrites the protected branch "${ref[1]}" through the GitHub API`
  return null
}

/** The command that merges, approves or pushes to a protected branch, and why; null when none does. */
export function separationViolation(cmds: ShellCommand[], protectedBranches: string[]): { text: string; reason: string } | null {
  for (const cmd of cmds) {
    let reason: string | null = null
    if (cmd.program === 'git') {
      const { sub, args } = gitSubcommand(cmd.argv)
      if (sub === 'push') reason = pushViolation(args, protectedBranches)
    } else if (cmd.program === 'gh' || cmd.program === 'glab') reason = hostingViolation(cmd.program, cmd.argv, protectedBranches)
    if (reason !== null) return { text: cmd.text, reason }
  }
  return null
}

