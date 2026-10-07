import { test, expect, describe, mock, type Engine, type MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { ViewModel } from '../types'
import { NOW, intentText } from './loop-world'

const SLUG = 'add-rate-limiting'
const INTENT = `intent/${SLUG}.md`
const SURFACES = ['terminal', 'desktop'] as const

// The engine beneath the plugin: an in-memory project directory and a recorder for everything the
// plugin asks of the host. Whatever the plugin calls on `$` lands here.
type Rig = {
  files: Map<string, string>
  toasts: string[]
  prompts: string[]
  opened: string[]
  status: (string | undefined)[]
  invalidated: string[]
  logs: string[]
  clock: MockClock
  state: Record<string, unknown>
  /** What a host command answers (stdout, exit code); git config user.name is Ana. */
  proc: (argv: readonly string[]) => { stdout: string; exitCode: number }
  agents: string[]
  /** What the person answers when the pane asks a question. */
  answer: string
}

const viewOf = (r: { state: Record<string, unknown> }): ViewModel | null | undefined => r.state['okf-loop.view'] as ViewModel | null | undefined

/** The engine resolves relative paths against the session's working directory: key the fake disk by the project-relative path. */
const PROJECT_PATH = /\/((?:\.okf|intent|specs|plans|proofs|reviews|evals|lessons|openknowledge|\.github|\.claude|src)(?:\/.+)?|CLAUDE\.md|REVIEW\.md|bands\.yaml)$/
const rel = (_root: string, path: string): string => (path.startsWith('/') ? (PROJECT_PATH.exec(path)?.[1] ?? path) : path)

function rig(on: On, store: Record<string, unknown> = {}, o: { fs?: boolean; env?: 'deny-release' } = {}): Rig {
  const clock = mock.clock(on, { now: NOW })
  const r: Rig = { files: new Map(), toasts: [], prompts: [], opened: [], status: [], invalidated: [], logs: [], clock, state: {}, proc: argv => (argv.join(' ') === 'git config user.name' ? { stdout: 'Ana\n', exitCode: 0 } : { stdout: '', exitCode: 1 }), agents: [], answer: 'Wrong scope' }
  if (o.env === 'deny-release') on('env.get', (_$, e) => (e.name === 'RELEASE_APPROVAL' ? { deny: 'the environment is unreadable' } : { value: e.name === 'HOME' ? '/home/ana' : 'ana' }))
  else mock.env(on, { HOME: '/home/ana', USER: 'ana' })
  mock.store(on, store)
  on('session.cwd', () => ({ value: '/work/proj' }))
  if (o.fs === false) return rigHost(on, r)
  on('fs.read', ($, e) => {
    const text = r.files.get(rel($.plugin.root, e.path))
    return text === undefined ? { deny: `ENOENT: ${e.path}` } : { value: text }
  })
  on('fs.write', ($, e) => {
    r.files.set(rel($.plugin.root, e.path), e.text)
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: r.files.has(rel($.plugin.root, e.path)) }))
  on('fs.stat', ($, e) =>
    r.files.has(rel($.plugin.root, e.path)) ? { value: { kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false } } : { deny: `ENOENT: ${e.path}` },
  )
  on('fs.list', ($, e) => {
    const dir = rel($.plugin.root, e.path)
    return {
      value: [...r.files.keys()]
        .filter(k => k.startsWith(`${dir}/`) && !k.slice(dir.length + 1).includes('/'))
        .map(k => ({ name: k.slice(dir.length + 1), kind: 'file' as const, size: 1, mtimeMs: NOW, isLink: false })),
    }
  })
  return rigHost(on, r)
}

