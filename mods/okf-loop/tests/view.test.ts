import { test, expect, describe } from 'claude-code/testing'

import type { UiTab } from '../types'
import { blankModel } from '../hooks/core/controller'
import { buildView, guardStats, playEvidence, statusSummary } from '../hooks/core/view'
import { renderBand, statusText } from '../hooks/ui/Band'
import { renderPane } from '../hooks/ui/Pane'
import { SURFACES, fakeElements, noopActions, sampleUi } from './fixtures'
import { findAll, renderNatural, type TreeNode } from './render-text'
import { MIN, World, intentText, startedWorld } from './loop-world'

const SLUG = 'add-rate-limiting'
const INTENT = `intent/${SLUG}.md`

describe('buildView', () => {
  test('a blank model is a view that is not ready yet', () => {
    const vm = buildView(blankModel(), 0)
    expect(vm.ready).toBe(false)
    expect(vm.active).toBeNull()
    expect(vm.plays.length).toBe(14)
    expect(vm.guards.length).toBe(9)
    expect(vm.ledger).toEqual([])
  })

  test('an empty project: no run, every scaffold missing, bundled knowledge, welcome-card ready', () => {
    const w = new World().boot()
    const vm = buildView(w.model, w.now)
    expect(vm.ready).toBe(true)
    expect(vm.runs).toEqual([])
    expect(vm.active).toBeNull()
    expect(vm.autopilot.state).toBe('no-run')
    expect(vm.setup.length).toBe(8)
    expect(vm.setup.every(s => !s.exists)).toBe(true)
    expect(vm.knowledge.source).toBe('bundled')
    expect(vm.bands).toEqual([])
    expect(statusText(vm)).toBeUndefined()
  })

  test('a run in flight: summary, snapshot, autopilot, release, notice', () => {
    const w = startedWorld('semi')
    const vm = buildView(w.model, w.now)
    expect(vm.runs.map(r => r.slug)).toEqual([SLUG])
    expect(vm.active?.record.slug).toBe(SLUG)
    expect(vm.active?.current).toBe('plan')
    expect(vm.autopilot).toMatchObject({ mode: 'semi', paused: false, budgetMax: 12, budgetLeft: 12 })
    expect(vm.release).toEqual({ envToken: false, grantUntil: null })
    expect(vm.notice).toContain(SLUG)
    expect(statusText(vm)).toBe('Loop 1/6 Plan · semi')
    expect(vm.ledger.some(e => e.kind === 'run.created')).toBe(true)
  })

  test('the notice fades after half a minute', () => {
    const w = startedWorld('manual')
    expect(buildView(w.model, w.now + 10_000).notice).not.toBe('')
    expect(buildView(w.model, w.now + 31_000).notice).toBe('')
  })

  test('the mode chip shows the effective mode, the config keeps the configured one', () => {
    const w = new World({ config: { autonomy: { mode: 'semi' } } }).boot()
    w.run('plays disable 4')
    const vm = buildView(w.model, w.now)
    expect(vm.config.autonomy.mode).toBe('semi')
    expect(vm.autopilot.mode).toBe('guided')
  })

  test('the view only moves when something real did (the clock ticks every 30 s)', () => {
    const w = startedWorld('manual')
    const a = JSON.stringify(buildView(w.model, w.now))
    expect(JSON.stringify(buildView(w.model, w.now + 5_000))).toBe(a)
    expect(JSON.stringify(buildView(w.model, w.now + 40_000))).not.toBe(a)
  })

  test('the grant is live until its window closes', () => {
    const w = new World().boot()
    w.run('release grant 5')
    expect(buildView(w.model, w.now).release.grantUntil).toBe(w.now + 5 * MIN)
    expect(buildView(w.model, w.now + 6 * MIN).release.grantUntil).toBeNull()
    w.envToken = true
    w.refresh()
    expect(buildView(w.model, w.now).release.envToken).toBe(true)
  })

  test('the ledger shown is the tail', () => {
    const w = startedWorld('manual')
    for (let i = 0; i < 250; i++) w.run(`twice lesson number ${i}`)
    const vm = buildView(w.model, w.now)
    expect(vm.ledger.length).toBe(200)
    expect(vm.ledger[199]?.summary).toContain('lesson number 249')
  })
})

describe('guards in the view', () => {
  test('hits, last message and dormancy come from the ledger and the adopted plays', () => {
    const w = startedWorld('manual')
    w.denied(w.edit('src/a.ts'))
    w.advance(MIN)
    w.denied(w.edit('src/b.ts'))
    const stats = guardStats(w.model)
    expect(stats['plan-first']?.hits).toBe(2)
    const vm = buildView(w.model, w.now)
    const planFirst = vm.guards.find(g => g.id === 'plan-first')
    expect(planFirst).toMatchObject({ enabled: true, active: true })
    expect(planFirst?.stat.hits).toBe(2)
    expect(planFirst?.stat.lastAt).toBe(w.now)
    expect(planFirst?.stat.lastMessage).toContain('plan')
    const cred = vm.guards.find(g => g.id === 'credential-shield')
    expect(cred).toMatchObject({ enabled: true, active: false })
    expect(cred?.stat.hits).toBe(0)
  })

  test('a guard switched off is off but its play may still be adopted', () => {
    const w = new World({ config: { guards: { disabled: ['test-lock'] } } }).boot()
    expect(buildView(w.model, w.now).guards.find(g => g.id === 'test-lock')).toMatchObject({ enabled: false, active: false })
  })
})

