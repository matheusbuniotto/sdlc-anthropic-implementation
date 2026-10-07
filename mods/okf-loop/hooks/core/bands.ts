// bands.yaml (templates/bands.template.yaml): parsing, metric extraction, sampling and the
// Stage-1 intent the watcher writes when a band is breached (closing the loop). Pure.

import type { BandReading, BandSource, BandSpec, Tier } from '../../types'
import { parseYaml } from './yaml'

type Rec = Record<string, unknown>

const DEFAULT_DIAGNOSE_TOOLS = ['Read', 'Grep', 'Bash(gh run view *)', 'Bash(gh pr list *)']

function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown, fallback: string): string {
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return fallback
}

/** A YAML list, or the comma string Play 13 shows (`"Read,Grep,Bash(gh run view *)"`; commas inside parentheses stay). */
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(x => str(x, '')).filter(x => x !== '')
  if (typeof v !== 'string') return []
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const c of v) {
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    if (c === ',' && depth === 0) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out.map(x => x.trim()).filter(x => x !== '')
}

function tierEntry(tiers: unknown, n: 1 | 2 | 3): Rec {
  if (!isRecord(tiers)) return {}
  for (const [key, value] of Object.entries(tiers)) {
    const k = key.toLowerCase().replace(/[^a-z0-9σ]/g, '')
    if (isRecord(value) && (k === `${n}sigma` || k === `sigma${n}` || k === `tier${n}` || k === `${n}σ`)) return value
  }
  return {}
}

