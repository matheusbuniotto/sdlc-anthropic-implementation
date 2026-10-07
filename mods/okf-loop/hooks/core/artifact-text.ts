// Line-level reading of artifact markdown: fence-aware scanning, `##` sections and the
// Status line (read and rewrite). Shared by artifacts.ts and artifacts-render.ts. Pure.

import type { ArtifactKind, ArtifactStatus } from '../../types'

/** Status vocabulary per template. Kinds without a Status line (proof, review, eval, lesson) are not listed. */
export const STATUS_VOCAB: Partial<Record<ArtifactKind, ArtifactStatus[]>> = {
  intent: ['draft', 'under-review', 'approved', 'rejected'],
  spec: ['draft', 'under-review', 'approved'],
  plan: ['draft', 'accepted', 'in-progress', 'complete'],
  incident: ['draft', 'under-review', 'approved', 'rejected'],
}

// ---------------------------------------------------------------------------
// Line scanning (fence-aware)
// ---------------------------------------------------------------------------

export type Line = { raw: string; text: string; fenced: boolean }

export function scan(source: string): Line[] {
  let fence = false
  return source.split('\n').map((raw) => {
    const text = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    const edge = /^\s*(```|~~~)/.test(text)
    const fenced = fence || edge
    if (edge) fence = !fence
    return { raw, text, fenced }
  })
}

const H2 = /^##(?!#)[ \t]+(.+?)[ \t]*#*[ \t]*$/
const NUMBERING = /^\d+(?:\.\d+)*[.):]?\s+/

export function heading2(l: Line): string | null {
  if (l.fenced) return null
  const m = H2.exec(l.text)
  return m?.[1] ? m[1].replace(NUMBERING, '').trim() : null
}

export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim()

export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/** "Risks" satisfies "Risks & Mitigations": the part before "and" is accepted alone, as is a heading that continues the name. */
export function sectionMatches(heading: string, required: string): boolean {
  const h = norm(heading)
  const r = norm(required)
  const head = r.split(' and ')[0] ?? r
  return h === r || h.startsWith(`${r} `) || h === head || h.startsWith(`${head} `)
}

/** `## ` headings in order, without their numbering prefix. */
export function sectionNames(text: string): string[] {
  const out: string[] = []
  for (const l of scan(text)) {
    const h = heading2(l)
    if (h !== null) out.push(h)
  }
  return out
}

/** Lines of the first `##` section matching `name`, up to the next `##`; null when absent. */
export function sectionBody(lines: Line[], name: string): Line[] | null {
  const start = lines.findIndex((l) => {
    const h = heading2(l)
    return h !== null && sectionMatches(h, name)
  })
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (heading2(lines[i] as Line) !== null) {
      end = i
      break
    }
  }
  return lines.slice(start + 1, end)
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const STATUS_LINE = /^(\s*(?:[-*+]\s+)?(?:\*\*)?Status(?::\*\*|\*\*:|:)\s*)(.*?)(\s*)$/i

/** Index of the Status line: it lives in the header block, before the first `##`. */
export function statusIndex(lines: Line[]): number {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as Line
    if (l.fenced) continue
    if (heading2(l) !== null) return -1
    if (STATUS_LINE.test(l.text)) return i
  }
  return -1
}

function statusValue(raw: string): ArtifactStatus {
  // A list of choices is the template's placeholder, not a decision: the artifact is still a draft.
  if (raw.includes('|')) return 'draft'
  const v = raw
    .toLowerCase()
    .replace(/[`*_[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const m = /^(under[ -]review|in[ -]progress|draft|approved|rejected|accepted|completed?)\b/.exec(v)
  if (!m) return 'unknown'
  const word = (m[1] ?? '').replace(' ', '-')
  return word === 'completed' ? 'complete' : (word as ArtifactStatus)
}

export function readStatus(text: string): ArtifactStatus {
  const lines = scan(text)
  const i = statusIndex(lines)
  if (i < 0) return 'unknown'
  const m = STATUS_LINE.exec((lines[i] as Line).text)
  return statusValue(m?.[2] ?? '')
}

const FIELD_LINE = /^(?:[-*+]\s+)?(?:\*\*[^*\n]+?(?::\*\*|\*\*:)|[A-Za-z][A-Za-z /&-]{0,40}:)\s*\S/

/**
 * Rewrite the `Status:` line keeping its shape (bold label, list marker, trailing
 * double space, backticked value); insert one after the header fields when absent.
 * A status outside the kind's vocabulary leaves the text untouched.
 */
export function setArtifactStatus(text: string, kind: ArtifactKind, status: ArtifactStatus): string {
  const vocab = STATUS_VOCAB[kind]
  if (vocab ? !vocab.includes(status) : status === 'missing' || status === 'unknown') return text
  const lines = scan(text)
  const cr = text.includes('\r\n') ? '\r' : ''
  const at = statusIndex(lines)
  if (at >= 0) {
    const line = lines[at] as Line
    const m = STATUS_LINE.exec(line.text)
    if (!m) return text
    const ticks = /^`.*`$/.test(m[2] ?? '')
    lines[at] = { ...line, raw: `${m[1]}${ticks ? `\`${status}\`` : status}${m[3]}${line.raw.endsWith('\r') ? '\r' : ''}` }
    return lines.map((l) => l.raw).join('\n')
  }
  const h1 = lines.findIndex((l) => !l.fenced && /^#\s+\S/.test(l.text))
  let last = -1
  for (let i = h1 + 1; h1 >= 0 && i < lines.length; i++) {
    const l = lines[i] as Line
    if (l.text.trim() === '') {
      if (last >= 0) break
      continue
    }
    if (!FIELD_LINE.test(l.text)) break
    last = i
  }
  const sample = last >= 0 ? (lines[last] as Line).text : ''
  const plain = sample !== '' && !sample.includes('**')
  const tail = /\s{2}$/.test(sample) ? '  ' : ''
  const entry = `${plain ? 'Status: ' : '**Status:** '}${status}${tail}${cr}`
  const made: Line = { raw: entry, text: entry, fenced: false }
  if (last >= 0) lines.splice(last + 1, 0, made)
  else if (h1 >= 0) lines.splice(h1 + 1, 0, { raw: cr, text: '', fenced: false }, made)
  else lines.unshift(made, { raw: cr, text: '', fenced: false })
  return lines.map((l) => l.raw).join('\n')
}