/** Everything the plugin asks of the host that is not the file system. */
function rigHost(on: On, r: Rig): Rig {
  on('process.run', (_$, e) => ({ value: { ...r.proc(e.argv), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('agent.spawn', (_$, e) => {
    // the bottom of the chain sees the Agent tool's own arguments
    const type = (e as unknown as { subagent_type?: string }).subagent_type ?? ''
    r.agents.push(type)
    return type === 'okf-loop:diagnoser' ? { model: 'm', agentId: 'agent-1' } : { deny: 'unexpected agent' }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.toast', (_$, e) => {
    r.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_$, e) => {
    r.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    r.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.invalidate', (_$, e) => {
    r.invalidated.push(e.event)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    r.opened.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('prompt.submit', (_$, e) => {
    r.prompts.push(e.text)
    return { text: e.text }
  })
  on('state.set', (_$, e, next) => {
    r.state[`${e.plugin}.${e.key}`] = e.value
    return next(e)
  })
  on('prompt.compose', () => ({ sections: [{ id: 'engine', text: 'engine prompt', scope: 'shared' as const }] }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('tool.call', (_$, e) => {
    if (e.tool === 'AskUserQuestion') {
      const questions = (e as unknown as { questions: { question: string }[] }).questions
      const answers = Object.fromEntries(questions.map(q => [q.question, r.answer]))
      return { result: { questions, answers }, text: 'answered' }
    }
    return { result: 'ran', text: 'ran' }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>the engine drew this</Text>
  })
  return r
}

const PANE = {
  title: 'The Loop',
  isFocused: true,
  bodyColumns: 100,
  placement: 'dock' as const,
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 6,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 5 },
  view: {},
}
const VIEWPORT = { columns: 120, rows: 40, isFullscreen: true }

/** `/sdlc <args>` as the engine raises it: typed by a person at the prompt, unless `origin` says otherwise. */
const sdlc = ($: Engine, args: string, kind = 'composer') =>
  $.command.run({ command: 'sdlc', args, origin: kind === 'plugin' ? { kind: 'plugin', name: 'other' } : { kind: 'composer' }, presentation: { isFullscreen: true, columns: 120 } })

const SEMI = { autonomy: { mode: 'semi' } }
const MANUAL = { autonomy: { mode: 'manual' } }

/** A session with a config file, optionally a run already on disk. */
async function boot($: Engine, on: On, config: object = SEMI, files: Record<string, string> = {}, store: Record<string, unknown> = {}): Promise<Rig> {
  const r = rig(on, store)
  r.files.set('.okf/config.json', JSON.stringify(config))
  for (const [k, v] of Object.entries(files)) r.files.set(k, v)
  await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
  return r
}

const mountPane = ($: Engine, surface: 'terminal' | 'desktop') =>
  $.ui.mount({ plugin: 'okf-loop', surface, component: 'Pane', requestId: 'sdlc-loop', props: PANE, viewport: VIEWPORT })
const mountBand = ($: Engine, surface: 'terminal' | 'desktop', hasSurvey = false) =>
  $.ui.mount({ plugin: 'okf-loop', surface, component: 'AbovePrompt', props: { ...BAND, hasSurvey }, viewport: VIEWPORT })

/** A run on disk whose intent is complete and waiting for a person. */
const READY = {
  '.okf/runs/add-rate-limiting.json': JSON.stringify({ slug: SLUG, title: 'Add rate limiting', source: 'human', createdAt: NOW - 3_600_000 }),
  '.okf/active': `${SLUG}\n`,
  [INTENT]: intentText('draft'),
}

describe('the pane and the band, mounted through the plugin', () => {
  for (const surface of SURFACES) {
    test(`${surface}: an empty project shows the welcome card; typing an idea starts a run and queues the interview`, async ($, on) => {
      const r = await boot($, on)
      const ui = await mountPane($, surface)
      expect(await ui.find({ type: 'Input', key: 'newrun' })).toBeDefined()
      await ui.input({ key: 'newrun', text: 'add rate limiting' })
      expect(r.files.get(INTENT)).toContain('# Intent: Add rate limiting')
      expect(r.files.get('.okf/active')?.trim()).toBe(SLUG)
      expect(r.files.get('.okf/ledger.jsonl')).toContain('run.created')
      await r.clock.advance(50)
      expect(r.prompts.length).toBe(1)
      expect(r.prompts[0]).toContain('interview')
      expect(await ui.find({ type: 'Text', text: 'Add rate limiting' })).toBeDefined()
      await ui.unmount()
    })

    test(`${surface}: a person's edit shows up on the heartbeat, and the Approve button passes the gate`, async ($, on) => {
      const r = await boot($, on, SEMI, READY)
      const ui = await mountPane($, surface)
      await r.clock.advance(5000)
      const approve = await ui.find({ type: 'Button', key: 'gate:approve' })
      expect(approve).toBeDefined()
      await ui.press({ key: 'gate:approve' })
      expect(r.files.get(INTENT)).toContain('**Status:** approved')
      expect(JSON.parse(r.files.get(`.okf/runs/${SLUG}.json`) ?? '{}').approvals['intent.approve'].by).toBe('Ana')
      await r.clock.advance(50)
      expect(r.prompts.some(p => p.includes('draft-spec'))).toBe(true)
      expect(r.toasts.some(t => t.includes('Approved intent.approve'))).toBe(true)
      await ui.unmount()
    })
  }
})

describe('the band above the prompt', () => {
  for (const surface of SURFACES) {
    test(`${surface}: it turns into a sign-off line, Approve passes the gate, Hide gives the prompt back to the engine`, async ($, on) => {
      const r = await boot($, on, SEMI, READY)
      await r.clock.advance(5000)
      const band = await mountBand($, surface)
      expect(await band.find({ type: 'Text', text: /awaits your sign-off/ })).toBeDefined()
      await band.press({ key: 'band:approve' })
      expect(r.files.get(INTENT)).toContain('**Status:** approved')
      expect(await band.find({ type: 'Text', text: /awaits your sign-off/ })).toBeUndefined()
      await band.press({ key: 'band:hide' })
      expect(await band.find({ type: 'Text', text: 'the engine drew this' })).toBeDefined()
      const ui = r.state['okf-loop.ui'] as { bandHidden: boolean } | undefined
      expect(ui?.bandHidden).toBe(true)
      await band.unmount()
    })

    test(`${surface}: a survey keeps the band quiet`, async ($, on) => {
      await boot($, on, SEMI, READY)
      const band = await mountBand($, surface, true)
      expect(await band.find({ type: 'Text', text: 'the engine drew this' })).toBeDefined()
      expect(await band.find({ type: 'Button', key: 'band:open' })).toBeUndefined()
      await band.unmount()
    })
  }

  test('no run, no band', async ($, on) => {
    await boot($, on)
    const band = await mountBand($, 'terminal')
    expect(await band.find({ type: 'Text', text: 'the engine drew this' })).toBeDefined()
    await band.unmount()
  })
})

describe('rejecting from the pane', () => {
  test('the Reject button asks why, and the answer goes to the ledger and the redraft prompt', async ($, on) => {
    const r = await boot($, on, SEMI, READY)
    await r.clock.advance(5000)
    r.answer = 'The problem section ignores mobile users'
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'gate:reject' })
    await r.clock.advance(50)
    expect(r.files.get(INTENT)).toContain('**Status:** rejected')
    expect(r.files.get('.okf/ledger.jsonl')).toContain('The problem section ignores mobile users')
    expect(r.prompts.some(p => p.includes('The problem section ignores mobile users'))).toBe(true)
    await ui.unmount()
  })
})

describe('the other tabs', () => {
  for (const surface of SURFACES) {
    test(`${surface}: Plays adopts and drops a play, Guards grants and revokes the release, Setup scaffolds`, async ($, on) => {
      const r = await boot($, on, SEMI, READY)
      await r.clock.advance(5000)
      const ui = await mountPane($, surface)

      await ui.press({ key: 'tab:plays' })
      await ui.press({ key: 'play:4:toggle' })
      expect(JSON.parse(r.files.get('.okf/config.json') ?? '{}').plays.enabled).not.toContain(4)
      await ui.press({ key: 'play:4:toggle' })
      expect(JSON.parse(r.files.get('.okf/config.json') ?? '{}').plays).toBeUndefined()
      await ui.press({ key: 'play:7:toggle' })
      expect(r.toasts.some(t => t.includes('cannot be disabled'))).toBe(true)

      await ui.press({ key: 'tab:guards' })
      await ui.press({ key: 'release:grant' })
      const until = r.state['okf-loop.grantUntil']
      expect(until).toBe(NOW + 5000 + 15 * 60_000)
      expect(r.files.get('.okf/ledger.jsonl')).toContain('release.granted')
      await ui.press({ key: 'release:revoke' })
      expect(r.state['okf-loop.grantUntil']).toBeNull()
      await ui.press({ key: 'guard:test-lock:toggle' })
      expect(JSON.parse(r.files.get('.okf/config.json') ?? '{}').guards.disabled).toContain('test-lock')

      await ui.press({ key: 'tab:setup' })
      await ui.press({ key: 'setup:create-all' })
      for (const path of ['CLAUDE.md', 'REVIEW.md', 'bands.yaml', 'evals/check.sh', '.claude/hooks/production-gate.sh']) expect(r.files.has(path)).toBe(true)
      expect(await ui.find({ type: 'Button', key: 'setup:create-all' })).toBeUndefined()
      await ui.unmount()
    })

    test(`${surface}: the mode picker writes the config and the pane follows`, async ($, on) => {
      const r = await boot($, on, SEMI, READY)
      const ui = await mountPane($, surface)
      await ui.press({ key: 'tab:setup' })
      await ui.select({ key: 'setup:mode', value: 'guided' })
      expect(JSON.parse(r.files.get('.okf/config.json') ?? '{}').autonomy.mode).toBe('guided')
      expect(viewOf(r)?.autopilot.mode).toBe('guided')
      await ui.unmount()
    })
  }

  test('the ledger tab exports the audit trail', async ($, on) => {
    const r = await boot($, on, SEMI, READY)
    const ui = await mountPane($, 'terminal')
    await ui.press({ key: 'tab:ledger' })
    await ui.press({ key: 'ledger:export' })
    expect(r.files.get('.okf/AUDIT.md')).toContain('# Audit trail')
    await ui.unmount()
  })
})

describe('a host with no file system at all', () => {
  test('the plugin loads, publishes an empty view and answers commands: every read degrades to "missing"', async ($, on) => {
    const r = rig(on, {}, { fs: false })
    await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
    expect(viewOf(r)?.ready).toBe(true)
    expect(viewOf(r)?.runs).toEqual([])
    expect((await sdlc($, 'status')).text).toContain('No run yet')
    expect((await sdlc($, 'approve')).text).toContain('no active run')
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Input', key: 'newrun' })).toBeDefined()
    // a guard still judges, and a refused write is still refused
    const denied = await $.tool.call({ tool: 'Write', file_path: '/work/proj/.env', content: 'A=1' })
    expect(denied.deny).toContain('protect')
    await ui.unmount()
  })
})

describe('a guard that fails', () => {
  test('refuses the action (fail closed) instead of waving it through', async ($, on) => {
    const r = rig(on, {}, { env: 'deny-release' })
    await $.session.start({ cwd: '/work/proj', surface: 'terminal', isInteractive: true })
    const denied = await $.tool.call({ tool: 'Bash', command: 'echo hi' })
    expect(denied.deny).toContain('fail closed')
    expect(r.toasts).toEqual([])
  })
})

describe('hooks the engine raises', () => {
  test('the session start registers /sdlc, publishes the view and a status line; the pane opens only when asked', async ($, on) => {
    const r = await boot($, on, SEMI, READY)
    const vm = viewOf(r)
    expect(vm?.ready).toBe(true)
    expect(vm?.active?.record.slug).toBe(SLUG)
    expect(r.status.at(-1)).toBe('Loop 1/6 Plan · semi')
    expect(r.opened).toEqual([])
  })

  test('openPaneOnStart set in the plugin options opens the pane at the start', async ($, on) => {
    const r = await boot($, on, MANUAL, READY)
    expect(r.opened).toEqual([])
  })

  test('openPaneOnStart in the plugin options opens it', { options: { openPaneOnStart: 'yes' } }, async ($, on) => {
    const r = await boot($, on, MANUAL, READY)
    expect(r.opened).toEqual(['sdlc-loop'])
  })

  test('a mode set in the plugin options wins over the file, and /sdlc mode says so', { options: { mode: 'manual' } }, async ($, on) => {
    const r = await boot($, on, SEMI)
    await sdlc($, 'new add rate limiting')
    await r.clock.advance(50)
    expect(r.prompts).toEqual([])
    expect(viewOf(r)?.autopilot.mode).toBe('manual')
    const reply = await sdlc($, 'mode guided')
    expect(reply.text).toContain('plugin option')
  })

  test('the untouched options mean "use .okf/config.json"', async ($, on) => {
    const r = await boot($, on, SEMI)
    expect(viewOf(r)?.autopilot.mode).toBe('semi')
    expect(viewOf(r)?.config.autonomy.maxAutoTurns).toBe(12)
  })

  test('/sdlc through the engine: status answers, and state-changing commands know who is asking', async ($, on) => {
    await boot($, on, MANUAL, READY)
    const status = await sdlc($, 'status')
    expect(status.text).toContain('Run add-rate-limiting')
    const help = await sdlc($, 'help')
    expect(help.text).toContain('/sdlc approve')
    const bad = await sdlc($, 'frobnicate')
    expect(bad.text).toContain('Unknown command')
    const open = await sdlc($, '')
    expect(open.text).toContain('Loop pane open')
  })

  test('only a person can change anything: a plugin that runs /sdlc approve is refused', async ($, on) => {
    const r = await boot($, on, MANUAL, READY)
    const refused = await sdlc($, 'approve', 'plugin')
    expect(refused.text).toContain('reserved for a person')
    expect(r.files.get(INTENT)).toContain('**Status:** draft')
    const done = await sdlc($, 'approve')
    expect(done.text).toContain('Approved intent.approve')
    expect(r.files.get(INTENT)).toContain('**Status:** approved')
  })

  test('the Loop contract is added to the system prompt as a session section', async ($, on) => {
    await boot($, on, SEMI, READY)
    const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: [], tools: [], outputStyle: null, traits: [] })
    const ids = composed.sections.map(s => s.id)
    expect(ids).toEqual(['engine', 'okf-loop:contract'])
    const contract = composed.sections.find(s => s.id === 'okf-loop:contract')
    expect(contract?.scope).toBe('session')
    expect(contract?.text).toContain('add-rate-limiting')
    expect(contract?.text).toContain('Mode semi')
  })

  test('a guard refuses before the tool runs, and says why; the denial is in the ledger', async ($, on) => {
    const r = await boot($, on, SEMI, READY)
    const denied = await $.tool.call({ tool: 'Write', file_path: '/work/proj/src/checkout.ts', content: 'export {}' })
    expect(denied.deny).toContain('Play 03')
    expect(denied.deny).toContain('plan')
    const ledger = r.files.get('.okf/ledger.jsonl') ?? ''
    expect(ledger).toContain('guard.blocked')
    expect(ledger).toContain('"guard":"plan-first"')
    expect(JSON.parse(r.files.get(`.okf/runs/${SLUG}.json`) ?? '{}').blockStreak).toBe(1)
    const allowed = await $.tool.call({ tool: 'Read', file_path: '/work/proj/README.md' })
    expect(allowed.deny).toBeUndefined()
  })

  test('a secret is refused even where plan-first does not apply', async ($, on) => {
    await boot($, on, SEMI)
    const denied = await $.tool.call({ tool: 'Write', file_path: '/work/proj/notes.txt', content: 'key AKIAIOSFODNN7REALKEY' })
    expect(denied.deny).toContain('secret')
  })

  test('a passing verification command is tracked on the run, and a gate cannot be forged through Bash', async ($, on) => {
    const r = await boot($, on, SEMI, READY)
    await $.tool.call({ tool: 'Bash', command: 'make test' })
    const rec = JSON.parse(r.files.get(`.okf/runs/${SLUG}.json`) ?? '{}')
    expect(rec.proof.lastRunPassed).toBe(true)
    expect(rec.proof.lastCommand).toBe('make test')
    expect(r.files.get('.okf/ledger.jsonl')).toContain('proof.pass')
    const forged = await $.tool.call({ tool: 'Bash', command: `sed -i 's/Status: draft/Status: approved/' intent/${SLUG}.md` })
    expect(forged.deny).toContain('Gate integrity')
    expect(r.files.get(INTENT)).toContain('**Status:** draft')
  })

  test('an approval that appears in a file while the agent is working is quarantined; the person confirms it', async ($, on) => {
    const r = await boot($, on, MANUAL, READY)
    await $.tool.call({ tool: 'Bash', command: 'echo hello' })
    r.files.set(INTENT, intentText('approved'))
    await r.clock.advance(5000)
    const vm = viewOf(r)
    expect(vm?.active?.stages[0]?.gates[0]?.approved).toBe(false)
    expect(vm?.quarantined.map(q => `${q.slug}:${q.gate}`)).toEqual([`${SLUG}:intent.approve`])
    expect(vm?.setup.some(s => s.id.startsWith('confirm:'))).toBe(false)
    expect(r.files.get('.okf/ledger.jsonl')).toContain('"quarantine":true')
    const ui = await mountPane($, 'terminal')
    expect(await ui.find({ type: 'Button', key: 'quarantine:confirm' })).toBeDefined()
    await ui.press({ key: 'quarantine:confirm' })
    expect(viewOf(r)?.active?.stages[0]?.gates[0]?.approved).toBe(true)
    expect(viewOf(r)?.quarantined).toEqual([])
    expect(JSON.parse(r.files.get(`.okf/runs/${SLUG}.json`) ?? '{}').approvals['intent.approve'].by).toBe('Ana')
    await ui.unmount()
  })

  test('the end of a turn the mod started runs the autopilot: the intent is ready, a toast says whose move it is', async ($, on) => {
    const r = await boot($, on, SEMI)
    await sdlc($, 'new add rate limiting')
    await r.clock.advance(50)
    r.files.set(INTENT, intentText('draft'))
    await $.turn.complete({ answer: 'The intent is written.', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(r.toasts.some(t => t.includes('ready for your sign-off'))).toBe(true)
    expect(r.files.get('.okf/ledger.jsonl')).toContain('"code":"human-gate"')
    expect(r.prompts.length).toBe(1)
  })
})

describe('Stage 6, end to end', () => {
  const config = {
    autonomy: { mode: 'manual' },
    bands: { enabled: true, window: 10, sources: [{ metric: 'ci_failure_rate', description: 'CI failure rate', argv: ['./rate.sh'], parse: 'number', intervalMinutes: 5, higherIsWorse: true }] },
  }
  const READING = { metric: 'ci_failure_rate', at: NOW, value: 0.17, mean: 0.12, sd: 0.02, z: 2.5, tier: '2sigma' as const, rules: [], n: 10 }

  test('a 2σ breach asks the read-only diagnoser; when no diagnosis can be had the harness still opens the incident', async ($, on) => {
    let rate = 0.1
    const r = await boot($, on, config)
    r.proc = argv => (argv[0] === './rate.sh' ? { stdout: `${rate}\n`, exitCode: 0 } : { stdout: '', exitCode: 1 })
    for (let i = 0; i < 12; i++) {
      rate = 0.1 + (i % 2) * 0.04
      await r.clock.advance(5 * 60_000)
    }
    expect(r.files.get('.okf/bands/ci_failure_rate.jsonl')?.trim().split('\n').length).toBeGreaterThanOrEqual(10)
    expect(r.agents).toEqual([])
    rate = 0.17
    await r.clock.advance(5 * 60_000)
    expect(r.agents).toEqual(['okf-loop:diagnoser'])
    expect(r.files.get('.okf/ledger.jsonl')).toContain('band.breach')
    expect(r.toasts.some(t => t.includes('2σ breach'))).toBe(true)
    // the test engine hands back no agent id, so the harness writes the intent without a diagnosis
    const incident = [...r.files.keys()].find(k => k.startsWith('intent/incident-'))
    expect(incident).toBeDefined()
    expect(r.files.get(incident ?? '')).toContain('ANOMALY-ci_failure_rate-2026-10-06')
    expect(r.files.get('.okf/ledger.jsonl')).toContain('incident.intent')
    expect(viewOf(r)?.runs.some(run => run.source === 'anomaly')).toBe(true)
    expect(viewOf(r)?.bands[0]?.tier).toBe('2sigma')
  })

  test('the subagent\'s own turn carries the diagnosis into the incident intent', async ($, on) => {
    const r = await boot($, on, config, {}, { diagnoses: { 'agent-1': { metric: 'ci_failure_rate', reading: READING, startedAt: NOW } } })
    await $.turn.complete({ answer: '### Signature\nretry storm after abc123', durationMs: 5, isAborted: false, turnId: 't9', reason: 'answer', agentId: 'agent-1' })
    const incident = [...r.files.keys()].find(k => k.startsWith('intent/incident-'))
    expect(r.files.get(incident ?? '')).toContain('retry storm after abc123')
    // a stranger's turn changes nothing
    const before = r.files.size
    await $.turn.complete({ answer: 'x', durationMs: 5, isAborted: false, turnId: 't10', reason: 'answer', agentId: 'agent-7' })
    expect(r.files.size).toBe(before)
  })

  test('a diagnosis that never arrives is given up on after ten minutes', async ($, on) => {
    const r = await boot($, on, config, {}, { diagnoses: { 'agent-1': { metric: 'ci_failure_rate', reading: READING, startedAt: NOW } } })
    await r.clock.advance(11 * 60_000)
    expect([...r.files.keys()].some(k => k.startsWith('intent/incident-'))).toBe(true)
  })
})
