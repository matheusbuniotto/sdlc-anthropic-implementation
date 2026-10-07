import { test, expect, describe } from 'claude-code/testing'

import type { RenderElement } from 'claude-code'

import type { UiTab, ViewModel } from '../types'
import { renderBand, statusText } from '../hooks/ui/Band'
import { tidy, type Surface } from '../hooks/ui/elements'
import { renderPane } from '../hooks/ui/Pane'
import { chainFor } from '../hooks/ui/PlaysTab'
import { applyLedgerFilter, LEDGER_FILTERS } from '../hooks/ui/LedgerTab'
import { pickMetrics } from '../hooks/ui/LoopTab'
import { ago, bar, cells, clip, clipStart, dur, pad, playTitle, spark, wrapText } from '../hooks/ui/theme'
import {
  NOW,
  SURFACES,
  awaitingHumanView,
  blockedView,
  emptyView,
  fakeElements,
  noopActions,
  quarantinedView,
  releaseView,
  sampleBands,
  sampleUi,
  sampleView,
} from './fixtures'
import { findAll, findButton, maxWidth, renderNatural, renderText, textOf, type TreeNode } from './render-text'

const TABS: UiTab[] = ['loop', 'plays', 'guards', 'ledger', 'setup']
const SCENARIOS: [string, () => ViewModel][] = [
  ['sample', () => sampleView()],
  ['empty', () => emptyView()],
  ['blocked', () => blockedView()],
  ['awaiting-human', () => awaitingHumanView()],
  ['release', () => releaseView()],
  ['quarantined', () => quarantinedView()],
]

function pane(surface: Surface, vm: ViewModel, tab: UiTab, columns = 120, rows = 40, ui: Partial<ReturnType<typeof sampleUi>> = {}) {
  const act = noopActions()
  const tree = renderPane(fakeElements(surface), { vm, ui: sampleUi({ tab, ...ui }), act, columns, rows, surface }) as unknown as TreeNode
  return { tree, act }
}

const text = (tree: TreeNode): string => renderNatural(tree).join('\n')

function press(tree: TreeNode, key: string): void {
  const b = findButton(tree, key)
  if (!b) throw new Error(`no Button keyed ${key}`)
  ;(b.props.onPress as () => void)()
}

// What the engine accepts: anything else makes it drop the whole tree.
const BOX = new Set(['key', 'flexDirection', 'flexGrow', 'flexShrink', 'flexWrap', 'alignItems', 'alignSelf', 'justifyContent', 'gap', 'columnGap', 'rowGap', 'width', 'height', 'minWidth', 'minHeight', 'margin', 'marginX', 'marginY', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'padding', 'paddingX', 'paddingY', 'paddingTop', 'paddingBottom', 'paddingLeft', 'paddingRight', 'borderStyle', 'borderColor', 'borderDimColor', 'backgroundColor', 'overflow', 'display', 'position', 'top', 'left', 'right', 'bottom', 'hover'])
const TEXT = new Set(['color', 'backgroundColor', 'dimColor', 'bold', 'italic', 'underline', 'strikethrough', 'inverse', 'wrap', 'hover', 'key'])
const BUTTON = new Set(['key', 'label', 'hotkey', 'action', 'plain', 'dimColor', 'variant', 'role', 'autoFocus', 'hover', 'onPress'])
const INPUT = new Set(['key', 'label', 'placeholder', 'value', 'submitLabel', 'autoFocus', 'onInput', 'onSubmit'])
const SELECT = new Set(['key', 'label', 'options', 'value', 'autoFocus', 'onSelect'])
const BORDERS = new Set(['single', 'double', 'round', 'bold', 'singleDouble', 'doubleSingle', 'classic', 'arrow', 'dashed', 'quote'])

type Node = { type: string; props?: Record<string, unknown>; children?: unknown[] }

function audit(tree: TreeNode, surface: Surface): string[] {
  const problems: string[] = []
  const keys: string[] = []
  const hotkeys: string[] = []
  const visit = (n: TreeNode, inline: boolean): void => {
    if (n === null || n === undefined || n === false || typeof n === 'string') return
    const node = n as Node
    const props = node.props ?? {}
    const allowed = { Box: BOX, Text: TEXT, Button: BUTTON, Input: INPUT, Select: SELECT }[node.type as 'Box']
    if (!allowed) problems.push(`unexpected element ${node.type}`)
    for (const [name, value] of Object.entries(props)) {
      if (allowed && !allowed.has(name)) problems.push(`${node.type} has unknown prop ${name}`)
      if (value === false) problems.push(`${node.type}.${name} is false (omit it instead)`)
      if (value === undefined) problems.push(`${node.type}.${name} is undefined`)
    }
    if (node.type === 'Box' && typeof props.borderStyle === 'string' && !BORDERS.has(props.borderStyle)) problems.push(`borderStyle ${props.borderStyle}`)
    if (node.type === 'Button') {
      if (inline) problems.push('Button inside Text')
      if (typeof props.key !== 'string' || props.key === '') problems.push('Button without key')
      if (typeof props.label !== 'string' || props.label === '') problems.push(`Button ${String(props.key)} without label`)
      if (typeof props.onPress !== 'function') problems.push(`Button ${String(props.key)} without onPress`)
      if (props.hotkey !== undefined) {
        if (typeof props.hotkey !== 'string' || !/^[0-9a-z]$/.test(props.hotkey)) problems.push(`hotkey ${String(props.hotkey)} is not one digit or lowercase letter`)
        else hotkeys.push(props.hotkey)
      }
    }
    if (node.type === 'Input' || node.type === 'Select') {
      if (surface === 'mobile') problems.push(`${node.type} on mobile`)
      if (typeof props.key !== 'string') problems.push(`${node.type} without key`)
    }
    if (node.type === 'Button' || node.type === 'Input' || node.type === 'Select') keys.push(String(props.key))
    if (inline && node.type === 'Box') problems.push('Box inside Text')
    for (const c of node.children ?? []) visit(c as TreeNode, node.type === 'Text')
  }
  visit(tree, false)
  for (const k of keys) if (keys.indexOf(k) !== keys.lastIndexOf(k)) problems.push(`duplicate key ${k}`)
  for (const h of hotkeys) if (hotkeys.indexOf(h) !== hotkeys.lastIndexOf(h)) problems.push(`duplicate hotkey ${h}`)
  return [...new Set(problems)]
}

test('h is a global in the plugin environment', () => {
  expect(typeof h).toBe('function')
  const Box = (props: { gap?: number }): RenderElement => ({ type: 'Box', props } as unknown as RenderElement)
  expect(<Box gap={1} />).toMatchObject({ type: 'Box', props: { gap: 1 } })
})

describe('every fixture renders on every surface', () => {
  for (const surface of SURFACES) {
    for (const [name, build] of SCENARIOS) {
      for (const tab of TABS) {
        test(`${surface} · ${name} · ${tab}`, () => {
          const { tree } = pane(surface, build(), tab)
          const lines = renderNatural(tree)
          expect(lines.length).toBeGreaterThan(8)
          expect(audit(tree, surface)).toEqual([])
        })
      }
    }
  }
})

