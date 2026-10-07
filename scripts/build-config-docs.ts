// Generates docs/CUSTOMIZING.md from schemas/okf-config.schema.json so the reference never drifts
// from the keys the mod validates. Run from the repo root: `bun scripts/build-config-docs.ts`.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MOD = join(import.meta.dir, '..', 'mods', 'okf-loop')
const schema = JSON.parse(readFileSync(join(MOD, 'schemas', 'okf-config.schema.json'), 'utf8')) as Schema

type Schema = {
  type?: string | string[]
  enum?: unknown[]
  default?: unknown
  description?: string
  properties?: Record<string, Schema>
  items?: Schema
}

const cell = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim()

function typeOf(node: Schema): string {
  if (node.enum) return node.enum.map((v) => `\`${String(v)}\``).join(' · ')
  const t = Array.isArray(node.type) ? node.type.join(' | ') : (node.type ?? 'any')
  if (t === 'array' && node.items?.type) return `${String(node.items.type)}[]`
  return t
}

function show(value: unknown): string {
  if (value === undefined) return ''
  const text = JSON.stringify(value)
  return text.length > 60 ? '(see below)' : `\`${text}\``
}

const rows: string[] = []
function walk(node: Schema, path: string[]): void {
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    if (key === '$schema') continue
    const full = [...path, key].join('.')
    if (child.type === 'object' && child.properties) {
      rows.push(`| **\`${full}\`** | object | | ${cell(child.description ?? '')} |`)
      walk(child, [...path, key])
    } else {
      rows.push(`| \`${full}\` | ${typeOf(child)} | ${show(child.default)} | ${cell(child.description ?? '')} |`)
    }
  }
}
walk(schema, [])

const doc = `# Customizing okf-loop

Everything customizable lives in **\`.okf/config.json\`** at the root of the project the mod runs in.
The file may be partial: anything you leave out keeps its default, and a bad value is reported in the
Setup tab (and \`/sdlc status\`) instead of crashing the mod. \`/sdlc init\` writes a minimal one.

For editor completion add the schema:

\`\`\`json
{ "$schema": "./mods/okf-loop/schemas/okf-config.schema.json" }
\`\`\`

Precedence, lowest to highest: built-in defaults → \`.okf/config.json\` → the plugin's \`userConfig\`
options set in \`/config\` (**Autonomy mode**, **Autopilot turn budget**, **Open the Loop pane at session start**; each has
a "use the file" value, so an untouched option never overrides \`/sdlc mode\`).
\`/sdlc mode\`, \`/sdlc plays\` and the pane's toggles write back to \`.okf/config.json\`.

## Key reference

_Generated from \`schemas/okf-config.schema.json\` by \`scripts/build-config-docs.ts\`; do not edit this table by hand._

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
${rows.join('\n')}

## Recipes

**Adopt only the entry-point plays** (Plays 1, 5, 7, 8 need no prerequisites):

\`\`\`json
{ "plays": { "enabled": [1, 5, 7, 8] } }
\`\`\`

**Put artifacts where your repository already keeps them** (\`{slug}\` is the run, \`{date}\` is YYYY-MM-DD):

\`\`\`json
{ "paths": { "intent": "docs/intent/{slug}.md", "spec": "docs/specs/{slug}.md", "plan": "docs/plans/{slug}.md" } }
\`\`\`

Add the new folders to \`guards.planFirstExempt\` so drafting them is allowed before a plan is accepted.

**Freeze more of the repo and shorten the release window:**

\`\`\`json
{ "guards": { "protectedPaths": ["schemas/generated/**", "infra/prod/**", "migrations/**", ".okf/**"], "grantMinutes": 10 } }
\`\`\`

Keep \`.okf/**\` in \`protectedPaths\`: it is what stops the agent from editing the mod's own config, ledger and
run records.

**Require a person for verification and review too** (they are machine gates by default; \`release.approve\` is always human):

\`\`\`json
{ "autonomy": { "humanGates": ["intent.approve", "spec.approve", "plan.accept", "verify.pass", "review.pass", "release.approve"] } }
\`\`\`

**Let the agent run fewer steps unattended:**

\`\`\`json
{ "autonomy": { "autoKinds": ["draft-spec", "draft-plan"] } }
\`\`\`

**Tell the proof tracker what counts as verification:**

\`\`\`json
{ "verify": { "commands": ["make test", "make lint", "./scripts/e2e.sh"] } }
\`\`\`

**Add a control band** (Stage 6). The command runs without a shell; its stdout is parsed per \`parse\`
(\`number\`, or \`json:path.to.number\`):

\`\`\`json
{
  "bands": {
    "enabled": true,
    "window": 30,
    "tier3": "propose",
    "sources": [
      {
        "metric": "ci_failure_rate",
        "description": "Failed CI runs on main over the last day",
        "argv": ["./scripts/ci-failure-rate.sh"],
        "parse": "json:rate",
        "intervalMinutes": 60,
        "higherIsWorse": true
      }
    ]
  }
}
\`\`\`

Also scaffold \`bands.yaml\` (\`/sdlc init bands\`) to tune the tier actions; the watcher needs at least 8 samples
before it can judge a metric.

## Your own knowledge base

The mod bundles a snapshot of this repository's \`openknowledge/\`. If your project has its own
\`openknowledge/\` (or another directory named by \`knowledge.root\`) the mod reads it at session start and on
\`/sdlc reload\`: your play list, prerequisites and templates replace the bundled ones where they differ. Play
numbers come from \`play-NN\` in the play's \`id\`/filename and front-matter \`prerequisites\`. To refresh the
bundled snapshot after editing this repository's knowledge base: \`bun scripts/build-knowledge.ts\`.

## Your own stage prompts

Create \`.okf/prompts/<key>.md\` to replace a stage prompt, where \`<key>\` is one of \`interview\`, \`draft-spec\`,
\`draft-plan\`, \`implement\`, \`verify\`, \`review\`, \`release\`, \`fix\`, \`incident\`, \`lesson\`. Placeholders:
\`{{slug}} {{title}} {{date}} {{stage}} {{intent_path}} {{spec_path}} {{plan_path}} {{proof_path}} {{review_path}}
{{claude_md}} {{review_policy}} {{incident_path}} {{lesson_path}} {{eval_path}} {{knowledge_root}}
{{verify_commands}} {{nit_cap}} {{policy_skills}} {{plan_files}} {{notes}} {{blocked_by}} {{gate_feedback}}\`.
An override can reword the work, but the guards stay deterministic: it cannot lift a rule.

## What the mod writes in your project

| Path | Written by | Commit it? |
| --- | --- | --- |
| \`intent/\`, \`specs/\`, \`plans/\`, \`proofs/\`, \`reviews/\`, \`lessons/\`, \`evals/\` | the agent (artifacts) and you (approvals) | yes — they are the audit trail |
| \`.okf/config.json\`, \`.okf/runs/*.json\`, \`.okf/ledger.jsonl\`, \`.okf/AUDIT.md\` | the mod | yes |
| \`.okf/active\`, \`.okf/bands/\` | the mod | no (listed in \`.okf/.gitignore\`) |
| \`CLAUDE.md\`, \`REVIEW.md\`, \`bands.yaml\`, CI workflow, managed settings, production gate | \`/sdlc init\` (never overwrites) | yes |
`

writeFileSync(join(MOD, 'docs', 'CUSTOMIZING.md'), doc)
console.log(`docs/CUSTOMIZING.md: ${rows.length} key rows`)
