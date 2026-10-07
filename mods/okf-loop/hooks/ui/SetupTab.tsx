// Setup tab: scaffold checklist, where the knowledge comes from, config
// problems, the autonomy mode picker and the bands (control charts) section.

import type { RenderElement } from 'claude-code'

import type { Mode } from '../../types'
import { blank, btn, btnWidth, flow, line, para, rowBox, rule, txt, type Ctx } from './kit'
import { C, clip, col, dim, modeLabel, MODES, pad, plural, spark, strong, tierColor, tierGlyph, tierLabel, wrapText } from './theme'

const MODE_BLURB: Record<Mode, string> = {
  manual: 'guards and the ledger only',
  guided: 'the mod proposes the next step, you trigger it',
  semi: 'the agent runs every non-human step and stops at each human gate',
}

function scaffolds(ctx: Ctx): RenderElement[] {
  const { vm, act, w } = ctx
  // A `confirm:` row is an approval waiting for a person, not a file to create: it never counts as missing.
  const isConfirm = (s: { id: string }): boolean => s.id.startsWith('confirm:')
  const files = vm.setup.filter(s => !isConfirm(s))
  const missing = files.filter(s => !s.exists)
  const out: RenderElement[] = [
    rule(ctx, [strong('Scaffolds'), dim(`  ${files.length - missing.length}/${files.length} in place`)], w),
  ]
  const labelW = Math.max(14, Math.min(24, w - 40))
  const createW = btnWidth({ label: 'Confirm' })
  for (const s of vm.setup) {
    // Missing rows leave room for their Create button so the buttons line up on the right.
    const room = s.exists ? w : w - createW - 1
    const text = txt(ctx, [
      { t: s.exists ? '✔' : '☐', color: s.exists ? C.ok : C.human },
      ' ',
      { t: pad(s.label, labelW), dimColor: s.exists },
      ' ',
      dim(pad(`P${String(s.play).padStart(2, '0')}  ${clip(s.path, Math.max(10, room - labelW - 8))}`, Math.max(0, room - labelW - 4))),
    ])
    out.push(
      s.exists
        ? text.node
        : rowBox(ctx, [text, btn(ctx, { key: `setup:create:${s.id}`, label: isConfirm(s) ? 'Confirm' : 'Create', onPress: () => act.scaffold(s.id) })]),
    )
    if (!s.exists && s.hint) out.push(line(ctx, ['    ', dim(clip(s.hint, w - 4))]))
  }
  if (missing.length > 0) {
    out.push(
      ...flow(
        ctx,
        [btn(ctx, { key: 'setup:create-all', label: `c Create all missing (${missing.length})`, hotkey: 'c', hint: 'create all', primary: true, onPress: () => act.scaffoldAll() })],
        w,
      ),
    )
  }
  return out
}

function knowledge(ctx: Ctx): RenderElement[] {
  const { vm, act, w } = ctx
  const k = vm.knowledge
  const source = k.source === 'repo' ? `repo: ${k.root}/` : 'bundled snapshot'
  const out: RenderElement[] = [
    rule(ctx, [strong('Knowledge')], w),
    ...flow(
      ctx,
      [
        txt(ctx, [dim('Source '), strong(source), dim(` · ${plural(vm.plays.length, 'play')}${k.title && w >= 90 ? ' · ' + clip(k.title, w - 60) : ''}`)]),
        btn(ctx, { key: 'setup:reload', label: 'r Reload knowledge', hotkey: 'r', hint: 'reload', onPress: () => act.reloadKnowledge() }),
      ],
      w,
      2,
    ),
  ]
  if (k.source === 'bundled') out.push(line(ctx, [dim(clip('A repo openknowledge/ folder, when present, overrides the bundled plays and templates.', w))]))
  for (const issue of k.issues.slice(0, 4)) out.push(line(ctx, [col('⚠ ', C.human), clip(issue, w - 2)]))
  if (k.issues.length > 4) out.push(line(ctx, [dim(`  … and ${k.issues.length - 4} more`)]))
  return out
}

