// One visual language for every view: glyphs and colours per state, chips, and
// the cell-width-aware text helpers. Pure: no engine, no clock (time is a parameter).

import type {
  ArtifactStatus,
  AutopilotView,
  LedgerKind,
  Mode,
  RunSnapshot,
  StageId,
  StageState,
  Tier,
  ViewModel,
} from '../../types'

// ---------------------------------------------------------------------------
// Colours: theme keys where the person's theme has one, raw names otherwise.
// ---------------------------------------------------------------------------

export const C = {
  ok: 'success',
  active: 'cyan',
  human: 'warning',
  bad: 'error',
  dim: 'inactive',
  info: 'ide',
  accent: 'claude',
  border: 'subtle',
  onChip: 'inverseText',
} as const

export type Style = {
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

/** A piece of a line: plain text, or text with a style. */
export type Seg = string | (Style & { t: string })

export const dim = (t: string): Seg => ({ t, dimColor: true })
export const col = (t: string, color: string): Seg => ({ t, color })
export const strong = (t: string, color?: string): Seg => (color ? { t, bold: true, color } : { t, bold: true })
/** A filled label: `inverseText` on a colour. Never interactive (Buttons are the pressables). */
export const chip = (text: string, bg: string): Seg => ({ t: ` ${text} `, backgroundColor: bg, color: C.onChip, bold: true })

// ---------------------------------------------------------------------------
// Stage, artifact, tier and health vocabulary
// ---------------------------------------------------------------------------

const STAGE_GLYPH: Record<StageState, string> = {
  done: '✔',
  active: '●',
  'awaiting-human': '◆',
  blocked: '✖',
  pending: '○',
  monitoring: '◌',
}

const STAGE_COLOR: Record<StageState, string> = {
  done: C.ok,
  active: C.active,
  'awaiting-human': C.human,
  blocked: C.bad,
  pending: C.dim,
  monitoring: C.info,
}

const STAGE_WORD: Record<StageState, string> = {
  done: 'done',
  active: 'in progress',
  'awaiting-human': 'awaits you',
  blocked: 'blocked',
  pending: 'waiting',
  monitoring: 'watching',
}

export const stageGlyph = (state: StageState): string => STAGE_GLYPH[state]
export const stageColor = (state: StageState): string => STAGE_COLOR[state]
export const stageWord = (state: StageState): string => STAGE_WORD[state]

export const NUMERALS = ['①', '②', '③', '④', '⑤', '⑥'] as const
export const numeral = (n: number): string => NUMERALS[n - 1] ?? String(n)

export const STAGE_ORDER: readonly StageId[] = ['plan', 'design', 'build', 'test', 'deploy', 'maintain']

export function statusGlyph(status: ArtifactStatus): string {
  switch (status) {
    case 'approved':
    case 'accepted':
    case 'complete':
      return '✔'
    case 'in-progress':
      return '●'
    case 'under-review':
      return '◆'
    case 'draft':
      return '◐'
    case 'rejected':
    case 'unknown':
      return '✖'
    default:
      return '○'
  }
}

export function statusColor(status: ArtifactStatus): string {
  switch (status) {
    case 'approved':
    case 'accepted':
    case 'complete':
      return C.ok
    case 'in-progress':
    case 'draft':
      return C.active
    case 'under-review':
      return C.human
    case 'rejected':
    case 'unknown':
      return C.bad
    default:
      return C.dim
  }
}

export function tierColor(tier: Tier): string {
  switch (tier) {
    case '3sigma':
      return C.bad
    case '2sigma':
      return C.human
    case '1sigma':
      return C.info
    default:
      return C.ok
  }
}

export const tierLabel = (tier: Tier): string =>
  tier === '3sigma' ? '3σ' : tier === '2sigma' ? '2σ' : tier === '1sigma' ? '1σ' : 'in control'

export const tierGlyph = (tier: Tier): string =>
  tier === '3sigma' || tier === '2sigma' ? '▲' : tier === '1sigma' ? '△' : '✔'

export function metricColor(status: 'good' | 'warn' | 'bad' | 'n/a'): string {
  return status === 'good' ? C.ok : status === 'warn' ? C.human : status === 'bad' ? C.bad : C.dim
}

export function healthChip(health: RunSnapshot['health']): { text: string; color: string } {
  if (health === 'blocked') return { text: '✖ blocked', color: C.bad }
  if (health === 'attention') return { text: '◆ needs you', color: C.human }
  return { text: '● on track', color: C.ok }
}

// ---------------------------------------------------------------------------
// Modes, autopilot, release grant
// ---------------------------------------------------------------------------

export const MODES: readonly Mode[] = ['manual', 'guided', 'semi']

export const modeLabel = (mode: Mode): string => (mode === 'semi' ? 'semi-auto' : mode)

export const nextMode = (mode: Mode): Mode => MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'manual'

export function autopilotChip(ap: AutopilotView): { text: string; color: string } {
  const used = Math.max(0, ap.budgetMax - ap.budgetLeft)
  switch (ap.state) {
    case 'running':
      return { text: `▶ running ${used}/${ap.budgetMax}`, color: C.active }
    case 'paused':
      return { text: '⏸ paused', color: C.human }
    case 'human-gate':
    case 'needs-human':
      return { text: '■ human gate', color: C.human }
    case 'budget':
      return { text: `■ budget ${used}/${ap.budgetMax}`, color: C.bad }
    case 'blocked-streak':
      return { text: '■ blocked streak', color: C.bad }
    case 'verify-fail-streak':
      return { text: '■ verify failing', color: C.bad }
    case 'guided':
      return { text: '◇ guided', color: C.info }
    case 'done':
      return { text: '✔ done', color: C.ok }
    case 'manual':
      return { text: 'manual', color: C.dim }
    default:
      return { text: 'idle', color: C.dim }
  }
}

export function releaseChip(release: ViewModel['release'], now: number): { text: string; color: string; open: boolean } {
  if (release.grantUntil !== null && release.grantUntil > now) {
    return { text: `🔓 release grant ${dur(release.grantUntil - now)}`, color: C.human, open: true }
  }
  if (release.envToken) return { text: '🔓 release token', color: C.human, open: true }
  return { text: '🔒 prod locked', color: C.dim, open: false }
}

// ---------------------------------------------------------------------------
// Ledger vocabulary
// ---------------------------------------------------------------------------

const LEDGER_ICON: Record<LedgerKind, string> = {
  'run.created': '+',
  'stage.entered': '▸',
  'artifact.written': '✎',
  'gate.opened': '◆',
  'gate.approved': '✔',
  'gate.rejected': '✖',
  'guard.blocked': '⊘',
  'proof.pass': '✔',
  'proof.fail': '✖',
  'autopilot.queued': '▶',
  'autopilot.halted': '■',
  'release.granted': '◈',
  'release.revoked': '◇',
  'band.sample': '·',
  'band.breach': '▲',
  'incident.intent': '⟲',
  'play.toggled': '◐',
  'config.changed': '≡',
  'scaffold.created': '+',
  'lesson.recorded': '✎',
  'agent.verdict': '§',
}

export const ledgerIcon = (kind: LedgerKind): string => LEDGER_ICON[kind] ?? '·'

export function ledgerColor(kind: LedgerKind): string {
  switch (kind) {
    case 'gate.approved':
    case 'proof.pass':
    case 'release.granted':
      return C.ok
    case 'gate.rejected':
    case 'guard.blocked':
    case 'proof.fail':
    case 'band.breach':
      return C.bad
    case 'gate.opened':
    case 'autopilot.halted':
    case 'incident.intent':
      return C.human
    case 'autopilot.queued':
      return C.active
    default:
      return C.dim
  }
}

// ---------------------------------------------------------------------------
// Text helpers. Widths are terminal cells (wide emoji count 2, marks 0).
// ---------------------------------------------------------------------------

function cellWidth(code: number): number {
  if (code === 0x200d || code === 0xfe0f || (code >= 0x300 && code <= 0x36f)) return 0
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2
  }
  return 1
}

