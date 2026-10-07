// A best-effort shell reader for the guards: splits a Bash command into simple commands
// (quotes, operators, redirects, heredocs, $(...) and bash -c are followed) so guards can
// reason about programs and arguments instead of grepping raw text. Paths and branches
// live in guards-writes.ts. Deterministic and pure; obfuscation (base64, inline
// interpreters) is out of reach by design.

export type Redirect = { op: string; target: string }

export type ShellCommand = {
  /** Every word as typed, dequoted; assignments and wrappers included. */
  words: string[]
  /** Words minus env assignments, reserved words and wrappers (sudo, env, time…); argv[0] is the program. */
  argv: string[]
  /** Basename of argv[0], '' for a bare redirect or assignment. */
  program: string
  redirects: Redirect[]
  heredocs: string[]
  /** Commands joined by `|` share an id. */
  pipeline: number
  /** words joined, whitespace-normalised: what regex patterns are tested against. */
  text: string
}

type RawCmd = { words: string[]; redirects: Redirect[]; heredocs: string[]; pipeline: number }

const MAX_DEPTH = 4
const MAX_COMMANDS = 400

function matchParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src.charAt(i)
    if (c === '\\') i++
    else if (c === "'") {
      const j = src.indexOf("'", i + 1)
      if (j < 0) return -1
      i = j
    } else if (c === '"') {
      let j = i + 1
      while (j < src.length && src.charAt(j) !== '"') j += src.charAt(j) === '\\' ? 2 : 1
      if (j >= src.length) return -1
      i = j
    } else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function ansiC(raw: string): string {
  return raw.replace(/\\(?:x([0-9a-fA-F]{1,2})|u([0-9a-fA-F]{1,4})|([0-7]{1,3})|(.))/g, (_m, x, u, o, c) => {
    if (x) return String.fromCharCode(Number.parseInt(x, 16))
    if (u) return String.fromCharCode(Number.parseInt(u, 16))
    if (o) return String.fromCharCode(Number.parseInt(o, 8))
    return c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c
  })
}

