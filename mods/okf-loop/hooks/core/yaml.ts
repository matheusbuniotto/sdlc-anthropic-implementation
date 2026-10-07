// A YAML subset (SPEC §4.1): front-matter, block maps and sequences, scalars,
// flow collections and block scalars. Hand-rolled because the engine has no
// dependencies. It never throws: garbage yields undefined / {}.

type Line = { indent: number; text: string; raw: string; blank: boolean }
type Rec = Record<string, unknown>

const MAX_DEPTH = 48
// `---` … `---` (or `...`) at the very start; the inner group is absent for an empty block.
const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function toLines(src: string): Line[] {
  return src.replace(/\r\n?/g, '\n').split('\n').map(line => {
    const raw = line.replace(/^\t+/, tabs => '  '.repeat(tabs.length))
    const rest = raw.trimStart()
    return { indent: raw.length - rest.length, text: rest.trimEnd(), raw, blank: rest.trim() === '' }
  })
}

function setKey(obj: Rec, key: string, value: unknown): void {
  // plain assignment to `__proto__` would swap the prototype instead of adding a key
  if (key === '__proto__') Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true })
  else obj[key] = value
}

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isSeqLine(text: string): boolean {
  return text === '-' || text.startsWith('- ') || text.startsWith('-\t')
}

const ESCAPES: Record<string, string> = {
  n: '\n', t: '\t', r: '\r', '0': '\0', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v',
  ' ': ' ', '"': '"', '/': '/', '\\': '\\', N: '\u0085', _: ' ', L: ' ', P: ' ',
}

function codePoint(hex: string): string {
  const n = Number.parseInt(hex, 16)
  try {
    return Number.isNaN(n) ? '' : String.fromCodePoint(n)
  } catch {
    return ''
  }
}

/** Reads a quoted scalar that starts at s[start]; null when it never closes. */
function readQuoted(s: string, start: number): { value: string; end: number } | null {
  const q = s.charAt(start)
  let out = ''
  let i = start + 1
  while (i < s.length) {
    const c = s.charAt(i)
    if (q === "'") {
      if (c === "'") {
        if (s.charAt(i + 1) !== "'") return { value: out, end: i + 1 }
        out += "'"
        i += 2
        continue
      }
    } else if (c === '"') {
      return { value: out, end: i + 1 }
    } else if (c === '\\') {
      const n = s.charAt(i + 1)
      const width = n === 'x' ? 2 : n === 'u' ? 4 : n === 'U' ? 8 : 0
      if (width > 0) {
        out += codePoint(s.slice(i + 2, i + 2 + width))
        i += 2 + width
      } else {
        out += ESCAPES[n] ?? n
        i += 2
      }
      continue
    }
    out += c
    i++
  }
  return null
}

const QUOTE_OPENERS = /[\s[{,:]/

/** Drops a trailing ` # comment`, leaving `#` inside quotes alone. */
function stripComment(s: string): string {
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) {
        if (quote === "'" && s.charAt(i + 1) === "'") i++
        else quote = ''
      }
    } else if ((c === '"' || c === "'") && (i === 0 || QUOTE_OPENERS.test(s.charAt(i - 1)))) {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(s.charAt(i - 1)))) {
      return s.slice(0, i).trimEnd()
    }
  }
  return s.trimEnd()
}

/** `[`/`{` depth left open by s, outside quotes. */
function openBrackets(s: string): number {
  let depth = 0
  let quote = ''
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i)
    if (quote) {
      if (c === '\\' && quote === '"') i++
      else if (c === quote) quote = ''
    } else if ((c === '"' || c === "'") && (i === 0 || QUOTE_OPENERS.test(s.charAt(i - 1)))) {
      quote = c
    } else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
  }
  return depth
}

function resolvePlain(s: string): unknown {
  if (s === '' || s === '~' || /^(?:null|Null|NULL)$/.test(s)) return null
  if (/^(?:true|True|TRUE)$/.test(s)) return true
  if (/^(?:false|False|FALSE)$/.test(s)) return false
  // "007" and "1.0.0" are identifiers, not numbers
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s) && !/^[-+]?0\d/.test(s)) {
    const n = Number(s)
    if (Number.isFinite(n)) return n
  }
  return s
}

function splitKey(text: string): { key: string; rest: string } | null {
  if (isSeqLine(text)) return null
  const first = text.charAt(0)
  if (first === '"' || first === "'") {
    const q = readQuoted(text, 0)
    if (!q) return null
    const after = text.slice(q.end)
    const m = /^[ \t]*:(?:[ \t]+|$)/.exec(after)
    return m ? { key: q.value, rest: after.slice(m[0].length) } : null
  }
  if ('[{|>#'.includes(first)) return null
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (c === '#' && i > 0 && /\s/.test(text.charAt(i - 1))) return null
    if (c === ':' && (i + 1 === text.length || /\s/.test(text.charAt(i + 1)))) {
      const key = text.slice(0, i).trimEnd()
      return key ? { key, rest: text.slice(i + 1) } : null
    }
  }
  return null
}

