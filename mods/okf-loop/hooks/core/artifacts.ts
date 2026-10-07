// The committed artifacts as data: parse and lint intent/spec/plan/proof/review
// text, plan files and drift. Pure: text in, facts out. Formats are the contract
// in docs/SPEC.md §5.6 and §8. Status rewriting lives in artifact-text.ts and the
// renderers in artifacts-render.ts; both are re-exported here.

import type { ArtifactDoc, ArtifactKind, LintIssue, LoopConfig } from '../../types'
import { type Line, STATUS_VOCAB, norm, readStatus, scan, sectionBody, sectionMatches, sectionNames, statusIndex } from './artifact-text'
import { globToRegExp } from './guards'

export { readStatus, sectionNames, setArtifactStatus } from './artifact-text'
export { appendTwiceRule, renderArtifact, renderScaffold } from './artifacts-render'

export const REQUIRED_SECTIONS: Record<'intent' | 'spec' | 'plan', string[]> = {
  intent: ['Problem', 'Proposed Outcome', 'Affected Users and Systems', 'Constraints', 'Open Questions'],
  spec: [
    'Executive Summary & Scope',
    'Requirements & Functional Contracts',
    'Technical Architecture & Interfaces',
    'Policy Compliance Matrix',
    'Flagged Areas of Concern',
    'Sign-off & Progression',
  ],
  plan: ['Files That Change', 'Order of Work', 'Risks & Mitigations', 'Proof of Correctness'],
}

// ---------------------------------------------------------------------------
// Placeholders, checklists, flagged concerns
// ---------------------------------------------------------------------------

const PLACEHOLDER_START =
  /^(?:e\.g\.?\s|YYYY|Describe\b|Brief\b|Explicitly\b|Link or Path\b|Description of\b|Edge case\b|State diagrams\b|Open Question \d|Short Descriptive\b|Feature Name\b|Task \/ Feature\b|Full Name\b|Department\b|intent\.md \/ spec\.md|TBD\b|TODO\b)/i
const PLACEHOLDER_WORD = /^(?:Name|Date|Title)$/
const STATUS_CHOICES = /\b(?:draft|under-review|approved|accepted|in-progress|complete)\b\s*\|/

function isPlaceholderText(inner: string): boolean {
  return PLACEHOLDER_START.test(inner) || PLACEHOLDER_WORD.test(inner) || STATUS_CHOICES.test(inner)
}

/** Bracketed template slots on one line; links, `[[wiki]]` links, checkboxes and reference definitions are not slots. */
function bracketSlots(line: string): string[] {
  const found: string[] = []
  for (let i = line.indexOf('['); i >= 0; i = line.indexOf('[', i + 1)) {
    if (line[i - 1] === '[' || line[i + 1] === '[') continue
    const close = line.indexOf(']', i + 1)
    if (close !== -1 && (line[close + 1] === '(' || line[close + 1] === ':')) continue
    const inner = (close === -1 ? line.slice(i + 1) : line.slice(i + 1, close)).trim()
    if (inner !== '' && isPlaceholderText(inner)) found.push(`[${inner}]`)
  }
  return found
}