function scan(src: string, depth: number, ids: { pipeline: number }): RawCmd[] {
  const cmds: RawCmd[] = []
  if (depth > MAX_DEPTH) return cmds
  const n = src.length
  let pipeline = ids.pipeline
  const fresh = (): RawCmd => ({ words: [], redirects: [], heredocs: [], pipeline })
  let cur = fresh()
  let word = ''
  let inWord = false
  let redir: string | null = null
  let heredoc: { strip: boolean } | null = null
  let pending: { cmd: RawCmd; delim: string; strip: boolean }[] = []
  let lastPipe = false
  let i = 0

  const endWord = (): void => {
    if (!inWord) return
    const w = word
    word = ''
    inWord = false
    if (heredoc) {
      pending.push({ cmd: cur, delim: w, strip: heredoc.strip })
      heredoc = null
    } else if (redir !== null) {
      cur.redirects.push({ op: redir, target: w })
      redir = null
    } else cur.words.push(w)
    lastPipe = false
  }
  const flush = (newPipeline: boolean): void => {
    endWord()
    redir = null
    heredoc = null
    if (cur.words.length > 0 || cur.redirects.length > 0) cmds.push(cur)
    if (newPipeline) pipeline = ++ids.pipeline
    cur = fresh()
    lastPipe = false
  }
  const pipe = (): void => {
    endWord()
    redir = null
    heredoc = null
    if (cur.words.length > 0 || cur.redirects.length > 0) cmds.push(cur)
    cur = fresh()
    lastPipe = true
  }
  /** src[open] is '('; analyses what is inside as commands of their own, returns the index after ')'. */
  const substitute = (open: number): number => {
    const close = matchParen(src, open)
    const inner = src.slice(open + 1, close < 0 ? n : close)
    cmds.push(...scan(inner, depth + 1, ids))
    return close < 0 ? n : close + 1
  }
  const backtick = (open: number): number => {
    let j = open + 1
    while (j < n && src.charAt(j) !== '`') j += src.charAt(j) === '\\' ? 2 : 1
    cmds.push(...scan(src.slice(open + 1, Math.min(j, n)), depth + 1, ids))
    return Math.min(j + 1, n)
  }
  const readHeredocs = (from: number): number => {
    let pos = from
    for (const h of pending) {
      const lines: string[] = []
      while (pos < n) {
        const nl = src.indexOf('\n', pos)
        const end = nl < 0 ? n : nl
        const line = src.slice(pos, end).replace(/\r$/, '')
        pos = nl < 0 ? n : nl + 1
        if ((h.strip ? line.replace(/^\t+/, '') : line) === h.delim) break
        lines.push(line)
      }
      h.cmd.heredocs.push(lines.join('\n'))
    }
    pending = []
    return pos
  }

  while (i < n && cmds.length <= MAX_COMMANDS) {
    const c = src.charAt(i)
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord()
      i++
    } else if (c === '\n') {
      endWord()
      if (!(lastPipe && cur.words.length === 0 && cur.redirects.length === 0)) flush(true)
      i++
      if (pending.length > 0) i = readHeredocs(i)
    } else if (c === '\\') {
      const next = src.charAt(i + 1)
      if (next !== '\n' && i + 1 < n) {
        word += next
        inWord = true
      }
      i += 2
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1)
      word += src.slice(i + 1, j < 0 ? n : j)
      inWord = true
      i = j < 0 ? n : j + 1
    } else if (c === '"') {
      inWord = true
      i++
      while (i < n && src.charAt(i) !== '"') {
        const d = src.charAt(i)
        if (d === '\\') {
          const e = src.charAt(i + 1)
          word += '$`"\\'.includes(e) && e !== '' ? e : e === '\n' ? '' : `\\${e}`
          i += 2
        } else if (d === '$' && src.charAt(i + 1) === '(' && src.charAt(i + 2) !== '(') {
          const s = i
          i = substitute(i + 1)
          word += src.slice(s, i)
        } else if (d === '`') {
          const s = i
          i = backtick(i)
          word += src.slice(s, i)
        } else {
          word += d
          i++
        }
      }
      i++
    } else if (c === '$') {
      const next = src.charAt(i + 1)
      inWord = true
      if (next === '(') {
        const s = i
        if (src.charAt(i + 2) === '(') {
          const close = matchParen(src, i + 1)
          i = close < 0 ? n : close + 1
        } else i = substitute(i + 1)
        word += src.slice(s, i)
      } else if (next === '{') {
        const close = src.indexOf('}', i + 2)
        const end = close < 0 ? n : close + 1
        word += src.slice(i, end)
        i = end
      } else if (next === "'") {
        let j = i + 2
        while (j < n && src.charAt(j) !== "'") j += src.charAt(j) === '\\' ? 2 : 1
        word += ansiC(src.slice(i + 2, Math.min(j, n)))
        i = Math.min(j + 1, n)
      } else {
        word += '$'
        i++
      }
    } else if (c === '`') {
      const s = i
      inWord = true
      i = backtick(i)
      word += src.slice(s, i)
    } else if (c === '#' && !inWord) {
      while (i < n && src.charAt(i) !== '\n') i++
    } else if (c === ';') {
      flush(true)
      i++
    } else if (c === '|') {
      if (src.charAt(i + 1) === '|') {
        flush(true)
        i += 2
      } else {
        pipe()
        i += src.charAt(i + 1) === '&' ? 2 : 1
      }
    } else if (c === '&') {
      if (src.charAt(i + 1) === '&') {
        flush(true)
        i += 2
      } else if (src.charAt(i + 1) === '>') {
        endWord()
        redir = src.charAt(i + 2) === '>' ? '&>>' : '&>'
        i += redir.length
      } else {
        flush(true)
        i++
      }
    } else if (c === '(' || c === ')') {
      flush(true)
      i++
    } else if (c === '>' || c === '<') {
      if (inWord && /^\d+$/.test(word)) {
        word = ''
        inWord = false
      } else endWord()
      if (src.charAt(i + 1) === '(') {
        const s = i
        i = substitute(i + 1)
        word += src.slice(s, i)
        inWord = true
        continue
      }
      let op = c
      if (c === '>') {
        if (src.charAt(i + 1) === '>') op = '>>'
        else if (src.charAt(i + 1) === '|') op = '>|'
        else if (src.charAt(i + 1) === '&') op = '>&'
      } else if (src.startsWith('<<<', i)) op = '<<<'
      else if (src.startsWith('<<-', i)) op = '<<-'
      else if (src.startsWith('<<', i)) op = '<<'
      else if (src.charAt(i + 1) === '&') op = '<&'
      else if (src.charAt(i + 1) === '>') op = '<>'
      i += op.length
      if (op === '<<' || op === '<<-') heredoc = { strip: op === '<<-' }
      else if (op === '>&' || op === '<&') {
        // `2>&1` duplicates a descriptor; `>&file` writes the file
        const dup = /^[ \t]*(?:\d+-?|-)(?=[\s;&|<>)]|$)/.exec(src.slice(i))
        if (dup) i += dup[0].length
        else redir = op === '>&' ? '>' : '<'
      } else redir = op
    } else {
      word += c
      inWord = true
      i++
    }
  }
  flush(false)
  return cmds
}

