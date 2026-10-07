// The audit trail: .okf/ledger.jsonl, one JSON object per line, append-only.
// Pure: the controller does the I/O. Time is always a parameter.
//
// Conventions the writer follows so the readers (describeEntry, auditMarkdown,
// metrics.ts) can rely on `data`:
//   gate.*            gate (GateId), by (person), note?, reason? (rejections), via? ('press'|'command'|'file'|'auto')
//   artifact.written  kind (ArtifactKind), path
//   guard.blocked     guard (GuardId), match?   (summary holds the denial message)
//   proof.*           command
//   autopilot.*       action? (NextActionKind), code? (halt code)
//   release.*         minutes?, until?
//   band.*            metric, tier?
//   incident.intent   metric, path
// Readers fall back to `summary` when a key is missing, so old or partial lines still render.

import type { Actor, LedgerEntry, LedgerFilter, LedgerKind, StageId } from '../../types'
import { GATE_DEFS, GATE_ORDER, STAGE_IDS, STAGE_META } from './constants'

export const DEFAULT_LEDGER_FILTER: LedgerFilter = { kinds: null, run: null, query: '' }

type Data = NonNullable<LedgerEntry['data']>

export function makeEntry(e: Omit<LedgerEntry, 'ts'>, ts: number): LedgerEntry {
  return { ...e, ts }
}

// Fixed key order keeps the file diff-friendly and greppable.
export function toLine(entry: LedgerEntry): string {
  const ordered: Record<string, unknown> = { ts: entry.ts, kind: entry.kind }
  if (entry.run !== undefined) ordered.run = entry.run
  if (entry.stage !== undefined) ordered.stage = entry.stage
  ordered.actor = entry.actor
  ordered.summary = entry.summary
  if (entry.data !== undefined) ordered.data = entry.data
  return JSON.stringify(ordered)
}

function cleanData(raw: unknown): Data | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const out: Data = {}
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v
  }
  return out
}

function toEntry(raw: unknown): LedgerEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.ts !== 'number' || !Number.isFinite(o.ts)) return null
  if (typeof o.kind !== 'string' || o.kind === '') return null
  const actor: Actor = o.actor === 'human' || o.actor === 'agent' ? o.actor : 'mod'
  // Unknown kinds are kept: a newer mod may have written them.
  const entry: LedgerEntry = { ts: o.ts, kind: o.kind as LedgerKind, actor, summary: typeof o.summary === 'string' ? o.summary : '' }
  if (typeof o.run === 'string' && o.run !== '') entry.run = o.run
  if (typeof o.stage === 'string' && (STAGE_IDS as readonly string[]).includes(o.stage)) entry.stage = o.stage as StageId
  const data = cleanData(o.data)
  if (data) entry.data = data
  return entry
}

// A torn write or a hand edit must never lose the rest of the trail.
export function parseLedger(text: string, limit?: number): LedgerEntry[] {
  const entries: LedgerEntry[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    try {
      const entry = toEntry(JSON.parse(trimmed))
      if (entry) entries.push(entry)
    } catch {
      // corrupt line: skip it
    }
  }
  if (limit === undefined || !(limit >= 0) || entries.length <= limit) return entries
  return entries.slice(entries.length - limit)
}

export function appendEntry(existing: string, entry: LedgerEntry): string {
  const base = existing === '' || existing.endsWith('\n') ? existing : `${existing}\n`
  return `${base}${toLine(entry)}\n`
}

function haystack(e: LedgerEntry): string {
  const data = e.data ? Object.values(e.data).map(String).join(' ') : ''
  return [e.summary, e.kind, e.run ?? '', e.stage ?? '', e.actor, data].join(' ').toLowerCase()
}

export function filterLedger(entries: LedgerEntry[], filter: LedgerFilter): LedgerEntry[] {
  const kinds = filter.kinds ? new Set<string>(filter.kinds) : null
  const query = filter.query.trim().toLowerCase()
  return entries.filter((e) => {
    if (kinds && !kinds.has(e.kind)) return false
    if (filter.run !== null && e.run !== filter.run) return false
    return query === '' || haystack(e).includes(query)
  })
}

