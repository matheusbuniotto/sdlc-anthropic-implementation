# Customizing okf-loop

Everything customizable lives in **`.okf/config.json`** at the root of the project the mod runs in.
The file may be partial: anything you leave out keeps its default, and a bad value is reported in the
Setup tab (and `/sdlc status`) instead of crashing the mod. `/sdlc init` writes a minimal one.

For editor completion add the schema:

```json
{ "$schema": "./mods/okf-loop/schemas/okf-config.schema.json" }
```

Precedence, lowest to highest: built-in defaults → `.okf/config.json` → the plugin's `userConfig`
options set in `/config` (**Autonomy mode**, **Autopilot turn budget**, **Open the Loop pane at session start**; each has
a "use the file" value, so an untouched option never overrides `/sdlc mode`).
`/sdlc mode`, `/sdlc plays` and the pane's toggles write back to `.okf/config.json`.

## Key reference

_Generated from `schemas/okf-config.schema.json` by `scripts/build-config-docs.ts`; do not edit this table by hand._

| Key | Type | Default | What it does |
| --- | --- | --- | --- |
| `version` | any | `1` | Config format version. Always 1. |
| **`knowledge`** | object | | Where the knowledge base (plays, stages, templates) comes from. |
| `knowledge.root` | string | `"openknowledge"` | Directory, relative to the repository, holding the project's own openknowledge/ tree. When it exists its plays, stages and templates override the snapshot bundled with the mod, per play number and per template. |
| **`autonomy`** | object | | How far the mod may drive the loop on its own. It never passes a human gate, whatever is set here. |
| `autonomy.mode` | `manual` · `guided` · `semi` | `"semi"` | manual: guards and the ledger only. guided: the mod proposes the next step and a person triggers it. semi: the agent runs every non-human step itself (draft spec, draft plan, implement, verify, review) and stops at the next human gate. semi degrades to guided while Play 04 is disabled. |
| `autonomy.maxAutoTurns` | integer | `12` | Autopilot turns allowed between two human gates. When the budget is spent the autopilot halts until a person passes a gate or resumes it. |
| `autonomy.haltOnBlocks` | integer | `3` | Halt the autopilot after this many guard blocks in a row without a good step in between. |
| `autonomy.haltOnVerifyFails` | integer | `3` | Halt the autopilot after this many failed verifications in a row. |
| `autonomy.humanGates` | array | (see below) | Gates that need a named person. release.approve is always required and is restored if removed. A gate that is not listed passes on its own once its machine requirements hold; verify.pass and review.pass are machine gates and only need a person if you list them. |
| `autonomy.autoKinds` | array | `["draft-spec","draft-plan","implement","verify","review"]` | Next-action kinds the autopilot may run unattended in semi mode. Steps that are for a person (gates, the interview, release) are never run by the autopilot. |
| **`plays`** | object | | Which of the 14 plays of openknowledge/INDEX.md are adopted. Each adopted play switches real behaviour on (guards, scaffolds, prompts). |
| `plays.enabled` | integer[] | `[1,2,3,4,5,6,7,8,10,11]` | Adopted play numbers. A play needs every prerequisite adopted too (Play 11 needs Play 07, and so on); on load, a play whose prerequisite is not adopted is switched off and reported. A play cannot be disabled while an adopted play depends on it. |
| **`paths`** | object | | Where artifacts live. {slug} (the run slug) and {date} (YYYY-MM-DD) expand. |
| `paths.intent` | string | `"intent/{slug}.md"` | Stage 1 artifact (intent.md), one per run. {slug} expands to the run slug. Must be relative to the repository; only {slug} and {date} expand. Must contain {slug}. |
| `paths.spec` | string | `"specs/{slug}.spec.md"` | Stage 2 artifact (spec.md), one per run. Must be relative to the repository; only {slug} and {date} expand. Must contain {slug}. |
| `paths.plan` | string | `"plans/{slug}.plan.md"` | Stage 3 artifact (plan.md), one per run. Source edits wait until its Status is accepted. Must be relative to the repository; only {slug} and {date} expand. Must contain {slug}. |
| `paths.proof` | string | `"proofs/{slug}.proof.md"` | Stage 4 verifier report, one per run. It must contain "### Verification Verdict: PASS" or "FAIL". Must be relative to the repository; only {slug} and {date} expand. Must contain {slug}. |
| `paths.review` | string | `"reviews/{slug}.review.md"` | Stage 5 three-pass review, one per run (format: Pass headings with [Tag], findings, "### Review Verdict: CLEAN\|BLOCKED"). Must be relative to the repository; only {slug} and {date} expand. Must contain {slug}. |
| `paths.incident` | string | `"intent/incident-{date}.md"` | Stage 6 to Stage 1: the intent the control bands write when a metric breaches. {date} expands to YYYY-MM-DD. Must be relative to the repository; only {slug} and {date} expand. |
| `paths.lesson` | string | `"lessons/{date}-{slug}.md"` | Play 14 post-mortem. {date} and {slug} expand. Must be relative to the repository; only {slug} and {date} expand. |
| `paths.eval` | string | `"evals/{slug}.json"` | Plays 09/14 regression eval for a run or an incident. {slug} expands. Must be relative to the repository; only {slug} and {date} expand. |
| `paths.claudeMd` | string | `"CLAUDE.md"` | Repository memory file (Play 05). Must be relative to the repository; only {slug} and {date} expand. |
| `paths.reviewPolicy` | string | `"REVIEW.md"` | The review policy the reviewer follows (Play 10). Must be relative to the repository; only {slug} and {date} expand. |
| `paths.bands` | string | `"bands.yaml"` | Statistical control bands definition (Play 13). Must be relative to the repository; only {slug} and {date} expand. |
| `paths.ciWorkflow` | string | `".github/workflows/agent-evals.yml"` | The CI evals workflow scaffolded from the template (Play 09). Must be relative to the repository; only {slug} and {date} expand. |
| `paths.managedSettings` | string | `".okf/enterprise-managed-settings.json"` | Enterprise managed-settings scaffold (Play 12). It is a template to hand to your admins, not a live setting. Must be relative to the repository; only {slug} and {date} expand. |
| `paths.productionGate` | string | `".claude/hooks/production-gate.sh"` | The production approval gate hook script (Play 11). Must be relative to the repository; only {slug} and {date} expand. |
| **`guards`** | object | | Deterministic tool-call guards. A guard is active only when its play is adopted and it is not listed in `disabled`. Pattern lists replace the defaults. |
| `guards.disabled` | array | `[]` | Guards switched off by hand. They stay visible, marked off, in the Guards tab. |
| `guards.protectedPaths` | string[] | (see below) | Globs the agent may not edit (protect-paths). The default includes .okf/** so no agent tool can change the mod's own config, ledger or run state. |
| `guards.testGlobs` | string[] | (see below) | Globs that identify test files; they are locked while a bug-fix protocol is active (test-lock). |
| `guards.planFirstExempt` | string[] | (see below) | Globs that stay editable before a plan is accepted: artifacts, docs and the mod's own files (plan-first). |
| `guards.secretPatterns` | object[] |  | Regular expressions for secrets that must never be written (secret-leak). A source may start with (?i) for case-insensitive. The default list lives in hooks/core/guards.ts; a list given here replaces it. |
| `guards.productionPatterns` | string[] |  | Regular expressions, tested case-insensitively against Bash commands: a match is a production deploy that needs a release token or a human grant (production-gate). The default list lives in hooks/core/guards.ts; a list given here replaces it. |
| `guards.destructiveSql` | boolean | `true` | Refuse DROP, TRUNCATE and DELETE FROM in Bash commands even with a release grant (destructive-sql). |
| `guards.protectedBranches` | string[] | `["main","master"]` | Branches the agent may not push to, force-push or merge into (separation-of-duties). |
| `guards.credentialPaths` | string[] | (see below) | Globs the agent may not read, edit or touch from Bash: SSH keys, cloud credentials, .env files (credential-shield). ~ is the home directory. |
| `guards.blockNetwork` | boolean | `false` | Also block curl, wget and WebFetch, as the managed-settings template does (credential-shield). Off by default. |
| `guards.grantMinutes` | integer | `15` | Minutes a human release grant (/sdlc release grant) stays valid. |
| **`verify`** | object | | Verification feedback loop (Play 08). |
| `verify.commands` | string[] | (see below) | Commands the proof tracker recognizes as verification runs: a Bash command that contains one of them counts, and its exit status decides pass or fail. |
| **`review`** | object | | The three-pass review (Play 10) as the mod reads it. |
| `review.nitCap` | integer | `5` | Most nits a review may list. More are summarized in one overflow line; a review over the cap without that line does not pass. |
| `review.passes` | object[] | (see below) | The review passes, in order. Every tag must appear in a "### Pass N — Title [Tag]" heading of the review for it to count as complete. |
| `review.ignorePaths` | string[] | (see below) | Globs the reviewer must not evaluate: generated files, vendor bundles, lockfiles. |
| **`bands`** | object | | Statistical control bands (Play 13): metrics sampled on a timer, judged with Western Electric rules, tiered response. |
| `bands.enabled` | boolean | `false` | Run the watcher: sample the sources and evaluate the bands. |
| `bands.sources` | object[] | `[]` | Metrics to sample. Each is a command run without a shell; its stdout is parsed into one number. |
| `bands.window` | integer | `30` | Rolling window in samples for the mean and standard deviation. At least 8, the samples needed before a band is judged. |
| `bands.tier3` | `propose` · `runbook` | `"propose"` | What a 3-sigma breach does. propose: write a proposal a person approves (the mod never acts alone). runbook: run `runbook` once a person approves. |
| `bands.runbook` | string[] | `[]` | Commands run after a person approves a 3-sigma breach when tier3 is "runbook". |
| **`ui`** | object | | Interface preferences. |
| `ui.openPaneOnStart` | boolean | `false` | Open the Loop pane when a session starts (wide terminals only). |
| `ui.showBand` | boolean | `true` | Show the one-line band above the prompt while a run exists. |
| `policySkills` | string[] | `[".claude/skills/**/SKILL.md","CLAUDE.md"]` | Globs of policy skills and docs the design stage must load (Plays 02 and 06). |

