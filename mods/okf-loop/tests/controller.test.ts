import { test, expect, describe } from 'claude-code/testing'

import { blankModel, ingest, parseRunRecord, resolveConfig, userOverrides, reduce, setupItems } from '../hooks/core/controller'
import { buildView } from '../hooks/core/view'
import { MIN, NOW, World, intentText, planText, specText, startedWorld } from './loop-world'

const SLUG = 'add-rate-limiting'
const INTENT = `intent/${SLUG}.md`
const SPEC = `specs/${SLUG}.spec.md`
const PLAN = `plans/${SLUG}.plan.md`

/** A run whose intent is complete and waiting for a human, in the given mode. */
function intentReady(mode: 'manual' | 'guided' | 'semi' = 'semi'): World {
  const w = startedWorld(mode)
  w.put(INTENT, intentText('draft'))
  w.turnComplete('The intent is written.')
  return w
}

describe('plugin options and config', () => {
  test('only options the person set override the file; sentinels mean "use the file"', () => {
    expect(userOverrides({ mode: 'config', maxAutoTurns: 0, openPaneOnStart: 'config' })).toEqual({})
    expect(userOverrides({ mode: 'guided', maxAutoTurns: 7, openPaneOnStart: 'yes' })).toEqual({ mode: 'guided', maxAutoTurns: 7, openPaneOnStart: true })
    expect(userOverrides({ openPaneOnStart: 'no' })).toEqual({ openPaneOnStart: false })
    expect(userOverrides({ mode: 'bogus', maxAutoTurns: -3 })).toEqual({})
  })

  test('the file decides until an option is set, and the override is reported', () => {
    const file = JSON.stringify({ autonomy: { mode: 'manual', maxAutoTurns: 5 } })
    const plain = resolveConfig(file, {}, {})
    expect(plain.config.autonomy.mode).toBe('manual')
    expect(plain.overridden.mode).toBe(false)
    const forced = resolveConfig(file, userOverrides({ mode: 'semi', maxAutoTurns: 9 }), {})
    expect(forced.config.autonomy.mode).toBe('semi')
    expect(forced.config.autonomy.maxAutoTurns).toBe(9)
    expect(forced.fileConfig.autonomy.mode).toBe('manual')
    expect(forced.overridden).toEqual({ mode: true, maxAutoTurns: true, openPaneOnStart: false })
  })

  test('a malformed config never throws: defaults and an issue', () => {
    const r = resolveConfig('{ not json', {}, {})
    expect(r.config.autonomy.mode).toBe('semi')
    expect(r.configIssues.length).toBeGreaterThan(0)
  })
})

describe('run records', () => {
  test('a damaged record falls back field by field; an unreadable one is skipped with an issue', () => {
    const ok = parseRunRecord(JSON.stringify({ title: 'T', source: 'ticket', approvals: { 'intent.approve': { by: 'Ana', at: 5 }, bogus: { by: 'x' } }, edits: ['a', 3, 'a', 'b'], autoTurns: -2, paused: 'yes' }), 'slug-1')
    expect(ok.record?.slug).toBe('slug-1')
    expect(ok.record?.title).toBe('T')
    expect(ok.record?.source).toBe('ticket')
    expect(ok.record?.approvals['intent.approve']).toEqual({ by: 'Ana', at: 5 })
    expect(Object.keys(ok.record?.approvals ?? {})).toEqual(['intent.approve'])
    expect(ok.record?.edits).toEqual(['a', 'b'])
    expect(ok.record?.autoTurns).toBe(0)
    expect(ok.record?.paused).toBe(false)
    expect(parseRunRecord('{oops', 's').record).toBeNull()
    expect(parseRunRecord('[1]', 's').issue).toContain('not a JSON object')
  })

  test('the file name is the slug whatever the record says', () => {
    expect(parseRunRecord(JSON.stringify({ slug: 'other', title: 'X' }), 'real').record?.slug).toBe('real')
  })
})

