import { test, expect, describe } from 'claude-code/testing'

import { setupItems } from '../hooks/core/controller'
import { MIN, World, intentText, planText, proofText, reviewText, specText, startedWorld } from './loop-world'

const SLUG = 'add-rate-limiting'
const INTENT = `intent/${SLUG}.md`
const SPEC = `specs/${SLUG}.spec.md`
const PLAN = `plans/${SLUG}.plan.md`
const PROOF = `proofs/${SLUG}.proof.md`
const REVIEW = `reviews/${SLUG}.review.md`
const SRC = ['src/checkout.ts']

type Mode = 'manual' | 'guided' | 'semi'

/** One agent turn that moved the loop forward, then the end of that turn. */
function agentWrites(w: World, path: string, text: string, answer = 'Done.'): void {
  w.advance(MIN)
  w.put(path, text)
  w.turnComplete(answer)
}

/** Drive a run through intent, spec and plan acceptance; ends with the agent told to implement (semi) or waiting. */
function toImplement(mode: Mode, config: object = {}): World {
  const w = new World({ config: { autonomy: { mode, ...config } } }).boot()
  w.run('new add rate limiting')
  agentWrites(w, INTENT, intentText('draft'))
  w.run('approve')
  agentWrites(w, SPEC, specText('draft', SLUG))
  w.run('approve')
  agentWrites(w, PLAN, planText('draft', SRC, SLUG))
  w.run('approve')
  return w
}

/** A run waiting at the release gate: everything before it done. */
function atRelease(mode: Mode): World {
  const w = toImplement('manual')
  w.run(`mode ${mode}`)
  w.advance(MIN)
  w.tool(w.edit('src/checkout.ts'))
  w.advance(MIN)
  w.put(PLAN, planText('complete', SRC, SLUG))
  w.tool(w.bash('make test'))
  w.advance(MIN)
  w.put(PROOF, proofText('PASS'))
  w.advance(MIN)
  w.put(REVIEW, reviewText(true))
  w.refresh()
  w.prompts.length = 0
  return w
}

