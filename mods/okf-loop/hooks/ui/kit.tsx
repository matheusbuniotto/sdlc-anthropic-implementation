// The small layout kit the tabs share: a render context, styled text lines,
// measured Buttons, greedy flow rows, cards and rules. Everything is a pure
// function of its arguments; element constructors come from `ctx.el`.

import type { RenderElement } from 'claude-code'

import type { UiActions, UiState, ViewModel } from '../../types'
import type { PaneElements, Surface } from './elements'
import { C, cells, type Seg, type Style } from './theme'

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

export const segsWidth = (segs: Seg[]): number => segs.reduce((n, s) => n + cells(typeof s === 'string' ? s : s.t), 0)

function styleOf(seg: Exclude<Seg, string>): Style {
  const { t: _t, ...style } = seg
  return style
}

/** One line of styled text that is cut, never wrapped, when the room ends. */
export function line(ctx: Ctx, segs: Seg[], base?: Style): RenderElement {
  const { Text } = ctx.el
  if (segs.length === 0) return <Text> </Text>
  return (
    <Text wrap="truncate-end" {...base}>
      {segs.map(s => (typeof s === 'string' ? s : <Text {...styleOf(s)}>{s.t}</Text>))}
    </Text>
  )
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

export function btn(ctx: Ctx, s: BtnSpec): Item {
  const { Button } = ctx.el
  if (s.hotkey) ctx.keys.push({ key: s.hotkey, hint: s.hint ?? s.label })
  const w = s.plain ? cells(s.label) + (s.hotkey ? s.hotkey.length + 2 : 0) : cells(s.label) + 4
  return {
    w,
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
