// Path handling for the guards: glob matching and repo-relative normalisation.
// Pure; no fs, so symlinks cannot be resolved (`..` is resolved lexically).

const MAX_BRACE_EXPANSIONS = 64
const GLOB_CACHE = new Map<string, RegExp>()
const META = /[*?[{\\]/

function escapeRe(c: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(c) ? `\\${c}` : c
}

/** `a/{b,c}/d` -> [`a/b/d`, `a/c/d`]. A brace without a comma is literal. */
function expandBraces(glob: string): string[] {
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === '\\') {
      i++
      continue
    }
    if (c !== '{') continue
    let depth = 0
    let last = i + 1
    const parts: string[] = []
    let close = -1
    for (let j = i; j < glob.length; j++) {
      const d = glob.charAt(j)
      if (d === '\\') j++
      else if (d === '{') depth++
      else if (d === '}') {
        depth--
        if (depth === 0) {
          close = j
          break
        }
      } else if (d === ',' && depth === 1) {
        parts.push(glob.slice(last, j))
        last = j + 1
      }
    }
    if (close < 0 || parts.length === 0) continue
    parts.push(glob.slice(last, close))
    const pre = glob.slice(0, i)
    const post = glob.slice(close + 1)
    return parts.flatMap(p => expandBraces(pre + p + post)).slice(0, MAX_BRACE_EXPANSIONS)
  }
  return [glob]
}

function classSource(glob: string, open: number): { src: string; end: number } | null {
  let i = open + 1
  let negate = false
  const first = glob.charAt(i)
  if (first === '!' || first === '^') {
    negate = true
    i++
  }
  let body = ''
  const start = i
  for (; i < glob.length; i++) {
    const c = glob.charAt(i)
    if (c === ']' && i > start) return { src: `[${negate ? '^/' : ''}${body}]`, end: i }
    body += c === '\\' || c === '^' || c === '[' || c === ']' ? `\\${c}` : c
  }
  return null
}

function globSource(input: string): string {
  const g = input.startsWith('./') ? input.slice(2) : input
  let src = ''
  let i = 0
  while (i < g.length) {
    const c = g.charAt(i)
    if (c === '*') {
      let j = i + 1
      while (g.charAt(j) === '*') j++
      const wholeSegment = j - i >= 2 && (i === 0 || g.charAt(i - 1) === '/')
      const next = g.charAt(j)
      if (wholeSegment && next === '/') src += '(?:.*/)?'
      else if (wholeSegment && next === '') {
        // `x/**` also matches `x` itself: removing or renaming the directory edits what is inside
        if (src.endsWith('/')) src = `${src.slice(0, -1)}(?:/.*)?`
        else src += '.*'
      } else src += '[^/]*'
      i = wholeSegment && next === '/' ? j + 1 : j
    } else if (c === '?') {
      src += '[^/]'
      i++
    } else if (c === '[') {
      const cls = classSource(g, i)
      if (cls) {
        src += cls.src
        i = cls.end + 1
      } else {
        src += '\\['
        i++
      }
    } else if (c === '\\' && i + 1 < g.length) {
      src += escapeRe(g.charAt(i + 1))
      i += 2
    } else {
      src += escapeRe(c)
      i++
    }
  }
  return src
}

/**
 * `**` spans directories, `*` and `?` stay inside one segment, `[..]` is a class, `{a,b}` alternates.
 * `**` + `/x` also matches a root-level `x`. Case-insensitive: macOS and Windows filesystems are,
 * so `Schemas/Generated` must not slip past a protected-path rule.
 */
export function globToRegExp(glob: string): RegExp {
  const cached = GLOB_CACHE.get(glob)
  if (cached) return cached
  const re = new RegExp(`^(?:${expandBraces(glob).map(globSource).join('|')})$`, 'i')
  if (GLOB_CACHE.size > 500) GLOB_CACHE.clear()
  GLOB_CACHE.set(glob, re)
  return re
}

function cleanForMatch(path: string): string {
  return path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
}

export function matchesAny(path: string, globs: string[]): boolean {
  const p = cleanForMatch(path)
  return globs.some(g => globToRegExp(g).test(p))
}

/** The first glob that matches, for messages. */
export function firstMatch(path: string, globs: string[]): string | null {
  const p = cleanForMatch(path)
  return globs.find(g => globToRegExp(g).test(p)) ?? null
}

export function isTestPath(path: string, testGlobs: string[]): boolean {
  return matchesAny(path, testGlobs)
}

function resolveSegments(path: string, absolute: boolean): string {
  const out: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
    } else out.push(seg)
  }
  return out.join('/')
}

/** Resolved absolute form (keeps a Windows drive prefix). */
function canonical(abs: string): string {
  const drive = /^[A-Za-z]:\//.test(abs) ? abs.slice(0, 2) : ''
  return `${drive}/${resolveSegments(drive ? abs.slice(2) : abs, true)}`
}