function parseFlow(src: string): unknown {
  let i = 0
  const skip = (): void => {
    while (i < src.length && /\s/.test(src.charAt(i))) i++
  }
  const scalar = (stops: string): unknown => {
    skip()
    const c = src.charAt(i)
    if (c === '"' || c === "'") {
      const q = readQuoted(src, i)
      if (q) {
        i = q.end
        return q.value
      }
    }
    const start = i
    while (i < src.length && !stops.includes(src.charAt(i))) i++
    return resolvePlain(src.slice(start, i).trim())
  }
  const node = (depth: number): unknown => {
    skip()
    const c = src.charAt(i)
    if (depth > MAX_DEPTH) return null
    if (c === '[') {
      i++
      const arr: unknown[] = []
      for (;;) {
        skip()
        const d = src.charAt(i)
        if (i >= src.length) break
        if (d === ']') {
          i++
          break
        }
        if (d === ',') {
          i++
          continue
        }
        const before = i
        const v = node(depth + 1)
        if (i === before) i++
        else arr.push(v)
      }
      return arr
    }
    if (c === '{') {
      i++
      const obj: Rec = {}
      for (;;) {
        skip()
        const d = src.charAt(i)
        if (i >= src.length) break
        if (d === '}') {
          i++
          break
        }
        if (d === ',') {
          i++
          continue
        }
        const before = i
        const key = scalar(':,}')
        skip()
        let v: unknown = null
        if (src.charAt(i) === ':') {
          i++
          v = node(depth + 1)
        }
        if (i === before) i++
        else setKey(obj, String(key), v)
      }
      return obj
    }
    return scalar(',]}')
  }
  return node(0)
}

