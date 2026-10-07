// Plays tab: the 14 plays grouped by stage, adoption toggles with their
// prerequisites, a detail card, and the dependency chains between plays.

import type { RenderElement } from 'claude-code'

import type { PlayView, StageId } from '../../types'
import { STAGE_META } from '../core/constants'
import { blank, btn, card, flow, innerWidth, kv, line, packSegs, rowBox, rule, txt, type Ctx, type Item } from './kit'
import {
  C,
  STAGE_ORDER,
  cells,
  chip,
  clip,
  col,
  dim,
  numeral,
  pad2,
  playTitle,
  strong,
  wrapText,
  type Seg,
} from './theme'

const SIDE_BY_SIDE_MIN = 132
const LIST_WIDTH = 76

function ordered(plays: PlayView[]): { stage: StageId; plays: PlayView[] }[] {
  return STAGE_ORDER.map(stage => ({ stage, plays: plays.filter(p => p.stage === stage).sort((a, b) => a.n - b.n) })).filter(g => g.plays.length > 0)
}

// ---------------------------------------------------------------------------
// Dependency chains: the longest path through a play, up and down.
// ---------------------------------------------------------------------------

function longest(plays: PlayView[], n: number, dir: 'up' | 'down', seen: number[] = []): number[] {
  if (seen.includes(n)) return [n]
  const play = plays.find(p => p.n === n)
  const next = dir === 'up' ? (play?.prerequisites ?? []) : plays.filter(q => q.prerequisites.includes(n)).map(q => q.n)
  let best: number[] = []
  for (const m of next) {
    const path = longest(plays, m, dir, [...seen, n])
    if (path.length > best.length) best = path
  }
  return dir === 'up' ? [...best, n] : [n, ...best]
}

export function chainFor(plays: PlayView[], n: number): number[] {
  return [...longest(plays, n, 'up').slice(0, -1), ...longest(plays, n, 'down')]
}

function chainSegs(plays: PlayView[], nums: number[], focus?: number): Seg[] {
  const out: Seg[] = []
  nums.forEach((n, i) => {
    const on = plays.find(p => p.n === n)?.enabled ?? false
    if (i > 0) out.push(dim(' → '))
    out.push({ t: pad2(n), color: on ? C.ok : undefined, dimColor: !on, bold: n === focus, underline: n === focus })
  })
  return out
}

