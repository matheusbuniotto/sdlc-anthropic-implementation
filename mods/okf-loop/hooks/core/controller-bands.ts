// Stage 6 in the controller: measurements in, tiered response out. Detection is the pure SPC
// in spc.ts; here a 2sigma reading buys a read-only diagnosis whose result the HARNESS (never the
// agent) writes as an incident intent and a new run, and a 3sigma reading is only ever a proposal.

import type { BandReading, BandSource, BandView, Tier } from '../../types'
import { dueSources, extractMetric, incidentIntentMarkdown, incidentSlug, sampleLine } from './bands'
import { artifactPath, slugify } from './config'
import { STATE_DIR, STATE_FILES } from './constants'
import { activeRun, isoDate, ledger, note, say, toast, type Acc } from './controller-kit'
import type { Model } from './controller-types'
import { diagnosisPrompt } from './prompts'
import { evaluateSeries, sparkline } from './spc'
import { newRunRecord } from './stages'

const RANK: Record<Tier, number> = { 'in-control': 0, '1sigma': 1, '2sigma': 2, '3sigma': 3 }
const SAMPLE_LEDGER_GAP = 60 * 60_000

export const bandFile = (metric: string): string => `${STATE_FILES.bandsDir}/${metric.replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`

const sourceOf = (model: Model, metric: string): BandSource | undefined => model.config.bands.sources.find(s => s.metric === metric)

/** Sources whose interval has elapsed. Silent (empty) while the feature is off or unconfigured. */
export function dueMetrics(model: Model, now: number): string[] {
  const b = model.config.bands
  if (!b.enabled || b.sources.length === 0) return []
  return dueSources(b.sources, model.bands.lastCheckedAt, now).map(s => s.metric)
}

export function bandViews(model: Model): BandView[] {
  const b = model.config.bands
  if (!b.enabled) return []
  return b.sources.map(source => {
    const values = (model.bands.samples[source.metric] ?? []).map(s => s.value).slice(-40)
    const last = model.bands.readings[source.metric] ?? null
    return { metric: source.metric, description: source.description, values, last, tier: last?.tier ?? 'in-control', spec: model.bands.spec, source }
  })
}

const f2 = (n: number): string => String(Math.round(n * 100) / 100)

/** One measurement of one source arrived from register.tsx (its command ran, or failed). */
export function onMeasured(acc: Acc, a: { now: number; metric: string; stdout: string; ok: boolean; error?: string }): void {
  const { now, metric } = a
  const src = sourceOf(acc.model, metric)
  if (!src) return
  const bands = acc.model.bands
  const checked = { ...bands.lastCheckedAt, [metric]: now }
  const value = a.ok ? extractMetric(a.stdout, src.parse) : null
  if (value === null) {
    acc.model = { ...acc.model, bands: { ...bands, lastCheckedAt: checked } }
    const why = a.ok ? `no number found in the output (parse: ${src.parse})` : (a.error ?? 'the command failed')
    toast(acc, `band-read:${metric}`, `Band ${metric}: ${why}`, now, 30 * 60_000)
    return
  }
  const samples = [...(bands.samples[metric] ?? []), { at: now, value }].slice(-500)
  acc.effects.push({ t: 'append', path: bandFile(metric), line: sampleLine(now, value) })
  const reading = evaluateSeries(metric, samples, { window: acc.model.config.bands.window, higherIsWorse: src.higherIsWorse, rules: bands.spec?.rules })
  const next = { ...bands, samples: { ...bands.samples, [metric]: samples }, lastCheckedAt: checked }
  acc.model = { ...acc.model, bands: reading ? { ...next, readings: { ...next.readings, [metric]: reading } } : next }
  if (!reading) return

  const lastLogged = bands.lastSampleLedgerAt[metric]
  if (lastLogged === undefined || now - lastLogged >= SAMPLE_LEDGER_GAP) {
    acc.model = { ...acc.model, bands: { ...acc.model.bands, lastSampleLedgerAt: { ...acc.model.bands.lastSampleLedgerAt, [metric]: now } } }
    ledger(acc, { kind: 'band.sample', actor: 'mod', summary: `${metric} = ${f2(value)} (${reading.tier})`, data: { metric, value, tier: reading.tier } }, now)
  }

  const prior = bands.breached[metric]
  if (RANK[reading.tier] < 2) {
    if (prior) {
      const breached = { ...acc.model.bands.breached }
      delete breached[metric]
      const proposals = { ...acc.model.bands.proposals }
      delete proposals[metric]
      acc.model = { ...acc.model, bands: { ...acc.model.bands, breached, proposals } }
    }
    return
  }
  if (prior && RANK[reading.tier] <= RANK[prior]) return
  breach(acc, reading, src, prior === undefined, now)
}

function breach(acc: Acc, reading: BandReading, src: BandSource, first: boolean, now: number): void {
  const metric = reading.metric
  const three = reading.tier === '3sigma'
  const label = three ? '3σ critical' : '2σ early degradation'
  acc.model = { ...acc.model, bands: { ...acc.model.bands, breached: { ...acc.model.bands.breached, [metric]: reading.tier } } }
  ledger(
    acc,
    { kind: 'band.breach', actor: 'mod', summary: `${metric} breached its band: ${label} (value ${f2(reading.value)}, z ${f2(reading.z)})`, data: { metric, tier: reading.tier, z: Math.round(reading.z * 100) / 100, value: reading.value } },
    now,
  )
  if (three) {
    acc.model = { ...acc.model, bands: { ...acc.model.bands, proposals: { ...acc.model.bands.proposals, [metric]: { at: now, reading } } } }
    const c = acc.model.config.bands
    const how = c.tier3 === 'runbook' && c.runbook.length > 0 ? 'Approve the runbook with /sdlc bands runbook, or revert.' : 'This is a proposal: a person decides (revert PR or rehearsed rollback).'
    toast(acc, `band:${metric}`, `3σ breach on ${metric}. ${how}`, now, 10 * 60_000)
  } else {
    toast(acc, `band:${metric}`, `2σ breach on ${metric}: a read-only diagnosis is running.`, now, 10 * 60_000)
  }
  note(acc, `${metric} ${label}`, now)
  if (first) {
    acc.effects.push({
      t: 'spawn',
      metric,
      reading,
      prompt: diagnosisPrompt({ reading, spec: acc.model.bands.spec, date: isoDate(now) }),
      description: `Diagnose ${src.metric} breach`,
    })
  }
}

