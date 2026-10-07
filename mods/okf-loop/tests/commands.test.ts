import { test, expect, describe } from 'claude-code/testing'

import { HELP_TEXT, isHumanOrigin, isReadOnly, parseCommand, parseGate } from '../hooks/core/commands'

describe('parseCommand', () => {
  test('no arguments opens the pane', () => {
    expect(parseCommand('')).toEqual({ cmd: 'open' })
    expect(parseCommand('   ')).toEqual({ cmd: 'open' })
    expect(parseCommand('open')).toEqual({ cmd: 'open' })
  })

  test('simple verbs', () => {
    expect(parseCommand('status')).toEqual({ cmd: 'status' })
    expect(parseCommand('STATUS')).toEqual({ cmd: 'status' })
    expect(parseCommand('help')).toEqual({ cmd: 'help' })
    expect(parseCommand('next')).toEqual({ cmd: 'next' })
    expect(parseCommand('pause')).toEqual({ cmd: 'pause' })
    expect(parseCommand('resume')).toEqual({ cmd: 'resume' })
    expect(parseCommand('fixed')).toEqual({ cmd: 'fixed' })
    expect(parseCommand('audit')).toEqual({ cmd: 'audit' })
    expect(parseCommand('reload')).toEqual({ cmd: 'reload' })
    expect(parseCommand('init')).toEqual({ cmd: 'init' })
    expect(parseCommand('init claude-md')).toEqual({ cmd: 'init', item: 'claude-md' })
  })

  test('new: idea, ticket reference, and the refusal of an empty idea', () => {
    expect(parseCommand('new add rate limiting to checkout')).toEqual({ cmd: 'new', idea: 'add rate limiting to checkout' })
    expect(parseCommand('new --ref PROJ-1 add rate limiting')).toEqual({ cmd: 'new', idea: 'add rate limiting', ref: 'PROJ-1' })
    expect(parseCommand('new --ref=PROJ-2 do it')).toEqual({ cmd: 'new', idea: 'do it', ref: 'PROJ-2' })
    expect(parseCommand('new -r ABC-9 thing')).toEqual({ cmd: 'new', idea: 'thing', ref: 'ABC-9' })
    expect(parseCommand('new').cmd).toBe('error')
    expect(parseCommand('new --ref PROJ-1').cmd).toBe('error')
  })

  test('approve takes a gate id, a short alias, or nothing', () => {
    expect(parseCommand('approve')).toEqual({ cmd: 'approve', gate: null })
    expect(parseCommand('approve intent.approve')).toEqual({ cmd: 'approve', gate: 'intent.approve' })
    expect(parseCommand('approve spec')).toEqual({ cmd: 'approve', gate: 'spec.approve' })
    expect(parseCommand('approve plan')).toEqual({ cmd: 'approve', gate: 'plan.accept' })
    expect(parseCommand('accept plan.accept')).toEqual({ cmd: 'approve', gate: 'plan.accept' })
    expect(parseCommand('approve release')).toEqual({ cmd: 'approve', gate: 'release.approve' })
    const bad = parseCommand('approve nonsense')
    expect(bad.cmd).toBe('error')
    expect(bad.cmd === 'error' && bad.message).toContain('release.approve')
  })

  test('reject: gate plus reason, or only a reason', () => {
    expect(parseCommand('reject spec.approve too vague about limits')).toEqual({ cmd: 'reject', gate: 'spec.approve', reason: 'too vague about limits' })
    expect(parseCommand('reject plan not enough detail')).toEqual({ cmd: 'reject', gate: 'plan.accept', reason: 'not enough detail' })
    expect(parseCommand('reject needs the audit trail')).toEqual({ cmd: 'reject', gate: null, reason: 'needs the audit trail' })
    expect(parseCommand('reject')).toEqual({ cmd: 'reject', gate: null, reason: '' })
  })

  test('mode', () => {
    expect(parseCommand('mode semi')).toEqual({ cmd: 'mode', mode: 'semi' })
    expect(parseCommand('mode semi-auto')).toEqual({ cmd: 'mode', mode: 'semi' })
    expect(parseCommand('mode Guided')).toEqual({ cmd: 'mode', mode: 'guided' })
    expect(parseCommand('mode manual')).toEqual({ cmd: 'mode', mode: 'manual' })
    expect(parseCommand('mode turbo').cmd).toBe('error')
    expect(parseCommand('mode').cmd).toBe('error')
  })

  test('use', () => {
    expect(parseCommand('use add-login')).toEqual({ cmd: 'use', slug: 'add-login' })
    expect(parseCommand('use').cmd).toBe('error')
  })

  test('plays', () => {
    expect(parseCommand('plays')).toEqual({ cmd: 'plays', action: 'list' })
    expect(parseCommand('plays list')).toEqual({ cmd: 'plays', action: 'list' })
    expect(parseCommand('plays enable 7')).toEqual({ cmd: 'plays', action: 'enable', n: 7 })
    expect(parseCommand('plays disable 07')).toEqual({ cmd: 'plays', action: 'disable', n: 7 })
    expect(parseCommand('plays toggle 12')).toEqual({ cmd: 'plays', action: 'toggle', n: 12 })
    expect(parseCommand('plays enable').cmd).toBe('error')
    expect(parseCommand('plays enable x').cmd).toBe('error')
    expect(parseCommand('plays frobnicate 3').cmd).toBe('error')
  })

  test('guards', () => {
    expect(parseCommand('guards')).toEqual({ cmd: 'guards' })
    expect(parseCommand('guards toggle test-lock')).toEqual({ cmd: 'guards', toggle: 'test-lock' })
    expect(parseCommand('guards toggle nope').cmd).toBe('error')
  })

  test('fix, release, twice, lesson, worktree, bands', () => {
    expect(parseCommand('fix login 500s on empty password')).toEqual({ cmd: 'fix', description: 'login 500s on empty password' })
    expect(parseCommand('fix').cmd).toBe('error')
    expect(parseCommand('release grant')).toEqual({ cmd: 'release', action: 'grant' })
    expect(parseCommand('release grant 30')).toEqual({ cmd: 'release', action: 'grant', minutes: 30 })
    expect(parseCommand('release revoke')).toEqual({ cmd: 'release', action: 'revoke' })
    expect(parseCommand('release grant 0').cmd).toBe('error')
    expect(parseCommand('release grant 9999').cmd).toBe('error')
    expect(parseCommand('release').cmd).toBe('error')
    expect(parseCommand('twice never mock the clock in tests')).toEqual({ cmd: 'twice', lesson: 'never mock the clock in tests' })
    expect(parseCommand('twice').cmd).toBe('error')
    expect(parseCommand('lesson the retry storm')).toEqual({ cmd: 'lesson', title: 'the retry storm' })
    expect(parseCommand('worktree feature-x')).toEqual({ cmd: 'worktree', name: 'feature-x' })
    expect(parseCommand('worktree bad name').cmd).toBe('worktree')
    expect(parseCommand('worktree').cmd).toBe('error')
    expect(parseCommand('bands')).toEqual({ cmd: 'bands', action: 'status' })
    expect(parseCommand('bands check')).toEqual({ cmd: 'bands', action: 'check' })
    expect(parseCommand('bands runbook')).toEqual({ cmd: 'bands', action: 'runbook' })
    expect(parseCommand('bands nope').cmd).toBe('error')
  })

  test('unknown commands name themselves and point at help', () => {
    const r = parseCommand('frobnicate now')
    expect(r.cmd).toBe('error')
    expect(r.cmd === 'error' && r.message).toContain('frobnicate')
    expect(r.cmd === 'error' && r.message).toContain('/sdlc help')
  })
})