## Recipes

**Adopt only the entry-point plays** (Plays 1, 5, 7, 8 need no prerequisites):

```json
{ "plays": { "enabled": [1, 5, 7, 8] } }
```

**Put artifacts where your repository already keeps them** (`{slug}` is the run, `{date}` is YYYY-MM-DD):

```json
{ "paths": { "intent": "docs/intent/{slug}.md", "spec": "docs/specs/{slug}.md", "plan": "docs/plans/{slug}.md" } }
```

Add the new folders to `guards.planFirstExempt` so drafting them is allowed before a plan is accepted.

**Freeze more of the repo and shorten the release window:**

```json
{ "guards": { "protectedPaths": ["schemas/generated/**", "infra/prod/**", "migrations/**", ".okf/**"], "grantMinutes": 10 } }
```

Keep `.okf/**` in `protectedPaths`: it is what stops the agent from editing the mod's own config, ledger and
run records.

**Require a person for verification and review too** (they are machine gates by default; `release.approve` is always human):

```json
{ "autonomy": { "humanGates": ["intent.approve", "spec.approve", "plan.accept", "verify.pass", "review.pass", "release.approve"] } }
```

**Let the agent run fewer steps unattended:**

```json
{ "autonomy": { "autoKinds": ["draft-spec", "draft-plan"] } }
```

