// Scaffolds and project files the mod creates: the setup checklist, `/sdlc init`, the Twice Rule,
// the audit export and saving config. Only what is missing is ever created; nothing is overwritten.

import type { LoopConfig, SetupItem, TemplateName } from '../../types'
import { renderScaffold } from './artifacts'
import { TOP_KEYS } from './config-parse'
import { diffFromDefaults } from './config'
import { STATE_FILES } from './constants'
import { GITIGNORE } from './controller-bands'
import { isoDate, ledger, say, type Acc } from './controller-kit'
import type { Model } from './controller-types'
import { auditMarkdown } from './ledger'

const GITIGNORE_PATH = '.okf/.gitignore'
export const CHECK_SH_PATH = 'evals/check.sh'

type Def = { id: string; label: string; play: number; path: (c: LoopConfig) => string; template?: TemplateName; hint: string; exec?: boolean }

const DEFS: Def[] = [
  { id: 'config', label: 'Loop config', play: 1, path: () => STATE_FILES.config, hint: 'Only what differs from the defaults; edit it freely.' },
  { id: 'gitignore', label: 'State ignore file', play: 1, path: () => GITIGNORE_PATH, hint: 'Keeps .okf/active and band samples out of git.' },
  { id: 'claude-md', label: 'CLAUDE.md', play: 5, path: c => c.paths.claudeMd, template: 'claude-context', hint: 'Agent context, with the Twice Rule section.' },
  { id: 'review-md', label: 'REVIEW.md', play: 10, path: c => c.paths.reviewPolicy, template: 'review-policy', hint: 'The three-pass review policy.' },
  { id: 'bands', label: 'bands.yaml', play: 13, path: c => c.paths.bands, template: 'bands', hint: 'Control-band spec for the Stage 6 watcher.' },
  {
    id: 'ci-evals',
    label: 'CI evals workflow',
    play: 9,
    path: c => c.paths.ciWorkflow,
    template: 'ci-evals-workflow',
    hint: 'Also creates evals/check.sh, the runner the workflow calls: it runs each expected_checks command of an eval JSON.',
  },
  { id: 'managed-settings', label: 'Managed settings', play: 12, path: c => c.paths.managedSettings, template: 'managed-settings', hint: 'Enterprise settings: sandbox, permissions, hooks.' },
  { id: 'production-gate', label: 'Production gate hook', play: 11, path: c => c.paths.productionGate, template: 'production-gate', hint: 'The shell hook behind the Play 11 gate (made executable).', exec: true },
]

export const CONFIRM_PREFIX = 'confirm:'

export const SCHEMA_PATH = 'mods/okf-loop/schemas/okf-config.schema.json'

/** Paths whose existence the views and the scaffolds care about. */
export function existencePaths(config: LoopConfig): string[] {
  return [...new Set([...DEFS.map(d => d.path(config)), CHECK_SH_PATH, SCHEMA_PATH, 'evals', 'lessons'])]
}

/** The Setup checklist. (A quarantined approval is not an item: it is `ViewModel.quarantined`.) */
export function setupItems(model: Model): SetupItem[] {
  const c = model.config
  return [
    ...DEFS.map(d => {
      const item: SetupItem = { id: d.id, label: d.label, path: d.path(c), play: d.play, exists: model.exists[d.path(c)] === true, hint: d.hint }
      if (d.template) item.template = d.template
      return item
    }),
  ]
}

/** The config as a minimal file: what differs from the defaults, plus any keys this mod does not know. */
export function configText(fileConfig: LoopConfig, base: unknown, schemaExists = false): string {
  const schema = (schemaExists && !fileConfig.$schema) ? '../mods/okf-loop/schemas/okf-config.schema.json' : fileConfig.$schema
  const out: Record<string, unknown> = {
    ...(schema ? { $schema: schema } : {}),
    version: 1,
    ...diffFromDefaults(fileConfig),
  }
  if (typeof base === 'object' && base !== null && !Array.isArray(base)) {
    for (const [k, v] of Object.entries(base as Record<string, unknown>)) if (!TOP_KEYS.includes(k) && out[k] === undefined) out[k] = v
  }
  return `${JSON.stringify(out, null, 2)}\n`
}

const CHECK_SH = `#!/usr/bin/env bash
# evals/check.sh <eval.json> <result.json>   (scaffolded by okf-loop, Play 09)
# The deterministic half of an agent eval: runs every command listed under "expected_checks" in the
# eval JSON and exits 0 only if all of them pass. <result.json> is what the agent produced; it only
# has to exist. An eval with no checks fails: a test that cannot fail proves nothing.
set -u
eval_file="\${1:-}"
result_file="\${2:-}"
if [ -z "$eval_file" ] || [ ! -f "$eval_file" ]; then
  echo "usage: evals/check.sh <eval.json> <result.json>" >&2
  exit 2
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "check.sh: jq is required" >&2
  exit 2
fi
if [ -n "$result_file" ] && [ ! -s "$result_file" ]; then
  echo "check.sh: the agent produced no result at $result_file" >&2
  exit 1
fi
checks=$(jq -r '(.expected_checks // [])[]' "$eval_file") || exit 2
if [ -z "$checks" ]; then
  echo "check.sh: $eval_file lists no expected_checks" >&2
  exit 1
fi
status=0
while IFS= read -r check; do
  [ -n "$check" ] || continue
  echo "check: $check"
  if ! bash -c "$check"; then
    echo "FAILED: $check" >&2
    status=1
  fi
done <<< "$checks"
exit $status
`