const RESERVED = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'until', 'esac', '!', '{', '}', 'time'])
export const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh', 'ash'])

/** Wrapper programs and the options of theirs that take a separate argument. */
const WRAPPERS: Record<string, string[]> = {
  sudo: ['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-T', '-U'],
  doas: ['-u', '-C'],
  env: ['-u', '-C'],
  nohup: [],
  nice: ['-n'],
  ionice: ['-c', '-n', '-p'],
  timeout: ['-s', '-k'],
  stdbuf: ['-i', '-o', '-e'],
  exec: ['-a'],
  builtin: [],
  command: [],
  xargs: ['-I', '-n', '-P', '-L', '-d', '-E', '-s', '-a'],
  setsid: [],
  caffeinate: ['-t'],
  unbuffer: [],
}

export function basename(w: string): string {
  const t = w.replace(/\/+$/, '')
  return t.slice(t.lastIndexOf('/') + 1)
}

function commandArgv(words: string[]): string[] {
  let i = 0
  for (let round = 0; round < 16; round++) {
    while (i < words.length && (RESERVED.has(words[i] ?? '') || ASSIGNMENT.test(words[i] ?? ''))) i++
    const w = words[i]
    if (w === undefined) return []
    const name = basename(w)
    const flagsWithArg = WRAPPERS[name]
    if (flagsWithArg === undefined) return words.slice(i)
    // `command -v x` only looks a program up
    if (name === 'command' && /^-[vV]/.test(words[i + 1] ?? '')) return words.slice(i)
    i++
    while (i < words.length && (words[i] ?? '').startsWith('-') && words[i] !== '-') {
      const flag = words[i] ?? ''
      i++
      if (flag === '--') break
      if (flagsWithArg.includes(flag)) i++
    }
    if (name === 'timeout') i++
  }
  return words.slice(i)
}

function shellScript(argv: string[]): string | null {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i] ?? ''
    if (!a.startsWith('-')) return null
    if (/^-[a-zA-Z]*c[a-zA-Z]*$/.test(a)) return argv[i + 1] ?? null
  }
  return null
}

function build(c: RawCmd): ShellCommand {
  const argv = commandArgv(c.words)
  return {
    words: c.words,
    argv,
    program: basename(argv[0] ?? ''),
    redirects: c.redirects,
    heredocs: c.heredocs,
    pipeline: c.pipeline,
    text: c.words.join(' ').replace(/\s+/g, ' ').trim(),
  }
}