describe('an empty disk', () => {
  test('ingests to a ready model with no runs, and every setup item missing', () => {
    const w = new World().boot()
    expect(w.model.ready).toBe(true)
    expect(w.model.runs).toEqual([])
    expect(w.model.active).toBeNull()
    expect(setupItems(w.model).every(i => !i.exists)).toBe(true)
    expect(w.model.knowledge.source).toBe('bundled')
    expect(w.model.knowledge.plays.length).toBe(14)
  })

  test('a blank model reduces a disk action without a previous model', () => {
    const w = new World()
    const out = reduce(blankModel(), { type: 'disk', disk: w.disk(), now: NOW, startup: true })
    expect(out.model.ready).toBe(true)
    expect(out.effects).toEqual([])
  })

  test('a corrupt run file is reported, not fatal', () => {
    const w = new World()
    w.put('.okf/runs/broken.json', '{nope')
    const m = ingest(w.disk(), NOW)
    expect(m.runs).toEqual([])
    expect(m.configIssues.some(i => i.includes('broken.json'))).toBe(true)
  })
})

describe('/sdlc new', () => {
  test('writes the intent skeleton, records the run, activates it and queues the interview in semi mode', () => {
    const w = new World({ config: { autonomy: { mode: 'semi' } } }).boot()
    const reply = w.run('new add rate limiting to checkout')
    expect(reply).toContain('Started run add-rate-limiting-to-checkout')
    const intent = w.text('intent/add-rate-limiting-to-checkout.md') ?? ''
    expect(intent).toContain('# Intent: Add rate limiting to checkout')
    expect(intent).toContain('**Status:** draft')
    expect(intent).toContain('**Author:** Ana')
    expect(w.text('.okf/active')?.trim()).toBe('add-rate-limiting-to-checkout')
    expect(w.text('.okf/.gitignore')).toContain('active')
    expect(w.record('add-rate-limiting-to-checkout').source).toBe('human')
    expect(w.ledgerOf('run.created')[0]?.data).toMatchObject({ title: 'Add rate limiting to checkout', source: 'human' })
    expect(w.ledgerOf('artifact.written')[0]?.data).toMatchObject({ kind: 'intent' })
    expect(w.panes).toEqual([true])
    expect(w.prompts.length).toBe(1)
    expect(w.prompts[0]?.key).toBe('interview')
    expect(w.prompts[0]?.text).toContain('add rate limiting to checkout')
    expect(w.active.snapshot.current).toBe('plan')
  })

  test('manual mode only creates and replies: nothing is queued', () => {
    const w = startedWorld('manual')
    expect(w.prompts).toEqual([])
    expect(w.text(INTENT)).toBeDefined()
    expect(w.ledgerOf('autopilot.queued')).toEqual([])
  })

  test('a ticket reference becomes the intent source and the run source', () => {
    const w = new World({ config: { autonomy: { mode: 'manual' } } }).boot()
    w.run('new --ref PROJ-42 add rate limiting')
    expect(w.text('intent/proj-42-add-rate-limiting.md')).toContain('**Source Ticket / Anomaly Ref:** PROJ-42')
    expect(w.record('proj-42-add-rate-limiting').source).toBe('ticket')
  })

  test('slugs stay unique against existing runs', () => {
    const w = startedWorld('manual')
    w.run('new add rate limiting')
    expect(w.model.runs.map(r => r.record.slug).sort()).toEqual([SLUG, `${SLUG}-2`])
    expect(w.model.active).toBe(`${SLUG}-2`)
  })

  test('the author falls back gracefully and the person who started it is in the ledger', () => {
    const w = new World({ config: { autonomy: { mode: 'manual' } } }).boot()
    w.author = ''
    w.run('new anything at all')
    expect(w.text('intent/anything-at-all.md')).toContain('**Author:** n/a')
  })
})