function trimTrailingSlash(p: string): string {
  return p.length > 1 ? p.replace(/\/+$/, '') : p
}

/**
 * Repo-relative, `/`-separated, `~` and `$HOME` expanded, `.`/`..` resolved.
 * Inside the repo -> relative (`.` for the root itself); outside -> absolute.
 */
export function normalizePath(path: string, cwd: string, home: string): string {
  let p = path.trim().replace(/\\/g, '/')
  const homeDir = trimTrailingSlash(home.replace(/\\/g, '/'))
  if (homeDir) p = p.replace(/^(?:~|\$HOME|\$\{HOME\})(?=\/|$)/, homeDir)
  const base = trimTrailingSlash(cwd.replace(/\\/g, '/'))
  const baseAbsolute = base.startsWith('/') || /^[A-Za-z]:\//.test(base)
  const pathAbsolute = p.startsWith('/') || /^[A-Za-z]:\//.test(p)
  if (!pathAbsolute && !baseAbsolute) return resolveSegments(p, false) || '.'
  const joined = pathAbsolute ? p : `${base}/${p}`
  const resolved = trimTrailingSlash(canonical(joined))
  if (!baseAbsolute) return resolved
  const root = trimTrailingSlash(canonical(base))
  const rl = resolved.toLowerCase()
  const bl = root.toLowerCase()
  if (rl === bl) return '.'
  const prefix = bl === '/' ? '/' : `${bl}/`
  return rl.startsWith(prefix) ? resolved.slice(prefix.length) : resolved
}

export type PathCtx = { cwd: string; home: string }

/** Absolute twin of a normalised path (so `~/.ssh/**` can match when the repo lives inside $HOME). */
function toAbsolute(rel: string, cwd: string): string {
  if (rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)) return rel
  const base = trimTrailingSlash(cwd.replace(/\\/g, '/'))
  return rel === '.' ? base : `${base}/${rel}`
}

/** Globs with `~` expanded, each paired with the glob as configured (for messages). */
function expandHomeGlobs(globs: string[], home: string): { x: string; o: string }[] {
  const h = trimTrailingSlash(home.replace(/\\/g, '/'))
  return globs
    .filter(g => h !== '' || !g.startsWith('~'))
    .map(g => ({ x: g === '~' || g.startsWith('~/') ? h + g.slice(1) : g, o: g }))
}

/** Leading literal directories of each glob: what a wildcard or a removal could touch. */
function literalPrefixes(globs: string[]): string[] {
  const out: string[] = []
  for (const glob of globs.flatMap(expandBraces)) {
    const segs = (glob.startsWith('./') ? glob.slice(2) : glob).split('/')
    const literal: string[] = []
    for (const s of segs) {
      if (META.test(s)) break
      literal.push(s)
    }
    const joined = literal.join('/')
    if (joined) out.push(joined)
  }
  return out
}

const WILDCARD = /[*?[]/

export type PathHit = { glob: string; via: 'path' | 'wildcard' | 'ancestor' }

/**
 * Does `raw` (as typed in a tool call or shell word) fall under any glob?
 * `removal`: deleting or renaming an ancestor directory of a protected path also counts.
 * A shell wildcard in `raw` counts when it could expand onto a protected literal path.
 */
export function pathHit(raw: string, globs: string[], ctx: PathCtx, removal = false): PathHit | null {
  if (globs.length === 0) return null
  const rel = normalizePath(raw, ctx.cwd, ctx.home)
  const abs = toAbsolute(rel, ctx.cwd)
  const pairs = expandHomeGlobs(globs, ctx.home)
  const expanded = pairs.map(p => p.x)
  const original = (x: string): string => pairs.find(p => p.x === x)?.o ?? x
  for (const v of rel === abs ? [rel] : [rel, abs]) {
    const g = firstMatch(v, expanded)
    if (g !== null) return { glob: original(g), via: 'path' }
  }
  const prefixes = literalPrefixes(expanded)
  if (WILDCARD.test(raw)) {
    const sample = rel.replace(/\[[^\]]*\]|[*?]/g, 'x')
    const g = firstMatch(sample, expanded) ?? firstMatch(toAbsolute(sample, ctx.cwd), expanded)
    if (g !== null) return { glob: original(g), via: 'wildcard' }
    const re = globToRegExp(rel)
    const dot = rel.startsWith('.')
    // a shell `*` never expands onto dotfiles
    const target = prefixes.find(p => re.test(p) && (dot || !p.startsWith('.')))
    if (target !== undefined) return { glob: target, via: 'wildcard' }
  }
  if (removal) {
    const cwd = toAbsolute('.', ctx.cwd).toLowerCase()
    const covers = rel === '.' || cwd === abs.toLowerCase() || cwd.startsWith(`${abs.toLowerCase()}/`)
    const target = prefixes.find(p => covers || p === rel || p.startsWith(`${rel}/`) || abs === p || p.startsWith(`${abs}/`))
    if (target !== undefined) return { glob: target, via: 'ancestor' }
  }
  return null
}
