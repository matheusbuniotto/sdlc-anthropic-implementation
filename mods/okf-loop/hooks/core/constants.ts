// Static facts of the AI-Native SDLC (openknowledge/INDEX.md) that several
// modules share. Pure data, no `$`, no engine imports.

import type {
  ArtifactKind,
  GateId,
  GateKind,
  GuardDef,
  GuardId,
  NextActionKind,
  PathKey,
  StageId,
  TemplateName,
  UiTab,
} from '../../types'

export const MOD_NAME = 'okf-loop'
export const COMMAND_NAME = 'sdlc'
export const PANE_ID = 'sdlc-loop'
/** The one environment variable the production gate reads (Play 11). The engine requires env names as literals. */
export const RELEASE_ENV = 'RELEASE_APPROVAL'
export const STATE_DIR = '.okf'

export const STAGE_IDS: readonly StageId[] = ['plan', 'design', 'build', 'test', 'deploy', 'maintain']

export const STAGE_META: Record<
  StageId,
  { number: 1 | 2 | 3 | 4 | 5 | 6; name: string; tagline: string; artifact: string; knowledgePath: string }
> = {
  plan: {
    number: 1,
    name: 'Plan',
    tagline: 'Capture intent in the originator’s own words',
    artifact: 'intent.md',
    knowledgePath: 'stages/01-plan.md',
  },
  design: {
    number: 2,
    name: 'Design',
    tagline: 'Requirements and design in one policy-guided session',
    artifact: 'spec.md',
    knowledgePath: 'stages/02-design.md',
  },
  build: {
    number: 3,
    name: 'Build',
    tagline: 'No code without an accepted plan',
    artifact: 'plan.md + code',
    knowledgePath: 'stages/03-build.md',
  },
  test: {
    number: 4,
    name: 'Test',
    tagline: 'The agent proves its own work before a human looks',
    artifact: 'proof + evals',
    knowledgePath: 'stages/04-test.md',
  },
  deploy: {
    number: 5,
    name: 'Deploy',
    tagline: 'Act up to the production gate; never past it',
    artifact: 'REVIEW verdicts',
    knowledgePath: 'stages/05-deploy.md',
  },
  maintain: {
    number: 6,
    name: 'Maintain',
    tagline: 'Control bands close the loop back to intent',
    artifact: 'bands.yaml',
    knowledgePath: 'stages/06-maintain.md',
  },
}

/** Which play numbers INDEX.md files under each stage (used when the knowledge root cannot be read). */
export const STAGE_PLAYS: Record<StageId, number[]> = {
  plan: [1],
  design: [2],
  build: [3, 4, 5, 6, 7],
  test: [8, 9],
  deploy: [10, 11, 12],
  maintain: [13, 14],
}

export const GATE_DEFS: Record<GateId, { stage: StageId; label: string; kind: GateKind; artifact: ArtifactKind | null }> = {
  'intent.approve': { stage: 'plan', label: 'Product owner approves intent.md', kind: 'human', artifact: 'intent' },
  'spec.approve': { stage: 'design', label: 'Sign off spec.md and its flagged concerns', kind: 'human', artifact: 'spec' },
  'plan.accept': { stage: 'build', label: 'Accept plan.md before any code', kind: 'human', artifact: 'plan' },
  'verify.pass': { stage: 'test', label: 'Verification passed on the final diff', kind: 'machine', artifact: 'proof' },
  'review.pass': { stage: 'deploy', label: 'Three-pass AI review is clean', kind: 'machine', artifact: 'review' },
  'release.approve': { stage: 'deploy', label: 'Named human authorizes the release', kind: 'human', artifact: null },
}

export const GATE_ORDER: readonly GateId[] = [
  'intent.approve',
  'spec.approve',
  'plan.accept',
  'verify.pass',
  'review.pass',
  'release.approve',
]

/** Gates a human can never be configured away from. */
export const ALWAYS_HUMAN_GATES: readonly GateId[] = ['release.approve']

export const GUARD_DEFS: Record<GuardId, GuardDef> = {
  'protect-paths': {
    id: 'protect-paths',
    label: 'Protect paths',
    play: 7,
    stage: 'build',
    summary: 'Frozen and generated code, and secret files, cannot be edited by the agent.',
  },
  'secret-leak': {
    id: 'secret-leak',
    label: 'Block secret writes',
    play: 7,
    stage: 'build',
    summary: 'Writes containing cloud keys, private keys or tokens are refused.',
  },
  'test-lock': {
    id: 'test-lock',
    label: 'Lock tests while fixing',
    play: 8,
    stage: 'test',
    summary: 'During a bug fix the reproduction test is frozen: fix the code, not the test.',
  },
  'plan-first': {
    id: 'plan-first',
    label: 'Plan before code',
    play: 3,
    stage: 'build',
    summary: 'Source edits wait for an accepted plan.md.',
  },
  'production-gate': {
    id: 'production-gate',
    label: 'Production gate',
    play: 11,
    stage: 'deploy',
    summary: 'Deploys to production need a release token or a human grant. The agent cannot pass it.',
  },
  'destructive-sql': {
    id: 'destructive-sql',
    label: 'No destructive SQL',
    play: 11,
    stage: 'deploy',
    summary: 'DROP, TRUNCATE and DELETE FROM never run through the agent.',
  },
  'credential-shield': {
    id: 'credential-shield',
    label: 'Credential shield',
    play: 12,
    stage: 'deploy',
    summary: 'SSH keys, cloud credentials and .env files stay unreadable.',
  },
  'separation-of-duties': {
    id: 'separation-of-duties',
    label: 'Separation of duties',
    play: 10,
    stage: 'deploy',
    summary: 'The agent never merges or pushes to a protected branch.',
  },
  'gate-integrity': {
    id: 'gate-integrity',
    label: 'Gate integrity',
    play: 11,
    stage: 'deploy',
    summary: 'Only a human moves an artifact to approved or accepted; the agent cannot sign its own gate.',
  },
}

