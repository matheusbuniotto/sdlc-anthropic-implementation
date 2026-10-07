// The small layout kit the tabs share: a render context, styled text lines,
// measured Buttons, greedy flow rows, cards and rules. Everything is a pure
// function of its arguments; element constructors come from `ctx.el`.

import type { RenderElement } from 'claude-code'

import type { UiActions, UiState, ViewModel } from '../../types'
import type { PaneElements, Surface } from './elements'
import { C, cells, clip, wrapText, type Seg, type Style } from './theme'

export type KeyHint = { key: string; hint: string }

export type Ctx = {
  el: PaneElements
  vm: ViewModel
  ui: UiState
  act: UiActions
  /** Cells the body may use, never more than the surface gave. */
  w: number
  rows: number
  surface: Surface
  /** Short viewport: tabs drop their secondary rows. */
  compact: boolean
  /** Hotkeys of the Buttons drawn so far, for the footer legend. */
  keys: KeyHint[]
}

/** A measured piece of a row: its width in cells and the element. */
export type Item = { w: number; node: RenderElement }

export type Held = ViewModel['quarantined'][number]

/** The approval of the active run that the file claims but the mod never recorded: held until a person confirms. */
export function heldOf(vm: ViewModel): Held | undefined {
  const slug = vm.active?.record.slug
  return slug === undefined ? undefined : vm.quarantined.find(q => q.slug === slug)
}

/** Approvals held in runs other than the active one. */
export const heldElsewhere = (vm: ViewModel): number => vm.quarantined.filter(q => q.slug !== vm.active?.record.slug).length

export const segsWidth = (segs: Seg[]): number => segs.reduce((n, s) => n + cells(typeof s === 'string' ? s : s.t), 0)

function styleOf(seg: Exclude<Seg, string>): Style {
  const { t: _t, ...style } = seg
  return style
}

/** Cut styled text to `width` cells; the segment that crosses the edge ends in `…`. */
export function fitSegs(segs: Seg[], width: number): Seg[] {
  const out: Seg[] = []
  let left = width
  for (const s of segs) {
    const text = typeof s === 'string' ? s : s.t
    if (cells(text) <= left) {
      out.push(s)
      left -= cells(text)
      continue
    }
    if (left > 0) {
      const cut = clip(text, left)
      out.push(typeof s === 'string' ? cut : { ...s, t: cut })
    }
    break
  }
  return out
}

/** One line of styled text that is cut, never wrapped, when the room ends (the safety net is the surface's width). */
export function line(ctx: Ctx, segs: Seg[], base?: Style): RenderElement {
  const { Text } = ctx.el
  const fitted = fitSegs(segs, ctx.w)
  if (fitted.length === 0) return <Text> </Text>
  return (
    <Text wrap="truncate-end" {...base}>
      {fitted.map(s => (typeof s === 'string' ? s : <Text {...styleOf(s)}>{s.t}</Text>))}
    </Text>
  )
}

/** A paragraph wrapped to `width`, at most `maxLines` lines; `prefix` marks the first line, the rest are indented. */
export function para(ctx: Ctx, text: string, width: number, maxLines: number, prefix = '', base?: Style): RenderElement[] {
  return wrapText(text, width - prefix.length, maxLines).map((l, i) => line(ctx, [(i === 0 ? prefix : ' '.repeat(prefix.length)) + l], base))
}

export const blank = (ctx: Ctx): RenderElement => line(ctx, [])

export const txt = (ctx: Ctx, segs: Seg[], base?: Style): Item => ({ w: segsWidth(segs), node: line(ctx, segs, base) })

export type BtnSpec = {
  key: string
  label: string
  onPress: () => void
  hotkey?: string
  /** What the footer legend says for this hotkey (defaults to the label). */
  hint?: string
  primary?: boolean
  /** No brackets: `x: label`, or the label alone without a hotkey. */
  plain?: boolean
  dim?: boolean
}

/** Cells a Button takes: `[ label ]`, or `k: label` / the label alone when plain. */
export const btnWidth = (s: Pick<BtnSpec, 'label' | 'plain' | 'hotkey'>): number =>
  s.plain ? cells(s.label) + (s.hotkey ? s.hotkey.length + 2 : 0) : cells(s.label) + 4

export function btn(ctx: Ctx, s: BtnSpec): Item {
  const { Button } = ctx.el
  if (s.hotkey) ctx.keys.push({ key: s.hotkey, hint: s.hint ?? s.label })
  return {
    w: btnWidth(s),
    node: (
      <Button
        key={s.key}
        label={s.label}
        hotkey={s.hotkey}
        variant={s.primary ? 'primary' : undefined}
        plain={s.plain ? true : undefined}
        dimColor={s.dim ? true : undefined}
        onPress={s.onPress}
      />
    ),
  }
}

export function rowBox(ctx: Ctx, items: Item[], gap = 1): RenderElement {
  const { Box } = ctx.el
  return <Box gap={gap}>{items.map(i => i.node)}</Box>
}

/** Pack items left to right, starting a new row where the next one would pass `width`. */
export function flow(ctx: Ctx, items: Item[], width: number, gap = 1): RenderElement[] {
  const rows: Item[][] = []
  let cur: Item[] = []
  let used = 0
  for (const it of items) {
    const add = cur.length ? gap + it.w : it.w
    if (cur.length && used + add > width) {
      rows.push(cur)
      cur = [it]
      used = it.w
    } else {
      cur.push(it)
      used += add
    }
  }
  if (cur.length) rows.push(cur)
  return rows.map(r => rowBox(ctx, r, gap))
}

/** Greedy-pack pieces of styled text into lines of at most `width` cells. */
export function packSegs(pieces: Seg[][], width: number, gap = 2): Seg[][] {
  const lines: Seg[][] = []
  let cur: Seg[] = []
  let used = 0
  for (const p of pieces) {
    const w = segsWidth(p)
    const add = cur.length ? gap + w : w
    if (cur.length && used + add > width) {
      lines.push(cur)
      cur = [...p]
      used = w
    } else {
      if (cur.length) cur.push(' '.repeat(gap))
      cur.push(...p)
      used += add
    }
  }
  if (cur.length) lines.push(cur)
  return lines
}

export function stack(ctx: Ctx, children: RenderElement[], gap = 0): RenderElement {
  const { Box } = ctx.el
  return (
    <Box flexDirection="column" gap={gap}>
      {children}
    </Box>
  )
}

/** A round-bordered card `width` cells wide: its content gets `width - 4`. */
export function card(ctx: Ctx, opts: { width: number; color?: string }, children: RenderElement[]): RenderElement {
  const { Box } = ctx.el
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={opts.color ?? C.border} paddingX={1} width={opts.width}>
      {children}
    </Box>
  )
}

export const innerWidth = (width: number): number => Math.max(10, width - 4)

/** `── Label ─────────` across `width`. */
export function rule(ctx: Ctx, label: Seg[], width: number, color: string = C.border): RenderElement {
  const rest = Math.max(2, width - 4 - segsWidth(label))
  return line(ctx, [{ t: '── ', color }, ...label, { t: ' ' + '─'.repeat(rest), color }])
}

/** `Label    value` rows of a detail card: the label column is dim and fixed. */
export function kv(ctx: Ctx, label: string, value: Seg[], labelWidth = 9): RenderElement {
  return line(ctx, [{ t: label.padEnd(labelWidth), dimColor: true }, ...value])
}