describe('gates', () => {
  test('aliases map to gate ids and unknown words do not', () => {
    expect(parseGate('intent')).toBe('intent.approve')
    expect(parseGate('Verify')).toBe('verify.pass')
    expect(parseGate('review.pass')).toBe('review.pass')
    expect(parseGate('x')).toBeNull()
  })
})

describe('authority', () => {
  test('only a person is human', () => {
    expect(isHumanOrigin('composer')).toBe(true)
    expect(isHumanOrigin('bridge')).toBe(true)
    expect(isHumanOrigin('sdk')).toBe(true)
    for (const kind of ['plugin', 'task-notification', 'scheduled-trigger', 'peer', 'channel', 'coordinator', 'unclassified', 'auto-continuation']) {
      expect(isHumanOrigin(kind)).toBe(false)
    }
  })

  test('read-only commands are the only ones anyone may run', () => {
    const readOnly = ['', 'status', 'help', 'plays', 'plays list', 'guards', 'bands', 'bands check', 'worktree x', 'audit', 'reload', 'bogus']
    for (const text of readOnly) expect(isReadOnly(parseCommand(text))).toBe(true)
    const stateful = [
      'new idea', 'next', 'approve', 'approve intent', 'reject why', 'mode semi', 'pause', 'resume', 'use x', 'plays enable 7',
      'guards toggle test-lock', 'fix bug', 'fixed', 'release grant', 'release revoke', 'twice a lesson', 'lesson t', 'bands runbook', 'init',
    ]
    for (const text of stateful) expect(isReadOnly(parseCommand(text))).toBe(false)
  })
})

describe('help', () => {
  test('mentions every command the parser knows', () => {
    for (const word of ['new', 'next', 'approve', 'reject', 'mode', 'pause', 'use', 'fix', 'release grant', 'release revoke', 'plays', 'guards', 'twice', 'lesson', 'worktree', 'bands', 'init', 'audit', 'reload', 'status']) {
      expect(HELP_TEXT).toContain(`/sdlc ${word}`)
    }
    expect(HELP_TEXT).toContain('resume')
    expect(HELP_TEXT).toContain('fixed')
  })
})