function parseLines(lines: Line[]): unknown {
  let pos = 0

  /** The next line that carries content; blank and comment lines are skipped. */
  const significant = (): Line | undefined => {
    while (pos < lines.length) {
      const l = lines[pos]
      if (!l) break
      if (!l.blank && !l.text.startsWith('#')) return l
      pos++
    }
    return undefined
  }

  const blockScalar = (header: string, parentIndent: number): string => {
    const chomp = header.includes('-') ? 'strip' : header.includes('+') ? 'keep' : 'clip'
    const digit = /\d/.exec(header)
    let blockIndent = digit ? Math.max(parentIndent, 0) + Number(digit[0]) : -1
    const body: string[] = []
    let i = pos
    while (i < lines.length) {
      const l = lines[i]
      if (!l) break
      if (l.blank) {
        body.push('')
        i++
        continue
      }
      if (blockIndent < 0) {
        if (l.indent <= parentIndent) break
        blockIndent = l.indent
      }
      if (l.indent < blockIndent) break
      body.push(l.raw.slice(blockIndent))
      i++
    }
    pos = i
    let trailing = 0
    while (body.length > 0 && body[body.length - 1] === '') {
      body.pop()
      trailing++
    }
    let text: string
    if (header.startsWith('|')) text = body.join('\n')
    else {
      text = ''
      let pending = 0
      let prev: 'text' | 'more' | null = null
      for (const l of body) {
        if (l === '') {
          pending++
          continue
        }
        const kind = /^[ \t]/.test(l) ? 'more' : 'text'
        if (prev === null) text = '\n'.repeat(pending) + l
        else {
          const breaks = prev === 'more' || kind === 'more' ? pending + 1 : pending
          text += (breaks === 0 ? ' ' : '\n'.repeat(breaks)) + l
        }
        pending = 0
        prev = kind
      }
    }
    if (chomp === 'strip') return text
    if (chomp === 'keep') return text + '\n'.repeat(text === '' ? trailing : trailing + 1)
    return text === '' ? '' : text + '\n'
  }

  /** The value that follows `key:` or `- ` (rest = the text after it), consuming continuation lines. */
  const value = (rest0: string, keyIndent: number, kind: 'map' | 'seq', depth: number): unknown => {
    const rest = stripComment(rest0.trim())
    if (rest === '') {
      const nx = significant()
      if (!nx) return null
      if (nx.indent > keyIndent) return node(keyIndent, depth + 1)
      // `key:` followed by `- a` at the key's own indent is still its sequence
      if (kind === 'map' && nx.indent === keyIndent && isSeqLine(nx.text)) return seq(keyIndent, depth + 1)
      return null
    }
    if (/^[|>][-+0-9]*$/.test(rest)) return blockScalar(rest, keyIndent)
    if (rest.startsWith('[') || rest.startsWith('{')) {
      let text = rest
      while (openBrackets(text) > 0 && pos < lines.length) {
        const l = lines[pos++]
        if (l) text += ' ' + stripComment(l.text.trim())
      }
      return parseFlow(text)
    }
    if (rest.startsWith('"') || rest.startsWith("'")) {
      let text = rest0.trim()
      let q = readQuoted(text, 0)
      while (!q && pos < lines.length) {
        const l = lines[pos++]
        if (l) text += l.blank ? '\n' : ' ' + l.text.trim()
        q = readQuoted(text, 0)
      }
      return q ? q.value : text.slice(1)
    }
    const parts = [rest]
    for (;;) {
      let j = pos
      while (j < lines.length && (lines[j]?.blank || lines[j]?.text.startsWith('#'))) j++
      const l = lines[j]
      if (!l || l.indent <= keyIndent) break
      parts.push(stripComment(l.text))
      pos = j + 1
    }
    return resolvePlain(parts.join(' '))
  }

  const seq = (indent: number, depth: number): unknown[] => {
    const out: unknown[] = []
    for (;;) {
      const l = significant()
      if (!l || l.indent !== indent || !isSeqLine(l.text)) break
      const before = pos
      const afterDash = l.text.slice(1)
      const rest = afterDash.trimStart()
      const itemIndent = indent + 1 + (afterDash.length - rest.length)
      const body = stripComment(rest)
      if (body === '') {
        pos++
        const nx = significant()
        out.push(nx && nx.indent > indent ? node(indent, depth + 1) : null)
      } else if (isSeqLine(body) || splitKey(body)) {
        // `- key: v` / `- - x`: the item is a nested block that starts mid-line
        lines[pos] = { indent: itemIndent, text: rest.trimEnd(), raw: ' '.repeat(itemIndent) + rest, blank: false }
        out.push(node(indent, depth + 1))
      } else {
        pos++
        out.push(value(rest, indent, 'seq', depth + 1))
      }
      if (pos === before) pos++
    }
    return out
  }

  const map = (indent: number, depth: number): Rec => {
    const out: Rec = {}
    for (;;) {
      const l = significant()
      if (!l) break
      if (l.indent > indent) {
        pos++
        continue
      }
      if (l.indent < indent) break
      const kv = splitKey(l.text)
      if (!kv) break
      pos++
      setKey(out, kv.key, value(kv.rest, indent, 'map', depth + 1))
    }
    return out
  }

  const node = (parentIndent: number, depth: number): unknown => {
    const l = significant()
    if (!l || l.indent <= parentIndent || depth > MAX_DEPTH) return null
    if (isSeqLine(l.text)) return seq(l.indent, depth)
    if (splitKey(l.text)) return map(l.indent, depth)
    pos++
    return value(l.text, parentIndent, 'seq', depth)
  }

  return node(-1, 0)
}

function parseDocument(src: string): unknown {
  let lines = toLines(src)
  let start = 0
  // directives and the document start marker
  while (start < lines.length) {
    const l = lines[start]
    if (!l) break
    if (l.blank || l.text.startsWith('#') || l.text.startsWith('%') || l.text === '---') start++
    else break
  }
  lines = lines.slice(start)
  const end = lines.findIndex(l => l.indent === 0 && (l.text === '---' || l.text === '...'))
  if (end >= 0) lines = lines.slice(0, end)
  if (lines.every(l => l.blank || l.text.startsWith('#'))) return undefined
  return parseLines(lines)
}

/** Splits `---` front-matter off the top of a text; null when there is none. */
function splitFrontmatter(text: string): { inner: string; length: number } | null {
  const m = FRONTMATTER.exec(text)
  return m ? { inner: m[1] ?? '', length: m[0].length } : null
}

export function parseYaml(text: string): unknown {
  try {
    const t = stripBom(text)
    const fm = splitFrontmatter(t)
    return parseDocument(fm ? t.slice(fm.length) : t)
  } catch {
    return undefined
  }
}

export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string; hasFrontmatter: boolean } {
  const t = stripBom(typeof text === 'string' ? text : '')
  try {
    const fm = splitFrontmatter(t)
    if (!fm) return { data: {}, body: t, hasFrontmatter: false }
    if (fm.inner.trim() === '') return { data: {}, body: t.slice(fm.length), hasFrontmatter: true }
    const parsed = parseDocument(fm.inner)
    // two horizontal rules around prose are not front-matter
    if (isRecord(parsed)) return { data: parsed, body: t.slice(fm.length), hasFrontmatter: true }
  } catch {
    // fall through: treated as no front-matter
  }
  return { data: {}, body: t, hasFrontmatter: false }
}

export function stripFrontmatter(text: string): string {
  return parseFrontmatter(text).body
}
