// Pane header: the title and what the autopilot is doing, the run picker, and
// the tab strip. Rows are packed by width, so a narrow pane wraps instead of overflowing.

import type { RenderElement } from 'claude-code'

import { UI_TABS } from '../core/constants'
import { btn, flow, heldElsewhere, txt, type Ctx, type Item } from './kit'
import {
  C,
  autopilotChip,
  chip,
  clip,
  dim,
  healthChip,
  modeLabel,
  nextMode,
  releaseChip,
  strong,
  type Seg,
} from './theme'

function filled(ctx: Ctx, text: string, color: string): Item {
  return color === C.dim ? txt(ctx, [dim(text)]) : txt(ctx, [chip(text, color)])
}

export function headerRows(ctx: Ctx): RenderElement[] {
  const { vm, act, w } = ctx
  const mode = vm.autopilot.mode
  const ap = autopilotChip(vm.autopilot)
  const grant = releaseChip(vm.release, vm.now)

  const top: Item[] = [
    txt(ctx, [strong('◉ The Loop', C.accent)]),
    btn(ctx, {
      key: 'mode',
      label: modeLabel(mode),
      hotkey: 'm',
      hint: 'mode',
      onPress: () => act.setMode(nextMode(vm.config.autonomy.mode)),
    }),
    filled(ctx, ap.text, ap.color),
  ]
  if (vm.active && mode === 'semi') {
    top.push(
      btn(ctx, {
        key: 'pause',
        label: vm.autopilot.paused ? 'Resume' : 'Pause',
        hotkey: 'p',
        hint: vm.autopilot.paused ? 'resume' : 'pause',
        onPress: () => act.togglePause(),
      }),
    )
  }
  top.push(grant.open ? filled(ctx, grant.text, grant.color) : txt(ctx, [dim(grant.text)]))
  return [...flow(ctx, top, w, 2), ...runPicker(ctx)]
}

function runPicker(ctx: Ctx): RenderElement[] {
  const { vm, act, w } = ctx
  const run = vm.active
  if (!run) {
    const more = vm.runs.length > 0 ? ` · ${vm.runs.length} ${vm.runs.length === 1 ? 'run' : 'runs'} to pick up` : ''
    const held = heldElsewhere(vm)
    return flow(ctx, [txt(ctx, [dim(`No active run${more}`)]), ...(held > 0 ? [txt(ctx, [{ t: `⚠ ${held} held`, color: C.human }])] : [])], w, 2)
  }
  const idx = Math.max(0, vm.runs.findIndex(r => r.slug === run.record.slug))
  const many = vm.runs.length > 1
  const step = (by: number): void => {
    const target = vm.runs[(idx + by + vm.runs.length) % vm.runs.length]
    if (target) act.selectRun(target.slug)
  }
  const health = healthChip(run.health)
  const source: Seg[] = run.record.source === 'human' ? [] : [{ t: run.record.source === 'anomaly' ? '⟲ anomaly' : 'ticket', dimColor: true }]
  const elsewhere = heldElsewhere(vm)
  const side: Item[] = [
    txt(ctx, [{ t: health.text, color: health.color }]),
    ...(source.length ? [txt(ctx, source)] : []),
    ...(elsewhere > 0 ? [txt(ctx, [{ t: `⚠ ${elsewhere} held in other ${elsewhere === 1 ? 'run' : 'runs'}`, color: C.human }])] : []),
  ]
  const arrows = many ? 5 + 5 + 3 + `${idx + 1}/${vm.runs.length}`.length : 0
  const room = w - arrows - side.reduce((n, s) => n + s.w + 1, 0) - 1
  const title = txt(ctx, [strong(clip(run.record.title, Math.max(12, room)))])
  const items: Item[] = many
    ? [
        btn(ctx, { key: 'run:prev', label: '‹', hotkey: 'h', hint: 'prev run', onPress: () => step(-1) }),
        title,
        btn(ctx, { key: 'run:next', label: '›', hotkey: 'l', hint: 'next run', onPress: () => step(1) }),
        txt(ctx, [dim(`${idx + 1}/${vm.runs.length}`)]),
        ...side,
      ]
    : [title, ...side]
  return flow(ctx, items, w)
}

export function tabRows(ctx: Ctx): RenderElement[] {
  const { vm, ui, act, w } = ctx
  const attention = vm.active !== null && vm.active.health !== 'ok'
  const items = UI_TABS.map(t =>
    btn(ctx, {
      key: `tab:${t.id}`,
      label: `${t.hotkey} ${t.label}${t.id === 'loop' && attention ? ' ◆' : ''}`,
      hotkey: t.hotkey,
      hint: t.label.toLowerCase(),
      primary: ui.tab === t.id,
      onPress: () => act.setTab(t.id),
    }),
  )
  return flow(ctx, items, w)
}