describe('the semi autopilot across the whole loop', () => {
  test('chains every non-human step and halts at each human gate', () => {
    const w = new World({ config: { autonomy: { mode: 'semi' } } }).boot()
    w.run('new add rate limiting')
    expect(w.prompts.map(p => p.key)).toEqual(['interview'])

    // The agent interviews and writes the intent: a human gate, so the chain stops.
    agentWrites(w, INTENT, intentText('draft'), 'The intent is written.')
    expect(w.prompts.map(p => p.key)).toEqual(['interview'])
    const halted = w.ledgerOf('autopilot.halted')
    expect(halted.length).toBe(1)
    expect(halted[0]?.data?.code).toBe('human-gate')
    expect(w.toasts.some(t => t.includes('ready for your sign-off') && t.includes('/sdlc approve'))).toBe(true)

    w.run('approve')
    expect(w.lastPrompt?.key).toBe('draft-spec')
    agentWrites(w, SPEC, specText('draft', SLUG), 'The spec is written.')
    expect(w.prompts.map(p => p.key)).toEqual(['interview', 'draft-spec'])

    w.run('approve')
    expect(w.lastPrompt?.key).toBe('draft-plan')
    agentWrites(w, PLAN, planText('draft', SRC, SLUG), 'The plan is written.')
    w.run('approve')
    expect(w.lastPrompt?.key).toBe('implement')
    expect(w.text(PLAN)).toContain('**Status:** accepted')

    // Implementation: edits tracked, plan marked complete by the agent, then verify is queued by the mod.
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.advance(MIN)
    w.put(PLAN, planText('complete', SRC, SLUG))
    w.turnComplete('Implemented.')
    expect(w.lastPrompt?.key).toBe('verify')
    expect(w.lastPrompt?.by).toBe('autopilot')

    w.advance(MIN)
    w.tool(w.bash('make test'))
    w.advance(MIN)
    w.put(PROOF, proofText('PASS'))
    w.turnComplete('Verified.')
    expect(w.lastPrompt?.key).toBe('review')
    expect(w.ledgerOf('gate.approved').some(e => e.data?.gate === 'verify.pass' && e.actor === 'mod')).toBe(true)

    w.advance(MIN)
    w.put(REVIEW, reviewText(true))
    w.turnComplete('Reviewed.')
    expect(w.prompts.map(p => p.key)).toEqual(['interview', 'draft-spec', 'draft-plan', 'implement', 'verify', 'review'])
    expect(w.active.snapshot.next.kind).toBe('release')
    const codes = w.ledgerOf('autopilot.halted').map(e => e.data?.code)
    expect(codes.filter(c => c === 'human-gate').length).toBe(4)
    expect(w.toasts.some(t => t.includes('release awaits your authorization'))).toBe(true)
  })

  test('a failed verification sends it back to implement, a passing re-verification forward', () => {
    const w = toImplement('semi')
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.put(PLAN, planText('complete', SRC, SLUG))
    w.turnComplete('Implemented.')
    expect(w.lastPrompt?.key).toBe('verify')
    w.advance(MIN)
    w.tool(w.bash('make test'), true)
    w.put(PROOF, proofText('FAIL'))
    w.turnComplete('Tests fail.')
    expect(w.lastPrompt?.key).toBe('implement')
    expect(w.record(SLUG).verifyFailStreak).toBe(1)
  })

  test('a person-typed turn never triggers a queued prompt', () => {
    const w = toImplement('semi')
    w.advance(MIN)
    w.turnComplete('That is how the limiter works.')
    const before = w.prompts.length
    w.advance(MIN)
    w.turnComplete('Another answer to a question the person typed.')
    expect(w.prompts.length).toBe(before)
  })

  test('guided suggests and never queues; manual does nothing', () => {
    const g = toImplement('guided')
    expect(g.prompts.map(p => p.key)).toEqual(['interview'])
    expect(g.active.snapshot.next.kind).toBe('implement')
    g.run('next')
    expect(g.lastPrompt?.key).toBe('implement')
    expect(g.lastPrompt?.by).toBe('human')
    const m = toImplement('manual')
    expect(m.prompts).toEqual([])
    m.turnComplete('Done.')
    expect(m.prompts).toEqual([])
    expect(m.run('next')).toContain('Queued')
  })

  test('without Play 04 semi runs as guided', () => {
    const w = new World({ config: { autonomy: { mode: 'semi' } } }).boot()
    expect(w.run('plays disable 4')).toContain('disabled')
    w.run('new add rate limiting')
    agentWrites(w, INTENT, intentText('draft'))
    const reply = w.run('approve')
    expect(reply).toContain('Next step')
    expect(w.prompts.map(p => p.key)).toEqual(['interview'])
    expect(w.model.config.autonomy.mode).toBe('semi')
    expect(w.run('status')).toContain('Play 04 is not adopted')
  })

  test('the turn budget halts the chain; /sdlc next goes past it', () => {
    const w = toImplement('semi', { maxAutoTurns: 2 })
    expect(w.record(SLUG).autoTurns).toBe(1)
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.turnComplete('Part one.')
    expect(w.lastPrompt?.key).toBe('implement')
    expect(w.record(SLUG).autoTurns).toBe(2)
    w.advance(MIN)
    w.tool(w.edit('src/limiter.ts'))
    w.turnComplete('Part two.')
    expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === 'budget')).toBe(true)
    const queued = w.prompts.length
    w.run('next')
    expect(w.prompts.length).toBe(queued + 1)
  })

  test('a turn that changed nothing halts instead of looping', () => {
    const w = toImplement('semi')
    w.advance(MIN)
    w.turnComplete('I looked around.')
    expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === 'no-progress')).toBe(true)
    expect(w.model.runtime.pending).toBeNull()
  })

  test('an agent that ends on a question is waited for', () => {
    const w = toImplement('semi')
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    const queued = w.prompts.length
    w.turnComplete('Should the limit be per account or per IP?')
    expect(w.prompts.length).toBe(queued)
    expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === 'question')).toBe(true)
  })

  test('an interrupted or failed turn halts the chain', () => {
    for (const reason of ['aborted', 'error'] as const) {
      const w = toImplement('semi')
      const queued = w.prompts.length
      w.turnComplete('', reason)
      expect(w.prompts.length).toBe(queued)
      expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === reason)).toBe(true)
    }
  })

  test('guard blocks in a row halt the autopilot; a good step in between resets the count', () => {
    const w = toImplement('semi', { haltOnBlocks: 2 })
    w.denied(w.bash('git push origin main'))
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    expect(w.record(SLUG).blockStreak).toBe(0)
    for (let i = 0; i < 2; i++) {
      w.advance(1000)
      expect(w.denied(w.bash('git push origin main')).allow).toBe(false)
    }
    expect(w.record(SLUG).blockStreak).toBe(2)
    w.advance(MIN)
    w.turnComplete('Tried.')
    expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === 'blocked-streak')).toBe(true)
  })

  test('failed verifications in a row halt it', () => {
    const w = toImplement('semi', { haltOnVerifyFails: 2 })
    w.put(PLAN, planText('complete', SRC, SLUG))
    w.run('next')
    for (let i = 0; i < 2; i++) {
      w.advance(MIN)
      w.tool(w.bash('make test'), true)
    }
    expect(w.record(SLUG).verifyFailStreak).toBe(2)
    w.advance(MIN)
    w.put(PROOF, proofText('FAIL'))
    w.turnComplete('Failing.')
    expect(w.ledgerOf('autopilot.halted').some(e => e.data?.code === 'verify-fail-streak')).toBe(true)
  })

  test('pause halts it and resume starts the next step again', () => {
    const w = toImplement('semi')
    w.run('pause')
    expect(w.record(SLUG).paused).toBe(true)
    expect(w.active.snapshot.record.paused).toBe(true)
    const queued = w.prompts.length
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.turnComplete('Part one.')
    expect(w.prompts.length).toBe(queued)
    w.run('resume')
    expect(w.record(SLUG).paused).toBe(false)
    expect(w.prompts.length).toBe(queued + 1)
  })

  test('/sdlc next is never a way past a human gate', () => {
    const w = new World({ config: { autonomy: { mode: 'semi' } } }).boot()
    w.run('new add rate limiting')
    agentWrites(w, INTENT, intentText('draft'))
    const queued = w.prompts.length
    const reply = w.run('next')
    expect(reply).toContain('human gate')
    expect(w.prompts.length).toBe(queued)
  })

  test('a project prompt override replaces the stage prompt', () => {
    const w = toImplement('guided')
    w.put('.okf/prompts/implement.md', 'Do {{title}} in the house style. Plan at {{plan_path}}.')
    w.refresh()
    w.run('next')
    expect(w.lastPrompt?.text).toBe('Do Add rate limiting in the house style. Plan at plans/add-rate-limiting.plan.md.')
  })
})