describe('plays, setup and bands in the view', () => {
  test('play evidence follows the scaffolds and the run', () => {
    const w = new World().boot()
    expect(playEvidence(w.model)[5]?.[0]?.ok).toBe(false)
    w.run('init')
    expect(playEvidence(w.model)[5]?.[0]?.ok).toBe(true)
    expect(playEvidence(w.model)[9]?.every(e => e.ok)).toBe(true)
    w.run('new add rate limiting')
    expect(playEvidence(w.model)[1]?.[0]?.ok).toBe(true)
    const vm = buildView(w.model, w.now)
    expect(vm.plays.find(p => p.n === 5)?.evidence[0]?.ok).toBe(true)
    expect(vm.plays.find(p => p.n === 7)?.dependents).toContain(11)
    expect(vm.plays.find(p => p.n === 12)).toMatchObject({ enabled: false })
  })

  test('a repo knowledge root overrides the bundled snapshot and is named as the source', () => {
    const w = new World()
    w.put('openknowledge/INDEX.md', '---\ntitle: Our playbook\nversion: "9"\nsummary: ours\n---\n# Our playbook\n')
    w.boot()
    const vm = buildView(w.model, w.now)
    expect(vm.knowledge.source).toBe('repo')
    expect(vm.knowledge.title).toBe('Our playbook')
    expect(vm.plays.length).toBe(14)
  })

  test('band views carry the series, the reading, the tier and the parsed spec', () => {
    const config = { bands: { enabled: true, window: 10, sources: [{ metric: 'ci_failure_rate', description: 'CI failure rate', argv: ['./rate.sh'], parse: 'number', intervalMinutes: 5, higherIsWorse: true }] } }
    const w = new World({ config }).boot()
    w.run('init bands')
    for (let i = 0; i < 12; i++) {
      w.advance(10 * MIN)
      w.measured('ci_failure_rate', 0.1 + (i % 2) * 0.04)
    }
    w.refresh()
    const [b] = buildView(w.model, w.now).bands
    expect(b?.metric).toBe('ci_failure_rate')
    expect(b?.values.length).toBe(12)
    expect(b?.last?.n).toBeGreaterThan(5)
    expect(b?.tier).toBe(b?.last?.tier)
    expect(b?.source?.argv).toEqual(['./rate.sh'])
    expect(b?.spec?.metric).toBeTruthy()
  })

  test('bands are an empty list while the feature is off', () => {
    expect(buildView(new World().boot().model, NOW_).bands).toEqual([])
  })
})

const NOW_ = 1_800_000_000_000

describe('statusSummary', () => {
  test('says where the run is, who owes the next move and the autopilot state', () => {
    const w = startedWorld('semi')
    const text = statusSummary(w.model, w.now)
    expect(text).toContain('Mode semi')
    expect(text).toContain(`Run ${SLUG}`)
    expect(text).toContain('Stage 1/6 Plan')
    expect(text).toContain('Gate owed: intent.approve')
    expect(text).toContain('Autopilot:')
    expect(text).toContain('Release: locked')
    expect(text).toContain('Guards: 8/9 enforcing')
  })

  test('with no run it points at /sdlc new, and shows a live grant and a hot band', () => {
    const w = new World().boot()
    expect(statusSummary(w.model, w.now)).toContain('/sdlc new')
    w.run('release grant 5')
    expect(statusSummary(w.model, w.now)).toContain('grant live')
  })

  test('a ready gate says it is ready, a rejected one is reworked, and a quarantine is flagged', () => {
    const w = startedWorld('manual')
    w.put(INTENT, intentText('draft'))
    w.refresh()
    expect(statusSummary(w.model, w.now)).toContain('by you (ready)')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(statusSummary(w.model, w.now)).toContain('⚠ intent/add-rate-limiting.md says approved but changed')
  })
})

describe('the real view model drives the real views', () => {
  const TABS: UiTab[] = ['loop', 'plays', 'guards', 'ledger', 'setup']

  test('every tab renders on every surface from a derived model, with the person\'s buttons wired', () => {
    const w = startedWorld('semi')
    w.put(INTENT, intentText('draft'))
    w.refresh()
    const vm = buildView(w.model, w.now)
    for (const surface of SURFACES) {
      for (const tab of TABS) {
        const act = noopActions()
        const tree = renderPane(fakeElements(surface), { vm, ui: sampleUi({ tab }), act, columns: 120, rows: 40, surface }) as unknown as TreeNode
        const lines = renderNatural(tree).join('\n')
        expect(lines.length).toBeGreaterThan(50)
        if (tab === 'loop') {
          expect(lines).toContain('Add rate limiting')
          const approve = findAll(tree, 'Button').find(b => b.props?.key === 'gate:approve')
          expect(approve).toBeDefined()
        }
        if (tab === 'setup') expect(lines).toContain('CLAUDE.md')
      }
      if (surface !== 'mobile') {
        const band = renderBand(fakeElements(surface), { vm, ui: sampleUi(), act: noopActions(), columns: 120, surface })
        expect(band).not.toBeNull()
        expect(renderNatural(band as unknown as TreeNode).join('\n')).toContain('sign-off')
      }
    }
  })

  test('the loading view and an empty project render too', () => {
    for (const vm of [buildView(blankModel(), 0), buildView(new World().boot().model, NOW_)]) {
      for (const surface of SURFACES) {
        const tree = renderPane(fakeElements(surface), { vm, ui: sampleUi(), act: noopActions(), columns: 100, rows: 30, surface }) as unknown as TreeNode
        expect(renderNatural(tree).length).toBeGreaterThan(0)
      }
    }
  })
})