describe('plays tab with a selected play', () => {
  for (const surface of SURFACES) {
    for (const columns of [80, 160]) {
      test(`${surface} · ${columns} columns`, () => {
        const { tree } = pane(surface, sampleView(), 'plays', columns, 40, { selectedPlay: 11 })
        expect(audit(tree, surface)).toEqual([])
        expect(text(tree)).toContain('Play 11')
      })
    }
  }
})

describe('widths: no row wider than the columns', () => {
  for (const columns of [60, 80, 120, 160]) {
    for (const [name, build] of SCENARIOS) {
      for (const tab of TABS) {
        test(`${columns} · ${name} · ${tab}`, () => {
          const { tree } = pane('terminal', build(), tab, columns, 40, tab === 'plays' ? { selectedPlay: 7 } : {})
          const lines = renderNatural(tree)
          const wide = lines.filter(l => cells(l) > columns)
          expect(wide).toEqual([])
          expect(maxWidth(renderText(tree, columns))).toBeLessThanOrEqual(columns)
        })
      }
    }
  }

  test('content stays readable on very wide panes', () => {
    const { tree } = pane('terminal', sampleView(), 'loop', 200)
    expect(maxWidth(renderNatural(tree))).toBeLessThanOrEqual(140)
  })
})

describe('responsive layout', () => {
  test('ribbon is horizontal from 110 columns and a vertical list below', () => {
    const wide = text(pane('terminal', sampleView(), 'loop', 120).tree)
    const narrow = text(pane('terminal', sampleView(), 'loop', 100).tree)
    expect(wide).toContain('─▶')
    expect(wide).toMatch(/① Plan.*② Design.*③ Build/)
    expect(narrow).not.toContain('─▶')
    expect(narrow.split('\n').filter(l => /^\s*[▸ ] [✔●◆✖○◌] [①②③④⑤⑥]/.test(l))).toHaveLength(6)
  })

  test('a short viewport drops the secondary cards', () => {
    const tall = renderNatural(pane('terminal', sampleView(), 'loop', 120, 40).tree)
    const short = renderNatural(pane('terminal', sampleView(), 'loop', 120, 16).tree)
    expect(short.length).toBeLessThan(tall.length)
    expect(short.join('\n')).not.toContain('Artifacts')
    expect(short.join('\n')).toContain('Run next')
  })

  test('plays: side by side when wide, inline detail when narrow', () => {
    const wide = renderNatural(pane('terminal', sampleView(), 'plays', 150, 40, { selectedPlay: 7 }).tree)
    expect(wide.some(l => l.includes('Capture as intent.md') && l.includes('│'))).toBe(true)
    expect(wide.some(l => l.includes('Hooks as Build-Time Guardrails') && l.includes('Play 07'))).toBe(true)
    const narrow = renderNatural(pane('terminal', sampleView(), 'plays', 90, 40, { selectedPlay: 7 }).tree)
    const at = narrow.findIndex(l => l.includes('07 Hooks as Build-Time Guardrails'))
    expect(narrow[at + 1]).toContain('╭')
  })
})

describe('header and tabs', () => {
  test('mode, autopilot and release chips', () => {
    const t = text(pane('terminal', sampleView(), 'loop').tree)
    expect(t).toContain('◉ The Loop')
    expect(t).toContain('semi-auto')
    expect(t).toContain('▶ running 4/12')
    expect(t).toContain('🔒 prod locked')
    const granted = text(pane('terminal', sampleView({ release: { envToken: false, grantUntil: NOW + 12 * 60_000 } }), 'loop').tree)
    expect(granted).toContain('🔓 release grant 12m')
    const paused = text(pane('terminal', sampleView({ autopilot: { ...sampleView().autopilot, paused: true, state: 'paused' } }), 'loop').tree)
    expect(paused).toContain('⏸ paused')
    expect(paused).toContain('Resume')
    expect(text(pane('terminal', awaitingHumanView(), 'loop').tree)).toContain('■ human gate')
  })

  test('run picker shows the active run and steps through the runs', () => {
    const { tree, act } = pane('terminal', sampleView(), 'loop')
    expect(text(tree)).toContain('Add rate limiting to checkout')
    expect(text(tree)).toContain('1/3')
    press(tree, 'run:next')
    press(tree, 'run:prev')
    expect(act.calls.map(c => [c.name, c.args[0]])).toEqual([
      ['selectRun', 'retry-payment-webhooks'],
      ['selectRun', 'incident-2026-10-04'],
    ])
  })

  test('a single run has no arrows', () => {
    const vm = sampleView()
    const { tree } = pane('terminal', { ...vm, runs: vm.runs.slice(0, 1) }, 'loop')
    expect(findButton(tree, 'run:next')).toBeUndefined()
  })

  test('tab strip: five tabs with hotkeys 1 to 5, the current one is primary, the Loop flags attention', () => {
    const { tree, act } = pane('terminal', awaitingHumanView(), 'plays')
    const tabs = findAll(tree, 'Button').filter(b => String(b.props.key).startsWith('tab:'))
    expect(tabs.map(b => b.props.hotkey)).toEqual(['1', '2', '3', '4', '5'])
    expect(tabs.filter(b => b.props.variant === 'primary').map(b => b.props.key)).toEqual(['tab:plays'])
    expect(tabs[0]?.props.label).toContain('◆')
    press(tree, 'tab:ledger')
    expect(act.calls).toEqual([{ name: 'setTab', args: ['ledger'] }])
  })

  test('mode button cycles the configured mode; pause toggles', () => {
    const { tree, act } = pane('terminal', sampleView(), 'loop')
    press(tree, 'mode')
    press(tree, 'pause')
    expect(act.calls).toEqual([
      { name: 'setMode', args: ['manual'] },
      { name: 'togglePause', args: [] },
    ])
    const manual = sampleView({ autopilot: { ...sampleView().autopilot, mode: 'manual', state: 'manual' } })
    expect(findButton(pane('terminal', manual, 'loop').tree, 'pause')).toBeUndefined()
  })

  test('notice and config issues are shown on every tab; Setup lists them', () => {
    const vm = sampleView({ notice: 'Spec approved.', configIssues: ['autonomy.maxAutoTurns must be a number', 'unknown key "foo"'] })
    expect(text(pane('terminal', vm, 'plays').tree)).toContain('› Spec approved.')
    const { tree, act } = pane('terminal', vm, 'guards')
    expect(text(tree)).toContain('2 config issues')
    press(tree, 'issues:open')
    expect(act.calls).toEqual([{ name: 'setTab', args: ['setup'] }])
    const setup = text(pane('terminal', vm, 'setup').tree)
    expect(setup).toContain('autonomy.maxAutoTurns must be a number')
    expect(setup).not.toContain('Open Setup')
  })

  test('a view model that is not ready shows a loading line', () => {
    const t = text(pane('terminal', sampleView({ ready: false }), 'loop').tree)
    expect(t).toContain('Loading the Loop')
  })
})