describe('guards and their bookkeeping', () => {
  test('plan-first holds a source edit until the plan is accepted; a denial is ledgered with its guard', () => {
    const w = startedWorld('manual')
    const verdict = w.denied(w.edit('src/checkout.ts'))
    expect(verdict.allow).toBe(false)
    expect(verdict.allow === false && verdict.message).toContain('plan')
    const entry = w.ledgerOf('guard.blocked')[0]
    expect(entry?.data?.guard).toBe('plan-first')
    expect(entry?.run).toBe(SLUG)
    expect(w.record(SLUG).blockStreak).toBe(1)
  })

  test('with no run only the run-independent guards apply', () => {
    const w = new World().boot()
    expect(w.judge(w.edit('src/anything.ts')).allow).toBe(true)
    expect(w.judge({ tool: 'Write', filePath: `${w.cwd}/.env`, content: 'A=1' }).allow).toBe(false)
  })

  test('a denial toast is rate limited per guard', () => {
    const w = startedWorld('manual')
    w.denied(w.edit('src/a.ts'))
    w.advance(10_000)
    w.denied(w.edit('src/b.ts'))
    expect(w.toasts.filter(t => t.includes('stopped the agent')).length).toBe(1)
    w.advance(61_000)
    w.denied(w.edit('src/c.ts'))
    expect(w.toasts.filter(t => t.includes('stopped the agent')).length).toBe(2)
    expect(w.ledgerOf('guard.blocked').length).toBe(3)
  })

  test('the proof tracker records a passing and a failing verification command', () => {
    const w = toImplement('manual')
    w.advance(MIN)
    w.tool(w.bash('cd api && make test -j4'))
    let rec = w.record(SLUG)
    expect(rec.proof.lastRunPassed).toBe(true)
    expect(rec.proof.lastRunAt).toBe(w.now)
    expect(rec.proof.lastCommand).toBe('cd api && make test -j4')
    expect(w.ledgerOf('proof.pass')[0]?.data?.command).toBe('cd api && make test -j4')
    w.advance(MIN)
    w.tool(w.bash('npm test'), true)
    rec = w.record(SLUG)
    expect(rec.proof.lastRunPassed).toBe(false)
    expect(rec.verifyFailStreak).toBe(1)
    expect(w.ledgerOf('proof.fail').length).toBe(1)
    w.advance(MIN)
    w.tool(w.bash('npm test'))
    expect(w.record(SLUG).verifyFailStreak).toBe(0)
  })

  test('other Bash commands are not proof runs', () => {
    const w = toImplement('manual')
    w.tool(w.bash('ls -la'))
    w.tool(w.bash('git status'))
    expect(w.record(SLUG).proof.lastRunAt).toBe(0)
    expect(w.ledgerOf('proof.pass')).toEqual([])
  })

  test('the edit tracker keeps unique repo-relative source paths and stamps lastEditAt', () => {
    const w = toImplement('manual')
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.tool({ tool: 'Write', filePath: `${w.cwd}/src/limiter.ts`, content: 'x' })
    const rec = w.record(SLUG)
    expect(rec.edits).toEqual(['src/checkout.ts', 'src/limiter.ts'])
    expect(rec.proof.lastEditAt).toBe(w.now)
  })

  test('edits of artifacts, .okf, docs and files outside the repo are not source edits', () => {
    const w = toImplement('manual')
    const before = w.record(SLUG)
    w.advance(MIN)
    w.tool({ tool: 'Write', filePath: `${w.cwd}/${PROOF}`, content: 'x' })
    w.tool({ tool: 'Edit', filePath: `${w.cwd}/docs/readme.md`, content: 'x' })
    w.tool({ tool: 'Write', filePath: '/tmp/elsewhere.ts', content: 'x' })
    w.tool(w.edit('src/failed.ts'), true)
    const after = w.record(SLUG)
    expect(after.edits).toEqual(before.edits)
    expect(after.proof.lastEditAt).toBe(before.proof.lastEditAt)
    const written = w.ledgerOf('artifact.written').filter(e => e.actor === 'agent')
    expect(written.length).toBe(1)
    expect(written[0]?.data).toMatchObject({ kind: 'proof', path: PROOF })
  })

  test('editing after the proof makes the proof stale for the gate', () => {
    const w = toImplement('manual')
    w.put(PLAN, planText('complete', SRC, SLUG))
    w.advance(MIN)
    w.tool(w.bash('make test'))
    w.advance(MIN)
    w.put(PROOF, proofText('PASS'))
    w.refresh()
    expect(w.active.snapshot.stages.find(s => s.id === 'test')?.gates[0]?.approved).toBe(true)
    w.advance(MIN)
    w.tool(w.edit('src/checkout.ts'))
    w.refresh()
    expect(w.active.snapshot.stages.find(s => s.id === 'test')?.gates[0]?.approved).toBe(false)
  })
})

