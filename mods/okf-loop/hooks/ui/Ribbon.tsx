// The stage ribbon (where the change is) and the artifact chain (what the
// committed files say). Horizontal from ~110 columns, a vertical list below.

import type { RenderElement } from 'claude-code'

import type { ArtifactDoc, ArtifactKind, RunSnapshot, StageId, StageSnapshot, Tier } from '../../types'
import { STAGE_META } from '../core/constants'
import { heldOf, line, rule, type Ctx } from './kit'
import {
  C,
  STAGE_ORDER,
  clip,
  clipStart,
  dim,
  numeral,
  pad,
  stageColor,
  stageGlyph,
  stageWord,
  statusColor,
  statusGlyph,
  strong,
  tierColor,
  tierLabel,
  type Seg,
} from './theme'

export const HORIZONTAL_MIN = 110

const stageOf = (run: RunSnapshot, id: StageId): StageSnapshot | undefined => run.stages.find(s => s.id === id)

/** Label and colour of the arc that closes the loop: it lights up while a band is out of control. */
function arcStyle(worst: Tier): { label: string; color: string } {
  return worst === '2sigma' || worst === '3sigma'
    ? { label: `⟲ ${tierLabel(worst)} breach → intent`, color: tierColor(worst) }
    : { label: '⟲ anomaly → intent', color: C.dim }
}

function node(ctx: Ctx, run: RunSnapshot, id: StageId): { segs: Seg[]; width: number } {
  const s = stageOf(run, id)
  const state = s?.state ?? 'pending'
  const meta = STAGE_META[id]
  const current = run.current === id
  const name = `${numeral(meta.number)} ${meta.name}`
  const segs: Seg[] = [
    { t: stageGlyph(state), color: stageColor(state), bold: current },
    ' ',
    state === 'pending' ? dim(name) : current ? strong(name) : name,
  ]
  return { segs, width: 2 + name.length }
}

function horizontal(ctx: Ctx, run: RunSnapshot, worst: Tier): RenderElement[] {
  const nodes = STAGE_ORDER.map(id => node(ctx, run, id))
  const total = nodes.reduce((n, x) => n + x.width, 0)
  const link = Math.max(4, Math.floor((ctx.w - total) / 5))

  const names: Seg[] = []
  const words: Seg[] = []
  STAGE_ORDER.forEach((id, i) => {
    const n = nodes[i]
    const s = stageOf(run, id)
    const state = s?.state ?? 'pending'
    if (!n) return
    names.push(...n.segs)
    const last = i === STAGE_ORDER.length - 1
    const cellW = n.width + (last ? 0 : link)
    if (!last) names.push({ t: ` ${'─'.repeat(link - 3)}▶ `, color: state === 'done' ? C.ok : C.dim })
    const word = stageWord(state)
    words.push({ t: pad('  ' + word, cellW), color: stageColor(state), bold: run.current === id, dimColor: state === 'pending' })
  })

  const lastW = nodes[nodes.length - 1]?.width ?? 10
  const length = total + link * 5
  const arc = arcStyle(worst)
  const label = ` ${arc.label} `
  const dashes = Math.max(2, length - lastW - 2 - label.length - 1)
  return [
    line(ctx, names),
    line(ctx, words),
    line(ctx, [{ t: '╰◀' + '─'.repeat(dashes), color: arc.color }, { t: label, color: arc.color, bold: worst !== 'in-control' && worst !== '1sigma' }, { t: '─╯', color: arc.color }]),
  ]
}

function vertical(ctx: Ctx, run: RunSnapshot, worst: Tier): RenderElement[] {
  const rows = STAGE_ORDER.map(id => {
    const s = stageOf(run, id)
    const state = s?.state ?? 'pending'
    const meta = STAGE_META[id]
    const current = run.current === id
    const summary = s?.summary || meta.tagline
    return line(ctx, [
      { t: current ? '▸ ' : '  ', color: C.accent },
      { t: stageGlyph(state), color: stageColor(state) },
      ' ',
      state === 'pending' ? dim(`${numeral(meta.number)} ${pad(meta.name, 8)}`) : current ? strong(`${numeral(meta.number)} ${pad(meta.name, 8)}`) : `${numeral(meta.number)} ${pad(meta.name, 8)}`,
      ' ',
      { t: clip(summary, Math.max(8, ctx.w - 17)), dimColor: state === 'pending' || state === 'done' },
    ])
  })
  const arc = arcStyle(worst)
  return [...rows, line(ctx, [{ t: '  ╰◀ ' + arc.label, color: arc.color }])]
}