describe('tabs switch content', () => {
  const marks: Record<UiTab, string[]> = {
    loop: ['Artifacts', 'Metrics', 'Run next'],
    plays: ['adopted', 'Dependency chains', '★ 01'],
    guards: ['Recent interceptions', 'Production gate', 'Protect paths'],
    ledger: ['Ledger', 'Export AUDIT.md', 'newest first'],
    setup: ['Scaffolds', 'Knowledge', 'Autonomy', 'Bands'],
  }
  for (const tab of TABS) {
    test(tab, () => {
      const t = text(pane('terminal', sampleView(), tab).tree)
      for (const m of marks[tab]) expect(t).toContain(m)
      for (const other of TABS.filter(o => o !== tab)) {
        expect(t).not.toContain(marks[other][0] === 'Ledger' ? 'newest first' : (marks[other][0] ?? ''))
      }
    })
  }

  test('the footer lists the hotkeys that exist on the tab', () => {
    const footer = (tab: UiTab, vm = sampleView()): string => renderNatural(pane('terminal', vm, tab, 160).tree).slice(-2).join(' ')
    expect(footer('loop', awaitingHumanView())).toContain('a approve')
    expect(footer('loop', awaitingHumanView())).toContain('r reject')
    expect(footer('guards')).toContain('g grant release')
    expect(footer('setup')).toContain('c create all')
    expect(footer('plays')).toContain('j next play')
    expect(footer('loop')).toContain('Esc closes')
    expect(renderNatural(pane('mobile', sampleView(), 'loop').tree).join('\n')).not.toContain('Esc closes')
  })
})

describe('Loop tab states', () => {
  test('empty: welcome card, New-run input, /sdlc init hint, no gate buttons', () => {
    const { tree } = pane('terminal', emptyView(), 'loop')
    const t = text(tree)
    expect(t).toContain('One change flows through six stages')
    expect(t).toContain('You sign four gates')
    expect(t).toContain('feed an anomaly back into a new intent')
    expect(t).toContain('Run /sdlc init')
    expect(t).toContain('No active run')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    expect(findButton(tree, 'gate:reject')).toBeUndefined()
    expect(findAll(tree, 'Input').map(i => i.props.key)).toEqual(['newrun'])
    expect(t).not.toContain('Artifacts')
  })

  test('empty on mobile degrades the input to a hint', () => {
    const { tree } = pane('mobile', emptyView(), 'loop')
    expect(findAll(tree, 'Input')).toHaveLength(0)
    expect(text(tree)).toContain('/sdlc new')
  })

  test('empty with scaffolds in place says so', () => {
    const vm = emptyView()
    const t = text(pane('terminal', { ...vm, setup: vm.setup.map(s => ({ ...s, exists: true })) }, 'loop').tree)
    expect(t).toContain('Scaffolds are in place')
  })

  test('mid-loop: the gate has passed, the next gate is up next, the agent owes the next move', () => {
    const { tree, act } = pane('terminal', sampleView(), 'loop')
    const t = text(tree)
    expect(t).toContain('③ Build')
    expect(t).toContain('in progress')
    expect(t).toContain('up next · verify.pass')
    expect(t).toContain('owed by agent')
    expect(t).toContain('⟲ 2σ breach → intent')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    const next = findButton(tree, 'next:run')
    expect(next?.props.hotkey).toBe('n')
    press(tree, 'next:run')
    expect(act.calls).toEqual([{ name: 'runNext', args: [] }])
  })

  test('awaiting human: yellow chip, requirements with who owes each, Approve and Reject wired', () => {
    const { tree, act } = pane('terminal', awaitingHumanView(), 'loop')
    const t = text(tree)
    expect(t).toContain('◆ needs you')
    expect(t).toContain('☐ 2 flagged concerns to resolve')
    expect(t).toMatch(/✔ spec\.md exists\s+machine/)
    expect(t).toMatch(/☐ Status: approved\s+you/)
    expect(t).toContain('owed by you')
    expect(findButton(tree, 'gate:approve')?.props).toMatchObject({ hotkey: 'a', variant: 'primary' })
    expect(findButton(tree, 'gate:reject')?.props.hotkey).toBe('r')
    expect(findButton(tree, 'next:run')).toBeUndefined()
    press(tree, 'gate:approve')
    press(tree, 'gate:reject')
    expect(act.calls).toEqual([
      { name: 'approve', args: ['spec.approve'] },
      { name: 'reject', args: ['spec.approve'] },
    ])
  })

  test('awaiting human but not ready: Approve and Reject are text, not Buttons', () => {
    const vm = awaitingHumanView()
    const active = vm.active
    if (!active) throw new Error('fixture has a run')
    const stages = active.stages.map(s =>
      s.id === 'design'
        ? { ...s, state: 'active' as const, gates: s.gates.map(g => ({ ...g, ready: false, blockedBy: ['2 sections missing'] })) }
        : s,
    )
    const { tree } = pane('terminal', { ...vm, active: { ...active, stages, health: 'ok' } }, 'loop')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    expect(findButton(tree, 'gate:reject')).toBeUndefined()
    expect(text(tree)).toContain('unlock once the checks pass')
    expect(text(tree)).toContain('2 sections missing')
  })

  test('release gate: the person authorizes the release', () => {
    const { tree, act } = pane('terminal', releaseView(), 'loop')
    expect(findButton(tree, 'gate:approve')?.props.label).toContain('Authorize release')
    press(tree, 'gate:approve')
    expect(act.calls).toEqual([{ name: 'approve', args: ['release.approve'] }])
  })

  test('blocked: red chip, the failing check is named, only the agent can move it', () => {
    const { tree } = pane('terminal', blockedView(), 'loop')
    const t = text(tree)
    expect(t).toContain('✖ blocked')
    expect(t).toContain('✖ ④ Test')
    expect(t).toMatch(/✖ verdict PASS · verdict is FAIL\s+machine/)
    expect(t).toContain('Fix the failing verification')
    expect(t).toContain('■ verify failing')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    expect(findButton(tree, 'next:run')).toBeDefined()
  })

  test('shipped run: every gate passed', () => {
    const vm = releaseView()
    const active = vm.active
    if (!active) throw new Error('fixture has a run')
    const stages = active.stages.map(s => ({
      ...s,
      state: s.id === 'maintain' ? ('monitoring' as const) : ('done' as const),
      gates: s.gates.map(g => ({ ...g, approved: true, ready: true })),
    }))
    const { tree } = pane('terminal', { ...vm, active: { ...active, stages, current: 'maintain', health: 'ok', next: { ...active.next, kind: 'monitor', byHuman: false, label: 'Watch the bands', reason: 'Released.', promptKey: undefined, gate: undefined } } }, 'loop')
    expect(text(tree)).toContain('Shipped')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    expect(findButton(tree, 'next:run')).toBeUndefined()
  })

  test('artifact chain shows each artifact with its status and path', () => {
    const t = text(pane('terminal', sampleView(), 'loop').tree)
    expect(t).toMatch(/✔ intent\s+→ ✔ spec\s+→ ● plan\s+→ ○ proof\s+→ ○ review\s+→ ◌ bands/)
    expect(t).toContain('in-progress')
    const narrow = text(pane('terminal', sampleView(), 'loop', 90).tree)
    expect(narrow).toContain('plans/rate-limit-checkout.plan.md')
    expect(text(pane('terminal', blockedView(), 'loop', 90).tree)).toMatch(/✖ proof\s+failed/)
  })

  test('metrics: worst first, at most four, with the target', () => {
    const picked = pickMetrics(sampleView().metrics, 4)
    expect(picked.map(m => m.status)).toEqual(['bad', 'bad', 'warn', 'warn'])
    const t = text(pane('terminal', sampleView(), 'loop').tree)
    expect(t).toContain('Plan drift')
    expect(t).toContain('50% vs ≥ 90%')
    expect(t).not.toContain('Gate wait')
  })

  test('breach strip with sparkline; quiet bands add nothing', () => {
    const t = text(pane('terminal', sampleView(), 'loop').tree)
    expect(t).toMatch(/▲ 2σ\s+error_rate [▁▂▃▄▅▆▇█]{8,}/)
    expect(t).toContain('read-only diagnosis')
    const calm = sampleView({ bands: sampleBands().map(b => ({ ...b, tier: 'in-control' as const })) })
    expect(text(pane('terminal', calm, 'loop').tree)).not.toContain('error_rate')
    const three = sampleView({ bands: sampleBands().map(b => ({ ...b, tier: '3sigma' as const })) })
    expect(text(pane('terminal', three, 'loop').tree)).toContain('proposal: a human decides')
  })

  test('new run input: typing and Enter reach the actions; Start shows once there is text', () => {
    const { tree, act } = pane('terminal', sampleView(), 'loop', 120, 40, { draftIdea: 'rate limit login' })
    const input = findAll(tree, 'Input')[0]
    expect(input?.props.value).toBe('rate limit login')
    ;(input?.props.onInput as (v: string) => void)('rate limit login too')
    ;(input?.props.onSubmit as (v: string) => void)('rate limit login too')
    press(tree, 'newrun:start')
    expect(act.calls).toEqual([
      { name: 'setDraftIdea', args: ['rate limit login too'] },
      { name: 'newRun', args: ['rate limit login too'] },
      { name: 'newRun', args: ['rate limit login'] },
    ])
    expect(findButton(pane('terminal', sampleView(), 'loop').tree, 'newrun:start')).toBeUndefined()
  })

  test('with no active run, the runs that exist can be opened', () => {
    const { tree, act } = pane('terminal', sampleView({ active: null }), 'loop')
    expect(text(tree)).toContain('Retry payment webhooks with backoff')
    press(tree, 'run:use:retry-payment-webhooks')
    expect(act.calls).toEqual([{ name: 'selectRun', args: ['retry-payment-webhooks'] }])
  })
})