describe('bug-fix protocol (Play 08)', () => {
  test('/sdlc fix starts it, queues the fix prompt, and a commit locks the tests', () => {
    const w = toImplement('guided')
    const reply = w.run('fix login returns 500 on an empty password')
    expect(reply).toContain('Bug-fix protocol started')
    expect(w.lastPrompt?.key).toBe('fix')
    expect(w.lastPrompt?.text).toContain('login returns 500 on an empty password')
    expect(w.record(SLUG).fix).toMatchObject({ active: true, reproCommitted: false })

    // Before the repro is committed the test is still the agent's to write.
    expect(w.judge(w.edit('tests/login.test.ts')).allow).toBe(true)
    w.tool(w.bash('git add -A && git commit -m "test: reproduce login 500"'))
    expect(w.record(SLUG).fix.reproCommitted).toBe(true)
    const locked = w.judge(w.edit('tests/login.test.ts'))
    expect(locked.allow).toBe(false)
    expect(locked.allow === false && locked.guard).toBe('test-lock')
    expect(w.judge(w.edit('src/login.ts')).allow).toBe(true)

    expect(w.run('fixed')).toContain('closed')
    expect(w.record(SLUG).fix.active).toBe(false)
    expect(w.judge(w.edit('tests/login.test.ts')).allow).toBe(true)
  })

  test('a commit with no fix active changes nothing; fix needs a run; manual mode queues nothing', () => {
    const w = toImplement('manual')
    w.tool(w.bash('git commit -m "x"'))
    expect(w.record(SLUG).fix.reproCommitted).toBe(false)
    const reply = w.run('fix a bug')
    expect(reply).toContain('manual mode')
    expect(w.prompts).toEqual([])
    expect(new World().boot().run('fix a bug')).toContain('Start or select a run')
    expect(w.run('fixed')).toContain('closed')
    expect(w.run('fixed')).toContain('No bug-fix protocol')
  })
})