export function cells(text: string): number {
  let n = 0
  for (const ch of text) n += cellWidth(ch.codePointAt(0) ?? 0)
  return n
}

/** Cut to `width` cells, ending in `…` when something was dropped. */
export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  if (cells(text) <= width) return text
  let out = ''
  let used = 0
  for (const ch of text) {
    const w = cellWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    out += ch
    used += w
  }
  return out + '…'
}

/** Like `clip` but keeps the tail: the file name of a long path. */
export function clipStart(text: string, width: number): string {
  if (width <= 0) return ''
  if (cells(text) <= width) return text
  const chars = [...text]
  let out = ''
  let used = 0
  for (let i = chars.length - 1; i >= 0; i--) {
    const ch = chars[i] ?? ''
    const w = cellWidth(ch.codePointAt(0) ?? 0)
    if (used + w > width - 1) break
    out = ch + out
    used += w
  }
  return '…' + out
}

export function pad(text: string, width: number, align: 'left' | 'right' = 'left'): string {
  const body = clip(text, width)
  const fill = ' '.repeat(Math.max(0, width - cells(body)))
  return align === 'left' ? body + fill : fill + body
}

/** Word-wrap to `width` cells; the last line is ellipsised when `maxLines` cuts the text. */
export function wrapText(text: string, width: number, maxLines = Infinity): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let rest = word
    while (cells(rest) > w) {
      if (line) {
        lines.push(line)
        line = ''
      }
      let head = ''
      let used = 0
      for (const ch of rest) {
        const cw = cellWidth(ch.codePointAt(0) ?? 0)
        if (used + cw > w) break
        head += ch
        used += cw
      }
      if (!head) head = [...rest][0] ?? rest.slice(0, 1)
      lines.push(head)
      rest = rest.slice(head.length)
    }
    if (!line) line = rest
    else if (cells(line) + 1 + cells(rest) <= w) line += ' ' + rest
    else {
      lines.push(line)
      line = rest
    }
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = clip((kept[maxLines - 1] ?? '') + ' …', w)
    return kept
  }
  return lines
}