export function analyzeBash(command: string): ShellCommand[] {
  const out: ShellCommand[] = []
  const expand = (c: RawCmd, depth: number): void => {
    if (out.length > MAX_COMMANDS) return
    const cmd = build(c)
    out.push(cmd)
    if (depth >= MAX_DEPTH) return
    const nest = (script: string): void => {
      for (const inner of scan(script, depth + 1, { pipeline: c.pipeline + 1000 })) {
        expand({ ...inner, pipeline: c.pipeline }, depth + 1)
      }
    }
    if (SHELLS.has(cmd.program)) {
      const script = shellScript(cmd.argv)
      if (script !== null) nest(script)
      else for (const body of cmd.heredocs) nest(body)
    } else if (cmd.program === 'eval') nest(cmd.argv.slice(1).join(' '))
    else if (cmd.program === 'find') {
      for (let i = 1; i < cmd.argv.length; i++) {
        if (!/^-(?:exec|execdir|ok|okdir)$/.test(cmd.argv[i] ?? '')) continue
        const group: string[] = []
        for (i++; i < cmd.argv.length && cmd.argv[i] !== ';' && cmd.argv[i] !== '+'; i++) group.push(cmd.argv[i] ?? '')
        expand({ words: group, redirects: [], heredocs: [], pipeline: c.pipeline }, depth + 1)
      }
    }
  }
  for (const c of scan(command, 0, { pipeline: 0 })) expand(c, 0)
  return out
}

// ---------------------------------------------------------------------------
// Which commands merely carry text (so a phrase inside them is not an action)
// ---------------------------------------------------------------------------

const INERT_PROGRAMS = new Set(
  (
    'echo printf cat bat head tail less more grep egrep fgrep rg ag ack ls ll la tree stat file wc diff cmp cd pushd popd pwd which ' +
    'type whereis man help vim vi nvim nano emacs code subl open cp mv rm touch mkdir rmdir ln chmod chown tee sed sort uniq cut tr ' +
    'tar zip unzip gzip gunzip bzip2 xz true false test [ export unset alias read sleep date whoami id basename dirname realpath ' +
    'readlink jq yq column nl fold xxd od shasum md5sum sha1sum sha256sum cksum du df ps printenv truncate install unlink shred rev ' +
    'tac comm paste join split'
  ).split(' '),
)
const INERT_GIT = new Set(
  (
    'commit log show diff status add blame grep tag notes stash branch checkout switch restore reset merge cherry-pick revert fetch ' +
    'pull clone remote config describe shortlog ls-files ls-tree rev-parse rev-list show-ref worktree init mv rm apply am ' +
    'format-patch reflog clean archive bundle gc fsck cat-file diff-tree name-rev merge-base'
  ).split(' '),
)
const INERT_GH = new Set(
  'pr issue repo gist search browse label status release auth config alias extension project ssh-key gpg-key'.split(' '),
)
const GIT_ARG_OPTIONS = ['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env']

export function gitSubcommand(argv: string[]): { sub: string; args: string[] } {
  let i = 1
  while (i < argv.length && (argv[i] ?? '').startsWith('-')) i += GIT_ARG_OPTIONS.includes(argv[i] ?? '') ? 2 : 1
  return { sub: argv[i] ?? '', args: argv.slice(i + 1) }
}

/** The programs whose arguments are text or file names, never commands to run (echo, git commit, gh pr create, vim…). */
export function isInert(cmd: ShellCommand): boolean {
  if (cmd.program === '') return true
  if (cmd.program === 'git') return INERT_GIT.has(gitSubcommand(cmd.argv).sub)
  if (cmd.program === 'gh') return INERT_GH.has(cmd.argv.slice(1).find(a => !a.startsWith('-')) ?? '')
  return INERT_PROGRAMS.has(cmd.program)
}

/** The text a SQL client would receive: arguments, heredoc bodies, here-strings. */
export function sqlText(cmd: ShellCommand): string {
  const hereStrings = cmd.redirects.filter(r => r.op === '<<<').map(r => r.target)
  return [cmd.text, ...cmd.heredocs, ...hereStrings].join('\n')
}

export function compilePattern(source: string, flags: string): RegExp | null {
  const insensitive = source.startsWith('(?i)')
  try {
    return new RegExp(insensitive ? source.slice(4) : source, insensitive && !flags.includes('i') ? `${flags}i` : flags)
  } catch {
    return null
  }
}