/** Template text still in the body. Code spans, fences and the spec's sign-off block (the human fills it) are not scanned. */
function findPlaceholders(lines: Line[], kind: ArtifactKind): string[] {
  const skip = new Set<Line>()
  if (kind === 'spec') for (const l of sectionBody(lines, 'Sign-off & Progression') ?? []) skip.add(l)
  const found: string[] = []
  for (const l of lines) {
    if (l.fenced || skip.has(l)) continue
    if (/\[feature-name\]/.test(l.text)) found.push('[feature-name]')
    if (/Highlight areas where requirements conflict/.test(l.text)) found.push('Highlight areas where requirements conflict…')
    found.push(...bracketSlots(l.text.replace(/`[^`]*`/g, '')))
  }
  return found
}

const CHECKBOX = /^\s*(?:[-*+]|\d+[.)])\s+\[([ xX])\](?:\s|$)/

function checklistOf(lines: Line[]): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const l of lines) {
    if (l.fenced) continue
    const m = CHECKBOX.exec(l.text)
    if (!m) continue
    total++
    if (m[1] !== ' ') done++
  }
  return { done, total }
}

/** Entries under "Flagged Areas of Concern": list items and bold-led lines, blockquote or not; resolved `[x]` items and "None" do not count. */
export function flaggedConcernCount(specText: string): number {
  const body = sectionBody(scan(specText), 'Flagged Areas of Concern') ?? []
  let count = 0
  for (const l of body) {
    const t = l.text.replace(/^\s*(?:>\s*)*/, '')
    const item = /^(?:\d+[.)]|[-*+])\s+(.*)$/.exec(t)
    const content = item ? (item[1] ?? '') : /^\*\*[^*]+\*\*/.test(t) ? t : ''
    if (content === '' || /^\[[xX]\]/.test(content)) continue
    if (/^(?:none|n\/a|no (?:flagged )?concerns?)\b[.!]?$/i.test(content.trim())) continue
    count++
  }
  return count
}

// ---------------------------------------------------------------------------
// Plan: files and drift
// ---------------------------------------------------------------------------

const BARE_FILES = ['Makefile', 'Dockerfile', 'Gemfile', 'Procfile', 'LICENSE', 'Jenkinsfile']

function looksLikePath(s: string): boolean {
  if (s === '' || /\s/.test(s) || s.length > 200) return false
  return /[/.*]/.test(s) || BARE_FILES.includes(s)
}

const cleanPath = (s: string): string =>
  s
    .trim()
    .replace(/^[`'"]+|[`'":,;]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')

/** Paths of one "Files That Change" entry: leading backticked paths ("`a.ts`, `b.ts` (new)") or the first plain token. */
function pathsOfEntry(content: string): string[] {
  const c = content.replace(/^\[[ xX]\]\s*/, '').replace(/^\*\*(.+?)\*\*/, '$1')
  const out: string[] = []
  let rest = c.trim()
  for (;;) {
    const m = /^`([^`]+)`\s*(?:,|\+|&|and\b|\/)?\s*/.exec(rest)
    if (!m) break
    const p = cleanPath(m[1] ?? '')
    if (looksLikePath(p)) out.push(p)
    rest = rest.slice(m[0].length)
  }
  if (out.length > 0) return out
  const token = cleanPath(rest.split(/\s+/)[0] ?? '')
  if (looksLikePath(token)) return [token]
  const quoted = cleanPath(/`([^`]+)`/.exec(rest)?.[1] ?? '')
  return looksLikePath(quoted) ? [quoted] : []
}

/** Repo-relative paths listed under "Files That Change", annotations like "(new)" removed. */
export function planFiles(planText: string): string[] {
  const body = sectionBody(scan(planText), 'Files That Change') ?? []
  const out: string[] = []
  const add = (p: string) => {
    if (!out.includes(p)) out.push(p)
  }
  for (const l of body) {
    const row = /^\s*\|(.*)\|\s*$/.exec(l.text)
    if (row) {
      const cell = /`([^`]+)`/.exec(row[1] ?? '')
      const p = cell ? cleanPath(cell[1] ?? '') : ''
      if (looksLikePath(p) && !/^[-: |]+$/.test(row[1] ?? '')) add(p)
      continue
    }
    const item = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(l.text)
    if (item) pathsOfEntry(item[1] ?? '').forEach(add)
    else if (l.fenced && !/^\s*(```|~~~)/.test(l.text)) pathsOfEntry(l.text.replace(/^\s*[-*+]\s+/, '')).forEach(add)
  }
  return out
}

const normPath = (p: string): string => p.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/')

function covers(planned: string, edited: string): boolean {
  if (planned === '') return false
  if (planned === edited) return true
  if (/[*?[]/.test(planned)) return globToRegExp(planned).test(edited)
  return edited.startsWith(planned.endsWith('/') ? planned : `${planned}/`)
}

/** Edited files the plan does not cover. A planned directory or glob covers everything beneath it. */
export function driftFiles(edited: string[], planned: string[]): string[] {
  const plan = planned.map(normPath)
  const out: string[] = []
  for (const e of edited.map(normPath)) {
    if (e !== '' && !out.includes(e) && !plan.some((p) => covers(p, e))) out.push(e)
  }
  return out
}

// ---------------------------------------------------------------------------
// parseArtifact
// ---------------------------------------------------------------------------

const KIND_PREFIX = /^(?:Intent|Specification|Spec|Plan|Review|Proof|Lesson|Incident)\s*[:—–-]\s*/i

function titleOf(lines: Line[]): string {
  const h1 = lines.find((l) => !l.fenced && /^#\s+\S/.test(l.text))
  if (!h1) return ''
  return h1.text
    .replace(/^#\s+/, '')
    .replace(KIND_PREFIX, '')
    .replace(/\s*\(from [^)]*\)\s*$/i, '')
    .trim()
}

function emptyDoc(kind: ArtifactKind, path: string, mtimeMs: number, exists: boolean): ArtifactDoc {
  const required = (REQUIRED_SECTIONS as Partial<Record<ArtifactKind, string[]>>)[kind] ?? []
  return {
    kind,
    path,
    exists,
    status: exists ? 'unknown' : 'missing',
    title: '',
    mtimeMs,
    sections: [],
    missingSections: [...required],
    checklist: { done: 0, total: 0 },
    flaggedConcerns: 0,
    planFiles: [],
    issues: [],
  }
}

/** One committed artifact, from its text (null: no such file). Never throws. */
export function parseArtifact(
  kind: ArtifactKind,
  path: string,
  text: string | null,
  mtimeMs: number,
  cfg: Pick<LoopConfig, 'review'>,
): ArtifactDoc {
  if (text === null) return emptyDoc(kind, path, mtimeMs, false)
  const doc = emptyDoc(kind, path, mtimeMs, true)
  if (text.trim() === '') {
    doc.issues.push({ severity: 'error', code: 'empty', message: `${path} is empty.` })
    return doc
  }
  const lines = scan(text)
  const issues: LintIssue[] = doc.issues
  doc.title = titleOf(lines)
  doc.sections = sectionNames(text)

  const vocab = STATUS_VOCAB[kind]
  const at = statusIndex(lines)
  const found = readStatus(text)
  if (vocab) {
    const hint = vocab.join(' | ')
    if (at < 0) {
      issues.push({ severity: 'error', code: 'status-invalid', message: `No Status line; add "**Status:** draft" (${hint}).` })
    } else if (found === 'unknown') {
      issues.push({ severity: 'error', code: 'status-invalid', message: `The Status line is not readable; use one of: ${hint}.` })
    } else if (!vocab.includes(found)) {
      issues.push({ severity: 'error', code: 'status-invalid', message: `Status "${found}" is not valid for ${kind}; use one of: ${hint}.` })
    } else doc.status = found
  } else doc.status = found

  const required = (REQUIRED_SECTIONS as Partial<Record<ArtifactKind, string[]>>)[kind] ?? []
  doc.missingSections = required.filter((r) => !doc.sections.some((h) => sectionMatches(h, r)))
  for (const name of doc.missingSections) {
    issues.push({ severity: 'warn', code: 'missing-section', message: `Missing section "${name}".` })
  }

  if (kind === 'intent' || kind === 'incident') doc.checklist = checklistOf(sectionBody(lines, 'Open Questions') ?? [])
  else if (kind === 'spec') doc.checklist = checklistOf(sectionBody(lines, 'Sign-off & Progression') ?? [])
  else doc.checklist = checklistOf(lines)

  if (kind === 'spec') doc.flaggedConcerns = flaggedConcernCount(text)
  if (kind === 'plan') {
    doc.planFiles = planFiles(text)
    if (doc.planFiles.length === 0) {
      issues.push({ severity: 'warn', code: 'no-files', message: 'Nothing is listed under "Files That Change".' })
    }
  }

  if (kind === 'intent' || kind === 'spec' || kind === 'plan' || kind === 'incident') {
    const slots = findPlaceholders(lines, kind)
    if (kind === 'plan' && doc.planFiles.some((p) => p.startsWith('path/to/'))) slots.push('path/to/… (template example files)')
    if (slots.length > 0) {
      const shown = slots.slice(0, 3).map((s) => (s.length > 40 ? `${s.slice(0, 39)}…` : s))
      issues.push({
        severity: 'warn',
        code: 'placeholder',
        message: `Template placeholders remain (${slots.length}): ${shown.join(', ')}${slots.length > 3 ? ', …' : ''}.`,
      })
    }
  }

  if (kind === 'proof' && parseVerdict(text) === null) {
    issues.push({ severity: 'warn', code: 'no-verdict', message: 'No "### Verification Verdict: PASS|FAIL" line.' })
  }
  if (kind === 'review') issues.push(...parseReview(text, cfg).issues)
  if (kind === 'eval') {
    try {
      const data: unknown = JSON.parse(text)
      if (typeof data === 'object' && data !== null && typeof (data as { id?: unknown }).id === 'string') {
        doc.title = (data as { id: string }).id
      }
    } catch {
      issues.push({ severity: 'error', code: 'invalid-json', message: `${path} is not valid JSON.` })
    }
  }
  return doc
}

// ---------------------------------------------------------------------------
// Proof and review formats (SPEC §5.6)
// ---------------------------------------------------------------------------

function lastMatch(text: string, re: RegExp): string | null {
  let hit: string | null = null
  for (const line of text.split('\n')) {
    const m = re.exec(line)
    if (m?.[1]) hit = m[1].toUpperCase()
  }
  return hit
}

/** "### Verification Verdict: PASS": the last such line wins; the template's "[PASS | FAIL]" is not a verdict. */
export function parseVerdict(text: string): 'PASS' | 'FAIL' | null {
  const v = lastMatch(text, /^\s*(?:#{1,6}\s*|\*\*)?Verification Verdict\s*[:—-]?\s*\**\s*(PASS|FAIL)\b/i)
  return v === 'PASS' || v === 'FAIL' ? v : null
}

export function parseReview(
  text: string,
  cfg: Pick<LoopConfig, 'review'>,
): {
  passes: string[]
  importantOpen: number
  importantResolved: number
  nits: number
  nitOverflowSummarized: boolean
  verdict: 'CLEAN' | 'BLOCKED' | null
  issues: LintIssue[]
} {
  const issues: LintIssue[] = []
  const passes: string[] = []
  const configured = cfg.review.passes
  let importantOpen = 0
  let importantResolved = 0
  let nits = 0
  let nitOverflowSummarized = false

  for (const line of text.replace(/\r/g, '').split('\n')) {
    const head = /^#{2,4}\s*(.+?)\s*#*$/.exec(line)
    if (head) {
      const title = head[1] ?? ''
      const bracket = /\[([A-Za-z][\w-]*)\]/.exec(title)?.[1]
      const isPass = /^Pass\s*\d+/i.test(title) || (bracket !== undefined && configured.some((p) => p.tag === bracket))
      if (isPass) {
        const byTitle = configured.find((p) => norm(title).includes(norm(p.title)))
        const tag = bracket ?? byTitle?.tag
        if (tag === undefined) issues.push({ severity: 'warn', code: 'pass-no-tag', message: `Pass heading "${title}" has no [Tag].` })
        else if (!passes.includes(tag)) passes.push(tag)
      }
      continue
    }
    const finding = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[([ xX])\]\s*)?\*{1,2}(Important|Nit)\b/.exec(line)
    if (finding) {
      if (finding[2] === 'Nit') nits++
      else if (finding[1] === 'x' || finding[1] === 'X') importantResolved++
      else importantOpen++
      continue
    }
    if (/\b\d+\s+additional\b[^\n]*\bnits?\b/i.test(line)) nitOverflowSummarized = true
  }

  const verdictWord = lastMatch(text, /^\s*(?:#{1,6}\s*|\*\*)?Review Verdict\s*[:—-]?\s*\**\s*(CLEAN|BLOCKED)\b/i)
  const verdict = verdictWord === 'CLEAN' || verdictWord === 'BLOCKED' ? verdictWord : null

  if (passes.length === 0) issues.push({ severity: 'error', code: 'no-passes', message: 'No "### Pass N — Title [Tag]" headings found.' })
  for (const p of configured) {
    if (passes.length > 0 && !passes.includes(p.tag)) {
      issues.push({ severity: 'warn', code: 'missing-pass', message: `Pass [${p.tag}] (${p.title}) is missing.` })
    }
  }
  if (verdict === null) issues.push({ severity: 'warn', code: 'no-verdict', message: 'No "### Review Verdict: CLEAN|BLOCKED" line.' })
  if (verdict === 'CLEAN' && importantOpen > 0) {
    issues.push({ severity: 'warn', code: 'verdict-mismatch', message: `Verdict is CLEAN but ${importantOpen} Important finding(s) are still open.` })
  }
  if (verdict === 'BLOCKED' && importantOpen === 0) {
    issues.push({ severity: 'warn', code: 'verdict-mismatch', message: 'Verdict is BLOCKED but no Important finding is open.' })
  }
  if (nits > cfg.review.nitCap && !nitOverflowSummarized) {
    issues.push({ severity: 'warn', code: 'nit-cap', message: `${nits} nits exceed the cap of ${cfg.review.nitCap}; summarize the rest in one line.` })
  }
  return { passes, importantOpen, importantResolved, nits, nitOverflowSummarized, verdict, issues }
}