export function parseBandsYaml(text: string): BandSpec | null {
  const doc = parseYaml(text)
  if (!isRecord(doc)) return null
  const metric = str(doc.metric, '')
  if (metric === '') return null
  const t1 = tierEntry(doc.tiers, 1)
  const t2 = tierEntry(doc.tiers, 2)
  const t3 = tierEntry(doc.tiers, 3)
  const esc = isRecord(t3.escalation) ? t3.escalation : {}
  return {
    metric,
    description: str(doc.description, ''),
    baseline: str(doc.baseline, 'rolling_30d'),
    interval: str(doc.interval, '1h'),
    rules: str(doc.rules, '').toLowerCase() === 'simple' ? 'simple' : 'western_electric',
    tiers: {
      '1sigma': { action: str(t1.action, 'log'), notify: t1.notify === true || t1.notify === 'true' },
      '2sigma': {
        action: str(t2.action, 'diagnose'),
        tools: list(t2.tools),
        outputFormat: str(t2.output_format, 'intent_markdown'),
        destination: str(t2.destination, 'intent/incident-${DATE}.md'),
      },
      '3sigma': {
        action: str(t3.action, 'propose'),
        routes: list(t3.routes),
        escalation: { channel: str(esc.channel, ''), priority: str(esc.priority, '') },
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Reading a metric off a command's stdout
// ---------------------------------------------------------------------------

function toNumber(s: string): number | null {
  const t = s.trim().replace(/%$/, '').trim()
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function lastLine(s: string): string {
  const lines = s.split(/\r?\n/).filter(l => l.trim() !== '')
  return lines[lines.length - 1] ?? ''
}

function parseJson(s: string): { ok: true; value: unknown } | { ok: false } {
  for (const candidate of [s.trim(), lastLine(s)]) {
    try {
      return { ok: true, value: JSON.parse(candidate) as unknown }
    } catch {
      // try the next candidate
    }
  }
  return { ok: false }
}

/** `number`: the output is a number (or its last line is). `json:a.b.0.c`: a number at that path of the JSON output. */
export function extractMetric(stdout: string, parse: string): number | null {
  const mode = parse.trim()
  if (mode.toLowerCase() === 'number') return toNumber(stdout) ?? toNumber(lastLine(stdout))
  if (!/^json:/i.test(mode)) return null
  const parsed = parseJson(stdout)
  if (!parsed.ok) return null
  let node: unknown = parsed.value
  for (const seg of mode.slice(5).split('.').filter(s => s !== '')) {
    if (Array.isArray(node)) node = /^\d+$/.test(seg) ? node[Number(seg)] : undefined
    else if (isRecord(node) && Object.prototype.hasOwnProperty.call(node, seg)) node = node[seg]
    else return null
  }
  if (typeof node === 'number') return Number.isFinite(node) ? node : null
  return typeof node === 'string' ? toNumber(node) : null
}

/** Sources whose interval has elapsed since their last check (never checked: due). */
export function dueSources(sources: BandSource[], lastCheckedAt: Record<string, number>, now: number): BandSource[] {
  return sources.filter(s => {
    const last = lastCheckedAt[s.metric]
    if (last === undefined) return true
    const minutes = Number.isFinite(s.intervalMinutes) ? Math.max(1, s.intervalMinutes) : 60
    return now - last >= minutes * 60_000
  })
}

// ---------------------------------------------------------------------------
// .okf/bands/<metric>.jsonl
// ---------------------------------------------------------------------------

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  return typeof v === 'string' ? toNumber(v) : null
}

/** Tolerates blank and corrupt lines; oldest first, the newest `limit` kept. */
export function parseSamples(jsonl: string, limit?: number): { at: number; value: number }[] {
  const out: { at: number; value: number }[] = []
  for (const line of jsonl.split(/\r?\n/)) {
    if (line.trim() === '') continue
    try {
      const o = JSON.parse(line) as unknown
      const at = isRecord(o) ? num(o.at) : null
      const value = isRecord(o) ? num(o.value) : null
      if (at !== null && value !== null) out.push({ at, value })
    } catch {
      // a half-written line is not a sample
    }
  }
  out.sort((a, b) => a.at - b.at)
  return limit !== undefined && limit >= 1 && out.length > limit ? out.slice(-Math.floor(limit)) : out
}

/** One JSON line, no trailing newline (the writer appends it). */
export function sampleLine(at: number, value: number): string {
  return JSON.stringify({ at, value: Number.isFinite(value) ? value : null })
}

// ---------------------------------------------------------------------------
// Breach -> intent
// ---------------------------------------------------------------------------

function kebab(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

export function incidentSlug(metric: string, date: string): string {
  const head = `incident-${date}`
  const tail = kebab(metric).slice(0, Math.max(0, 48 - head.length - 1)).replace(/-+$/, '')
  return tail === '' ? head : `${head}-${tail}`
}

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])

/** The tools the 2σ diagnosis may use: bands.yaml's list, stripped of anything that can write, else the template's. */
export function diagnoseToolList(spec: BandSpec | null): string[] {
  const safe = (spec?.tiers['2sigma'].tools ?? []).filter(t => {
    const name = t.split('(')[0]?.trim() ?? ''
    if (WRITE_TOOLS.has(name)) return false
    // a bare Bash (or Bash(*)) would let the "read-only" pass run anything
    return !(name === 'Bash' && (!t.includes('(') || /^Bash\(\s*(?:\*|:\*)?\s*\)$/.test(t)))
  })
  return [...new Set(safe.length > 0 ? safe : DEFAULT_DIAGNOSE_TOOLS)]
}

function fmt(n: number): string {
  return String(Number(n.toPrecision(4)))
}

const TIER_LABEL: Record<Tier, string> = {
  'in-control': 'in control',
  '1sigma': '1σ drift',
  '2sigma': '2σ early degradation',
  '3sigma': '3σ critical breach',
}

/** Heading levels drop below the intent's own `##` sections, and task boxes go (Open Questions is the intent's only checklist). */
function embedDiagnosis(text: string): string {
  return text
    .replace(/^(#{1,6})(?=\s)/gm, h => '#'.repeat(Math.min(6, h.length + 3)))
    .replace(/^(\s*[-*+]\s)\[[ xX]\]\s/gm, '$1')
}

/** The Stage-1 intent (templates/intent.template.md) for a band breach, Status draft, diagnosis embedded. */
export function incidentIntentMarkdown(a: {
  reading: BandReading
  spec: BandSpec | null
  diagnosis: string
  date: string
  author: string
  sha?: string
}): string {
  const r = a.reading
  const tier3 = a.spec?.tiers['3sigma']
  const short = r.tier === '3sigma' ? '3σ' : r.tier === '2sigma' ? '2σ' : r.tier === '1sigma' ? '1σ' : 'drift'
  const ref = `ANOMALY-${r.metric}-${a.date}`
  const description = a.spec?.description ? ` (${a.spec.description})` : ''
  const rules = r.rules.length > 0 ? `Western Electric rules fired: ${r.rules.join(', ')}.` : 'No Western Electric rule fired; the z-score alone crossed the band.'
  const diagnosis = a.diagnosis.replace(/\r\n?/g, '\n').trim()
  const routes = tier3 && tier3.routes.length > 0 ? tier3.routes.join(', ') : 'a revert pull request or a pre-approved runbook'
  const escalation = tier3 && tier3.escalation.channel !== '' ? `${tier3.escalation.channel}${tier3.escalation.priority ? ` (${tier3.escalation.priority})` : ''}` : 'the team escalation channel'

  const lines = [
    `# Intent: Investigate ${r.metric} anomaly (${short})`,
    '',
    `**Author:** ${a.author}  `,
    '**Status:** draft  ',
    `**Date:** ${a.date}  `,
    `**Source Ticket / Anomaly Ref:** ${ref}  `,
    '',
    '---',
    '',
    '## Problem',
    `The control band for \`${r.metric}\`${description} breached at ${TIER_LABEL[r.tier]}. Operators and users of the service behind this metric are exposed to the degradation until its cause is found and removed.`,
    '',
    `- **Metric signature:** value ${fmt(r.value)} against a rolling baseline of ${fmt(r.mean)} ± ${fmt(r.sd)} (n=${r.n}); z = ${r.z.toFixed(2)} in the worse direction. ${rules}`,
    `- **Detected at:** ${new Date(r.at).toISOString()}`,
    ...(a.sha ? [`- **Offending deploy commit:** \`${a.sha}\``] : []),
    '',
    '### Diagnosis (read-only, written by the agent)',
    diagnosis === '' ? 'The read-only diagnostic pass returned nothing; start from the metric signature above.' : embedDiagnosis(diagnosis),
    '',
    '## Proposed Outcome',
    `\`${r.metric}\` returns inside its control band (within 1σ of its baseline) once the cause named in the diagnosis is addressed, and the fix ships with a permanent regression eval in \`evals/\` (Play 09).${r.tier === '3sigma' ? ` Mitigation (${routes}) is a proposal for a human to approve; the agent takes no production action on its own.` : ''}`,
    '',
    '## Affected Users and Systems',
    `- **User Personas:** consumers of the service behind \`${r.metric}\`; the on-call engineer who triages this intent`,
    `- **Target Systems / Repositories:** this repository${a.sha ? ` (suspect commit \`${a.sha}\`)` : ''} and the system that emits \`${r.metric}\``,
    '- **External Dependencies:** none identified by the watcher; confirm during triage',
    '',
    '## Constraints',
    `- **Security & Auth:** the diagnosis ran read-only (tools: ${diagnoseToolList(a.spec).join(', ')}); no production change has been made and any mitigation needs a human`,
    '- **Data Privacy & Classification:** scrub PII and secrets from any log excerpt before it leaves the team',
    `- **Performance / SLAs:** \`${r.metric}\` must return within its 1σ band; escalate via ${escalation}`,
    '- **Out of Scope:** unrelated refactors and any unattended production change',
    '',
    '## Open Questions',
    '- [ ] Does a human confirm the root cause named in the diagnosis?',
    '- [ ] Is this a regression to fix now, or accepted drift that calls for a wider band?',
    `- [ ] Which incident eval should guard \`${r.metric}\` once the fix ships?`,
    '',
  ]
  return lines.join('\n')
}