describe('approving a gate', () => {
  test('is refused while the intent is a skeleton, naming what is missing', () => {
    const w = startedWorld('semi')
    w.prompts.length = 0
    const reply = w.run('approve intent.approve')
    expect(reply).toContain('not ready')
    expect(reply).toContain('placeholders')
    expect(w.text(INTENT)).toContain('**Status:** draft')
    expect(w.ledgerOf('gate.approved')).toEqual([])
  })

  test('with nothing to approve it says so, and with no run it points at /sdlc new', () => {
    expect(new World().boot().run('approve')).toContain('no active run')
    const w = startedWorld('manual')
    expect(w.run('approve')).toContain('Nothing waits')
  })

  test('a ready intent: writes the Status, the record, the ledger entry, resets the budget', () => {
    const w = intentReady('semi')
    w.prompts.length = 0
    const reply = w.run('approve')
    expect(reply).toContain('Approved intent.approve')
    expect(w.text(INTENT)).toContain('**Status:** approved')
    const rec = w.record(SLUG)
    expect(rec.approvals['intent.approve']?.by).toBe('Ana')
    const entry = w.ledgerOf('gate.approved').find(e => e.data?.gate === 'intent.approve' && e.actor === 'human')
    expect(entry?.data).toMatchObject({ gate: 'intent.approve', by: 'Ana', via: 'command' })
    expect(w.active.snapshot.stages[0]?.state).toBe('done')
  })

  test('semi: the mod queues the next stage itself and counts the turn', () => {
    const w = intentReady('semi')
    w.prompts.length = 0
    const reply = w.run('approve')
    expect(reply).toContain('Autopilot queued')
    expect(w.lastPrompt?.key).toBe('draft-spec')
    expect(w.lastPrompt?.by).toBe('autopilot')
    expect(w.record(SLUG).autoTurns).toBe(1)
    expect(w.ledgerOf('autopilot.queued').length).toBe(2)
  })

  test('semi: one step at a time: approving while the interview turn is still running waits for it to end', () => {
    const w = startedWorld('semi')
    w.put(INTENT, intentText('draft'))
    w.refresh()
    w.prompts.length = 0
    const reply = w.run('approve')
    expect(reply).toContain('still on the step already queued')
    expect(w.prompts).toEqual([])
    w.turnComplete('The intent is written.')
    expect(w.lastPrompt?.key).toBe('draft-spec')
  })

  test('guided: it suggests the next step and queues nothing', () => {
    const w = intentReady('guided')
    w.prompts.length = 0
    const reply = w.run('approve')
    expect(reply).toContain('Next step')
    expect(reply).toContain('/sdlc next')
    expect(w.prompts).toEqual([])
  })

  test('manual: records and stops', () => {
    const w = intentReady('manual')
    const reply = w.run('approve intent')
    expect(reply).toBe('Approved intent.approve.')
    expect(w.prompts).toEqual([])
  })

  test('a gate of a later stage is not open yet; a machine gate cannot be approved by hand', () => {
    const w = intentReady('manual')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    expect(w.run('approve spec')).toContain('not open yet')
    expect(w.run('approve verify.pass')).toContain('machine gate')
  })

  test('approving twice says it is already approved', () => {
    const w = intentReady('manual')
    w.run('approve')
    expect(w.run('approve intent')).toContain('already approved')
  })

  test('the whole front half: intent, spec, plan, each through its gate', () => {
    const w = intentReady('manual')
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    expect(w.active.snapshot.current).toBe('design')
    expect(w.run('approve')).toContain('Approved spec.approve')
    w.put(PLAN, planText('draft', ['src/checkout.ts'], SLUG))
    w.refresh()
    expect(w.active.snapshot.current).toBe('build')
    expect(w.run('approve')).toContain('Approved plan.accept')
    expect(w.text(PLAN)).toContain('**Status:** accepted')
    expect(w.active.snapshot.next.kind).toBe('implement')
  })
})