/** `/sdlc init [item]` and the Setup tab's Create buttons: create what is missing, say what was skipped. */
export function scaffold(acc: Acc, item: string | undefined, now: number): void {
  const m = acc.model
  const items = setupItems(m).filter(i => !i.id.startsWith(CONFIRM_PREFIX))
  const targets = item === undefined || item === 'all' ? items : items.filter(i => i.id === item)
  if (targets.length === 0) return say(acc, `Unknown setup item "${item}". Items: ${items.map(i => i.id).join(', ')}.`)
  const date = isoDate(now)
  const created: string[] = []
  const present: string[] = []
  const unavailable: string[] = []
  for (const t of targets) {
    if (t.exists) {
      present.push(t.label)
      continue
    }
    const def = DEFS.find(d => d.id === t.id)
    if (!def) continue
    let text: string | null = null
    if (def.id === 'config') text = configText(m.fileConfig, m.configBase, m.exists[SCHEMA_PATH] === true)
    else if (def.id === 'gitignore') text = GITIGNORE
    else if (def.template) {
      const tpl = m.knowledge.templates[def.template]
      text = tpl === undefined ? null : renderScaffold(def.template, tpl, { project: m.project, date, paths: m.config.paths })
    }
    if (text === null) {
      unavailable.push(`${t.label} (no ${def.template} template in the knowledge base)`)
      continue
    }
    acc.effects.push({ t: 'write', path: t.path, text, overwrite: false, ...(def.exec ? { exec: true } : {}) })
    created.push(t.label)
    ledger(acc, { kind: 'scaffold.created', actor: 'human', summary: `Scaffolded ${t.label} at ${t.path}`, data: { item: t.id, path: t.path, ...(def.template ? { template: def.template } : {}) } }, now)
    if (def.id === 'ci-evals' && m.exists[CHECK_SH_PATH] !== true) {
      acc.effects.push({ t: 'write', path: CHECK_SH_PATH, text: CHECK_SH, overwrite: false, exec: true })
      ledger(acc, { kind: 'scaffold.created', actor: 'human', summary: `Scaffolded ${CHECK_SH_PATH} for the CI workflow`, data: { item: 'evals-check', path: CHECK_SH_PATH } }, now)
      created.push(CHECK_SH_PATH)
    }
  }
  if (created.length > 0) acc.effects.push({ t: 'refresh' })
  const parts: string[] = []
  if (created.length > 0) parts.push(`Created: ${created.join(', ')}.`)
  if (present.length > 0) parts.push(`Already there (never overwritten): ${present.join(', ')}.`)
  if (unavailable.length > 0) parts.push(`Skipped: ${unavailable.join('; ')}.`)
  const waiting = Object.keys(m.runtime.quarantine).length
  if (waiting > 0) parts.push(`${waiting} approval${waiting === 1 ? '' : 's'} still need${waiting === 1 ? 's' : ''} your confirmation (/sdlc approve <gate>).`)
  say(acc, parts.length > 0 ? parts.join(' ') : 'Nothing to create.')
}

export function twice(acc: Acc, lesson: string, now: number): void {
  const m = acc.model
  const path = m.config.paths.claudeMd
  const tpl = m.knowledge.templates['claude-context']
  const seed = m.exists[path] === true || tpl === undefined ? '' : renderScaffold('claude-context', tpl, { project: m.project, date: isoDate(now), paths: m.config.paths })
  acc.effects.push({ t: 'edit', path, edit: { kind: 'twice', lesson, date: isoDate(now), seed } })
  ledger(acc, { kind: 'lesson.recorded', actor: 'human', summary: `Twice Rule: ${lesson}`, data: { kind: 'twice', path } }, now)
  acc.effects.push({ t: 'refresh' })
  say(acc, `Added to ${path} under "Things Claude Gets Wrong": ${lesson}`)
}

export function audit(acc: Acc, now: number): void {
  const m = acc.model
  const text = auditMarkdown(m.ledger, { project: m.project || 'this project', generatedAt: now })
  acc.effects.push({ t: 'write', path: STATE_FILES.audit, text, overwrite: true })
  say(acc, `Wrote ${STATE_FILES.audit}: ${m.ledger.length} ledger entr${m.ledger.length === 1 ? 'y' : 'ies'}, ${m.runs.length} run${m.runs.length === 1 ? '' : 's'}.`)
}
