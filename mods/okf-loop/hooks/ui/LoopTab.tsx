// Loop tab: the ribbon, the gate that holds the change, the one move that
// advances it, the artifact chain, the leading/lagging metrics, any band breach.

import type { RenderElement } from 'claude-code'

import type { BandView, GateReport, MetricView, RunSnapshot, StageSnapshot, Tier } from '../../types'
import { STAGE_META } from '../core/constants'
import { artifactChain, ribbon } from './Ribbon'
import { blank, btn, card, flow, heldOf, innerWidth, line, para, rowBox, rule, txt, type Ctx, type Held, type Item } from './kit'
import {
  C,
  STAGE_ORDER,
  ago,
  autopilotChip,
  cells,
  chip,
  clip,
  col,
  dim,
  metricColor,
  numeral,
  pad,
  plural,
  spark,
  stageColor,
  stageGlyph,
  strong,
  tierColor,
  tierLabel,
  wrapText,
  type Seg,
} from './theme'

const TIER_RANK: Record<Tier, number> = { 'in-control': 0, '1sigma': 1, '2sigma': 2, '3sigma': 3 }

export function worstTier(bands: BandView[]): Tier {
  return bands.reduce<Tier>((w, b) => (TIER_RANK[b.tier] > TIER_RANK[w] ? b.tier : w), 'in-control')
}

/** A hotkey in the label (`a Approve`) where the surface has a keyboard. */
export const keyed = (ctx: Ctx, key: string, label: string): string => (ctx.surface === 'mobile' ? label : `${key} ${label}`)