/** The read-only diagnosis came back (or never will): the harness writes the incident intent and opens the run. */
export function onDiagnosis(acc: Acc, a: { now: number; metric: string; reading: BandReading; diagnosis: string; author: string }): void {
  const { now, metric, reading } = a
  const date = isoDate(now)
  const slug = slugify(incidentSlug(metric, date), acc.model.runs.map(r => r.record.slug))
  const path = artifactPath(acc.model.config, 'intent', { slug })
  const text = incidentIntentMarkdown({ reading, spec: acc.model.bands.spec, diagnosis: a.diagnosis, date, author: a.author || 'okf-loop watcher' })
  const title = `Investigate ${metric} anomaly (${reading.tier === '3sigma' ? '3σ' : '2σ'})`
  acc.effects.push({ t: 'write', path, text, overwrite: false })
  acc.effects.push({ t: 'write', path: `${STATE_DIR}/.gitignore`, text: GITIGNORE, overwrite: false })
  acc.effects.push({ t: 'saveRun', record: newRunRecord({ slug, title, source: 'anomaly', now }) })
  if (!activeRun(acc.model)) acc.effects.push({ t: 'setActive', slug })
  ledger(acc, { kind: 'run.created', run: slug, stage: 'plan', actor: 'mod', summary: `Run ${slug} opened from a ${metric} anomaly`, data: { title, source: 'anomaly' } }, now)
  ledger(acc, { kind: 'artifact.written', run: slug, stage: 'plan', actor: 'mod', summary: `Wrote ${path}`, data: { kind: 'intent', path } }, now)
  ledger(acc, { kind: 'incident.intent', run: slug, stage: 'plan', actor: 'mod', summary: `Incident intent for ${metric}: ${path}`, data: { metric, path } }, now)
  toast(acc, `incident:${slug}`, `Incident intent written for ${metric}: ${path} waits for your review.`, now, 0)
  note(acc, `Incident intent: ${path}`, now)
  acc.effects.push({ t: 'refresh' })
}

export const GITIGNORE = '# okf-loop: local state, never committed\nactive\nbands/\n'

/** `/sdlc bands`: where each metric stands. */
export function bandsStatus(acc: Acc): void {
  const m = acc.model
  const b = m.config.bands
  if (!b.enabled) return say(acc, 'Bands are off. Set bands.enabled and bands.sources in .okf/config.json (Play 13); see bands.yaml.')
  if (b.sources.length === 0) return say(acc, 'Bands are on but bands.sources is empty: add a source (argv + parse) to watch a metric.')
  const lines = b.sources.map(s => {
    const r = m.bands.readings[s.metric]
    const n = (m.bands.samples[s.metric] ?? []).length
    const spark = sparkline((m.bands.samples[s.metric] ?? []).map(x => x.value), 16)
    return r ? `${s.metric}: ${r.tier} (z ${f2(r.z)}, value ${f2(r.value)}, n=${r.n}) ${spark}` : `${s.metric}: collecting (${n} sample${n === 1 ? '' : 's'}) ${spark}`.trim()
  })
  const props = Object.keys(m.bands.proposals)
  if (props.length > 0) lines.push(`3σ proposal pending for ${props.join(', ')}: ${b.tier3 === 'runbook' && b.runbook.length > 0 ? '/sdlc bands runbook runs it once' : 'a person decides'}.`)
  say(acc, lines.join('\n'))
}

export function bandsCheck(acc: Acc): void {
  const b = acc.model.config.bands
  if (!b.enabled || b.sources.length === 0) return say(acc, 'No band source is configured, so there is nothing to check (bands.enabled and bands.sources in .okf/config.json).')
  acc.effects.push({ t: 'bands', metrics: b.sources.map(s => s.metric) })
  say(acc, `Checking ${b.sources.length} band source${b.sources.length === 1 ? '' : 's'} now…`)
}

/** `/sdlc bands runbook` (a person): run the configured runbook once for a pending 3sigma proposal. */
export function bandsRunbook(acc: Acc, now: number, by: string): void {
  const b = acc.model.config.bands
  const proposals = Object.keys(acc.model.bands.proposals)
  if (b.tier3 !== 'runbook' || b.runbook.length === 0) return say(acc, 'No runbook is configured: set bands.tier3 to "runbook" and bands.runbook (argv) in .okf/config.json.')
  if (proposals.length === 0) return say(acc, 'There is no 3σ proposal waiting: the runbook only runs after a breach at 3σ.')
  acc.effects.push({ t: 'process', argv: b.runbook, purpose: 'runbook', label: b.runbook.join(' ') })
  acc.model = { ...acc.model, bands: { ...acc.model.bands, proposals: {} } }
  ledger(acc, { kind: 'agent.verdict', actor: 'human', summary: `${by || 'A human'} approved the runbook for ${proposals.join(', ')}: ${b.runbook.join(' ')}`, data: { kind: 'runbook', by: by || 'human', metric: proposals.join(',') } }, now)
  say(acc, `Running the runbook once: ${b.runbook.join(' ')}`)
}