**Tell the proof tracker what counts as verification:**

```json
{ "verify": { "commands": ["make test", "make lint", "./scripts/e2e.sh"] } }
```

**Add a control band** (Stage 6). The command runs without a shell; its stdout is parsed per `parse`
(`number`, or `json:path.to.number`):

```json
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
```

Also scaffold `bands.yaml` (`/sdlc init bands`) to tune the tier actions; the watcher needs at least 8 samples
before it can judge a metric.

## Your own knowledge base

The mod bundles a snapshot of this repository's `openknowledge/`. If your project has its own
`openknowledge/` (or another directory named by `knowledge.root`) the mod reads it at session start and on
`/sdlc reload`: your play list, prerequisites and templates replace the bundled ones where they differ. Play
numbers come from `play-NN` in the play's `id`/filename and front-matter `prerequisites`. To refresh the
bundled snapshot after editing this repository's knowledge base: `bun scripts/build-knowledge.ts`.

## Your own stage prompts

Create `.okf/prompts/<key>.md` to replace a stage prompt, where `<key>` is one of `interview`, `draft-spec`,
`draft-plan`, `implement`, `verify`, `review`, `release`, `fix`, `incident`, `lesson`. Placeholders:
`{{slug}} {{title}} {{date}} {{stage}} {{intent_path}} {{spec_path}} {{plan_path}} {{proof_path}} {{review_path}}
{{claude_md}} {{review_policy}} {{incident_path}} {{lesson_path}} {{eval_path}} {{knowledge_root}}
{{verify_commands}} {{nit_cap}} {{policy_skills}} {{plan_files}} {{notes}} {{blocked_by}} {{gate_feedback}}`.
An override can reword the work, but the guards stay deterministic: it cannot lift a rule.

## What the mod writes in your project

| Path | Written by | Commit it? |
| --- | --- | --- |
| `intent/`, `specs/`, `plans/`, `proofs/`, `reviews/`, `lessons/`, `evals/` | the agent (artifacts) and you (approvals) | yes — they are the audit trail |
| `.okf/config.json`, `.okf/runs/*.json`, `.okf/ledger.jsonl`, `.okf/AUDIT.md` | the mod | yes |
| `.okf/active`, `.okf/bands/` | the mod | no (listed in `.okf/.gitignore`) |
| `CLAUDE.md`, `REVIEW.md`, `bands.yaml`, CI workflow, managed settings, production gate | `/sdlc init` (never overwrites) | yes |