describe('the release grant (Play 11)', () => {
  test('a grant lives for its window, authorizes the release and tells the agent (semi)', () => {
    const w = atRelease('semi')
    expect(w.active.snapshot.next.kind).toBe('release')
    expect(w.judge(w.bash('kubectl apply -f deploy.yaml -n prod')).allow).toBe(false)
    const reply = w.run('release grant 10')
    expect(reply).toContain('Release authorized by Ana for 10 minutes')
    expect(w.grantUntil).toBe(w.now + 10 * MIN)
    expect(w.ledgerOf('release.granted')[0]?.data).toMatchObject({ minutes: 10 })
    expect(w.record(SLUG).approvals['release.approve']).toMatchObject({ by: 'Ana' })
    expect(w.lastPrompt?.key).toBe('release')
    expect(w.judge(w.bash('kubectl apply -f deploy.yaml -n prod')).allow).toBe(true)
    // destructive SQL never runs through the agent, grant or not
    expect(w.judge(w.bash('psql -c "DROP TABLE users"')).allow).toBe(false)
  })

  test('manual mode only grants; a bare grant uses the configured minutes', () => {
    const w = atRelease('manual')
    const reply = w.run('release grant')
    expect(reply).toContain('manual mode')
    expect(w.grantUntil).toBe(w.now + 15 * MIN)
    expect(w.prompts).toEqual([])
  })

  test('approving the release gate is the same as granting', () => {
    const w = atRelease('guided')
    w.run('approve release')
    expect(w.grantUntil).toBe(w.now + 15 * MIN)
    expect(w.lastPrompt?.key).toBe('release')
  })

  test('revoking closes it again; an expired grant is revoked by the mod', () => {
    const w = atRelease('manual')
    w.run('release grant 5')
    expect(w.run('release revoke')).toContain('revoked')
    expect(w.grantUntil).toBeNull()
    expect(w.judge(w.bash('terraform apply -auto-approve -var env=prod')).allow).toBe(false)
    expect(w.ledgerOf('release.revoked')[0]?.actor).toBe('human')

    w.run('release grant 5')
    w.advance(6 * MIN)
    w.refresh()
    expect(w.grantUntil).toBeNull()
    const expired = w.ledgerOf('release.revoked').pop()
    expect(expired?.actor).toBe('mod')
    expect(expired?.data?.reason).toBe('expired')
  })

  test('with the environment token set production is open without a grant', () => {
    const w = atRelease('manual')
    w.envToken = true
    expect(w.judge(w.bash('kubectl apply -f deploy.yaml -n prod')).allow).toBe(true)
  })

  test('a grant with no run waiting still opens the window', () => {
    const w = new World().boot()
    expect(w.run('release grant 3')).toContain('Release grant live for 3 minutes')
    expect(w.grantUntil).toBe(w.now + 3 * MIN)
  })
})