describe('quarantined approvals', () => {
  test('a held approval is the first card of the Loop tab, with a primary Confirm button wired to act.confirm', () => {
    const { tree, act } = pane('terminal', quarantinedView(), 'loop')
    const lines = renderNatural(tree)
    const t = lines.join('\n')
    expect(t).toContain('⚠ specs/rate-limit-checkout.spec.md says approved but changed while the agent was working')
    expect(t).toContain('Status: approved appeared at 12:14')
    expect(t).toContain('Held until you confirm: the agent cannot sign its own gate.')
    expect(lines.findIndex(l => l.includes('says approved but changed'))).toBeLessThan(lines.findIndex(l => l.includes('① Plan')))
    expect(findButton(tree, 'quarantine:confirm')?.props).toMatchObject({ label: 'c Confirm approval', hotkey: 'c', variant: 'primary' })
    press(tree, 'quarantine:confirm')
    expect(act.calls).toEqual([{ name: 'confirm', args: ['spec.approve'] }])
  })

  test('the held gate is awaiting a human and offers Reject, not a second way to approve', () => {
    const { tree } = pane('terminal', quarantinedView(), 'loop')
    const t = text(tree)
    expect(t).toContain('◆ needs you')
    expect(t).toContain('☐ Status: approved · held: changed while the agent was working')
    expect(t).toMatch(/✔ spec\s+→|⚠ spec/)
    expect(t).toContain('Confirm the held approval above')
    expect(findButton(tree, 'gate:approve')).toBeUndefined()
    expect(findButton(tree, 'gate:reject')?.props.hotkey).toBe('r')
  })

  test('other runs held elsewhere show a count chip; the active run alone shows none', () => {
    expect(text(pane('terminal', quarantinedView(), 'loop').tree)).toContain('⚠ 1 held in other run')
    expect(text(pane('terminal', quarantinedView(), 'plays').tree)).toContain('⚠ 1 held in other run')
    const only = quarantinedView({ quarantined: quarantinedView().quarantined.slice(0, 1) })
    expect(text(pane('terminal', only, 'loop').tree)).not.toContain('held in other')
    expect(text(pane('terminal', sampleView(), 'loop').tree)).not.toContain('held')
    expect(findButton(pane('terminal', sampleView(), 'loop').tree, 'quarantine:confirm')).toBeUndefined()
  })

  test('with no active run, held runs are marked in the list', () => {
    const vm = quarantinedView({ active: null })
    const t = text(pane('terminal', vm, 'loop').tree)
    expect(t).toContain('⚠ 2 held')
    expect(findButton(pane('terminal', vm, 'loop').tree, 'quarantine:confirm')).toBeUndefined()
  })

  test('narrow and desktop: the card wraps instead of overflowing', () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const columns of [60, 80, 120]) {
        const lines = renderNatural(pane(surface, quarantinedView(), 'loop', columns).tree)
        expect(lines.filter(l => cells(l) > columns)).toEqual([])
        expect(lines.join('\n')).toContain('Confirm approval')
      }
    }
  })

  test('band: ⚠ confirm <gate> with a Confirm button (a letter), expanded shows the detail', () => {
    const band = (ui = {}) =>
      renderBand(fakeElements('terminal'), { vm: quarantinedView(), ui: sampleUi(ui), act, columns: 120, surface: 'terminal' }) as unknown as TreeNode
    const act = noopActions()
    const tree = band()
    const t = renderNatural(tree).join('\n')
    expect(t).toContain('⚠ confirm spec.approve')
    expect(t).toContain('says approved, held until you confirm')
    expect(findButton(tree, 'band:confirm')?.props).toMatchObject({ label: 'Confirm', hotkey: 'c', variant: 'primary' })
    expect(findButton(tree, 'band:approve')).toBeUndefined()
    press(tree, 'band:confirm')
    expect(act.calls).toEqual([{ name: 'confirm', args: ['spec.approve'] }])
    expect(renderNatural(band({ bandExpanded: true }))[1]).toContain('no approval recorded by the mod')
    const keys = findAll(tree, 'Button').map(b => b.props.hotkey)
    for (const k of keys) expect(k).toMatch(/^[a-z]$/)
    expect(new Set(keys).size).toBe(keys.length)
    for (const columns of [50, 80]) {
      const narrow = renderBand(fakeElements('terminal'), { vm: quarantinedView(), ui: sampleUi({ bandExpanded: true }), act, columns, surface: 'terminal' }) as unknown as TreeNode
      expect(renderNatural(narrow).filter(l => cells(l) > columns)).toEqual([])
      expect(findButton(narrow, 'band:confirm')).toBeDefined()
    }
  })

  test('Setup: a leftover confirm: row says Confirm and never counts as a missing file', () => {
    const vm = sampleView()
    const withRow = { ...vm, setup: [...vm.setup, { id: 'confirm:rate-limit-checkout:spec.approve', label: 'Confirm spec approval', path: 'specs/rate-limit-checkout.spec.md', play: 2, exists: false, hint: 'Approved on disk; waiting for you.' }] }
    const { tree, act } = pane('terminal', withRow, 'setup')
    expect(findButton(tree, 'setup:create:confirm:rate-limit-checkout:spec.approve')?.props.label).toBe('Confirm')
    expect(findButton(tree, 'setup:create-all')?.props.label).toContain('(4)')
    expect(text(tree)).toContain('3/7 in place')
    press(tree, 'setup:create:confirm:rate-limit-checkout:spec.approve')
    expect(act.calls).toEqual([{ name: 'scaffold', args: ['confirm:rate-limit-checkout:spec.approve'] }])
    const onlyConfirm = { ...vm, setup: [...vm.setup.map(s => ({ ...s, exists: true })), withRow.setup[withRow.setup.length - 1] as (typeof vm.setup)[number]] }
    expect(findButton(pane('terminal', onlyConfirm, 'setup').tree, 'setup:create-all')).toBeUndefined()
  })
})