describe('rejecting a gate', () => {
  test('needs a reason: the agent redrafts from it', () => {
    const w = intentReady('semi')
    expect(w.run('reject')).toContain('Say why')
    expect(w.text(INTENT)).toContain('**Status:** draft')
  })

  test('sets the status back, clears the approval, ledgers the reason and queues a redraft with the feedback', () => {
    const w = intentReady('semi')
    w.prompts.length = 0
    const reply = w.run('reject intent the problem section ignores mobile users')
    expect(reply).toContain('Rejected intent.approve')
    expect(reply).toContain('redraft')
    expect(w.text(INTENT)).toContain('**Status:** rejected')
    const entry = w.ledgerOf('gate.rejected')[0]
    expect(entry?.actor).toBe('human')
    expect(entry?.data).toMatchObject({ gate: 'intent.approve', reason: 'the problem section ignores mobile users' })
    expect(w.lastPrompt?.key).toBe('interview')
    expect(w.lastPrompt?.text).toContain('the problem section ignores mobile users')
  })

  test('a spec rejection goes back to draft and the redraft prompt carries the feedback', () => {
    const w = intentReady('semi')
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    w.prompts.length = 0
    w.run('reject spec.approve add a rollback requirement')
    expect(w.text(SPEC)).toContain('**Status:** draft')
    expect(w.lastPrompt?.key).toBe('draft-spec')
    expect(w.lastPrompt?.text).toContain('add a rollback requirement')
  })

  test('manual mode keeps the feedback in the ledger and queues nothing', () => {
    const w = intentReady('manual')
    const reply = w.run('reject intent too vague')
    expect(reply).toContain('feedback is in the ledger')
    expect(w.prompts).toEqual([])
  })

  test('feedback keeps reaching later prompts until the gate is approved', () => {
    const w = intentReady('guided')
    w.run('reject intent be specific about limits')
    w.put(INTENT, intentText('rejected'))
    w.refresh()
    w.prompts.length = 0
    w.run('next')
    expect(w.lastPrompt?.text).toContain('be specific about limits')
  })

  test('there is no release to reject', () => {
    const w = intentReady('manual')
    expect(w.run('reject release no')).toContain('no release to reject')
  })
})

describe('human authority', () => {
  const STATEFUL = ['new idea', 'next', 'approve', 'reject nope', 'mode manual', 'pause', 'resume', 'plays disable 4', 'guards toggle plan-first', 'fix a bug', 'fixed', 'release grant', 'release revoke', 'twice a lesson', 'lesson a title', 'bands runbook', 'init']

  test('a plugin, a notification or a schedule can run none of them', () => {
    for (const origin of ['plugin', 'task-notification', 'scheduled-trigger', 'peer', 'channel']) {
      for (const text of STATEFUL) {
        const w = intentReady('semi')
        const before = w.files.size
        const ledgerBefore = w.ledger.length
        w.prompts.length = 0
        const reply = w.run(text, { origin })
        expect(reply).toContain('reserved for a person')
        expect(w.files.size).toBe(before)
        expect(w.ledger.length).toBe(ledgerBefore)
        expect(w.prompts).toEqual([])
        expect(w.text(INTENT)).toContain('**Status:** draft')
      }
    }
  })

  test('the composer, the bridge and the SDK host are people; a button press is too', () => {
    for (const origin of ['composer', 'bridge', 'sdk']) {
      const w = intentReady('manual')
      expect(w.run('approve', { origin })).toContain('Approved')
    }
    const w = intentReady('manual')
    expect(w.run('approve', { origin: 'plugin', via: 'press' })).toContain('Approved')
  })

  test('read-only commands work from any origin', () => {
    const w = intentReady('manual')
    for (const text of ['status', 'help', 'plays', 'guards', 'bands', 'worktree x', 'audit']) {
      expect(w.run(text, { origin: 'plugin' })).not.toContain('reserved for a person')
    }
  })
})

describe('time stays a parameter', () => {
  test('the same disk at the same instant derives the same model', () => {
    const w = intentReady('semi')
    const a = ingest(w.disk(), NOW + MIN, w.model)
    const b = ingest(w.disk(), NOW + MIN, w.model)
    expect(JSON.stringify(a.runs.map(r => r.snapshot))).toBe(JSON.stringify(b.runs.map(r => r.snapshot)))
  })
})

// ---------------------------------------------------------------------------
// Provenance of human approvals (a status that appears in a file)
// ---------------------------------------------------------------------------

const QKEY = `${SLUG}:intent.approve`