describe('scaffolds', () => {
  test('/sdlc init creates what is missing, with a ledger entry each, and evals/check.sh with the CI workflow', () => {
    const w = new World().boot()
    const reply = w.run('init')
    expect(reply).toContain('Created')
    for (const path of ['.okf/config.json', '.okf/.gitignore', 'CLAUDE.md', 'REVIEW.md', 'bands.yaml', '.github/workflows/agent-evals.yml', 'evals/check.sh', '.okf/enterprise-managed-settings.json', '.claude/hooks/production-gate.sh']) {
      expect(w.files.has(path)).toBe(true)
    }
    expect(w.execs.sort()).toEqual(['.claude/hooks/production-gate.sh', 'evals/check.sh'])
    expect(w.ledgerOf('scaffold.created').length).toBe(9)
    expect(JSON.parse(w.text('.okf/config.json') ?? '{}')).toEqual({ version: 1 })
    expect(w.text('evals/check.sh')).toContain('expected_checks')
    expect(w.text('CLAUDE.md')).toContain('# proj')
    expect(setupItems(w.model).every(i => i.exists)).toBe(true)
    expect(setupItems(w.model).find(i => i.id === 'ci-evals')?.hint).toContain('evals/check.sh')

    // When the schema file exists in the repo, $schema is added to .okf/config.json
    const wWithSchema = new World()
    wWithSchema.put('mods/okf-loop/schemas/okf-config.schema.json', '{}')
    wWithSchema.boot()
    wWithSchema.run('init config')
    expect(JSON.parse(wWithSchema.text('.okf/config.json') ?? '{}')).toEqual({
      $schema: '../mods/okf-loop/schemas/okf-config.schema.json',
      version: 1,
    })
  })

  test('nothing is ever overwritten', () => {
    const w = new World()
    w.put('CLAUDE.md', 'my own context')
    w.put('REVIEW.md', 'my own policy')
    w.put('.okf/config.json', JSON.stringify({ autonomy: { mode: 'guided' } }))
    w.boot()
    const reply = w.run('init')
    expect(reply).toContain('Already there (never overwritten): Loop config, CLAUDE.md, REVIEW.md')
    expect(w.text('CLAUDE.md')).toBe('my own context')
    expect(w.text('REVIEW.md')).toBe('my own policy')
    expect(JSON.parse(w.text('.okf/config.json') ?? '{}')).toEqual({ autonomy: { mode: 'guided' } })
    expect(w.run('init')).toContain('Already there')
    expect(w.ledgerOf('scaffold.created').length).toBe(6)
  })

  test('a single item can be created by id; an unknown id is named', () => {
    const w = new World().boot()
    expect(w.run('init review-md')).toContain('Created: REVIEW.md')
    expect(w.files.has('CLAUDE.md')).toBe(false)
    expect(w.run('init nope')).toContain('Unknown setup item "nope"')
    expect(w.run('init review-md')).toContain('Already there')
  })

  test('the setup checklist follows custom paths', () => {
    const w = new World({ config: { paths: { claudeMd: 'docs/AGENTS.md' } } }).boot()
    w.run('init claude-md')
    expect(w.files.has('docs/AGENTS.md')).toBe(true)
    expect(setupItems(w.model).find(i => i.id === 'claude-md')?.path).toBe('docs/AGENTS.md')
  })
})

