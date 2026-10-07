// The pane: one header, one body, one footer. `renderPane` is a pure view of
// (view model, UI state, callbacks, size, surface); the wiring resolves the
// element table and builds the callbacks, this file never sees `$`.

import type { RenderElement } from 'claude-code'

import type { UiActions, UiState, ViewModel } from '../../types'
import { tidy, type PaneElements, type Surface } from './elements'
import { guardsTab } from './GuardsTab'
import { headerRows, tabRows } from './Header'
import { blank, btn, flow, line, packSegs, rowBox, txt, type Ctx, type KeyHint } from './kit'
import { ledgerTab } from './LedgerTab'
import { loopTab } from './LoopTab'
import { playsTab } from './PlaysTab'
import { setupTab } from './SetupTab'
import { C, clip, col, dim, plural, type Seg } from './theme'

export type PaneProps = {
  vm: ViewModel
  ui: UiState
  act: UiActions
  /** The body's width in cells (the pane's `bodyColumns`). */
  columns: number
  rows: number
  surface: Surface
}

/** Past this a card is just a long line: content stays left, readable. */
export const MAX_WIDTH = 140
export const MIN_WIDTH = 30
const COMPACT_ROWS = 24

function body(ctx: Ctx): RenderElement[] {
  switch (ctx.ui.tab) {
    case 'plays':
      return playsTab(ctx)
    case 'guards':
      return guardsTab(ctx)
    case 'ledger':
      return ledgerTab(ctx)
    case 'setup':
      return setupTab(ctx)
    default:
      return loopTab(ctx)
  }
}

function legend(ctx: Ctx, bodyKeys: KeyHint[], chromeKeys: KeyHint[]): RenderElement[] {
  if (ctx.surface === 'mobile') return []
  const seen = new Set<string>()
  const hints = [...bodyKeys, ...chromeKeys].filter(k => !/^[1-5]$/.test(k.key) && !seen.has(k.key) && seen.add(k.key))
  const pieces: Seg[][] = [
    ...hints.map<Seg[]>(k => [{ t: k.key, bold: true }, dim(` ${k.hint}`)]),
    [{ t: '1-5', bold: true }, dim(' tabs')],
    [{ t: 'Esc', bold: true }, dim(' closes')],
  ]
  return packSegs(pieces, ctx.w, 3).map(segs => line(ctx, segs.flatMap<Seg>(s => (s === '   ' ? [dim(' · ')] : [s]))))
}

function strips(ctx: Ctx): RenderElement[] {
  const { vm, ui, act, w } = ctx
  const out: RenderElement[] = []
  if (vm.notice) out.push(line(ctx, [col('› ', C.accent), clip(vm.notice, w - 2)]))
  if (vm.configIssues.length > 0 && ui.tab !== 'setup') {
    out.push(
      rowBox(ctx, [
        txt(ctx, [col(`⚠ ${plural(vm.configIssues.length, 'config issue')}`, C.human), dim(' in .okf/config.json')]),
        btn(ctx, { key: 'issues:open', label: 'Open Setup', onPress: () => act.setTab('setup') }),
      ]),
    )
  }
  return out
}

export function renderPane(el: PaneElements, p: PaneProps): RenderElement {
  const t = tidy(el)
  const { Box } = t
  const w = Math.max(MIN_WIDTH, Math.min(p.columns, MAX_WIDTH))
  const ctx: Ctx = {
    el: t,
    vm: p.vm,
    ui: p.ui,
    act: p.act,
    w,
    rows: p.rows,
    surface: p.surface,
    compact: p.rows < COMPACT_ROWS,
    keys: [],
  }

  if (!p.vm.ready) {
    return (
      <Box flexDirection="column" width={w}>
        {line(ctx, [{ t: '◉ The Loop', color: C.accent, bold: true }])}
        {line(ctx, [dim('Loading the Loop: reading config, knowledge, runs and the ledger…')])}
      </Box>
    )
  }

  const head = headerRows(ctx)
  const tabs = tabRows(ctx)
  const chromeKeys = ctx.keys.splice(0)
  const main = body(ctx)
  const bodyKeys = ctx.keys.splice(0)
  const notes = strips(ctx)

  return (
    <Box flexDirection="column" width={w}>
      {head}
      <Box flexDirection="column" marginTop={1}>
        {tabs}
      </Box>
      {notes.length > 0 ? <Box flexDirection="column">{notes}</Box> : null}
      <Box flexDirection="column" marginTop={1}>
        {main}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {line(ctx, [dim('─'.repeat(w))])}
        {legend(ctx, bodyKeys, chromeKeys)}
      </Box>
    </Box>
  )
}