function wrapped(ctx: Ctx, text: string, width: number, maxLines: number, prefix = '', color?: string): RenderElement[] {
  return para(ctx, text, width, maxLines, prefix, color ? { color } : undefined)
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function welcome(ctx: Ctx): RenderElement {
  const iw = innerWidth(ctx.w)
  const missing = ctx.vm.setup.filter(s => !s.exists).length
  const hint =
    missing > 0
      ? `Run /sdlc init to scaffold ${plural(missing, 'missing file')} (CLAUDE.md, REVIEW.md, bands.yaml, the production gate).`
      : 'Scaffolds are in place. Start from an idea below, or run /sdlc new <idea>.'
  return card(ctx, { width: ctx.w, color: C.accent }, [
    line(ctx, [strong('◉ The Loop', C.accent), dim('  humans above the loop, the agent inside it')]),
    blank(ctx),
    ...wrapped(ctx, 'One change flows through six stages: Plan, Design, Build, Test, Deploy, Maintain. Each stage commits an artifact; git is the source of truth.', iw, 2),
    ...wrapped(ctx, 'You sign four gates (intent, spec, plan, release). The agent drafts, builds, verifies and reviews in between, and stops where a person must decide.', iw, 2),
    ...wrapped(ctx, 'Control bands watch production and feed an anomaly back into a new intent ⟲, so the loop closes by itself.', iw, 2),
    blank(ctx),
    ...wrapped(ctx, hint, iw, 2, '▸ '),
  ])
}

function runsList(ctx: Ctx): RenderElement[] {
  const { vm, act } = ctx
  if (vm.runs.length === 0) return []
  const rows = vm.runs.map(r => {
    const meta = STAGE_META[r.current]
    const health = r.health === 'blocked' ? C.bad : r.health === 'attention' ? C.human : C.ok
    return rowBox(ctx, [
      txt(ctx, [{ t: r.health === 'blocked' ? '✖' : r.health === 'attention' ? '◆' : '●', color: health }, ' ', pad(clip(r.title, Math.max(12, ctx.w - 36)), Math.max(12, ctx.w - 36)), dim(` ${numeral(meta.number)} ${pad(meta.name, 8)}`), vm.quarantined.some(q => q.slug === r.slug) ? { t: ' ⚠', color: C.human } : '']),
      btn(ctx, { key: `run:use:${r.slug}`, label: 'Open', onPress: () => act.selectRun(r.slug) }),
    ])
  })
  return [rule(ctx, [strong('Runs')], ctx.w), ...rows]
}

// ---------------------------------------------------------------------------
// Gate card
// ---------------------------------------------------------------------------

function gateLine(ctx: Ctx, run: RunSnapshot, g: GateReport, iw: number): RenderElement {
  const by = run.record.approvals[g.id]
  const who = g.kind === 'human' ? 'you' : 'machine'
  if (g.approved) {
    const tail = by ? ` · by ${by.by} ${ago(by.at, ctx.vm.now)}` : ''
    return line(ctx, [{ t: '✔ ', color: C.ok }, dim(clip(`${g.id} · ${g.label}${tail}`, iw - 2))])
  }
  return line(ctx, [dim(clip(`○ ${g.id} · ${g.label} · ${who}`, iw))])
}

/** `upcoming`: the gate's stage has not started, so unmet checks are not failures yet. */
function requirementLines(ctx: Ctx, g: GateReport, iw: number, upcoming: boolean): RenderElement[] {
  const byW = 7
  return g.requirements.map(r => {
    const glyph = r.ok ? '✔' : upcoming ? '○' : r.by === 'human' ? '☐' : '✖'
    const color = r.ok ? C.ok : upcoming ? C.dim : r.by === 'human' ? C.human : C.bad
    const text = r.detail ? `${r.label} · ${r.detail}` : r.label
    return line(ctx, [
      { t: glyph, color },
      ' ',
      { t: pad(text, iw - 2 - byW - 1), dimColor: r.ok },
      ' ',
      { t: pad(r.by === 'human' ? 'you' : 'machine', byW, 'right'), color: r.by === 'human' ? C.human : undefined, dimColor: r.by !== 'human' },
    ])
  })
}

function gateActions(ctx: Ctx, g: GateReport, iw: number, held: Held | undefined): RenderElement[] {
  const { act } = ctx
  if (g.approved) return [line(ctx, [{ t: '✔ passed', color: C.ok }])]
  if (g.kind === 'machine') {
    return [line(ctx, [dim(clip('Machine gate: the mod passes it once every check holds. Nothing to press.', iw))])]
  }
  if (!g.ready) {
    const why = g.blockedBy[0] ? ` Waiting for: ${g.blockedBy[0]}` : ''
    return [line(ctx, [dim(clip(`${keyed(ctx, 'a', 'Approve')} · ${keyed(ctx, 'r', 'Reject')} unlock once the checks pass.${why}`, iw))])]
  }
  const release = g.id === 'release.approve'
  const heldHere = held?.gate === g.id
  const items: Item[] = [
    txt(ctx, [{ t: 'Owed by you', color: C.human, bold: true }]),
    ...(heldHere ? [txt(ctx, [dim('confirm it in the card above')])] : [btn(ctx, { key: 'gate:approve', label: keyed(ctx, 'a', release ? 'Authorize release' : 'Approve'), hotkey: 'a', hint: 'approve', primary: true, onPress: () => act.approve(g.id) })]),
    btn(ctx, { key: 'gate:reject', label: keyed(ctx, 'r', 'Reject'), hotkey: 'r', hint: 'reject', onPress: () => act.reject(g.id) }),
  ]
  return flow(ctx, items, iw, 2)
}

function stageTitle(stage: StageSnapshot, g: GateReport, iw: number, ctx: Ctx, upNext: boolean): RenderElement {
  const meta = STAGE_META[stage.id]
  const left = `${numeral(meta.number)} ${meta.name}`
  const right = upNext ? `up next · ${g.id}` : g.id
  const label = clip(g.label, Math.max(8, iw - 2 - left.length - 3 - right.length - 2))
  const fill = Math.max(1, iw - (2 + left.length + 3 + cells(label)) - right.length)
  return line(ctx, [
    { t: stageGlyph(stage.state), color: stageColor(stage.state), bold: true },
    ' ',
    strong(left),
    dim(' · '),
    label,
    ' '.repeat(fill),
    dim(right),
  ])
}

/** The first open gate from the current stage onward: what holds the change, or what it meets next. */
function openGate(run: RunSnapshot): { stage: StageSnapshot; gate: GateReport } | null {
  for (const id of STAGE_ORDER.slice(STAGE_ORDER.indexOf(run.current))) {
    const stage = run.stages.find(s => s.id === id)
    const gate = stage?.gates.find(g => !g.approved)
    if (stage && gate) return { stage, gate }
  }
  return null
}

function gateCard(ctx: Ctx, run: RunSnapshot, held: Held | undefined): RenderElement {
  const iw = innerWidth(ctx.w)
  const open = openGate(run)
  if (!open) {
    const done = run.stages.every(s => s.state === 'done' || s.state === 'monitoring')
    return card(ctx, { width: ctx.w, color: C.info }, [
      line(ctx, [{ t: '◌ ', color: C.info }, strong(done ? 'Shipped' : 'Maintain'), dim(' · every gate is passed')]),
      ...wrapped(ctx, 'Bands watch production. A breach turns into a new intent (source: anomaly) and the loop starts again.', iw, 2),
    ])
  }
  const { stage, gate: focus } = open
  const upNext = stage.id !== run.current
  const rows: RenderElement[] = []
  if (upNext) {
    for (const g of run.stages.find(s => s.id === run.current)?.gates ?? []) rows.push(gateLine(ctx, run, g, iw))
  }
  rows.push(stageTitle(stage, focus, iw, ctx, upNext))
  for (const g of stage.gates) {
    if (g === focus) rows.push(...requirementLines(ctx, g, iw, upNext), ...gateActions(ctx, g, iw, held))
    else rows.push(gateLine(ctx, run, g, iw))
  }
  return card(ctx, { width: ctx.w, color: upNext ? C.border : stageColor(stage.state) }, rows)
}

// ---------------------------------------------------------------------------
// Next-action card
// ---------------------------------------------------------------------------

function nextCard(ctx: Ctx, run: RunSnapshot): RenderElement {
  const { act, vm } = ctx
  const iw = innerWidth(ctx.w)
  const n = run.next
  const blocked = run.health === 'blocked'
  const color = blocked ? C.bad : n.byHuman ? C.human : C.active
  const owes = n.byHuman ? 'you' : n.kind === 'monitor' || n.kind === 'idle' ? 'nobody' : 'agent'
  const head = `${n.byHuman ? '◆ Your move' : '▸ Next'} · ${n.label}`
  const rows: RenderElement[] = [
    line(ctx, [
      { t: pad(clip(head, iw - 14), iw - 14), color, bold: true },
      { t: pad(`owed by ${owes}`, 14, 'right'), dimColor: true },
    ]),
    ...wrapped(ctx, n.reason, iw, 2),
  ]
  const ap = autopilotChip(vm.autopilot)
  const canRun = !n.byHuman && n.promptKey !== undefined
  const items: Item[] = []
  if (canRun) {
    items.push(btn(ctx, { key: 'next:run', label: keyed(ctx, 'n', 'Run next ▸'), hotkey: 'n', hint: 'run next', primary: true, onPress: () => act.runNext() }))
  } else if (n.byHuman) {
    items.push(txt(ctx, [dim(heldOf(vm) ? 'Confirm the held approval above: it is yours to pass.' : 'Use the gate above: it is yours to pass.')]))
  }
  const used = items.reduce((s, i) => s + i.w + 2, 0)
  items.push(txt(ctx, [{ t: ap.text, color: ap.color }, dim(` · ${clip(vm.autopilot.reason, Math.max(10, iw - used - ap.text.length - 3))}`)]))
  rows.push(...flow(ctx, items, iw, 2))
  return card(ctx, { width: ctx.w, color }, rows)
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

const STATUS_RANK = { bad: 0, warn: 1, good: 2, 'n/a': 3 } as const

export function pickMetrics(metrics: MetricView[], count: number): MetricView[] {
  return metrics
    .map((m, i) => ({ m, i }))
    .sort((a, b) => STATUS_RANK[a.m.status] - STATUS_RANK[b.m.status] || a.i - b.i)
    .slice(0, count)
    .map(x => x.m)
}

function metricsBlock(ctx: Ctx): RenderElement[] {
  const picked = pickMetrics(ctx.vm.metrics, 4)
  if (picked.length === 0) return []
  const per = ctx.w >= 100 ? 4 : 2
  const cw = Math.floor(ctx.w / per)
  const out: RenderElement[] = [rule(ctx, [strong('Metrics')], ctx.w)]
  for (let i = 0; i < picked.length; i += per) {
    const group = picked.slice(i, i + per)
    const labels: Seg[] = group.map(m => ({ t: pad(clip(`${m.kind === 'leading' ? '↗' : '↙'} ${m.label}`, cw - 1), cw), dimColor: true }))
    const values: Seg[] = group.flatMap<Seg>(m => {
      const color = metricColor(m.status)
      const value = clip(m.value, cw - 1)
      const tail = m.target && m.status !== 'n/a' ? clip(` vs ${m.target}`, cw - 1 - value.length) : ''
      return [{ t: value, color, bold: m.status !== 'n/a' }, { t: pad(tail, cw - value.length), dimColor: true }]
    })
    out.push(line(ctx, labels), line(ctx, values))
  }
  return out
}

// ---------------------------------------------------------------------------
// Band breach strip
// ---------------------------------------------------------------------------

const fmt = (n: number): string => {
  const a = Math.abs(n)
  const s = a >= 100 ? n.toFixed(0) : a >= 10 ? n.toFixed(1) : n.toFixed(2)
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

function response(ctx: Ctx, tier: Tier): string {
  if (tier === '3sigma') return ctx.vm.config.bands.tier3 === 'runbook' ? 'runbook awaits your approval' : 'proposal: a human decides'
  if (tier === '2sigma') return 'read-only diagnosis'
  return 'logged'
}

function breachStrip(ctx: Ctx): RenderElement[] {
  const hot = ctx.vm.bands.filter(b => b.tier !== 'in-control').sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]).slice(0, 3)
  return hot.map(b => {
    const r = b.last
    const color = tierColor(b.tier)
    const stats = r ? ` ${fmt(r.value)} (μ ${fmt(r.mean)}, z ${r.z >= 0 ? '+' : ''}${r.z.toFixed(1)}${r.rules.length ? ', ' + r.rules.join('+') : ''})` : ''
    const head: Seg[] = [chip(`▲ ${tierLabel(b.tier)}`, color), ' ', strong(clip(b.metric, 22)), ' ', { t: spark(b.values, 14), color }]
    const room = ctx.w - 12 - Math.min(22, b.metric.length) - 16
    return line(ctx, [...head, dim(clip(`${stats} · ${response(ctx, b.tier)}`, Math.max(10, room)))])
  })
}

// ---------------------------------------------------------------------------
// New run
// ---------------------------------------------------------------------------

function newRun(ctx: Ctx, first: boolean): RenderElement[] {
  const { el, ui, act } = ctx
  const { Input } = el
  const draft = ui.draftIdea.trim()
  if (!Input) {
    return [line(ctx, [dim('Start a change with /sdlc new <what should change>.')])]
  }
  const rows: RenderElement[] = []
  if (!first) rows.push(rule(ctx, [strong('New run')], ctx.w))
  rows.push(
    <Input key="newrun" label="What should change? " placeholder="describe the change in your own words" value={ui.draftIdea} submitLabel="start" onInput={v => act.setDraftIdea(v)} onSubmit={v => act.newRun(v)} />,
  )
  if (draft) {
    rows.push(rowBox(ctx, [btn(ctx, { key: 'newrun:start', label: 'Start run ▸', primary: true, onPress: () => act.newRun(draft) })]))
  }
  return rows
}

// ---------------------------------------------------------------------------

/** The approval the file claims but nobody recorded: the loop holds it until a person confirms. */
function heldCard(ctx: Ctx, held: Held): RenderElement {
  const iw = innerWidth(ctx.w)
  return card(ctx, { width: ctx.w, color: C.human }, [
    ...para(ctx, `${held.path} says approved but changed while the agent was working`, iw, 2, '⚠ ', { bold: true, color: C.human }),
    ...para(ctx, held.detail, iw, 2, '', { dimColor: true }),
    line(ctx, [dim(clip('Held until you confirm: the agent cannot sign its own gate.', iw))]),
    ...flow(ctx, [btn(ctx, { key: 'quarantine:confirm', label: keyed(ctx, 'c', 'Confirm approval'), hotkey: 'c', hint: 'confirm approval', primary: true, onPress: () => ctx.act.confirm(held.gate) })], iw),
  ])
}

export function loopTab(ctx: Ctx): RenderElement[] {
  const { vm } = ctx
  const run = vm.active
  const worst = worstTier(vm.bands)
  const out: RenderElement[] = []
  const alert = TIER_RANK[worst] >= 2
  const held = heldOf(vm)

  if (!run) {
    out.push(welcome(ctx), ...newRun(ctx, true), ...runsList(ctx))
    if (worst !== 'in-control') out.push(...breachStrip(ctx))
    return out
  }

  if (held) out.push(heldCard(ctx, held))
  if (alert) out.push(...breachStrip(ctx))
  out.push(...ribbon(ctx, run, worst), gateCard(ctx, run, held), nextCard(ctx, run))
  if (!ctx.compact) out.push(...artifactChain(ctx, run, worst), ...metricsBlock(ctx))
  if (!alert && worst !== 'in-control') out.push(...breachStrip(ctx))
  out.push(...newRun(ctx, false))
  return out
}