function compactLine(ctx: Ctx, run: RunSnapshot): RenderElement {
  const segs: Seg[] = []
  for (const id of STAGE_ORDER) {
    const state = stageOf(run, id)?.state ?? 'pending'
    segs.push({ t: `${stageGlyph(state)}${numeral(STAGE_META[id].number)}`, color: stageColor(state) }, ' ')
  }
  const cur = stageOf(run, run.current)
  const tail = `${STAGE_META[run.current].name}${cur?.summary ? ' · ' + cur.summary : ''}`
  const used = 6 * 3 + 1
  segs.push(strong(clip(tail, Math.max(8, ctx.w - used))))
  return line(ctx, segs)
}

export function ribbon(ctx: Ctx, run: RunSnapshot, worst: Tier): RenderElement[] {
  if (ctx.compact) return [compactLine(ctx, run)]
  return ctx.w >= HORIZONTAL_MIN ? horizontal(ctx, run, worst) : vertical(ctx, run, worst)
}

// ---------------------------------------------------------------------------
// Artifact chain: intent → spec → plan → proof → review → bands
// ---------------------------------------------------------------------------

const CHAIN: { id: StageId; kind: ArtifactKind; name: string }[] = [
  { id: 'plan', kind: 'intent', name: 'intent' },
  { id: 'design', kind: 'spec', name: 'spec' },
  { id: 'build', kind: 'plan', name: 'plan' },
  { id: 'test', kind: 'proof', name: 'proof' },
  { id: 'deploy', kind: 'review', name: 'review' },
]

type Link = { name: string; glyph: string; color: string; status: string; path: string }

function chainLinks(ctx: Ctx, run: RunSnapshot, worst: Tier): Link[] {
  const links: Link[] = CHAIN.map(c => {
    const stage = stageOf(run, c.id)
    const doc: ArtifactDoc | undefined = stage?.artifacts.find(a => a.kind === c.kind)
    const path = doc?.path ?? ctx.vm.config.paths[c.kind].replace('{slug}', run.record.slug)
    if (!doc?.exists) return { name: c.name, glyph: '○', color: C.dim, status: 'missing', path }
    // Proofs and reviews carry no Status line: the stage says how they went.
    if (c.kind === 'proof' || c.kind === 'review') {
      const state = stage?.state
      if (state === 'done') return { name: c.name, glyph: '✔', color: C.ok, status: 'passed', path }
      if (state === 'blocked') return { name: c.name, glyph: '✖', color: C.bad, status: 'failed', path }
      return { name: c.name, glyph: '●', color: C.active, status: 'written', path }
    }
    if (heldOf(ctx.vm)?.path === doc.path) return { name: c.name, glyph: '⚠', color: C.human, status: 'held', path }
    return { name: c.name, glyph: statusGlyph(doc.status), color: statusColor(doc.status), status: doc.status, path }
  })
  const bands = ctx.vm.config.bands.enabled
  links.push({
    name: 'bands',
    glyph: '◌',
    color: bands ? (worst === 'in-control' ? C.info : tierColor(worst)) : C.dim,
    status: bands ? (worst === 'in-control' ? 'watching' : tierLabel(worst)) : 'off',
    path: ctx.vm.config.paths.bands,
  })
  return links
}

/** `reviews/rate-limit.review.md` -> `reviews/….review.md`, or just `….review.md` when that is still too wide. */
export function shortPath(path: string, slug: string, width: number): string {
  const short = path.replace(slug, '…')
  if (short.length <= width) return short
  return clipStart(short.slice(short.lastIndexOf('/') + 1), width)
}

export function artifactChain(ctx: Ctx, run: RunSnapshot, worst: Tier): RenderElement[] {
  const links = chainLinks(ctx, run, worst)
  const head = rule(ctx, [strong('Artifacts')], ctx.w)
  if (ctx.w < HORIZONTAL_MIN) {
    const pathW = Math.max(10, ctx.w - 24)
    return [
      head,
      ...links.map(l =>
        line(ctx, [{ t: l.glyph, color: l.color }, ' ', pad(l.name, 7), { t: pad(l.status, 13), color: l.color }, dim(clipStart(l.path, pathW))]),
      ),
    ]
  }
  const arrow = ' → '
  const gap = ' '.repeat(arrow.length)
  const cellW = Math.floor((ctx.w - arrow.length * 5) / 6)
  const row = (cell: (l: Link) => Seg, sep: Seg): Seg[] => links.flatMap((l, i) => (i < links.length - 1 ? [cell(l), sep] : [cell(l)]))
  return [
    head,
    line(ctx, row(l => ({ t: pad(`${l.glyph} ${l.name}`, cellW), color: l.color, bold: true }), dim(arrow))),
    line(ctx, row(l => ({ t: pad(`  ${l.status}`, cellW), color: l.color }), gap)),
    line(ctx, row(l => ({ t: pad(shortPath(l.path, run.record.slug, cellW - 2), cellW), dimColor: true }), gap)),
  ]
}