function dependencyBlock(ctx: Ctx, plays: PlayView[], width: number): RenderElement[] {
  const roots = plays.filter(p => p.prerequisites.length === 0).sort((a, b) => a.n - b.n)
  const seen = new Set<string>()
  const rows: RenderElement[] = []
  for (const r of roots) {
    const chain = longest(plays, r.n, 'down')
    if (chain.length < 2) continue
    const key = chain.join('-')
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(line(ctx, [col('★ ', C.human), ...chainSegs(plays, chain)]))
  }
  return [rule(ctx, [strong('Dependency chains'), dim('  ★ entry points need nothing')], width), ...rows]
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

function hintFor(p: PlayView): { text: string; color?: string } {
  if (!p.enabled && p.unmet.length > 0) return { text: `needs ${p.unmet.map(pad2).join(', ')}`, color: C.human }
  if (p.enabled && p.dependents.length > 0) return { text: `needed by ${p.dependents.map(pad2).join(', ')}` }
  return { text: '' }
}

function playRow(ctx: Ctx, p: PlayView, selected: boolean, width: number, hintW: number): RenderElement {
  const { act } = ctx
  const hint = hintFor(p)
  const titleW = Math.max(8, hintW > 0 ? width - 13 - hintW : width - 11)
  const title = clip(playTitle(p.title), titleW)
  const items: Item[] = [
    txt(ctx, [{ t: selected ? '▸' : ' ', color: C.accent }]),
    btn(ctx, { key: `play:${p.n}:toggle`, label: p.enabled ? '[x]' : '[ ]', plain: true, dim: !p.enabled, onPress: () => act.togglePlay(p.n) }),
    txt(ctx, [{ t: p.entryPoint ? '★' : ' ', color: C.human }, ' ', { t: pad2(p.n), dimColor: !p.enabled }]),
    btn(ctx, { key: `play:${p.n}:open`, label: title, plain: true, dim: !p.enabled && !selected, onPress: () => act.selectPlay(selected ? null : p.n) }),
  ]
  if (hintW > 0) {
    const spare = titleW - cells(title)
    if (spare > 0) items.push(txt(ctx, [' '.repeat(spare - 1)]))
    items.push(txt(ctx, [{ t: hint.text, color: hint.color, dimColor: hint.color === undefined }]))
  }
  return rowBox(ctx, items)
}

function groupHeader(ctx: Ctx, stage: StageId, plays: PlayView[], width: number): RenderElement {
  const meta = STAGE_META[stage]
  const adopted = plays.filter(p => p.enabled).length
  return rule(ctx, [strong(`${numeral(meta.number)} ${meta.name}`), dim(` ${adopted}/${plays.length} adopted`)], width)
}

// ---------------------------------------------------------------------------
// Detail card
// ---------------------------------------------------------------------------

/** "Play 11" or "Plays 10, 11". */
const playsList = (nums: number[]): string => `${nums.length === 1 ? 'Play' : 'Plays'} ${nums.map(pad2).join(', ')}`

function detailCard(ctx: Ctx, p: PlayView, width: number): RenderElement {
  const { vm, act } = ctx
  const iw = innerWidth(width)
  const meta = STAGE_META[p.stage]
  const lw = 9
  const rows: RenderElement[] = [
    line(ctx, [
      p.entryPoint ? { t: '★ ', color: C.human } : '',
      strong(`Play ${pad2(p.n)}`),
      dim(' · '),
      clip(playTitle(p.title), Math.max(10, iw - 24)),
      ' ',
      p.enabled ? chip('adopted', C.ok) : dim('not adopted'),
    ]),
    line(ctx, [dim(`${numeral(meta.number)} ${meta.name}${p.entryPoint ? ' · entry point: needs no prerequisites' : ''}`)]),
    ...wrapText(p.summary, iw, 3).map(l => line(ctx, [l])),
    blank(ctx),
  ]
  const needs: Seg[] =
    p.prerequisites.length === 0
      ? [dim('nothing')]
      : p.prerequisites.flatMap<Seg>((m, i) => {
          const ok = !p.unmet.includes(m)
          return [i ? '  ' : '', { t: `${ok ? '✔' : '✖'} Play ${pad2(m)}`, color: ok ? C.ok : C.human }]
        })
  rows.push(kv(ctx, 'Needs', needs, lw))
  const unlocks = vm.plays.filter(q => q.prerequisites.includes(p.n)).sort((a, b) => a.n - b.n)
  rows.push(
    kv(ctx, 'Unlocks', unlocks.length === 0 ? [dim('nothing')] : unlocks.flatMap<Seg>((q, i) => [i ? '  ' : '', { t: `Play ${pad2(q.n)}`, color: q.enabled ? C.ok : undefined, dimColor: !q.enabled }]), lw),
    kv(ctx, 'Chain', chainSegs(vm.plays, chainFor(vm.plays, p.n), p.n), lw),
  )
  const enforced = p.enforcedBy.length ? p.enforcedBy.join(' · ') : 'knowledge only'
  wrapText(enforced, iw - lw, 2).forEach((l, i) => rows.push(kv(ctx, i === 0 ? 'Enforced' : '', [l], lw)))
  if (p.evidence.length > 0) {
    const cells = p.evidence.map<Seg[]>(e => [{ t: e.ok ? '✔ ' : '☐ ', color: e.ok ? C.ok : C.human }, { t: e.label, dimColor: e.ok }])
    packSegs(cells, iw - lw, 2).forEach((segs, i) => rows.push(kv(ctx, i === 0 ? 'Evidence' : '', segs, lw)))
  }
  if (p.outputs.length) rows.push(kv(ctx, 'Outputs', [dim(clip(p.outputs.join(', '), iw - lw))], lw))
  const root = vm.knowledge.root
  const doc = `${root}/${p.path}`
  rows.push(kv(ctx, 'Doc', [vm.knowledge.source === 'repo' ? doc : `${doc} (bundled)`].map(t => dim(clip(t, iw - lw))), lw))
  rows.push(blank(ctx))
  const actions: Item[] = [
    btn(ctx, { key: 'play:toggle', label: `t ${p.enabled ? 'Drop play' : 'Adopt play'}`, hotkey: 't', hint: p.enabled ? 'drop' : 'adopt', primary: !p.enabled, onPress: () => act.togglePlay(p.n) }),
  ]
  if (!p.enabled && p.unmet.length > 0) actions.push(txt(ctx, [col(`adopt ${playsList(p.unmet)} first`, C.human)]))
  else if (p.enabled && p.dependents.length > 0) actions.push(txt(ctx, [dim(`${playsList(p.dependents)} ${p.dependents.length === 1 ? 'depends' : 'depend'} on it`)]))
  rows.push(...flow(ctx, actions, iw, 2))
  return card(ctx, { width, color: p.enabled ? C.ok : C.border }, rows)
}

// ---------------------------------------------------------------------------

export function playsTab(ctx: Ctx): RenderElement[] {
  const { vm, ui, act, w } = ctx
  const groups = ordered(vm.plays)
  const flat = groups.flatMap(g => g.plays)
  const selected = flat.find(p => p.n === ui.selectedPlay)
  const adopted = flat.filter(p => p.enabled).length

  const move = (by: number): void => {
    const at = flat.findIndex(p => p.n === ui.selectedPlay)
    const target = flat[at === -1 ? (by > 0 ? 0 : flat.length - 1) : (at + by + flat.length) % flat.length]
    if (target) act.selectPlay(target.n)
  }
  const tools: Item[] = [
    txt(ctx, [dim(`${adopted}/${flat.length} adopted · ★ ${flat.filter(p => p.entryPoint).length} entry points`)]),
    btn(ctx, { key: 'play:prev', label: 'k ▴', hotkey: 'k', hint: 'prev play', onPress: () => move(-1) }),
    btn(ctx, { key: 'play:next', label: 'j ▾', hotkey: 'j', hint: 'next play', onPress: () => move(1) }),
  ]
  const out: RenderElement[] = [...flow(ctx, tools, w, 2)]

  if (flat.length === 0) {
    out.push(line(ctx, [dim('No plays loaded. Reload knowledge from the Setup tab.')]))
    return out
  }

  const wide = w >= SIDE_BY_SIDE_MIN
  const listW = wide ? LIST_WIDTH : w
  const hintW = Math.min(22, Math.max(0, ...flat.map(p => hintFor(p).text.length)))
  const list: RenderElement[] = []
  for (const g of groups) {
    list.push(groupHeader(ctx, g.stage, g.plays, listW))
    for (const p of g.plays) {
      list.push(playRow(ctx, p, p.n === selected?.n, listW, hintW))
      if (!wide && p.n === selected?.n) list.push(detailCard(ctx, p, w))
    }
  }

  if (wide) {
    const { Box } = ctx.el
    const right: RenderElement[] = selected
      ? [detailCard(ctx, selected, w - listW - 2)]
      : [...dependencyBlock(ctx, vm.plays, w - listW - 2), blank(ctx), line(ctx, [dim('Pick a play (click, or j / k) to see what it needs,')]), line(ctx, [dim('what enforces it here and what evidence the repo carries.')])]
    out.push(
      <Box gap={2}>
        <Box flexDirection="column" width={listW}>
          {list}
        </Box>
        <Box flexDirection="column" width={w - listW - 2}>
          {right}
        </Box>
      </Box>,
    )
  } else {
    out.push(...list)
    if (!selected) out.push(...dependencyBlock(ctx, vm.plays, w))
  }
  return out
}