describe('approvals made in an editor', () => {
  test('an idle person editing Status to approved is an implicit human approval', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.record(SLUG).approvals['intent.approve']).toMatchObject({ by: 'file' })
    const entry = w.ledgerOf('gate.approved').find(e => e.data?.gate === 'intent.approve')
    expect(entry?.actor).toBe('human')
    expect(entry?.data).toMatchObject({ by: 'file', via: 'file' })
    expect(w.active.snapshot.stages[0]?.state).toBe('done')
  })

  test('the record is written once, not on every refresh', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    w.advance(MIN)
    w.refresh()
    w.refresh()
    expect(w.ledgerOf('gate.approved').filter(e => e.data?.gate === 'intent.approve').length).toBe(1)
  })

  test('semi: an approval noticed during the session starts the next stage; at start-up it only records', () => {
    const w = intentReady('semi')
    w.prompts.length = 0
    w.advance(MIN)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(w.lastPrompt?.key).toBe('draft-spec')

    const cold = new World({ config: { autonomy: { mode: 'semi' } } })
    cold.files = new Map(w.files)
    cold.files.delete(`.okf/runs/${SLUG}.json`)
    cold.put(`.okf/runs/${SLUG}.json`, JSON.stringify({ slug: SLUG, title: 'Add rate limiting', source: 'human', createdAt: 1 }))
    cold.put(INTENT, intentText('approved'))
    cold.boot()
    expect(cold.record(SLUG).approvals['intent.approve']).toMatchObject({ by: 'file' })
    expect(cold.prompts).toEqual([])
  })

  test('an approval that appears while the agent works is quarantined: the gate stays closed', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(Object.keys(w.model.runtime.quarantine)).toEqual([QKEY])
    expect(w.record(SLUG).approvals['intent.approve']).toBeUndefined()
    const gate = w.active.snapshot.stages[0]?.gates[0]
    expect(gate?.approved).toBe(false)
    expect(gate?.ready).toBe(true)
    expect(gate?.requirements.find(r => r.by === 'human' && r.id === 'approved')?.detail).toContain('confirm with /sdlc approve intent.approve')
    expect(w.active.snapshot.stages[0]?.state).toBe('awaiting-human')
    expect(w.active.snapshot.next.kind).toBe('await-human')
    const blocked = w.ledgerOf('guard.blocked')[0]
    expect(blocked?.data).toMatchObject({ guard: 'gate-integrity', gate: 'intent.approve', quarantine: true })
    expect(blocked?.summary).toContain('changed while the agent was working')
    expect(w.toasts.some(t => t.includes('confirm with /sdlc approve'))).toBe(true)
    expect(w.ledgerOf('gate.approved').filter(e => e.data?.gate === 'intent.approve')).toEqual([])
  })

  test('so is one that appears after the agent ran any Bash command, even with no turn active', () => {
    const w = intentReady('manual')
    w.advance(1000)
    w.facts.activityAt = w.now
    w.advance(1000)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(Object.keys(w.model.runtime.quarantine)).toEqual([QKEY])
  })

  test('background work taints every later approval in the session', () => {
    const w = intentReady('manual')
    w.facts.backgroundWork = true
    w.advance(MIN)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(Object.keys(w.model.runtime.quarantine)).toEqual([QKEY])
  })

  test('a quarantined approval is announced once, however often it is refreshed', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    w.refresh()
    w.advance(5000)
    w.refresh()
    expect(w.ledgerOf('guard.blocked').filter(e => e.data?.quarantine === true).length).toBe(1)
    expect(w.toasts.filter(t => t.includes('changed while the agent was working')).length).toBe(1)
  })

  test('confirming with /sdlc approve works on the quarantined gate and clears it', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    w.facts.turnActive = false
    w.advance(MIN)
    const reply = w.run('approve')
    expect(reply).toContain('Approved intent.approve')
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.record(SLUG).approvals['intent.approve']).toMatchObject({ by: 'Ana' })
    const human = w.ledgerOf('gate.approved').filter(e => e.data?.gate === 'intent.approve')
    expect(human.length).toBe(1)
    expect(human[0]?.data).toMatchObject({ by: 'Ana', via: 'command' })
    expect(w.text(INTENT)).toContain('**Status:** approved')
    expect(w.active.snapshot.stages[0]?.state).toBe('done')
    w.facts.turnActive = true
    w.advance(MIN)
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
  })

  test('the Approve button and the confirm button both clear it; the view lists it as quarantined, not as a Setup row', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(setupItems(w.model).some(i => i.id.startsWith('confirm:'))).toBe(false)
    const held = buildView(w.model, w.now).quarantined
    expect(held).toEqual([{ slug: SLUG, gate: 'intent.approve', path: INTENT, detail: expect.stringContaining('/sdlc approve intent.approve') }])
    // act.confirm(gate) and act.approve(gate) both reach the approve path, as a press
    w.cmd({ cmd: 'approve', gate: 'intent.approve' }, { origin: 'plugin', via: 'press' })
    expect(w.model.runtime.quarantine).toEqual({})
    expect(buildView(w.model, w.now).quarantined).toEqual([])
    expect(w.record(SLUG).approvals['intent.approve']).toBeDefined()
  })

  test('the controller still honours a confirm item id (init confirm:<slug>:<gate>)', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    w.cmd({ cmd: 'init', item: `confirm:${QKEY}` }, { origin: 'plugin', via: 'press' })
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.record(SLUG).approvals['intent.approve']).toBeDefined()
  })

  test('quarantined approvals of every run are listed, the active run first', () => {
    const w = intentReady('manual')
    w.run('new second change')
    w.put('intent/second-change.md', intentText('draft', 'Second change'))
    w.refresh()
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.put('intent/second-change.md', intentText('approved', 'Second change'))
    w.refresh()
    const held = buildView(w.model, w.now).quarantined
    expect(held.map(h => h.slug)).toEqual(['second-change', SLUG])
    w.run(`use ${SLUG}`)
    expect(buildView(w.model, w.now).quarantined.map(h => h.slug)).toEqual([SLUG, 'second-change'])
  })

  test('/sdlc init never confirms a gate behind your back', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    const reply = w.run('init')
    expect(reply).toContain('still needs your confirmation')
    expect(w.record(SLUG).approvals['intent.approve']).toBeUndefined()
  })

  test('a gate the mod itself recorded is never quarantined', () => {
    const w = intentReady('manual')
    w.run('approve')
    w.facts.turnActive = true
    w.facts.backgroundWork = true
    w.advance(MIN)
    w.facts.activityAt = w.now
    w.advance(MIN)
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.active.snapshot.stages[0]?.state).toBe('done')
  })

  test('plan.accept follows the same rule, and plan-first keeps holding source edits while it is quarantined', () => {
    const w = intentReady('manual')
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    w.run('approve')
    w.put(PLAN, planText('draft', ['src/checkout.ts'], SLUG))
    w.refresh()
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(PLAN, planText('accepted', ['src/checkout.ts'], SLUG))
    w.refresh()
    expect(Object.keys(w.model.runtime.quarantine)).toEqual([`${SLUG}:plan.accept`])
    const held = w.judge(w.edit('src/checkout.ts'))
    expect(held.allow).toBe(false)
    expect(held.allow === false && held.guard).toBe('plan-first')
    w.facts.turnActive = false
    w.run('approve plan')
    expect(w.judge(w.edit('src/checkout.ts')).allow).toBe(true)
  })

  test('an idle edit to accepted on the plan is accepted as a person\'s', () => {
    const w = intentReady('manual')
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    w.run('approve')
    w.put(PLAN, planText('draft', ['src/checkout.ts'], SLUG))
    w.refresh()
    w.advance(MIN)
    w.put(PLAN, planText('accepted', ['src/checkout.ts'], SLUG))
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.record(SLUG).approvals['plan.accept']).toMatchObject({ by: 'file' })
    expect(w.judge(w.edit('src/checkout.ts')).allow).toBe(true)
  })

  test('the quarantine survives a reload while the file is unchanged', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    const again = new World({ config: { autonomy: { mode: 'manual' } }, now: w.now + 5 * MIN })
    again.files = new Map(w.files)
    again.boot()
    expect(Object.keys(again.model.runtime.quarantine)).toEqual([QKEY])
    expect(again.active.snapshot.stages[0]?.gates[0]?.approved).toBe(false)
  })

  test('reverting the forged status and approving it for real later is an ordinary approval', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    w.facts.turnActive = false
    w.advance(MIN)
    w.put(INTENT, intentText('draft'))
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
    w.advance(MIN)
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(w.model.runtime.quarantine).toEqual({})
    expect(w.record(SLUG).approvals['intent.approve']).toMatchObject({ by: 'file' })
  })

  test('/sdlc status says a quarantine is pending', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    const status = w.run('status')
    expect(status).toContain('says approved but changed while the agent was working')
    expect(status).toContain('/sdlc approve intent.approve')
  })

  test('the guard stats count a quarantine as a gate-integrity interception', () => {
    const w = intentReady('manual')
    w.advance(MIN)
    w.facts.turnActive = true
    w.put(INTENT, intentText('approved'))
    w.refresh()
    expect(w.ledgerOf('guard.blocked')[0]?.data?.guard).toBe('gate-integrity')
  })
})

