// Guards (Plays 03, 07, 08, 10, 11, 12): pure, deterministic ports of the shell hooks in
// openknowledge/plays/. No model in the path; every denial explains itself.

import type { GuardContext, GuardId, GuardInput, GuardVerdict } from '../../types'
import { GUARD_DEFS, GUARD_ORDER, RELEASE_ENV } from './constants'
import { analyzeBash, basename, compilePattern, isInert, sqlText, type ShellCommand } from './guards-bash'
import { bashWrites, separationViolation, touchedPaths, type Write } from './guards-writes'
import { matchesAny, normalizePath, pathHit, type PathCtx, type PathHit } from './guards-paths'

export { bashWrittenPaths } from './guards-writes'
export { globToRegExp, isTestPath, matchesAny, normalizePath } from './guards-paths'

/** Regex sources; a leading `(?i)` means case-insensitive. Placeholders (…EXAMPLE, <token>, xxxx) never match. */
export const DEFAULT_SECRET_PATTERNS: { name: string; pattern: string }[] = [
  { name: 'AWS access key id', pattern: String.raw`\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b` },
  {
    name: 'AWS secret access key',
    pattern: String.raw`(?i)aws_?secret_?access_?key["']?\s*[:=]\s*["']?[A-Za-z0-9/+=]{40}`,
  },
  {
    name: 'Private key block',
    pattern: String.raw`-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----`,
  },
  { name: 'GitHub token', pattern: String.raw`\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b` },
  { name: 'Slack token', pattern: String.raw`\bxox[abprs]-[A-Za-z0-9-]{10,}` },
  { name: 'Stripe live key', pattern: String.raw`\b[sr]k_live_[A-Za-z0-9]{16,}` },
  { name: 'Google API key', pattern: String.raw`\bAIza[0-9A-Za-z_-]{35}\b` },
  { name: 'Anthropic or OpenAI API key', pattern: String.raw`\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}` },
  { name: 'JSON web token', pattern: String.raw`\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}` },
  {
    name: 'Database URL with password',
    pattern: String.raw`\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|amqps?)://[^\s:/@]+:[^\s@/]{3,}@[^\s/]+`,
  },
  {
    name: 'Hard-coded credential',
    pattern: String.raw`(?i)\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)["']?\s*[:=]\s*["'](?![^"'\s]*(?:\$\{|\{\{|<))(?=[^"'\s]*\d)[^"'\s]{12,}["']`,
  },
]

/**
 * Regex sources tested (case-insensitively) against each executable command of a Bash call.
 * Ported from templates/hook-production-gate.template.sh, tightened so reads (kubectl get,
 * helm template, terraform plan) and prose (commit messages) are not mistaken for deploys.
 */
export const DEFAULT_PRODUCTION_PATTERNS: string[] = [
  String.raw`^(?![^\n]*(?:\b(?:get|describe|logs|list|ls|status|diff|plan|view|show|check|lint)\b|--dry-run|--help))[^\n]*(?:^|[^a-z0-9])(?:deploy(?:ment)?s?|release|publish|promote|rollout)(?![a-z0-9])[^\n]*(?:^|[^a-z0-9])prod(?:uction)?(?![a-z0-9])`,
  String.raw`\bpush\b[^\n]*[\s:/]prod(?:uction)?(?:\s|$)`,
  String.raw`\bhelm\b(?=[^\n]*\b(?:upgrade|install|rollback|uninstall|delete)\b)[^\n]*\bprod(?:uction)?\b`,
  String.raw`\b(?:terraform|tofu|terragrunt|pulumi)\b(?=[^\n]*\b(?:apply|destroy|up)\b)[^\n]*\bprod(?:uction)?\b`,
  String.raw`\bkubectl\b(?=[^\n]*\b(?:apply|rollout|replace|patch|scale|delete|create|set)\b)[^\n]*\bprod(?:uction)?\b`,
  String.raw`\b(?:flyctl|fly|wrangler|netlify|firebase|serverless|sls|argocd|heroku|gcloud|aws|az)\b(?=[^\n]*\b(?:deploy|publish|release|apply|promote|sync|rollout)\b)[^\n]*\bprod(?:uction)?\b`,
  String.raw`\bvercel\b[^\n]*--prod\b`,
  String.raw`\bgh\b[^\n]*\bworkflow\b[^\n]*\brun\b[^\n]*\bprod(?:uction)?\b`,
  String.raw`\bmigrate\b[^\n]*\bprod(?:uction)?\b`,
]

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

