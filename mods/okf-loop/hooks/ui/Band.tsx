// The band above the prompt: one compact line that says where the Loop is,
// turns yellow when a person owes the next move and red when blocked, plus an
// optional second line with what the gate wants. Pure; null means "draw nothing".

import type { RenderElement } from 'claude-code'

import type { GateReport, Tier, ViewModel } from '../../types'
import { GATE_DEFS, STAGE_META } from '../core/constants'
import { tidy, type PaneElements } from './elements'
import { btn, btnWidth, fitSegs, heldOf, line, type BtnSpec, type Ctx } from './kit'
import { worstTier } from './LoopTab'
import type { PaneProps } from './Pane'
import { C, autopilotChip, cells, clip, clipStart, dim, numeral, tierColor, tierLabel, type Seg } from './theme'

export type BandProps = {
  vm: ViewModel
  ui: PaneProps['ui']
  act: PaneProps['act']
  /** The band's `bodyColumns`. */
  columns: number
  surface: PaneProps['surface']
}

/** `Loop 3/6 Build · semi`; undefined while there is no run. */
export function statusText(vm: ViewModel): string | undefined {
  const run = vm.active
  if (!run) return undefined
  const meta = STAGE_META[run.current]
  return `Loop ${meta.number}/6 ${meta.name} · ${vm.autopilot.mode}`
}

type Gate = { gate: GateReport; file: string }

/** The human gate a person can pass right now, if there is one. */
function humanGate(vm: ViewModel): Gate | null {
  const run = vm.active
  if (!run) return null
  for (const stage of run.stages) {
    for (const gate of stage.gates) {
      if (gate.kind === 'human' && gate.ready && !gate.approved && run.current === stage.id) {
        const kind = GATE_DEFS[gate.id].artifact
        const doc = stage.artifacts.find(a => a.kind === kind)
        return { gate, file: doc?.exists ? doc.path : kind ? `${kind}.md` : 'the release' }
      }
    }
  }
  return null
}

function focusGate(vm: ViewModel): GateReport | null {
  const run = vm.active
  const stage = run?.stages.find(s => s.id === run.current)
  return stage?.gates.find(g => !g.approved) ?? null
}

/** What the band says: fixed parts always shown, one flexible text clipped to the room left. */
type Look = { glyph: string; color: string; buttons: 'held' | 'gate' | 'blocked' | 'normal' | 'alert'; before: Seg[]; flex: string; after: Seg[] }

function look(vm: ViewModel, worst: Tier): Look | null {
  const run = vm.active
  const hot = worst === '2sigma' || worst === '3sigma'
  const breach = vm.bands.filter(b => b.tier === worst)[0]
  const gate = humanGate(vm)
  const held = heldOf(vm)
  if (run && held) {
    return { glyph: '⚠', color: C.human, buttons: 'held', before: [{ t: `confirm ${held.gate}`, bold: true }, dim(' · ')], flex: held.path, after: [' says approved, held until you confirm'] }
  }
  if (run && gate) {
    const release = gate.gate.id === 'release.approve'
    return release
      ? { glyph: '◆', color: C.human, buttons: 'gate', before: [{ t: 'release awaits your authorization', bold: true }], flex: '', after: [] }
      : { glyph: '◆', color: C.human, buttons: 'gate', before: [], flex: gate.file, after: [' awaits your sign-off'] }
  }
  if (run && run.health === 'blocked') {
    const stage = run.stages.find(s => s.state === 'blocked')
    const meta = STAGE_META[stage?.id ?? run.current]
    return { glyph: '✖', color: C.bad, buttons: 'blocked', before: [{ t: `${numeral(meta.number)} ${meta.name} blocked`, bold: true }, dim(' · ')], flex: stage?.summary || run.next.reason, after: [] }
  }
  if (hot && breach) {
    return { glyph: '▲', color: tierColor(worst), buttons: 'alert', before: [{ t: `band breach ${tierLabel(worst)}`, bold: true }, ' '], flex: breach.metric, after: run ? [dim(` · ${STAGE_META[run.current].name}`)] : [] }
  }
  if (!run) return null
  const meta = STAGE_META[run.current]
  const stage = run.stages.find(s => s.id === run.current)
  const ap = autopilotChip(vm.autopilot)
  const used = Math.max(0, vm.autopilot.budgetMax - vm.autopilot.budgetLeft)
  const apText = vm.autopilot.state === 'running' ? `▶ autopilot ${used}/${vm.autopilot.budgetMax}` : ap.text
  return {
    glyph: '◉',
    color: C.accent,
    buttons: 'normal',
    before: [{ t: 'Loop ', bold: true }, `${numeral(meta.number)} ${meta.name}`, dim(' ▸ ')],
    flex: stage?.summary || run.next.label,
    after: [dim(' · '), { t: apText, color: ap.color }],
  }
}