export const GUARD_ORDER: readonly GuardId[] = [
  'protect-paths',
  'secret-leak',
  'plan-first',
  'test-lock',
  'production-gate',
  'destructive-sql',
  'credential-shield',
  'separation-of-duties',
  'gate-integrity',
]

/** What in the mod makes each play real, shown in the Plays tab. Keys are play numbers. */
export const PLAY_ENFORCEMENT: Record<number, string[]> = {
  1: ['/sdlc new', 'Interview prompt', 'intent.md scaffold'],
  2: ['Spec drafting prompt', 'Policy skills loaded', 'Spec sign-off gate'],
  3: ['Plan-first guard', 'plan.md scaffold', 'Plan acceptance gate'],
  4: ['Autopilot (semi mode)', 'Parallel-run dashboard', '/sdlc worktree hint'],
  5: ['CLAUDE.md scaffold', '/sdlc twice (Twice Rule)'],
  6: ['Policy skills in the design prompt'],
  7: ['Protect-paths guard', 'Secret-leak guard'],
  8: ['Test-lock guard', 'Proof tracker', 'Verify gate', '/sdlc fix'],
  9: ['CI evals workflow scaffold', 'Incident-to-eval writer'],
  10: ['REVIEW.md scaffold', 'Three-pass reviewer agent', 'Separation-of-duties guard'],
  11: ['Production-gate guard', 'Destructive-SQL guard', 'Gate-integrity guard', 'Release grant'],
  12: ['Managed-settings scaffold', 'Credential-shield guard'],
  13: ['bands.yaml scaffold', 'SPC watcher', 'Tiered response'],
  14: ['Incident intent writer', '/sdlc lesson', 'Rollback proposal'],
}

/** Plays adopted by default: the entry points and what they unlock, minus the ones that need outside infrastructure. */
export const DEFAULT_PLAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 10, 11]

export const NEXT_ACTION_KINDS: readonly NextActionKind[] = [
  'interview',
  'draft-spec',
  'draft-plan',
  'implement',
  'verify',
  'review',
  'await-human',
  'release',
  'monitor',
  'idle',
]

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  'intent',
  'spec',
  'plan',
  'claude-context',
  'review-policy',
  'verifier-agent',
  'bands',
  'ci-evals-workflow',
  'managed-settings',
  'production-gate',
]

/** Knowledge-root-relative file of each template. */
export const TEMPLATE_FILES: Record<TemplateName, string> = {
  intent: 'templates/intent.template.md',
  spec: 'templates/spec.template.md',
  plan: 'templates/plan.template.md',
  'claude-context': 'templates/claude-context.template.md',
  'review-policy': 'templates/review-policy.template.md',
  'verifier-agent': 'templates/verifier-agent.template.md',
  bands: 'templates/bands.template.yaml',
  'ci-evals-workflow': 'templates/ci-evals-workflow.template.yml',
  'managed-settings': 'templates/enterprise-managed-settings.template.json',
  'production-gate': 'templates/hook-production-gate.template.sh',
}

export const PATH_KEYS: readonly PathKey[] = [
  'intent',
  'spec',
  'plan',
  'proof',
  'review',
  'incident',
  'lesson',
  'eval',
  'claudeMd',
  'reviewPolicy',
  'bands',
  'ciWorkflow',
  'managedSettings',
  'productionGate',
]

export const UI_TABS: readonly { id: UiTab; label: string; hotkey: string }[] = [
  { id: 'loop', label: 'Loop', hotkey: '1' },
  { id: 'plays', label: 'Plays', hotkey: '2' },
  { id: 'guards', label: 'Guards', hotkey: '3' },
  { id: 'ledger', label: 'Ledger', hotkey: '4' },
  { id: 'setup', label: 'Setup', hotkey: '5' },
]

/** Files under the project's .okf/ directory. */
export const STATE_FILES = {
  config: `${STATE_DIR}/config.json`,
  ledger: `${STATE_DIR}/ledger.jsonl`,
  runsDir: `${STATE_DIR}/runs`,
  bandsDir: `${STATE_DIR}/bands`,
  promptsDir: `${STATE_DIR}/prompts`,
  audit: `${STATE_DIR}/AUDIT.md`,
  active: `${STATE_DIR}/active`,
} as const