describe('plays, guards and mode edits', () => {
  test('a play with an adopted dependent cannot be dropped, and the reason is plain', () => {
    const w = new World().boot()
    const reply = w.run('plays disable 7')
    expect(reply).toContain('cannot be disabled')
    expect(reply).toContain('Play 11')
    expect(w.files.has('.okf/config.json')).toBe(false)
  })

  test('enabling needs the prerequisites; a legal toggle is saved minimally and ledgered', () => {
    const w = new World().boot()
    expect(w.run('plays enable 13')).toMatch(/cannot be enabled yet|enabled/)
    expect(w.run('plays disable 4')).toContain('disabled')
    const saved = JSON.parse(w.text('.okf/config.json') ?? '{}') as { plays?: { enabled: number[] } }
    expect(saved.plays?.enabled).not.toContain(4)
    expect(w.ledgerOf('play.toggled')[0]?.data).toMatchObject({ play: 4, enabled: false })
    expect(w.model.config.plays.enabled).not.toContain(4)
    expect(w.run('plays disable 4')).toContain('not adopted')
    expect(w.run('plays enable 4')).toContain('enabled')
    expect(w.model.config.plays.enabled).toContain(4)
    expect(w.run('plays')).toContain('[x] Play 04')
  })

  test('a guard of a dropped play goes dormant and stops judging', () => {
    const w = startedWorld('manual')
    w.run('plays disable 4')
    w.run('plays disable 10')
    w.run('plays disable 3')
    expect(w.judge(w.edit('src/checkout.ts')).allow).toBe(true)
  })

  test('/sdlc mode saves to the file; an option the person set still wins, and says so', () => {
    const w = new World().boot()
    expect(w.run('mode guided')).toContain('Mode set to guided')
    expect(JSON.parse(w.text('.okf/config.json') ?? '{}')).toMatchObject({ autonomy: { mode: 'guided' } })
    expect(w.model.config.autonomy.mode).toBe('guided')
    expect(w.ledgerOf('config.changed')[0]?.data).toMatchObject({ key: 'autonomy.mode', value: 'guided' })

    const forced = new World({ options: { mode: 'semi' } }).boot()
    const reply = forced.run('mode manual')
    expect(reply).toContain('plugin option')
    expect(forced.model.config.autonomy.mode).toBe('semi')
    expect(JSON.parse(forced.text('.okf/config.json') ?? '{}').autonomy.mode).toBe('manual')
  })

  test('unknown keys in the config file survive an edit', () => {
    const w = new World({ config: { custom: { keep: true }, autonomy: { mode: 'manual' } } }).boot()
    w.run('mode guided')
    expect(JSON.parse(w.text('.okf/config.json') ?? '{}').custom).toEqual({ keep: true })
  })

  test('/sdlc guards lists every guard with its hits and can switch one off', () => {
    const w = startedWorld('manual')
    w.denied(w.edit('src/a.ts'))
    const list = w.run('guards')
    expect(list).toContain('plan-first')
    expect(list).toContain('1 hit')
    expect(list).toContain('credential-shield')
    expect(list).toContain('dormant')
    expect(w.run('guards toggle plan-first')).toContain('OFF')
    expect(w.judge(w.edit('src/a.ts')).allow).toBe(true)
    expect(w.run('guards toggle plan-first')).toContain('now on')
  })
})

describe('twice, lesson, audit, worktree', () => {
  test('/sdlc twice adds the lesson to CLAUDE.md (created from the template when missing)', () => {
    const w = new World().boot()
    expect(w.run('twice never mock the clock in tests')).toContain('Things Claude Gets Wrong')
    const text = w.text('CLAUDE.md') ?? ''
    expect(text).toContain('## Things Claude Gets Wrong')
    expect(text).toContain('never mock the clock in tests (added 2026-10-06)')
    expect(text).toContain('# proj')
    w.run('twice always pin the toolchain')
    expect(w.text('CLAUDE.md')).toContain('always pin the toolchain')
    expect(w.ledgerOf('lesson.recorded').length).toBe(2)
  })

  test('/sdlc lesson queues the post-mortem prompt with the run\'s recent events', () => {
    const w = toImplement('guided')
    w.denied(w.bash('git push origin main'))
    w.run('lesson the push that was refused')
    expect(w.lastPrompt?.key).toBe('lesson')
    expect(w.lastPrompt?.text).toContain('the push that was refused')
    expect(w.lastPrompt?.text).toContain('guard.blocked')
    expect(startedWorld('manual').run('lesson x')).toContain('Manual mode')
  })

  test('/sdlc audit writes .okf/AUDIT.md from the whole ledger', () => {
    const w = toImplement('manual')
    const reply = w.run('audit')
    expect(reply).toContain('Wrote .okf/AUDIT.md')
    const text = w.text('.okf/AUDIT.md') ?? ''
    expect(text).toContain('# Audit trail')
    expect(text).toContain(SLUG)
    expect(text).toContain('intent.approve')
  })

  test('/sdlc worktree answers with the command to run', () => {
    const w = startedWorld('manual')
    expect(w.run('worktree rate-limit')).toContain('claude --worktree rate-limit')
  })

  test('/sdlc use switches runs and names the options when it cannot', () => {
    const w = startedWorld('manual')
    w.run('new second change')
    expect(w.model.active).toBe('second-change')
    expect(w.run(`use ${SLUG}`)).toContain('Active run')
    expect(w.text('.okf/active')?.trim()).toBe(SLUG)
    expect(w.run('use nope')).toContain('second-change')
  })
})