describe('Plays tab', () => {
  test('14 plays grouped by stage, entry points starred, adoption and hints', () => {
    const { tree } = pane('terminal', sampleView(), 'plays', 120)
    const t = text(tree)
    for (const n of ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14']) expect(t).toMatch(new RegExp(`${n} \\S`))
    for (const stage of ['① Plan', '② Design', '③ Build', '④ Test', '⑤ Deploy', '⑥ Maintain']) expect(t).toContain(stage)
    expect(t.match(/\[.\] ★ \d\d/g)).toHaveLength(4)
    expect(t).toContain('10/14 adopted')
    expect(t).toMatch(/\[ \]\s+13 .* needs 09, 12/)
    expect(t).toMatch(/\[x\]\s+★ 05 .* needed by 06, 10/)
    expect(t).toContain('★ 07 → 11 → 10 → 12 → 13 → 14')
    expect(text(pane('terminal', sampleView(), 'plays', 120).tree)).not.toContain('Play 07 · ')
  })

  test('row buttons toggle adoption and select the play', () => {
    const { tree, act } = pane('terminal', sampleView(), 'plays')
    press(tree, 'play:9:toggle')
    press(tree, 'play:9:open')
    expect(act.calls).toEqual([
      { name: 'togglePlay', args: [9] },
      { name: 'selectPlay', args: [9] },
    ])
  })

  test('detail card: summary, needs, unlocks, chain, enforcement, evidence, doc', () => {
    const { tree, act } = pane('terminal', sampleView(), 'plays', 120, 40, { selectedPlay: 10 })
    const t = text(tree)
    expect(t).toContain('Play 10 · Dual-Direction AI in the PR Review Loop')
    expect(t).toContain('✔ Play 05')
    expect(t).toMatch(/Unlocks\s+Play 12\s+Play 13/)
    expect(t).toContain('05 → 06 → 10 → 12 → 13 → 14')
    expect(t).toContain('Three-pass reviewer agent')
    expect(t).toContain('☐ REVIEW.md')
    expect(t).toContain('openknowledge/plays/play-10-ai-pr-review-loop.md (bundled)')
    expect(t).toContain('t Drop play')
    press(tree, 'play:toggle')
    press(tree, 'play:next')
    press(tree, 'play:prev')
    expect(act.calls.map(c => [c.name, c.args[0]])).toEqual([['togglePlay', 10], ['selectPlay', 11], ['selectPlay', 9]])
  })

  test('detail card of an unadopted play names what is missing', () => {
    const t = text(pane('terminal', sampleView(), 'plays', 120, 40, { selectedPlay: 13 }).tree)
    expect(t).toContain('✖ Play 09')
    expect(t).toContain('adopt Plays 09, 12 first')
    expect(text(pane('terminal', sampleView(), 'plays', 120, 40, { selectedPlay: 1 }).tree)).toContain('Play 02 depends on it')
    expect(text(pane('terminal', sampleView(), 'plays', 120, 40, { selectedPlay: 5 }).tree)).toContain('Plays 06, 10 depend on it')
    expect(text(pane('terminal', sampleView(), 'plays', 120, 40, { selectedPlay: 14 }).tree)).toContain('adopt Play 13 first')
    expect(t).toContain('not adopted')
  })

  test('j and k walk the list from nothing selected', () => {
    const first = pane('terminal', sampleView(), 'plays')
    press(first.tree, 'play:next')
    press(first.tree, 'play:prev')
    expect(first.act.calls.map(c => c.args[0])).toEqual([1, 14])
  })

  test('chains follow the longest path through a play', () => {
    const plays = sampleView().plays
    expect(chainFor(plays, 1)).toEqual([1, 2, 3, 4])
    expect(chainFor(plays, 11)).toEqual([7, 11, 10, 12, 13, 14])
    expect(chainFor(plays, 14)).toEqual([5, 6, 10, 12, 13, 14])
  })
})

describe('Guards tab', () => {
  test('production gate panel, guard rows with hits, dormant and off chips', () => {
    const vm = sampleView()
    const { tree } = pane('terminal', { ...vm, guards: vm.guards.map(g => (g.id === 'destructive-sql' ? { ...g, enabled: false } : g)) }, 'guards')
    const t = text(tree)
    expect(t).toContain('Production gate')
    expect(t).toContain('✖ RELEASE_APPROVAL not set')
    expect(t).toContain('none: production commands are denied')
    expect(t).toMatch(/Protect paths\s+P07\s+3 hits/)
    expect(t).toMatch(/Lock tests while fixing\s+P08\s+no hits/)
    expect(t).toMatch(/Credential shield .* dormant/)
    expect(t).toMatch(/No destructive SQL .* off/)
    expect(t).toContain('↳ okf-loop · Play 07 · Protect paths: .env is protected')
    expect(t).toContain('Recent interceptions')
    expect(t.match(/⊘ /g)?.length).toBeGreaterThanOrEqual(4)
  })

  test('toggle, grant and revoke call the actions', () => {
    const { tree, act } = pane('terminal', sampleView({ release: { envToken: false, grantUntil: NOW + 9 * 60_000 } }), 'guards')
    expect(text(tree)).toContain('9m left')
    press(tree, 'guard:plan-first:toggle')
    press(tree, 'release:grant')
    press(tree, 'release:revoke')
    expect(act.calls).toEqual([
      { name: 'toggleGuard', args: ['plan-first'] },
      { name: 'grantRelease', args: [15] },
      { name: 'revokeRelease', args: [] },
    ])
  })

  test('without a grant there is nothing to revoke; an env token is shown', () => {
    const none = pane('terminal', sampleView(), 'guards').tree
    expect(findButton(none, 'release:revoke')).toBeUndefined()
    expect(findButton(none, 'release:grant')?.props.label).toContain('Grant 15m')
    expect(text(pane('terminal', sampleView({ release: { envToken: true, grantUntil: null } }), 'guards').tree)).toContain('✔ RELEASE_APPROVAL is set')
  })

  test('empty ledger: no interceptions yet', () => {
    expect(text(pane('terminal', emptyView(), 'guards').tree)).toContain('Nothing blocked yet')
  })
})

describe('Ledger tab', () => {
  test('rows are newest first with time, icon, actor and summary', () => {
    const t = renderNatural(pane('terminal', sampleView(), 'ledger').tree)
    const rows = t.filter(l => /^\d\d:\d\d /.test(l))
    expect(rows.length).toBe(22)
    expect(rows[0]).toContain('error_rate reached 2σ')
    expect(rows[0]).toMatch(/^\d\d:\d\d {2}▲ {2}mod/)
    expect(rows[rows.length - 1]).toContain('Run created')
    expect(t).toContain('Today')
    expect(t).toContain('Yesterday')
  })

  test('filter chips set the filter and the current one is primary', () => {
    const { tree, act } = pane('terminal', sampleView(), 'ledger', 120, 40, { ledgerFilter: { kinds: ['guard.blocked'], run: null, query: '' } })
    const chips = findAll(tree, 'Button').filter(b => String(b.props.key).startsWith('ledger:filter:'))
    expect(chips.map(c => c.props.label)).toEqual(['All', 'Gates', 'Guards', 'Proof', 'Autopilot', 'Bands'])
    expect(chips.filter(c => c.props.variant === 'primary').map(c => c.props.label)).toEqual(['Guards'])
    press(tree, 'ledger:filter:proof')
    press(tree, 'ledger:run')
    press(tree, 'ledger:export')
    expect(act.calls[0]).toEqual({ name: 'setLedgerFilter', args: [{ kinds: ['proof.pass', 'proof.fail', 'agent.verdict'], run: null, query: '' }] })
    expect(act.calls[1]).toEqual({ name: 'setLedgerFilter', args: [{ kinds: ['guard.blocked'], run: 'rate-limit-checkout', query: '' }] })
    expect(act.calls[2]).toEqual({ name: 'exportAudit', args: [] })
  })

  test('the guard filter shows guard rows only; a search narrows further; nothing found says so', () => {
    const vm = sampleView()
    const guards = applyLedgerFilter(vm.ledger, { kinds: LEDGER_FILTERS[2]?.kinds ?? null, run: null, query: '' })
    expect(guards.every(e => e.kind === 'guard.blocked')).toBe(true)
    expect(guards).toHaveLength(4)
    expect(applyLedgerFilter(vm.ledger, { kinds: null, run: null, query: 'PLAN-FIRST' })).toHaveLength(2)
    expect(applyLedgerFilter(vm.ledger, { kinds: null, run: 'nope', query: '' })).toHaveLength(0)
    const t = text(pane('terminal', vm, 'ledger', 120, 40, { ledgerFilter: { kinds: null, run: null, query: 'zzz' } }).tree)
    expect(t).toContain('Nothing matches this filter')
    expect(text(pane('terminal', emptyView(), 'ledger').tree)).toContain('No entries yet')
  })

  test('the search field edits the filter where the surface has Input', () => {
    const { tree, act } = pane('terminal', sampleView(), 'ledger')
    const input = findAll(tree, 'Input')[0]
    ;(input?.props.onInput as (v: string) => void)('gate')
    expect(act.calls).toEqual([{ name: 'setLedgerFilter', args: [{ kinds: null, run: null, query: 'gate' }] }])
    expect(findAll(pane('mobile', sampleView(), 'ledger').tree, 'Input')).toHaveLength(0)
  })

  test('long ledgers are cut with a pointer to the export', () => {
    const base = sampleView().ledger
    const many = Array.from({ length: 5 }, (_, i) => base.map(e => ({ ...e, ts: e.ts - i * 1000 }))).flat()
    const t = text(pane('terminal', sampleView({ ledger: many }), 'ledger').tree)
    expect(t).toContain('older entries. Export AUDIT.md')
  })
})

describe('Setup tab', () => {
  test('scaffold checklist with Create and Create all missing', () => {
    const { tree, act } = pane('terminal', sampleView(), 'setup')
    const t = text(tree)
    expect(t).toContain('3/7 in place')
    expect(t).toMatch(/☐ REVIEW\.md\s+P10/)
    expect(t).toMatch(/✔ CLAUDE\.md\s+P05/)
    expect(findAll(tree, 'Button').filter(b => String(b.props.key).startsWith('setup:create:'))).toHaveLength(4)
    expect(findButton(tree, 'setup:create-all')?.props.label).toContain('(4)')
    press(tree, 'setup:create:review-md')
    press(tree, 'setup:create-all')
    press(tree, 'setup:reload')
    press(tree, 'setup:bands-check')
    expect(act.calls).toEqual([
      { name: 'scaffold', args: ['review-md'] },
      { name: 'scaffoldAll', args: [] },
      { name: 'reloadKnowledge', args: [] },
      { name: 'checkBands', args: [] },
    ])
  })

  test('all scaffolds present: no Create buttons', () => {
    const vm = sampleView()
    const { tree } = pane('terminal', { ...vm, setup: vm.setup.map(s => ({ ...s, exists: true })) }, 'setup')
    expect(findButton(tree, 'setup:create-all')).toBeUndefined()
  })

  test('knowledge source: bundled snapshot vs repo', () => {
    expect(text(pane('terminal', sampleView(), 'setup').tree)).toContain('bundled snapshot')
    const repo = sampleView({ knowledge: { source: 'repo', root: 'openknowledge', title: 'Our wiki', issues: ['plays/play-99.md: missing front-matter'] } })
    const t = text(pane('terminal', repo, 'setup').tree)
    expect(t).toContain('repo: openknowledge/')
    expect(t).toContain('⚠ plays/play-99.md: missing front-matter')
  })

  test('mode picker is a Select where the surface has one and Buttons otherwise', () => {
    const terminal = pane('terminal', sampleView(), 'setup')
    const select = findAll(terminal.tree, 'Select')[0]
    expect(select?.props.value).toBe('semi')
    expect((select?.props.options as { value: string }[]).map(o => o.value)).toEqual(['manual', 'guided', 'semi'])
    ;(select?.props.onSelect as (v: string) => void)('guided')
    ;(select?.props.onSelect as (v: string) => void)('bogus')
    expect(terminal.act.calls).toEqual([{ name: 'setMode', args: ['guided'] }])

    const mobile = pane('mobile', sampleView(), 'setup')
    expect(findAll(mobile.tree, 'Select')).toHaveLength(0)
    expect(findAll(mobile.tree, 'Button').filter(b => String(b.props.key).startsWith('setup:mode:'))).toHaveLength(3)
    press(mobile.tree, 'setup:mode:manual')
    expect(mobile.act.calls).toEqual([{ name: 'setMode', args: ['manual'] }])
  })

  test('bands: off explains how to turn them on, on shows tier and sparkline', () => {
    expect(text(pane('terminal', emptyView(), 'setup').tree)).toContain('Set bands.enabled')
    const t = text(pane('terminal', sampleView(), 'setup').tree)
    expect(t).toMatch(/▲ error_rate\s+[▁▂▃▄▅▆▇█]+\s+2σ\s+z \+2\.3/)
    expect(t).toMatch(/✔ p95_latency_ms .* in control/)
  })

  test('a degraded mode is explained', () => {
    const vm = sampleView({ autopilot: { ...sampleView().autopilot, mode: 'guided', state: 'guided' } })
    expect(text(pane('terminal', vm, 'setup').tree)).toContain('Configured semi-auto but running guided')
  })
})

describe('Band above the prompt', () => {
  const band = (vm: ViewModel, columns = 100, ui = {}, surface: Surface = 'terminal') => {
    const act = noopActions()
    const tree = renderBand(fakeElements(surface), { vm, ui: sampleUi(ui), act, columns, surface }) as unknown as TreeNode | null
    return { tree, act }
  }
  const calm = (vm: ViewModel): ViewModel => ({ ...vm, bands: vm.bands.map(b => ({ ...b, tier: 'in-control' as const })) })

  test('nothing to show returns null', () => {
    expect(band(emptyView()).tree).toBeNull()
    expect(band(sampleView(), 100, { bandHidden: true }).tree).toBeNull()
    const off = sampleView()
    expect(band({ ...off, config: { ...off.config, ui: { ...off.config.ui, showBand: false } } }).tree).toBeNull()
    expect(band(sampleView({ ready: false })).tree).toBeNull()
  })

  test('normal: where the Loop is and what the autopilot does, with Open, Next, Pause, Hide', () => {
    const { tree, act } = band(calm(sampleView()), 130)
    const t = renderNatural(tree).join('\n')
    expect(t).toContain('◉ Loop ③ Build ▸ plan accepted · implementing 3 files · ▶ autopilot 4/12')
    expect(renderNatural(band(calm(sampleView()), 100).tree).join('\n')).toContain('▶ autopilot 4/12')
    expect(findAll(tree, 'Button').map(b => b.props.key)).toEqual(['band:open', 'band:next', 'band:pause', 'band:expand', 'band:hide'])
    for (const key of ['band:open', 'band:next', 'band:pause', 'band:expand', 'band:hide']) press(tree, key)
    expect(act.calls.map(c => c.name)).toEqual(['openPane', 'runNext', 'togglePause', 'toggleBand', 'hideBand'])
  })

  test('awaiting human: yellow line naming the file, Approve and Open', () => {
    const { tree, act } = band(awaitingHumanView())
    const t = renderNatural(tree).join('\n')
    expect(t).toContain('◆ specs/rate-limit-checkout.spec.md awaits your sign-off')
    expect(findAll(tree, 'Button').map(b => b.props.key)).toContain('band:approve')
    expect(findButton(tree, 'band:next')).toBeUndefined()
    press(tree, 'band:approve')
    expect(act.calls).toEqual([{ name: 'approve', args: ['spec.approve'] }])
    expect(JSON.stringify(((tree as Node).children as Node[])[0])).toContain('"color":"warning"')
  })

  test('release gate names the release', () => {
    expect(renderNatural(band(releaseView()).tree).join('\n')).toContain('release awaits your authorization')
  })

  test('blocked: red, says where, offers Next', () => {
    const { tree } = band(blockedView())
    const t = renderNatural(tree).join('\n')
    expect(t).toContain('✖ ④ Test blocked · verification FAILED: 2 tests red')
    expect(findButton(tree, 'band:next')?.props.variant).toBe('primary')
    expect(JSON.stringify(tree)).toContain('"color":"error"')
  })

  test('a live breach with no run still shows, as an alert with Open only', () => {
    const { tree } = band({ ...emptyView(), bands: sampleBands() })
    expect(renderNatural(tree).join('\n')).toContain('▲ band breach 2σ error_rate')
    expect(findAll(tree, 'Button').map(b => b.props.key)).toEqual(['band:open', 'band:hide'])
  })

  test('expanded adds a second line with the gate requirements', () => {
    const collapsed = renderNatural(band(awaitingHumanView(), 160).tree)
    const expanded = renderNatural(band(awaitingHumanView(), 160, { bandExpanded: true }).tree)
    expect(collapsed).toHaveLength(1)
    expect(expanded).toHaveLength(2)
    expect(expanded[1]).toContain('spec.approve:')
    expect(expanded[1]).toContain('✔ spec.md exists')
    expect(expanded[1]).toContain('☐ 2 flagged concerns to resolve')
  })

  test('never wider than the band, dropping Buttons before text', () => {
    for (const columns of [50, 60, 80, 120]) {
      for (const vm of [calm(sampleView()), awaitingHumanView(), blockedView(), sampleView()]) {
        const lines = renderNatural(band(vm, columns, { bandExpanded: true }).tree)
        expect(lines.filter(l => cells(l) > columns)).toEqual([])
      }
    }
    const narrow = band(calm(sampleView()), 60).tree
    expect(findButton(narrow, 'band:open')).toBeDefined()
  })

  test('hotkeys are single letters (a bare digit in an empty prompt must not press a band Button)', () => {
    for (const vm of [calm(sampleView()), awaitingHumanView(), blockedView(), releaseView()]) {
      const keys = findAll(band(vm, 160, { bandExpanded: true }).tree, 'Button').map(b => b.props.hotkey)
      for (const k of keys) expect(k).toMatch(/^[a-z]$/)
      expect(new Set(keys).size).toBe(keys.length)
    }
  })

  test('valid on every surface that draws a band', () => {
    for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
      expect(audit(band(awaitingHumanView(), 100, {}, surface).tree, surface)).toEqual([])
    }
  })

  test('statusText', () => {
    expect(statusText(sampleView())).toBe('Loop 3/6 Build · semi')
    expect(statusText(awaitingHumanView())).toBe('Loop 2/6 Design · semi')
    expect(statusText(emptyView())).toBeUndefined()
    expect(statusText(sampleView({ autopilot: { ...sampleView().autopilot, mode: 'manual' } }))).toBe('Loop 3/6 Build · manual')
  })
})

