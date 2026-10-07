// LoopConfig defaults: the values docs/SPEC.md §4.4 names. Pure data.

import type { LoopConfig, Mode } from '../../types'
import { DEFAULT_PLAYS } from './constants'
import { DEFAULT_PRODUCTION_PATTERNS, DEFAULT_SECRET_PATTERNS } from './guards'

export const MODES: readonly Mode[] = ['manual', 'guided', 'semi']

export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const DEFAULT_CONFIG: LoopConfig = {
  version: 1,
  knowledge: { root: 'openknowledge' },
  autonomy: {
    mode: 'semi',
    maxAutoTurns: 12,
    haltOnBlocks: 3,
    haltOnVerifyFails: 3,
    humanGates: ['intent.approve', 'spec.approve', 'plan.accept', 'release.approve'],
    autoKinds: ['draft-spec', 'draft-plan', 'implement', 'verify', 'review'],
  },
  plays: { enabled: [...DEFAULT_PLAYS] },
  paths: {
    intent: 'intent/{slug}.md',
    spec: 'specs/{slug}.spec.md',
    plan: 'plans/{slug}.plan.md',
    proof: 'proofs/{slug}.proof.md',
    review: 'reviews/{slug}.review.md',
    incident: 'intent/incident-{date}.md',
    lesson: 'lessons/{date}-{slug}.md',
    eval: 'evals/{slug}.json',
    claudeMd: 'CLAUDE.md',
    reviewPolicy: 'REVIEW.md',
    bands: 'bands.yaml',
    ciWorkflow: '.github/workflows/agent-evals.yml',
    managedSettings: '.okf/enterprise-managed-settings.json',
    productionGate: '.claude/hooks/production-gate.sh',
  },
  guards: {
    disabled: [],
    // .okf/** keeps every agent tool away from the mod's own config, ledger and run state.
    protectedPaths: [
      'schemas/generated/**',
      'api/v1/frozen/**',
      '.env',
      '.env.*',
      '**/.env',
      '**/.env.*',
      'secrets/**',
      '.okf/**',
    ],
    testGlobs: ['tests/**', 'test/**', '__tests__/**', '**/*.test.*', '**/*.spec.*', '**/test_*.py', '**/*_test.go'],
    planFirstExempt: [
      '**/*.md',
      'intent/**',
      'specs/**',
      'plans/**',
      'proofs/**',
      'reviews/**',
      'lessons/**',
      'evals/**',
      '.okf/**',
      '.claude/**',
      'openknowledge/**',
    ],
    secretPatterns: DEFAULT_SECRET_PATTERNS.map((p) => ({ name: p.name, pattern: p.pattern })),
    productionPatterns: [...DEFAULT_PRODUCTION_PATTERNS],
    destructiveSql: true,
    protectedBranches: ['main', 'master'],
    credentialPaths: ['~/.ssh/**', '~/.aws/**', '~/.config/gcloud/**', '**/.env', '**/.env.*', 'secrets/**'],
    blockNetwork: false,
    grantMinutes: 15,
  },
  verify: {
    commands: [
      'make test',
      'make lint',
      'make build',
      'npm test',
      'npm run test',
      'npm run lint',
      'pnpm test',
      'yarn test',
      'pytest',
      'cargo test',
      'go test',
      'bun test',
    ],
  },
  review: {
    nitCap: 5,
    passes: [
      { tag: 'Bugs', title: 'Logic & Regressions' },
      { tag: 'Security', title: 'Security & Privacy' },
      { tag: 'Compliance', title: 'Specification & Architecture Alignment' },
    ],
    ignorePaths: ['src/gen/**', 'build/**', '*.min.js', 'package-lock.json', 'yarn.lock'],
  },
  bands: { enabled: false, sources: [], window: 30, tier3: 'propose', runbook: [] },
  ui: { openPaneOnStart: false, showBand: true },
  policySkills: ['.claude/skills/**/SKILL.md', 'CLAUDE.md'],
}