export function bar(progress: number, width: number): string {
  const w = Math.max(0, width)
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0))
  const filled = Math.round(p * w)
  return '█'.repeat(filled) + '░'.repeat(w - filled)
}

const SPARK = '▁▂▃▄▅▆▇█'

/** The newest `width` values as block characters; a flat series is drawn mid-height. */
export function spark(values: number[], width = 16): string {
  const v = values.slice(-Math.max(1, width))
  if (v.length === 0) return ''
  const lo = Math.min(...v)
  const hi = Math.max(...v)
  return v
    .map(x => {
      if (hi === lo) return SPARK[3] ?? '▄'
      return SPARK[Math.min(7, Math.floor(((x - lo) / (hi - lo)) * 8))] ?? '▄'
    })
    .join('')
}

/** "42s", "7m", "1h 12m", "2d 3h". */
export function dur(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  const d = Math.floor(h / 24)
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`
}

/** "just now", "4m ago". */
export function ago(ms: number, now: number): string {
  const d = now - ms
  return d < 5000 ? 'just now' : `${dur(d)} ago`
}

const two = (n: number): string => String(n).padStart(2, '0')

export const hhmm = (ts: number): string => {
  const d = new Date(ts)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

export function dayLabel(ts: number, now: number): string {
  const d = new Date(ts)
  const n = new Date(now)
  const day = (x: Date): number => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

/** "Play 07: Hooks as Build-Time Guardrails" -> "Hooks as Build-Time Guardrails" (the number is drawn on its own). */
export const playTitle = (title: string): string => title.replace(/^\s*Play\s*\d+\s*[:.\-–—]\s*/i, '')

export const pad2 = (n: number): string => two(n)

export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`