describe('theme helpers', () => {
  test('cells counts wide emoji as two and marks as none', () => {
    expect(cells('abc')).toBe(3)
    expect(cells('🔒 x')).toBe(4)
    expect(cells('✔ ①')).toBe(3)
    expect(cells('e\u0301')).toBe(1)
  })

  test('clip, clipStart, pad', () => {
    expect(clip('hello world', 8)).toBe('hello w…')
    expect(clip('hi', 8)).toBe('hi')
    expect(clip('hello', 0)).toBe('')
    expect(clip('🔒🔒🔒', 5)).toBe('🔒🔒…')
    expect(clipStart('specs/rate-limit.spec.md', 12)).toBe('…mit.spec.md')
    expect(pad('ab', 5)).toBe('ab   ')
    expect(pad('ab', 5, 'right')).toBe('   ab')
    expect(pad('abcdefgh', 5)).toBe('abcd…')
  })

  test('wrapText wraps on words, breaks long words and ellipsises at maxLines', () => {
    expect(wrapText('one two three four', 9)).toEqual(['one two', 'three', 'four'])
    expect(wrapText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapText('one two three four', 9, 2)).toEqual(['one two', 'three …'])
    expect(wrapText('', 10)).toEqual([])
  })

  test('bar, spark, dur, ago, playTitle', () => {
    expect(bar(0.5, 8)).toBe('████░░░░')
    expect(bar(2, 4)).toBe('████')
    expect(bar(Number.NaN, 4)).toBe('░░░░')
    expect(spark([1, 2, 3, 4, 5, 6, 7, 8], 8)).toBe('▁▂▃▄▅▆▇█')
    expect(spark([3, 3, 3], 8)).toBe('▄▄▄')
    expect(spark([], 8)).toBe('')
    expect(dur(42_000)).toBe('42s')
    expect(dur(7 * 60_000)).toBe('7m')
    expect(dur(72 * 60_000)).toBe('1h 12m')
    expect(dur((51 * 60) * 60_000)).toBe('2d 3h')
    expect(ago(NOW - 4 * 60_000, NOW)).toBe('4m ago')
    expect(ago(NOW - 1000, NOW)).toBe('just now')
    expect(playTitle('Play 07: Hooks as Build-Time Guardrails')).toBe('Hooks as Build-Time Guardrails')
    expect(playTitle('Capture intent')).toBe('Capture intent')
  })

  test('tidy drops false and undefined props before the engine sees them', () => {
    const seen: Record<string, unknown>[] = []
    const record = (props: Record<string, unknown>) => {
      seen.push(props)
      return { type: 'Text' } as never
    }
    const el = { ...fakeElements('terminal'), Text: record as never }
    tidy(el).Text({ bold: false, dimColor: true, color: undefined, children: 'x' } as never)
    expect(seen).toEqual([{ dimColor: true, children: 'x' }])
  })
})