function issues(ctx: Ctx): RenderElement[] {
  const { vm, w } = ctx
  if (vm.configIssues.length === 0) return []
  return [
    rule(ctx, [strong('Config issues', C.bad), dim(`  ${vm.configIssues.length} in .okf/config.json`)], w, C.bad),
    ...vm.configIssues.slice(0, 6).map(i => line(ctx, [col('✖ ', C.bad), clip(i, w - 2)])),
    ...(vm.configIssues.length > 6 ? [line(ctx, [dim(`  … and ${vm.configIssues.length - 6} more`)])] : []),
  ]
}

function autonomy(ctx: Ctx): RenderElement[] {
  const { vm, act, w, el } = ctx
  const a = vm.config.autonomy
  const out: RenderElement[] = [rule(ctx, [strong('Autonomy')], w)]
  const { Select } = el
  const setMode = (v: string): void => {
    const mode = MODES.find(m => m === v)
    if (mode) act.setMode(mode)
  }
  if (Select) {
    out.push(
      <Select key="setup:mode" label="Mode " value={a.mode} options={MODES.map(m => ({ value: m, label: modeLabel(m) }))} onSelect={setMode} />,
      line(ctx, [dim(clip(MODE_BLURB[a.mode], w))]),
    )
  } else {
    out.push(
      ...flow(
        ctx,
        MODES.map(m => btn(ctx, { key: `setup:mode:${m}`, label: modeLabel(m), primary: a.mode === m, onPress: () => act.setMode(m) })),
        w,
      ),
      line(ctx, [dim(clip(MODE_BLURB[a.mode], w))]),
    )
  }
  if (vm.autopilot.mode !== a.mode) {
    out.push(...wrapText(`Configured ${modeLabel(a.mode)} but running ${modeLabel(vm.autopilot.mode)}: autopilot needs Plays 03, 04 and 08 adopted.`, w - 2, 2).map(l => line(ctx, [col('⚠ ', C.human), l])))
  }
  out.push(
    line(ctx, [dim(clip(`Budget ${a.maxAutoTurns} turns between gates · halts after ${a.haltOnBlocks} blocks or ${a.haltOnVerifyFails} failed verifications`, w))]),
    line(ctx, [dim(clip(`You sign: ${a.humanGates.join(' · ')}`, w))]),
  )
  return out
}

function bands(ctx: Ctx): RenderElement[] {
  const { vm, act, w } = ctx
  const cfg = vm.config.bands
  const out: RenderElement[] = [rule(ctx, [strong('Bands'), dim(`  Play 13 · ${cfg.enabled ? `${plural(vm.bands.length, 'metric')} watched · window ${cfg.window}` : 'off'}`)], w)]
  if (!cfg.enabled) {
    out.push(...wrapText('Off. Set bands.enabled in .okf/config.json and add a bands.yaml: the watcher then samples each source on its interval and escalates by sigma.', w, 2).map(l => line(ctx, [dim(l)])))
    return out
  }
  const nameW = Math.max(10, Math.min(22, w - 44))
  for (const b of vm.bands) {
    const r = b.last
    const z = r ? `z ${r.z >= 0 ? '+' : ''}${r.z.toFixed(1)}${w >= 70 ? ` · n=${r.n}` : ''}` : 'collecting'
    out.push(
      line(ctx, [
        { t: tierGlyph(b.tier) + ' ', color: tierColor(b.tier) },
        { t: pad(clip(b.metric, nameW), nameW), bold: true },
        ' ',
        { t: spark(b.values, 12), color: tierColor(b.tier) },
        '  ',
        { t: pad(tierLabel(b.tier), 11), color: tierColor(b.tier) },
        dim(z),
      ]),
    )
  }
  if (vm.bands.length === 0) out.push(line(ctx, [dim('No band sources yet. Add them under bands.sources in config.')]))
  out.push(...flow(ctx, [btn(ctx, { key: 'setup:bands-check', label: 'b Check now', hotkey: 'b', hint: 'check bands', onPress: () => act.checkBands() })], w))
  return out
}

export function setupTab(ctx: Ctx): RenderElement[] {
  return [...scaffolds(ctx), blank(ctx), ...knowledge(ctx), ...issues(ctx), blank(ctx), ...autonomy(ctx), blank(ctx), ...bands(ctx)]
}