const ICONS: Record<LedgerKind, string> = {
  'run.created': '◉',
  'stage.entered': '→',
  'artifact.written': '✎',
  'gate.opened': '◆',
  'gate.approved': '✔',
  'gate.rejected': '✖',
  'guard.blocked': '⚑',
  'proof.pass': '✔',
  'proof.fail': '✖',
  'autopilot.queued': '▶',
  'autopilot.halted': '■',
  'release.granted': '◇',
  'release.revoked': '◈',
  'band.sample': '∿',
  'band.breach': '▲',
  'incident.intent': '⟲',
  'play.toggled': '◐',
  'config.changed': '≡',
  'scaffold.created': '✚',
  'lesson.recorded': '❖',
  'agent.verdict': '◎',
}

export function ledgerIcon(kind: LedgerKind): string {
  return ICONS[kind] ?? '·'
}

function text(data: LedgerEntry['data'], key: string): string | null {
  const v = data?.[key]
  if (typeof v === 'string' && v.trim() !== '') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function who(e: LedgerEntry): string {
  if (e.actor === 'human') return text(e.data, 'by') ?? 'A human'
  return e.actor === 'agent' ? 'The agent' : 'The mod'
}

function sentence(raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const capped = flat.length > 200 ? `${flat.slice(0, 199)}…` : flat
  // Identifiers (verify.pass, add-login, ci_failure_rate) keep their spelling.
  const cased = /^[A-Za-z]+(\s|$)/.test(capped) ? capped.charAt(0).toUpperCase() + capped.slice(1) : capped
  return /[.!?…]$/.test(cased) ? cased : `${cased}.`
}

// Derived from `data` when the keys are there, else the writer's own summary.
function derive(e: LedgerEntry): string | null {
  const d = e.data
  const on = e.run ? ` on ${e.run}` : ''
  const gate = text(d, 'gate')
  switch (e.kind) {
    case 'run.created': {
      const title = text(d, 'title')
      return `${who(e)} started run ${e.run ?? 'a new run'}${title ? `: ${title}` : ''}`
    }
    case 'stage.entered':
      return e.stage ? `${e.run ? `Run ${e.run}` : 'The run'} entered the ${STAGE_META[e.stage].name} stage` : null
    case 'artifact.written': {
      const target = text(d, 'path') ?? (text(d, 'kind') ? `the ${text(d, 'kind')} artifact` : null)
      return target ? `${who(e)} wrote ${target}${on}` : null
    }
    case 'gate.opened':
      return gate ? `Gate ${gate} is ready for a human decision${on}` : null
    case 'gate.approved':
      if (!gate) return null
      return e.actor === 'mod' ? `Gate ${gate} passed its machine checks${on}` : `${who(e)} approved ${gate}${on}`
    case 'gate.rejected': {
      if (!gate) return null
      const reason = text(d, 'reason')
      return `${who(e)} rejected ${gate}${on}${reason ? `: ${reason}` : ''}`
    }
    case 'guard.blocked': {
      const guard = text(d, 'guard')
      return guard ? `The ${guard} guard stopped the agent${on}: ${e.summary}` : null
    }
    case 'proof.pass':
    case 'proof.fail': {
      const cmd = text(d, 'command')
      const outcome = e.kind === 'proof.pass' ? 'passed' : 'failed'
      return cmd ? `Verification command "${cmd}" ${outcome}${on}` : `A verification run ${outcome}${on}`
    }
    case 'autopilot.queued': {
      const action = text(d, 'action')
      return action ? `Autopilot queued the ${action} step${on}` : null
    }
    case 'release.granted': {
      const minutes = text(d, 'minutes')
      return `${who(e)} granted a release window${minutes ? ` of ${minutes} minutes` : ''}`
    }
    case 'release.revoked':
      return `${who(e)} revoked the release window`
    case 'band.breach': {
      const metric = text(d, 'metric')
      const tier = text(d, 'tier')
      return metric ? `Metric ${metric} breached its control band${tier ? ` (${tier})` : ''}` : null
    }
    case 'incident.intent': {
      const metric = text(d, 'metric')
      return metric ? `An incident intent was written for ${metric}` : null
    }
    default:
      return null
  }
}

export function describeEntry(entry: LedgerEntry): string {
  return sentence(derive(entry) ?? (entry.summary !== '' ? entry.summary : entry.kind))
}

// ---------------------------------------------------------------------------
// AUDIT.md: chain of custody per run, then the full log
// ---------------------------------------------------------------------------

const KIND_STAGE: Record<string, StageId> = { intent: 'plan', spec: 'design', plan: 'build', proof: 'test', review: 'deploy', incident: 'maintain', lesson: 'maintain', eval: 'test' }

function stamp(ts: number): string {
  if (!Number.isFinite(ts) || Math.abs(ts) > 8.64e15) return 'unknown time'
  return `${new Date(ts).toISOString().slice(0, 19).replace('T', ' ')} UTC`
}

function cell(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim() || '—'
}

function table(header: string[], rows: string[][]): string[] {
  return [
    `| ${header.join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ]
}

// A fast non-cryptographic checksum: it tells a reader the export matches the ledger, not that nobody forged it.
function checksum(lines: string[]): string {
  let h = 0x811c9dc5
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      h ^= line.charCodeAt(i)
      h = Math.imul(h, 0x01000193) >>> 0
    }
    h ^= 10
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

type Custody = { ts: number; stage: StageId; artifact: string; who: string; when: string; evidence: string }

function actorName(e: LedgerEntry): string {
  return e.actor === 'human' ? (text(e.data, 'by') ?? 'human') : e.actor
}

function custodyRows(entries: LedgerEntry[]): Custody[] {
  const rows: Custody[] = []
  const writes = new Map<string, { first: number; last: LedgerEntry; count: number; stage: StageId }>()
  for (const e of entries) {
    const gate = text(e.data, 'gate')
    const gateDef = GATE_ORDER.find((g) => g === gate)
    switch (e.kind) {
      case 'run.created': {
        const source = text(e.data, 'source')
        rows.push({ ts: e.ts, stage: 'plan', artifact: `run ${e.run ?? ''}`, who: actorName(e), when: stamp(e.ts), evidence: [source ? `source: ${source}` : '', text(e.data, 'title') ?? ''].filter(Boolean).join('; ') || e.summary })
        break
      }
      case 'artifact.written': {
        const kind = text(e.data, 'kind') ?? ''
        const key = text(e.data, 'path') ?? (kind || e.summary)
        const stage = e.stage ?? KIND_STAGE[kind] ?? 'build'
        const prev = writes.get(key)
        writes.set(key, { first: prev?.first ?? e.ts, last: e, count: (prev?.count ?? 0) + 1, stage })
        break
      }
      case 'gate.approved':
      case 'gate.rejected': {
        const approved = e.kind === 'gate.approved'
        const def = gateDef ? GATE_DEFS[gateDef] : null
        const path = text(e.data, 'path')
        const how = text(e.data, 'via')
        const evidence = approved
          ? [e.actor === 'mod' ? 'machine checks passed' : 'human approval', how ? `via ${how}` : '', text(e.data, 'note') ?? ''].filter(Boolean).join('; ')
          : `rejected${text(e.data, 'reason') ? `: ${text(e.data, 'reason')}` : ''}`
        rows.push({ ts: e.ts, stage: e.stage ?? def?.stage ?? 'build', artifact: [gate ?? 'gate', path ?? ''].filter(Boolean).join(' · '), who: actorName(e), when: stamp(e.ts), evidence })
        break
      }
      case 'proof.pass':
      case 'proof.fail':
        rows.push({ ts: e.ts, stage: 'test', artifact: 'proof', who: actorName(e), when: stamp(e.ts), evidence: `${text(e.data, 'command') ?? 'verification'} ${e.kind === 'proof.pass' ? 'passed' : 'FAILED'}` })
        break
      case 'release.granted':
      case 'release.revoked':
        rows.push({ ts: e.ts, stage: 'deploy', artifact: 'release grant', who: actorName(e), when: stamp(e.ts), evidence: e.kind === 'release.granted' ? `granted${text(e.data, 'minutes') ? ` for ${text(e.data, 'minutes')} min` : ''}` : 'revoked' })
        break
      case 'incident.intent':
        rows.push({ ts: e.ts, stage: 'maintain', artifact: text(e.data, 'path') ?? 'incident intent', who: actorName(e), when: stamp(e.ts), evidence: text(e.data, 'metric') ? `anomaly: ${text(e.data, 'metric')}` : e.summary })
        break
      case 'lesson.recorded':
        rows.push({ ts: e.ts, stage: 'maintain', artifact: text(e.data, 'path') ?? 'lesson', who: actorName(e), when: stamp(e.ts), evidence: e.summary })
        break
      default:
    }
  }
  for (const [key, w] of writes) {
    rows.push({ ts: w.last.ts, stage: w.stage, artifact: key, who: actorName(w.last), when: stamp(w.last.ts), evidence: w.count > 1 ? `${w.count} writes, first ${stamp(w.first)}` : '1 write' })
  }
  const order = (s: StageId) => STAGE_IDS.indexOf(s)
  return rows.sort((a, b) => order(a.stage) - order(b.stage) || a.ts - b.ts)
}

function runSection(run: string, entries: LedgerEntry[]): string[] {
  const created = entries.find((e) => e.kind === 'run.created')
  const approvals = entries.filter((e) => e.kind === 'gate.approved' && e.data?.gate !== undefined)
  const release = approvals.filter((e) => e.data?.gate === 'release.approve').pop()
  const gatesPassed = [...new Set(approvals.map((e) => String(e.data?.gate)))]
  const blocked = entries.filter((e) => e.kind === 'guard.blocked').length
  const rows = custodyRows(entries)
  const lines = [`### ${run}`, '']
  lines.push(`- Originated by: ${created ? `${actorName(created)} on ${stamp(created.ts)}` : 'not recorded in this ledger'}`)
  lines.push(`- Gates passed: ${gatesPassed.length === 0 ? 'none yet' : gatesPassed.join(', ')}`)
  lines.push(`- Release authorized by: ${release ? `${actorName(release)} on ${stamp(release.ts)}` : 'not authorized'}`)
  lines.push(`- Guard interceptions: ${blocked}`, '')
  if (rows.length === 0) return [...lines, '_No custody events recorded for this run._', '']
  const header = ['Stage', 'Artifact', 'Who', 'When (UTC)', 'Evidence']
  return [...lines, ...table(header, rows.map((r) => [STAGE_META[r.stage].name, r.artifact, r.who, r.when, r.evidence])), '']
}

export function auditMarkdown(entries: LedgerEntry[], opts: { project: string; generatedAt: number; run?: string }): string {
  const scoped = opts.run === undefined ? entries : entries.filter((e) => e.run === opts.run)
  const sorted = scoped.map((e, i) => ({ e, i })).sort((a, b) => a.e.ts - b.e.ts || a.i - b.i).map((x) => x.e)
  const log = sorted.filter((e) => e.kind !== 'band.sample')
  const omitted = sorted.length - log.length
  const out: string[] = [`# Audit trail: ${opts.project}`, '']
  out.push(`Generated ${stamp(opts.generatedAt)} · scope: ${opts.run === undefined ? 'all runs' : `run \`${opts.run}\``} · ${sorted.length} ledger entr${sorted.length === 1 ? 'y' : 'ies'}`)
  if (sorted.length > 0) out.push(`First entry ${stamp(sorted[0]?.ts ?? 0)} · last entry ${stamp(sorted[sorted.length - 1]?.ts ?? 0)}`)
  out.push('', '> Source: `.okf/ledger.jsonl`, append-only. The committed artifacts in git are the cryptographic anchor; this file adds who did what, when, and with which evidence. Separation of duties: the agent can act up to the production gate and cannot pass it.', '')

  if (sorted.length === 0) return [...out, '_No ledger entries yet._', ''].join('\n')

  const count = (kind: LedgerKind) => sorted.filter((e) => e.kind === kind).length
  out.push('## Summary', '')
  out.push(...table(['Gates approved', 'Gates rejected', 'Verifications', 'Guard interceptions', 'Release grants'], [[String(count('gate.approved')), String(count('gate.rejected')), `${count('proof.pass')} passed / ${count('proof.fail')} failed`, String(count('guard.blocked')), String(count('release.granted'))]]), '')

  out.push('## Chain of custody', '')
  const runs: string[] = []
  for (const e of sorted) if (e.run !== undefined && !runs.includes(e.run)) runs.push(e.run)
  if (runs.length === 0) out.push('_No run-scoped events._', '')
  for (const run of runs) out.push(...runSection(run, sorted.filter((e) => e.run === run)))

  out.push('## Chronological log', '')
  out.push(...table(['Time (UTC)', 'Run', 'Actor', 'Event', 'Detail'], log.map((e) => [stamp(e.ts), e.run ?? '—', actorName(e), `${ledgerIcon(e.kind)} ${e.kind}`, describeEntry(e)])), '')
  if (omitted > 0) out.push(`_${omitted} band sample${omitted === 1 ? '' : 's'} omitted from the log; see \`.okf/bands/\`._`, '')
  out.push(`Checksum of the ${sorted.length} entries above (FNV-1a 32-bit, detects accidental edits, not tampering): \`${checksum(sorted.map(toLine))}\``, '')
  return out.join('\n')
}