describe('the engine accepts the trees and the presses reach the actions', () => {
  const mountables: [string, () => ViewModel][] = [
    ['sample', () => sampleView()],
    ['empty', () => emptyView()],
    ['blocked', () => blockedView()],
    ['awaiting-human', () => awaitingHumanView()],
    ['quarantined', () => quarantinedView()],
  ]
  for (const surface of SURFACES) {
    for (const [name, build] of mountables) {
      for (const tab of TABS) {
        test(`${surface} · ${name} · ${tab}`, async ($, on) => {
          const act = noopActions()
          on('ui.render', { component: 'Pane' }, ($h, e) =>
            renderPane($h.ui.resolve(e), { vm: build(), ui: sampleUi({ tab, selectedPlay: tab === 'plays' ? 7 : null }), act, columns: e.props.bodyColumns, rows: 40, surface: e.surface }),
          )
          const ui = await $.ui.mount({
            plugin: 'test',
            surface,
            component: 'Pane',
            props: { title: 'The Loop', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { bodyRows: 40 } as never, view: {} as never },
            viewport: { columns: 120, rows: 40 } as never,
          })
          const drawn = (await ui.drawn()) as unknown as TreeNode
          expect(findAll(drawn, 'Button').length).toBeGreaterThan(4)
          await ui.press({ key: 'tab:guards' })
          expect(act.calls).toEqual([{ name: 'setTab', args: ['guards'] }])
          if (surface === 'mobile') expect(await ui.findAll({ type: 'Input' })).toHaveLength(0)
        })
      }
    }
  }

  test('the engine finds Input and Select where the surface has them, and typing reaches the action', async ($, on) => {
    const act = noopActions()
    on('ui.render', { component: 'Pane' }, ($h, e) =>
      renderPane($h.ui.resolve(e), { vm: sampleView(), ui: sampleUi({ tab: 'loop' }), act, columns: 120, rows: 40, surface: e.surface }),
    )
    const ui = await $.ui.mount({
      plugin: 'test',
      surface: 'terminal',
      component: 'Pane',
      props: { title: 'The Loop', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { bodyRows: 40 } as never, view: {} as never },
    })
    await ui.input({ key: 'newrun', text: 'rate limit login' })
    expect(act.calls).toEqual([{ name: 'newRun', args: ['rate limit login'] }])
  })

  test('approve reaches the action through the engine', async ($, on) => {
    const act = noopActions()
    on('ui.render', { component: 'Pane' }, ($h, e) =>
      renderPane($h.ui.resolve(e), { vm: awaitingHumanView(), ui: sampleUi(), act, columns: 120, rows: 40, surface: e.surface }),
    )
    const ui = await $.ui.mount({
      plugin: 'test',
      surface: 'desktop',
      component: 'Pane',
      props: { title: 'The Loop', isFocused: true, bodyColumns: 120, placement: 'dock', scroll: { bodyRows: 40 } as never, view: {} as never },
    })
    await ui.press({ key: 'gate:approve' })
    expect(act.calls).toEqual([{ name: 'approve', args: ['spec.approve'] }])
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [name, build] of [['awaiting-human', () => awaitingHumanView()], ['blocked', () => blockedView()], ['mid-loop', () => sampleView()]] as [string, () => ViewModel][]) {
      test(`band · ${surface} · ${name}`, async ($, on) => {
        const act = noopActions()
        on('ui.render', { component: 'AbovePrompt' }, async ($h, e, next) => {
          const tree = renderBand($h.ui.resolve(e), { vm: build(), ui: sampleUi({ bandExpanded: true }), act, columns: e.props.bodyColumns, surface: e.surface })
          return tree ?? (await next(e))
        })
        const ui = await $.ui.mount({
          plugin: 'test',
          surface,
          component: 'AbovePrompt',
          props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 100, scroll: { bodyRows: 7 } as never, view: {} as never },
        })
        const open = await ui.find({ key: 'band:open' })
        expect(open?.props.label).toBe('Open')
        await ui.press({ key: 'band:open' })
        expect(act.calls).toEqual([{ name: 'openPane', args: [] }])
      })
    }
  }
})

test('textOf renders a Button the way the terminal draws it', () => {
  expect(textOf({ type: 'Button', props: { label: 'Go' } })).toBe('[ Go ]')
  expect(textOf({ type: 'Button', props: { label: 'Go', plain: true, hotkey: 'g' } })).toBe('g: Go')
  expect(textOf({ type: 'Button', props: { label: '[x]', plain: true } })).toBe('[x]')
})