describe('ledger discipline', () => {
  test('gate.opened is written once when a gate first waits for a human, and again after a rejection', () => {
    const w = intentReady('manual')
    const opened = () => w.ledgerOf('gate.opened').filter(e => e.data?.gate === 'intent.approve').length
    expect(opened()).toBe(1)
    w.refresh()
    w.refresh()
    expect(opened()).toBe(1)
    w.advance(MIN)
    w.run('reject intent be more specific')
    w.advance(MIN)
    w.put(INTENT, intentText('draft'))
    w.refresh()
    expect(opened()).toBe(2)
    w.refresh()
    expect(opened()).toBe(2)
  })

  test('a gate that was already waiting when the session started is announced once, with a toast', () => {
    const w = new World({ config: { autonomy: { mode: 'manual' } } })
    w.put(`.okf/runs/${SLUG}.json`, JSON.stringify({ title: 'Add rate limiting', createdAt: 1 }))
    w.put(INTENT, intentText('draft'))
    w.boot()
    expect(w.ledgerOf('gate.opened').length).toBe(1)
    expect(w.toasts.some(t => t.includes('ready for your sign-off'))).toBe(true)
    w.refresh()
    expect(w.ledgerOf('gate.opened').length).toBe(1)
  })

  test('entering a stage is ledgered when a gate moves the run on', () => {
    const w = intentReady('manual')
    expect(w.ledgerOf('stage.entered')).toEqual([])
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    const entered = w.ledgerOf('stage.entered')
    expect(entered.map(e => e.stage)).toContain('design')
  })

  test('every state change leaves an entry: who, what, which run', () => {
    const w = intentReady('semi')
    w.run('approve')
    for (const e of w.ledger) {
      expect(e.summary.length).toBeGreaterThan(0)
      expect(['human', 'agent', 'mod']).toContain(e.actor)
    }
    const kinds = new Set(w.ledger.map(e => e.kind))
    for (const k of ['run.created', 'artifact.written', 'autopilot.queued', 'gate.opened', 'gate.approved'] as const) expect(kinds.has(k)).toBe(true)
    expect(w.ledger.filter(e => e.run === SLUG).length).toBeGreaterThan(4)
  })

  test('a torn ledger line never loses the rest', () => {
    const w = intentReady('manual')
    const before = w.model.ledger.length
    w.put('.okf/ledger.jsonl', `${w.text('.okf/ledger.jsonl') ?? ''}{"ts":12,"kind"\n`)
    w.refresh()
    expect(w.model.ledger.length).toBe(before)
  })
})

describe('a plan that moved on without a record', () => {
  test('approving it records the acceptance and keeps its status (a pulled run, say)', () => {
    const w = intentReady('manual')
    w.run('approve')
    w.put(SPEC, specText('draft', SLUG))
    w.refresh()
    w.run('approve')
    w.put(PLAN, planText('complete', ['src/checkout.ts'], SLUG))
    w.refresh()
    expect(w.judge(w.edit('src/checkout.ts')).allow).toBe(false)
    expect(w.run('approve plan')).toContain('Approved plan.accept')
    expect(w.text(PLAN)).toContain('**Status:** complete')
    expect(w.record(SLUG).approvals['plan.accept']).toBeDefined()
  })
})