// AWS documents its keys as ...EXAMPLE; the other markers are the usual "fill me in" tokens
const PLACEHOLDER_EXACT = /EXAMPLE/
const PLACEHOLDER_LOOSE =
  /REDACTED|PLACEHOLDER|<[^>\s][^>]*>|x{8,}|\*{4,}|changeme|your[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)|:(?:password|pass|secret|changeme)@/i
const MAX_MATCHES = 50

function mask(secret: string): string {
  // reveal at most a quarter of it, so the name and prefix identify it but it cannot be recovered
  const shown = Math.min(4, Math.floor(secret.length / 4))
  return `${secret.slice(0, shown)}… (${secret.length} chars)`
}

export function detectSecrets(
  text: string,
  patterns: { name: string; pattern: string }[],
): { name: string; sample: string } | null {
  if (!text) return null
  for (const { name, pattern } of patterns) {
    const re = compilePattern(pattern, 'g')
    if (!re) continue
    for (let n = 0, m = re.exec(text); m !== null && n < MAX_MATCHES; n++, m = re.exec(text)) {
      if (m[0] === '') {
        re.lastIndex++
        continue
      }
      if (!PLACEHOLDER_EXACT.test(m[0]) && !PLACEHOLDER_LOOSE.test(m[0])) return { name, sample: mask(m[0]) }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

const MAX_REGEX_TEXT = 6000

/**
 * Patterns scan with `[^\n]*`, which is quadratic on a huge command; past a size cap the text is
 * squeezed to its distinct short words (padding and repeats vanish), then cut to head and tail.
 */
function regexWindows(text: string): string[] {
  if (text.length <= MAX_REGEX_TEXT) return [text]
  const squeezed = [...new Set(text.split(' ').filter(w => w.length <= 60))].join(' ')
  if (squeezed.length <= MAX_REGEX_TEXT) return [squeezed]
  const half = MAX_REGEX_TEXT / 2
  return [squeezed.slice(0, half), squeezed.slice(-half)]
}

/** Production deploys: any executable command (not prose) matching a pattern; returns that command's text. */
function findProduction(cmds: ShellCommand[], patterns: string[]): string | null {
  const regexes = patterns.map(p => compilePattern(p, 'i')).filter((r): r is RegExp => r !== null)
  for (const cmd of cmds) {
    if (isInert(cmd)) continue
    const windows = regexWindows(cmd.text)
    if (regexes.some(r => windows.some(w => r.test(w)))) return cmd.text
  }
  return null
}

export function isProductionCommand(command: string, patterns: string[]): boolean {
  return findProduction(analyzeBash(command), patterns) !== null
}

const RUNNERS = new Set(['npx', 'bunx', 'pnpx'])
const PY_RUNNERS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch'])

function proofForms(argv: string[]): string[][] {
  const program = basename(argv[0] ?? '')
  const dropFlags = (a: string[]): string[] => {
    let i = 0
    while ((a[i] ?? '').startsWith('-')) i++
    return a.slice(i)
  }
  const forms = [argv]
  if (/^python[\d.]*$/.test(program) && argv[1] === '-m') forms.push(argv.slice(2))
  if (RUNNERS.has(program)) forms.push(dropFlags(argv.slice(1)))
  if (PY_RUNNERS.has(program) && argv[1] === 'run') forms.push(dropFlags(argv.slice(2)))
  if (program === 'pnpm' && argv[1] === 'exec') forms.push(dropFlags(argv.slice(2)))
  return forms
}

/** Words of `pattern` appear in order at the start of argv, flags between them allowed (`make -j4 test`). */
function startsWithTokens(argv: string[], pattern: string[]): boolean {
  if (basename(argv[0] ?? '') !== basename(pattern[0] ?? '\0')) return false
  let k = 1
  for (let j = 1; j < pattern.length; j++) {
    while ((argv[k] ?? '').startsWith('-')) k++
    if (argv[k] !== pattern[j]) return false
    k++
  }
  return true
}

export function isProofCommand(command: string, patterns: string[]): boolean {
  const pats = patterns.map(p => p.trim().split(/\s+/).filter(Boolean)).filter(p => p.length > 0)
  if (pats.length === 0 || command.trim() === '') return false
  return analyzeBash(command).some(cmd => proofForms(cmd.argv).some(argv => pats.some(p => startsWithTokens(argv, p))))
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const KNOWN_TOOLS = new Set([...EDIT_TOOLS, 'Bash', 'Read', 'WebFetch'])
const EVALUATION_ORDER: GuardId[] = [
  'gate-integrity',
  'protect-paths',
  'secret-leak',
  'credential-shield',
  'plan-first',
  'test-lock',
  'production-gate',
  'destructive-sql',
  'separation-of-duties',
]

type Env = {
  ctx: GuardContext
  pc: PathCtx
  tool: string
  isEdit: boolean
  /** filePath as given by the tool call. */
  path: string | null
  content: string
  command: string
  cmds: ShellCommand[]
  writes: Write[]
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function clip(s: string, max = 90): string {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

function deny(id: GuardId, why: string, instead: string, match?: string): GuardVerdict {
  const def = GUARD_DEFS[id]
  return {
    allow: false,
    guard: id,
    play: def.play,
    message: `okf-loop · Play ${pad2(def.play)} · ${def.label}: ${why}\nDo instead: ${instead}`,
    ...(match === undefined ? {} : { match }),
  }
}

/** Paths the call writes: the tool's own file, or what a Bash command redirects, copies, removes… */
function targets(e: Env): Write[] {
  if (e.isEdit) return e.path === null ? [] : [{ path: e.path, kind: 'write' }]
  return e.writes
}

const isOutsideRepo = (rel: string): boolean => rel.startsWith('/') || /^[A-Za-z]:\//.test(rel)

/** `.env.example` and friends hold no secrets; only the `.env*` globs yield to them. */
function envTemplateExempt(raw: string, hit: PathHit): boolean {
  return hit.glob.includes('.env') && /^\.env(?:\.[^/]*)?\.(?:example|sample|template|dist)$/i.test(basename(raw))
}

function hitOf(e: Env, raw: string, globs: string[], removal = false): PathHit | null {
  const h = pathHit(raw, globs, e.pc, removal)
  return h && !envTemplateExempt(raw, h) ? h : null
}

// --- gate-integrity ---------------------------------------------------------

const LABEL = '\\bstatus\\s*(?:\\*\\*|__)?\\s*:\\s*(?:\\*\\*|__)?\\s*[`"\'*_]*'
const FORGED_APPROVAL = new RegExp(`${LABEL}(?:approved|accepted)\\b`, 'i')
const FORGED_PROGRESS = new RegExp(`${LABEL}(?:in-progress|complete)\\b`, 'i')
// an Edit that swaps just the status word leaves no label in its new text
const BARE_APPROVAL = /^[\s*_`"'[\]]*(?:approved|accepted)[\s*_`"'[\]]*$/im
const BARE_PROGRESS = /^[\s*_`"'[\]]*(?:in-progress|complete)[\s*_`"'[\]]*$/im
const APPROVAL_WORD = /\b(?:approved|accepted)\b/i

type GateKey = 'intent' | 'spec' | 'plan'
const GATE_OF: Record<GateKey, string> = { intent: 'intent.approve', spec: 'spec.approve', plan: 'plan.accept' }

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function artifactGlob(pattern: string): string {
  return pattern.replace(/\{(?:slug|date)\}/g, '*')
}

function gateKeyOf(e: Env, raw: string): GateKey | null {
  for (const key of ['intent', 'spec', 'plan'] as const) {
    if (pathHit(raw, [artifactGlob(e.ctx.paths[key])], e.pc)) return key
  }
  return null
}

/** The run slug a plan path belongs to, when the configured pattern carries `{slug}`. */
function planSlug(e: Env, raw: string): string | null {
  const pattern = e.ctx.paths.plan
  if (!pattern.includes('{slug}')) return null
  const src = pattern
    .split(/(\{slug\}|\{date\})/)
    .map(part => (part === '{slug}' ? '([^/]+?)' : part === '{date}' ? '[^/]+' : escapeRegex(part)))
    .join('')
  return new RegExp(`^${src}$`, 'i').exec(normalizePath(raw, e.pc.cwd, e.pc.home))?.[1] ?? null
}

function gateIntegrity(e: Env): GuardVerdict | null {
  const partial = e.tool === 'Edit' || e.tool === 'MultiEdit'
  for (const w of targets(e)) {
    if (w.kind === 'remove') continue
    const key = gateKeyOf(e, w.path)
    if (key === null) continue
    const forgedApproval = e.isEdit
      ? FORGED_APPROVAL.test(e.content) || (partial && BARE_APPROVAL.test(e.content))
      : APPROVAL_WORD.test(e.command)
    if (forgedApproval) {
      const word = key === 'plan' ? 'accepted' : 'approved'
      return deny(
        'gate-integrity',
        `${clip(w.path)} would be set to "${word}" by the agent.\nOnly a human moves this gate.`,
        `set Status to under-review (or draft) and ask the human to /sdlc approve ${GATE_OF[key]}.`,
        w.path,
      )
    }
    if (key !== 'plan') continue
    const forgedProgress = e.isEdit
      ? FORGED_PROGRESS.test(e.content) || (partial && BARE_PROGRESS.test(e.content))
      : FORGED_PROGRESS.test(e.command)
    if (!forgedProgress) continue
    const run = e.ctx.run
    const slug = planSlug(e, w.path)
    if (run !== null && run.planAccepted && (slug === null || slug.toLowerCase() === run.slug.toLowerCase())) continue
    return deny(
      'gate-integrity',
      `${clip(w.path)} would be set to in-progress/complete, but no accepted plan stands behind it.\nOnly a human accepts the plan.`,
      'keep Status: draft or under-review and ask the human to /sdlc approve plan.accept; then set in-progress/complete.',
      w.path,
    )
  }
  return null
}

// --- protect-paths ----------------------------------------------------------

function protectPaths(e: Env): GuardVerdict | null {
  for (const w of targets(e)) {
    const h = hitOf(e, w.path, e.ctx.guards.protectedPaths, w.kind === 'remove')
    if (h) {
      return deny(
        'protect-paths',
        `${clip(w.path)} is frozen, generated or secret (protected path "${h.glob}").\nThe agent may not write, move or delete it.`,
        'change the generator or source of truth that produces it, or ask a human to edit it (or to adjust guards.protectedPaths in .okf/config.json).',
        w.path,
      )
    }
  }
  return null
}

// --- secret-leak ------------------------------------------------------------

const TEMPLATE_FILE = /\.(?:template|example|sample)(?:\.[^./]+)?$/i

function secretLeak(e: Env): GuardVerdict | null {
  let text = ''
  let where = e.path ?? 'the file'
  if (e.isEdit) {
    if (e.path !== null && TEMPLATE_FILE.test(basename(e.path))) return null
    text = e.content
  } else if (e.tool === 'Bash') {
    // a command only leaks when it writes somewhere; a template file is the one safe place
    const real = e.writes.find(w => w.kind === 'write' && !TEMPLATE_FILE.test(basename(w.path)))
    if (!real) return null
    text = e.command
    where = real.path
  }
  const found = detectSecrets(text, e.ctx.guards.secretPatterns)
  if (!found) return null
  return deny(
    'secret-leak',
    `the text for ${clip(where, 60)} contains what looks like ${found.name} (${found.sample}).\nSecrets never go into the repository.`,
    'read it from an environment variable or secret manager and write only a placeholder such as <YOUR_KEY> (or use a *.example file).',
    `${found.name}: ${found.sample}`,
  )
}

// --- credential-shield ------------------------------------------------------

function credentialShield(e: Env): GuardVerdict | null {
  const g = e.ctx.guards
  const touched: string[] = []
  if (e.tool === 'Read' || e.isEdit) {
    if (e.path !== null) touched.push(e.path)
  } else if (e.tool === 'Bash') touched.push(...touchedPaths(e.cmds), ...e.writes.map(w => w.path))
  for (const raw of touched) {
    const h = hitOf(e, raw, g.credentialPaths, e.writes.some(w => w.path === raw && w.kind === 'remove'))
    if (h) {
      return deny(
        'credential-shield',
        `${clip(raw)} holds credentials (matches "${h.glob}") and is off limits to the agent.\nKey material must never enter the conversation.`,
        'ask the human for the one non-secret value you need, or use a documented placeholder; configure access outside the agent.',
        raw,
      )
    }
  }
  if (!g.blockNetwork) return null
  const fetcher =
    e.tool === 'WebFetch' ? 'WebFetch' : e.cmds.find(c => c.program === 'curl' || c.program === 'wget')?.program
  if (!fetcher) return null
  return deny(
    'credential-shield',
    `network access (${fetcher}) is blocked by guards.blockNetwork.\nOutbound calls could exfiltrate what the agent can read.`,
    'work from local files and the repository docs, or ask a human to fetch it; a trusted domain belongs in the sandbox allowlist, not in a command.',
    fetcher,
  )
}

// --- plan-first / test-lock -------------------------------------------------

function expandSlug(pattern: string, slug: string): string {
  return pattern.replace(/\{slug\}/g, slug)
}

function planFirst(e: Env): GuardVerdict | null {
  const run = e.ctx.run
  if (run === null || run.planAccepted) return null
  for (const w of targets(e)) {
    // creating, touching or deleting files is not "editing source"; writing content is
    if (w.kind !== 'write') continue
    const rel = normalizePath(w.path, e.pc.cwd, e.pc.home)
    if (isOutsideRepo(rel) || matchesAny(rel, e.ctx.guards.planFirstExempt)) continue
    return deny(
      'plan-first',
      `run "${run.slug}" has no accepted plan, so ${clip(w.path)} cannot be edited yet.\nNo code before a plan a human has accepted.`,
      `finish ${expandSlug(e.ctx.paths.plan, run.slug)} and ask the human to accept it (/sdlc approve plan.accept); docs and artifacts stay editable meanwhile.`,
      w.path,
    )
  }
  return null
}

function testLock(e: Env): GuardVerdict | null {
  if (e.ctx.run === null || !e.ctx.run.fixActive) return null
  for (const w of targets(e)) {
    const h = pathHit(w.path, e.ctx.guards.testGlobs, e.pc, w.kind === 'remove')
    if (h) {
      return deny(
        'test-lock',
        `${clip(w.path)} is a test file and a bug fix is in progress.\nTest files are locked during bug remediation. Fix the implementation, not the test.`,
        'change the code until the committed reproduction test passes; if the test itself is wrong, ask the human to end the fix with /sdlc fixed.',
        w.path,
      )
    }
  }
  return null
}

// --- Bash-only guards -------------------------------------------------------

function productionGate(e: Env): GuardVerdict | null {
  if (e.ctx.release.envToken || e.ctx.release.grantActive) return null
  const cmd = findProduction(e.cmds, e.ctx.guards.productionPatterns)
  if (cmd === null) return null
  return deny(
    'production-gate',
    `"${clip(cmd, 70)}" deploys to production and no signed release authorization is active.\nProduction deployments require signed release authorization.`,
    `stop at the gate and ask the release manager; a human can authorize with /sdlc release grant (or start the session with ${RELEASE_ENV} set).`,
    cmd,
  )
}

const DESTRUCTIVE_SQL = /\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA|INDEX|VIEW)|TRUNCATE(?:\s+TABLE)?|DELETE\s+FROM)\b/i

function destructiveSql(e: Env): GuardVerdict | null {
  if (!e.ctx.guards.destructiveSql) return null
  // echo/printf/cat only matter when their output feeds a command that is not itself inert (| psql)
  const live = new Set(e.cmds.filter(c => !isInert(c)).map(c => c.pipeline))
  for (const cmd of e.cmds) {
    if (isInert(cmd) && !live.has(cmd.pipeline)) continue
    const m = DESTRUCTIVE_SQL.exec(sqlText(cmd))
    if (m) {
      return deny(
        'destructive-sql',
        `"${clip(cmd.text, 70)}" contains ${m[0].toUpperCase().replace(/\s+/g, ' ')}, which the agent never runs (not even with a release grant).`,
        'write the change as a reviewed migration file and ask a human to apply it to the database.',
        m[0],
      )
    }
  }
  return null
}

function separationOfDuties(e: Env): GuardVerdict | null {
  const branches = e.ctx.guards.protectedBranches
  if (branches.length === 0) return null
  const v = separationViolation(e.cmds, branches)
  if (v === null) return null
  return deny(
    'separation-of-duties',
    `"${clip(v.text, 70)}" ${v.reason}.\nThe agent that wrote the code has no authority to merge or release it (protected: ${branches.join(', ')}).`,
    'push a feature branch and open a pull request; a human code owner reviews and merges.',
    v.text,
  )
}

const CHECKS: Record<GuardId, (e: Env) => GuardVerdict | null> = {
  'gate-integrity': gateIntegrity,
  'protect-paths': protectPaths,
  'secret-leak': secretLeak,
  'credential-shield': credentialShield,
  'plan-first': planFirst,
  'test-lock': testLock,
  'production-gate': productionGate,
  'destructive-sql': destructiveSql,
  'separation-of-duties': separationOfDuties,
}

function isActive(id: GuardId, ctx: Pick<GuardContext, 'guards' | 'enabledPlays'>): boolean {
  return !ctx.guards.disabled.includes(id) && ctx.enabledPlays.includes(GUARD_DEFS[id].play)
}

export function activeGuards(
  ctx: Pick<GuardContext, 'guards' | 'enabledPlays'>,
): { id: GuardId; enabled: boolean; active: boolean }[] {
  return GUARD_ORDER.map(id => {
    const enabled = !ctx.guards.disabled.includes(id)
    return { id, enabled, active: isActive(id, ctx) }
  })
}

export function evaluateGuards(input: GuardInput, ctx: GuardContext): GuardVerdict {
  if (!KNOWN_TOOLS.has(input.tool)) return { allow: true }
  const command = typeof input.command === 'string' ? input.command : ''
  const cmds = input.tool === 'Bash' ? analyzeBash(command) : []
  const env: Env = {
    ctx,
    pc: { cwd: ctx.cwd, home: ctx.home },
    tool: input.tool,
    isEdit: EDIT_TOOLS.has(input.tool),
    path: typeof input.filePath === 'string' && input.filePath !== '' ? input.filePath : null,
    content: typeof input.content === 'string' ? input.content : '',
    command,
    cmds,
    writes: bashWrites(cmds),
  }
  for (const id of EVALUATION_ORDER) {
    if (!isActive(id, ctx)) continue
    try {
      const verdict = CHECKS[id](env)
      if (verdict !== null) return verdict
    } catch (err) {
      // a guard that cannot decide must not wave the call through
      const reason = err instanceof Error ? err.message : String(err)
      return deny(id, `the guard failed internally (${clip(reason, 60)}), so the call is held.`, 'retry; if it persists, disable this guard in .okf/config.json and report the bug.')
    }
  }
  return { allow: true }
}