function detailLine(vm: ViewModel, columns: number, ctx: Ctx): RenderElement {
  const gate = focusGate(vm)
  const run = vm.active
  const held = heldOf(vm)
  if (held) return line(ctx, [dim(clip(held.detail, columns))])
  if (gate && gate.requirements.length > 0) {
    const segs: Seg[] = [dim(`${gate.id}: `)]
    gate.requirements.forEach((r, i) => {
      if (i) segs.push(dim(' · '))
      segs.push({ t: `${r.ok ? '✔' : r.by === 'human' ? '☐' : '✖'} ${r.label}`, color: r.ok ? C.ok : r.by === 'human' ? C.human : C.bad })
    })
    return line(ctx, segs)
  }
  return line(ctx, [dim(clip(run?.next.reason ?? 'No gate is open.', columns))])
}

export function renderBand(el: PaneElements, p: BandProps): RenderElement | null {
  const { vm, ui, act } = p
  if (ui.bandHidden || !vm.config.ui.showBand || !vm.ready) return null
  const worst = worstTier(vm.bands)
  const shape = look(vm, worst)
  if (!shape) return null

  const t = tidy(el)
  const { Box } = t
  const ctx: Ctx = { el: t, vm, ui, act, w: p.columns, rows: 2, surface: p.surface, compact: true, keys: [] }
  const run = vm.active
  const gate = humanGate(vm)
  const canRun = run !== null && !run.next.byHuman && run.next.promptKey !== undefined

  // Letters only: a bare digit typed into an empty prompt would press a band Button.
  const specs: { priority: number; spec: BtnSpec }[] = [
    { priority: 0, spec: { key: 'band:open', label: 'Open', hotkey: 'o', onPress: () => act.openPane() } },
    { priority: 4, spec: { key: 'band:hide', label: 'Hide', hotkey: 'h', onPress: () => act.hideBand() } },
  ]
  if (shape.buttons === 'gate' && gate) {
    specs.push({ priority: -1, spec: { key: 'band:approve', label: 'Approve', hotkey: 'a', primary: true, onPress: () => act.approve(gate.gate.id) } })
  }
  const held = heldOf(vm)
  if (shape.buttons === 'held' && held) {
    specs.push({ priority: -1, spec: { key: 'band:confirm', label: 'Confirm', hotkey: 'c', primary: true, onPress: () => act.confirm(held.gate) } })
  }
  if (canRun && shape.buttons !== 'gate' && shape.buttons !== 'held') {
    specs.push({ priority: 1, spec: { key: 'band:next', label: 'Next', hotkey: 'n', primary: shape.buttons === 'blocked', onPress: () => act.runNext() } })
  }
  if (run && vm.autopilot.mode === 'semi' && shape.buttons === 'normal') {
    specs.push({ priority: 2, spec: { key: 'band:pause', label: vm.autopilot.paused ? 'Resume' : 'Pause', hotkey: 'p', onPress: () => act.togglePause() } })
  }
  if (run) {
    specs.push({ priority: 3, spec: { key: 'band:expand', label: ui.bandExpanded ? '−' : '+', hotkey: 'e', onPress: () => act.toggleBand() } })
  }

  // Drop the least important Buttons until the fixed text and a stretch of the flexible one fit.
  const fixed = [...shape.before, ...shape.after].reduce((n, x) => n + cells(typeof x === 'string' ? x : x.t), 0)
  const want = fixed + Math.min(cells(shape.flex), 16)
  const keep = [...specs].sort((a, b) => a.priority - b.priority)
  const textRoom = (): number => p.columns - 2 - 1 - keep.reduce((n, b) => n + btnWidth(b.spec) + 1, 0)
  while (keep.length > 1 && textRoom() < want) keep.pop()
  const shown = specs.filter(s => keep.includes(s)).sort((a, b) => a.priority - b.priority)

  const flexRoom = Math.max(4, textRoom() - fixed)
  const flex: Seg[] = shape.flex ? [{ t: shape.glyph === '◆' || shape.glyph === '⚠' ? clipStart(shape.flex, flexRoom) : clip(shape.flex, flexRoom), bold: shape.glyph === '◆' }] : []
  const row = (
    <Box gap={1}>
      {line(ctx, [{ t: shape.glyph, color: shape.color, bold: true }])}
      {line(ctx, fitSegs([...shape.before, ...flex, ...shape.after], Math.max(8, textRoom())))}
      {shown.map(s => btn(ctx, s.spec).node)}
    </Box>
  )
  if (!ui.bandExpanded || !run) return row
  return (
    <Box flexDirection="column">
      {row}
      {detailLine(vm, p.columns, ctx)}
    </Box>
  )
}

