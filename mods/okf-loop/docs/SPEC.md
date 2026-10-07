# okf-loop — build specification

Single source of truth for everyone building this mod. If this file and your
intuition disagree, this file wins; if this file is wrong, say so in your report
instead of silently deviating.

## 0. What we are building

`okf-loop` is a Claude Code **mod** (a plugin of function hooks, hot-reloading, with UI) that
**runs `openknowledge/INDEX.md`**: the AI-Native SDLC ("the Loop") as a live, customizable,
semi-autonomous runtime instead of a document.

The knowledge base in this repo (`/Users/matheus/rea/openknowledge/`) is the product spec.
Read the parts you build against. Do **not** read or `cd` outside `/Users/matheus/rea`.
The only outside-of-repo facts you may use are already copied in: the mod API types
(`mods/okf-loop/.claude-plugin/types/claude-code/index.d.ts`) and API notes
(`mods/okf-loop/.dev/mod-api/`). Grep the types file; it is 20k lines.

What "running INDEX.md" means, concretely:

| INDEX.md says | The mod does |
| --- | --- |
| 6 stages, artifact chain `intent→spec→plan→proof→REVIEW→bands` | A **run** per change; stage state is *derived from the committed artifacts* (file exists + `Status:` line), so git stays the source of truth. |
| Humans above the loop; agent acts up to a gate, cannot pass it | **Gates**. Human gates (`intent.approve`, `spec.approve`, `plan.accept`, `release.approve`) need a person; machine gates (`verify.pass`, `review.pass`) are checked deterministically. The agent cannot flip a Status to approved (gate-integrity guard). |
| Plan mode first, auto mode inside an accepted plan | **Autopilot** (`semi` mode): after each human approval the mod queues the next stage's prompt itself, chains verify → review, and **halts at the next human gate**, on budget, on block/verify-fail streaks, or when paused. |
| 14 plays, adopted modularly, entry points need no prerequisites | **Plays registry parsed from the knowledge base front-matter**, enable/disable with prerequisite enforcement; each enabled play switches real behaviour on (guards, scaffolds, prompts). |
| Hooks are deterministic guardrails (Plays 07, 08, 11) | `tool.call` **guards**: protect-paths, secret-leak, plan-first, test-lock, production-gate, destructive-sql, credential-shield, separation-of-duties, gate-integrity — each a pure function, self-explaining denials, recorded in the ledger. |
| Templates | `/sdlc init` scaffolds `CLAUDE.md`, `REVIEW.md`, `bands.yaml`, CI evals workflow, managed settings, production gate script from `openknowledge/templates/`; `renderTemplate` fills artifacts. |
| Audit trail / chain of custody, leading & lagging metrics | `.okf/ledger.jsonl` (append-only), `AUDIT.md` export, metrics computed from the ledger. |
| Stage 6 control bands, deterministic detection, tiered response | Pure SPC math (Western Electric), `bands.yaml` parse, watcher timer, 2σ → read-only diagnosis → harness writes `intent/incident-<date>.md` (closing the loop), 3σ → *proposal* a human approves. |
| "Customizable open-source" | `.okf/config.json` (+ JSON schema) controls everything; `openknowledge/` in the project, if present, **overrides** the bundled knowledge snapshot (plays, templates); stage prompts overridable in `.okf/prompts/`. MIT licensed, installable from the repo as a marketplace. |

Quality bar: **great UI** (a tabbed live pane that makes the Loop visible, a band above the prompt,
status line, toasts), **deterministic core** (everything decidable is a pure function with tests),
**semi-autonomous but safe** (never passes a human gate, bounded budget).

Names: mod `okf-loop` · command `/sdlc` · pane id `sdlc-loop` · state dir `.okf/` in the *project*.

## 1. Hard engine constraints (learned the hard way — violating them fails validation)

1. **`$` never crosses an import.** `$` may be passed only to a top-level function declared in the
   *same file*. So: every `$.…` call lives in `hooks/register.tsx`. Everything else (`hooks/core/*`,
   `hooks/ui/*`) is **pure**: data in, data/JSX out, no `$`, no `import … from 'claude-code'`
   except `import type`.
2. Spell every API call in full (`$.fs.read(...)`); never alias or destructure `$` or a namespace.
3. Event names in `on(...)` are string literals; one `on` per event per matcher; never shadow `on`.
4. No Node, no DOM, no `setTimeout`, no `fetch`, no `import()`. ES modules, static imports, relative paths.
   Web standards (`URL`, `TextEncoder`, `crypto.subtle`, `JSON`, `Intl`, `Date`) exist.
5. `e` is deeply frozen. Pass copies to `next`.
6. `$.env.get(name)` needs `name` as a string literal.
7. JSX compiles to the global `h`. Elements come from `$.ui.resolve(e)`; pure views receive the
   resolved table as `el` and callbacks as props. Boolean UI props (`focus`, `autoFocus`,
   `closeOnEscape`, `holdToasts`) accept only `true` — omit them to mean false.
8. A hook that throws is skipped; guards must fail closed with `.catch(($, e, next) => next.called ? next(e) : { deny: '…' })`.
9. State: `$.state` (atoms) holds what drawings read; the project's `.okf/` files hold what must
   outlive a session; `$.store` only for per-user trivia.
10. Module imports of types use `import type { … } from '../../types'` (from `hooks/core`, `hooks/ui`)
    and `'../types'` (from `hooks/register.tsx`). Constants import from `./constants`.
11. A pane opened by a person's command/press seats at any width; opened unasked it needs ≥144 columns.
12. Tests: `*.test.ts(x)` under `tests/`, `import { test, expect, describe } from 'claude-code/testing'`,
    run with `claude plugin test` from the mod dir. The test environment has **no fs/network/process**,
    so logic that needs them must be reachable as pure functions (that is the point of the design).
    Validation: `claude plugin validate .` from the mod dir must pass.
13. TypeScript strict, `noUncheckedIndexedAccess` is on (index results may be `undefined`).
14. Style: no comments that restate code; short comments for *why*. Match the surrounding file.
    No new dependencies. Files stay readable (< ~600 lines each; split by concept).

## 2. Layout and ownership

Paths are relative to `/Users/matheus/rea/mods/okf-loop/`. **Each file has exactly one owner.**
Never edit a file you do not own; if you need a change in someone else's file or in
`types/index.d.ts`/`constants.ts` (owned by the lead), put the request in your final report.

| Path | Owner |
| --- | --- |
| `types/index.d.ts`, `hooks/core/constants.ts`, `docs/SPEC.md` | lead |
| `hooks/core/yaml.ts`, `guards.ts`, `spc.ts`, `bands.ts` + `tests/guards.test.ts`, `tests/spc.test.ts`, `tests/yaml.test.ts`, `tests/bands.test.ts` | **B** |
| `hooks/core/config.ts`, `knowledge.ts`, `knowledge.generated.ts`, `artifacts.ts` + `tests/config.test.ts`, `tests/knowledge.test.ts`, `tests/artifacts.test.ts`, `../../scripts/build-knowledge.ts`, `schemas/okf-config.schema.json` | **A1** |
| `hooks/core/stages.ts`, `autopilot.ts`, `ledger.ts`, `metrics.ts` + `tests/stages.test.ts`, `tests/autopilot.test.ts`, `tests/ledger.test.ts`, `tests/metrics.test.ts` | **A2** |
| `hooks/ui/*` + `tests/ui-views.test.tsx` | **C** |
| `hooks/core/prompts.ts`, `agents/*.md` + `tests/prompts.test.ts` | **D** |
| `hooks/core/controller.ts`, `commands.ts`, `view.ts`, `hooks/register.tsx`, `hooks/hooks.json`, `.claude-plugin/plugin.json` + `tests/controller.test.ts`, `tests/commands.test.ts`, `tests/ui.test.tsx` | **E** (starts after A1/A2/B/C/D land) |
| `README.md`, `docs/*.md` (except SPEC), `../../README.md` section, `../../.claude-plugin/marketplace.json`, `../../LICENSE`, `../../scripts/dev-sync.sh` | docs (last) |

## 3. Data on disk (the project the mod runs in)

```
<project>/
  openknowledge/…            optional; if present it overrides the bundled knowledge (plays, templates)
  intent/<slug>.md           Stage 1   (Status: draft|under-review|approved|rejected)
  specs/<slug>.spec.md       Stage 2   (Status: draft|under-review|approved)
  plans/<slug>.plan.md       Stage 3   (Status: draft|accepted|in-progress|complete)
  proofs/<slug>.proof.md     Stage 4   verifier report; contains "### Verification Verdict: PASS|FAIL"
  reviews/<slug>.review.md   Stage 5   three-pass review (format in §5.6)
  evals/<slug>.json          Plays 09/14
  lessons/<date>-<slug>.md   Play 14
  intent/incident-<date>.md  Stage 6 → Stage 1 (source: anomaly)
  CLAUDE.md  REVIEW.md  bands.yaml
  .okf/config.json           LoopConfig (partial; merged over defaults)
  .okf/ledger.jsonl          one LedgerEntry per line, append-only
  .okf/runs/<slug>.json      RunRecord
  .okf/active                the active run's slug
  .okf/bands/<metric>.jsonl  {"at":…,"value":…} samples
  .okf/prompts/<key>.md      optional prompt overrides ({{placeholders}})
  .okf/AUDIT.md              exported audit trail
```

Artifact path patterns (`LoopConfig.paths`) expand `{slug}` and `{date}` (YYYY-MM-DD).
Defaults: `intent: "intent/{slug}.md"`, `spec: "specs/{slug}.spec.md"`, `plan: "plans/{slug}.plan.md"`,
`proof: "proofs/{slug}.proof.md"`, `review: "reviews/{slug}.review.md"`, `incident: "intent/incident-{date}.md"`,
`lesson: "lessons/{date}-{slug}.md"`, `eval: "evals/{slug}.json"`, `claudeMd: "CLAUDE.md"`,
`reviewPolicy: "REVIEW.md"`, `bands: "bands.yaml"`, `ciWorkflow: ".github/workflows/agent-evals.yml"`,
`managedSettings: ".okf/enterprise-managed-settings.json"`, `productionGate: ".claude/hooks/production-gate.sh"`.

## 4. Module APIs (exact signatures — implement them as written; extra exports are fine)

All in `hooks/core/`. Types come from `../../types`. All functions are pure and deterministic
(time is always a parameter, never read).

### 4.1 `yaml.ts` (B)
```ts
export function parseYaml(text: string): unknown
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string; hasFrontmatter: boolean }
export function stripFrontmatter(text: string): string
```
A YAML **subset** sufficient for this repo: `---` front-matter; block mappings (nested by indentation),
block sequences (`- scalar`, `- key: value` maps), scalars (quoted `"…"`/`'…'`, numbers, `true/false`, `null`, bare strings,
`"[[wiki/links]]"` stay strings), comments (`#`, but not inside quotes), flow sequences `[a, b]` and empty `[]`/`{}`,
`key: >-` / `|` block scalars (folded/literal, indentation stripped). It must parse every front-matter in
`/Users/matheus/rea/openknowledge/**/*.md` and `openknowledge/templates/bands.template.yaml` (a `---` front-matter followed
by the YAML body — `parseYaml` must skip a leading front-matter block). Never throws: returns `undefined` / `{}` on garbage.

### 4.2 `guards.ts` (B)
```ts
export function evaluateGuards(input: GuardInput, ctx: GuardContext): GuardVerdict   // first deny wins; deterministic
export function activeGuards(ctx: Pick<GuardContext, 'guards' | 'enabledPlays'>): { id: GuardId; enabled: boolean; active: boolean }[]
export function globToRegExp(glob: string): RegExp                // ** * ? [..]; '/'-aware; matches repo-relative paths
export function matchesAny(path: string, globs: string[]): boolean
export function normalizePath(path: string, cwd: string, home: string): string   // → repo-relative with '/', `~` expanded, '..' resolved; outside-repo → absolute
export function isTestPath(path: string, testGlobs: string[]): boolean
export function detectSecrets(text: string, patterns: { name: string; pattern: string }[]): { name: string; sample: string } | null  // sample is masked
export function bashWrittenPaths(command: string): string[]       // best-effort: >, >>, tee, sed -i, cp/mv/rm/touch/truncate/dd of=, install
export function isProofCommand(command: string, patterns: string[]): boolean   // 'make test' matches 'make test', 'cd x && make test -j4'
export function isProductionCommand(command: string, patterns: string[]): boolean
export const DEFAULT_SECRET_PATTERNS: { name: string; pattern: string }[]
export const DEFAULT_PRODUCTION_PATTERNS: string[]
```
Behaviour (every denial `message` is self-explaining: starts `okf-loop · Play NN · <guard label>:` then *why*, then `Do instead:` a compliant alternative; ≤ 4 lines; mention the path/command):

* **Tools**: `Edit`, `Write`, `MultiEdit`, `NotebookEdit` carry `filePath`/`content`; `Bash` carries `command`; `Read` carries `filePath`; `WebFetch` has neither. Unknown tools → allow.
* A guard applies iff `guards.disabled` lacks it **and** its play (`GUARD_DEFS[id].play`) is in `enabledPlays`. Guards needing a run (`plan-first`, `test-lock`) allow when `ctx.run === null`.
* **protect-paths** (Play 07): Edit/Write/MultiEdit/NotebookEdit onto `guards.protectedPaths` (defaults in `config.ts`: `schemas/generated/**`, `api/v1/frozen/**`, `.env`, `.env.*`, `**/.env`, `**/.env.*`, `secrets/**`) → deny; also Bash whose `bashWrittenPaths` hit them.
* **secret-leak** (Play 07): content of Write / Edit new text / MultiEdit / NotebookEdit matching `secretPatterns` → deny; message names the pattern, never echoes the secret (masked sample only). Allow when the target is a `*.md`/docs path? **No** — secrets are secrets everywhere, but allow `.template`/`.example`/`.sample` files and the literal placeholders `AKIAIOSFODNN7EXAMPLE`.
* **plan-first** (Play 03): run present, `!run.planAccepted`, tool is a source edit, path not in `planFirstExempt` → deny with the run slug, the plan path (from `ctx.paths.plan`), and "ask the human to accept it (/sdlc approve plan.accept)". Bash redirect writes count too.
* **test-lock** (Play 08): `run.fixActive` (= bug-fix protocol active **and** reproduction test committed) and the target is a test path → deny: "Test files are locked during bug remediation. Fix the implementation, not the test."
* **production-gate** (Play 11): Bash command matching `productionPatterns` (case-insensitive) and `!release.envToken && !release.grantActive` → deny: "Production deployments require signed release authorization… Ask the release manager; a human can grant it with /sdlc release grant". With a token/grant → allow.
* **destructive-sql** (Play 11): `\b(DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)|TRUNCATE(\s+TABLE)?|DELETE\s+FROM)\b` (case-insensitive) in a Bash command when `guards.destructiveSql` → deny even with a release grant.
* **credential-shield** (Play 12): Read/Edit/Write/Bash touching `guards.credentialPaths` (`~/.ssh/**`, `~/.aws/**`, `~/.config/gcloud/**`, `**/.env`, `**/.env.*`, `secrets/**`) → deny; if `guards.blockNetwork`: `WebFetch` and Bash `curl`/`wget` → deny.
* **separation-of-duties** (Play 10): Bash `git push` naming a `protectedBranches` branch (also `HEAD:main`, `+main`, `--force`/`-f` pushes whose refspec names it), `gh pr merge`, `gh api …/merge` → deny: "The agent that wrote the code has no authority to merge or release it."
* **gate-integrity** (Play 11): the agent writes `**Status:** approved` (intent/spec) or `**Status:** accepted` (plan) into a file whose path matches an artifact path pattern (`ctx.paths.intent|spec|plan` expanded with `*` for the slug), via Edit/Write/MultiEdit or a Bash write whose command text contains approved/accepted → deny: "Only a human moves this gate. Set Status to under-review/draft and ask the human to /sdlc approve <gate>." `Status: complete`/`in-progress` on a plan is allowed. (Humans edit files in their editor, not through the tool.)
* Order of evaluation: gate-integrity, protect-paths, secret-leak, credential-shield, plan-first, test-lock, production-gate, destructive-sql, separation-of-duties.

### 4.3 `spc.ts` + `bands.ts` (B)
```ts
// spc.ts
export function mean(xs: number[]): number
export function stdev(xs: number[]): number                       // population sd; 0 for n<2
export function rollingStats(samples: number[], window: number): { mean: number; sd: number; n: number }  // the last `window` samples EXCLUDING the newest
export function zScore(value: number, mean: number, sd: number, higherIsWorse: boolean): number           // sd 0 → 0
export function westernElectric(zs: number[]): { rule: string; tier: Tier }[]    // zs oldest→newest, oriented (+ = worse)
export function classifyTier(z: number, rules: { rule: string; tier: Tier }[]): Tier
export function evaluateSeries(metric: string, samples: { at: number; value: number }[], opts: { window: number; higherIsWorse: boolean; minSamples?: number; rules?: 'western_electric' | 'simple' }): BandReading | null  // null until minSamples (default 8)
export function sparkline(values: number[], width?: number): string      // ▁▂▃▄▅▆▇█
// bands.ts
export function parseBandsYaml(text: string): BandSpec | null
export function extractMetric(stdout: string, parse: string): number | null     // 'number' | 'json:a.b.0.c'
export function dueSources(sources: BandSource[], lastCheckedAt: Record<string, number>, now: number): BandSource[]
export function parseSamples(jsonl: string, limit?: number): { at: number; value: number }[]
export function sampleLine(at: number, value: number): string
export function incidentIntentMarkdown(a: { reading: BandReading; spec: BandSpec | null; diagnosis: string; date: string; author: string; sha?: string }): string  // Stage-1 intent format (openknowledge/templates/intent.template.md), Status: draft, Anomaly Ref ANOMALY-<metric>-<date>
export function incidentSlug(metric: string, date: string): string
export function diagnoseToolList(spec: BandSpec | null): string[]
```
Tiers follow the knowledge base exactly: `|z|<2` → `in-control`/`1sigma` (log only; use `'in-control'` when |z|<1, `'1sigma'` when 1≤|z|<2),
`2≤z<3` → `2sigma` (read-only diagnosis), `z≥3` → `3sigma` (propose, never act alone). Only the *worse* direction counts.
Western Electric (oriented, + = worse): WE1 one point ≥3σ → `3sigma`; WE2 two of three consecutive ≥2σ → `2sigma`;
WE3 four of five consecutive ≥1σ → `2sigma`; WE4 eight consecutive above the mean → `1sigma`. `rules:'simple'` ignores WE.
`classifyTier` = the highest tier among z-based and rule-based.

### 4.4 `config.ts` (A1)
```ts
export const DEFAULT_CONFIG: LoopConfig
export function parseConfig(input: string | unknown): { config: LoopConfig; issues: string[] }   // deep-merge over defaults; validate; clamp; never throws; unknown keys → issue
export function serializeConfig(config: LoopConfig, base?: unknown): string   // pretty JSON, stable key order, `$schema` first; only keys that differ from defaults when `minimal` semantics are wanted → implement `serializeConfig(config)` as full pretty JSON
export function diffFromDefaults(config: LoopConfig): Record<string, unknown>   // the minimal patch
export function withPlayToggled(config: LoopConfig, n: number, plays: PlayDef[]): { config: LoopConfig; ok: boolean; reason: string }   // enforces prerequisites and dependents
export function withGuardToggled(config: LoopConfig, id: GuardId): LoopConfig
export function withMode(config: LoopConfig, mode: Mode): LoopConfig
export function artifactPath(config: LoopConfig, key: PathKey, vars: { slug?: string; date?: string }): string
export function artifactGlob(config: LoopConfig, key: PathKey): string   // {slug} → *
export function slugify(title: string, existing?: string[]): string   // kebab, ≤48 chars, unique against `existing` by suffix -2, -3
export function applyUserOptions(config: LoopConfig, options: Record<string, unknown>): LoopConfig   // plugin.json userConfig (mode, maxAutoTurns, openPaneOnStart) override file values
```
`DEFAULT_CONFIG` values: see §3 paths; `autonomy`: mode `semi`, `maxAutoTurns` 12, `haltOnBlocks` 3, `haltOnVerifyFails` 3,
`humanGates` `['intent.approve','spec.approve','plan.accept','release.approve']` (release.approve can never be removed),
`autoKinds` `['draft-spec','draft-plan','implement','verify','review']`; `plays.enabled` = `DEFAULT_PLAYS`;
guards defaults as in §4.2 (`protectedPaths` ALSO contains `.okf/**` so no agent tool can edit the mod's own state, config or ledger — only the mod (via `$.fs`) and humans in their editor can; `grantMinutes` 15, `protectedBranches` `['main','master']`, `blockNetwork` false, `destructiveSql` true,
`planFirstExempt`: `**/*.md`, `intent/**`, `specs/**`, `plans/**`, `proofs/**`, `reviews/**`, `lessons/**`, `evals/**`, `.okf/**`, `.claude/**`, `openknowledge/**`;
`testGlobs`: `tests/**`, `test/**`, `__tests__/**`, `**/*.test.*`, `**/*.spec.*`, `**/test_*.py`, `**/*_test.go`; `credentialPaths` as §4.2;
`productionPatterns`/`secretPatterns` from `guards.ts` exports — import them, do not duplicate);
`verify.commands`: `make test`, `make lint`, `make build`, `npm test`, `npm run test`, `npm run lint`, `pnpm test`, `yarn test`, `pytest`, `cargo test`, `go test`, `bun test`;
`review`: `nitCap` 5, passes `[{tag:'Bugs',title:'Logic & Regressions'},{tag:'Security',title:'Security & Privacy'},{tag:'Compliance',title:'Specification & Architecture Alignment'}]`,
`ignorePaths` `['src/gen/**','build/**','*.min.js','package-lock.json','yarn.lock']`;
`bands`: `enabled` false, `sources` `[]`, `window` 30, `tier3` `'propose'`, `runbook` `[]`; `ui`: `openPaneOnStart` false, `showBand` true; `policySkills`: `['.claude/skills/**/SKILL.md','CLAUDE.md']`.
`knowledge.root` `'openknowledge'`. Also ship `schemas/okf-config.schema.json` (JSON Schema draft-07) describing every key with descriptions, and `$schema` in the file written by init points to `./node_modules`-free relative path `https://raw.githubusercontent.com/…` placeholder is NOT acceptable — use a relative `$schema` of `"../mods/okf-loop/schemas/okf-config.schema.json"` only when the schema file exists in the project, otherwise omit `$schema`.

### 4.5 `knowledge.ts` + `knowledge.generated.ts` + `scripts/build-knowledge.ts` (A1)
```ts
export function bundledKnowledge(): Knowledge                             // from knowledge.generated.ts
export function knowledgeFiles(root: string): string[]                    // the repo-relative paths worth reading under root: INDEX.md, plays/*.md, stages/*.md, templates/* — given a directory listing is unavailable here, return the *fixed* candidate list (INDEX.md, stages/01-plan.md … , plays/play-01-… (14 names from bundled), templates/*)
export function loadKnowledge(files: Record<string, string>, root: string): Knowledge   // files keyed by path relative to root; parse INDEX.md front-matter, every play/stage front-matter; unknown/missing → issues, never throws
export function mergeKnowledge(base: Knowledge, override: Knowledge): Knowledge   // override wins per play number / template; keeps issues
export function playByNumber(plays: PlayDef[], n: number): PlayDef | undefined
export function prerequisitesOf(plays: PlayDef[], n: number): number[]
export function dependentsOf(plays: PlayDef[], n: number, enabled: number[]): number[]
export function unmetPrerequisites(plays: PlayDef[], n: number, enabled: number[]): number[]
export function playViews(args: { plays: PlayDef[]; enabled: number[]; evidence: Record<number, { label: string; ok: boolean }[]> }): PlayView[]   // adds enabled/unmet/dependents/enforcedBy (PLAY_ENFORCEMENT)
export function topologicalPlayOrder(plays: PlayDef[]): number[]
```
`scripts/build-knowledge.ts` (run with `bun scripts/build-knowledge.ts` from the repo root) reads
`openknowledge/INDEX.md`, `plays/*.md`, `stages/*.md`, `templates/*` and writes `knowledge.generated.ts`
(`export const BUNDLED: { title, version, summary, plays: PlayDef[], stages: StageDoc[], templates: Partial<Record<TemplateName,string>> }`). Parsing there may reuse `hooks/core/yaml.ts` (owner B; it will exist) —
if it is not there yet, write a minimal local parser and switch when it lands. The generated file must be **deterministic** (stable ordering), formatted, committed. `prerequisites` front-matter entries like
`"[[openknowledge/plays/play-07-build-guardrail-hooks]]"` map to play numbers via the `play-NN` in the link. Stage front-matter `stage: stage-3-build` → `'build'`.

### 4.6 `artifacts.ts` (A1)
```ts
export function parseArtifact(kind: ArtifactKind, path: string, text: string | null, mtimeMs: number, cfg: Pick<LoopConfig, 'review'>): ArtifactDoc
export function setArtifactStatus(text: string, kind: ArtifactKind, status: ArtifactStatus): string     // rewrites the `**Status:** …` line keeping its shape; inserts after the header block if absent
export function readStatus(text: string): ArtifactStatus
export function renderArtifact(args: { kind: 'intent' | 'spec' | 'plan'; template: string; title: string; author: string; date: string; slug: string; intentPath?: string; specPath?: string; source?: string; branch?: string }): string   // fills the template's bracketed placeholders; Status: draft
export function renderScaffold(name: TemplateName, template: string, vars: { project: string; date: string; paths: LoopConfig['paths'] }): string   // CLAUDE.md, REVIEW.md, verifier, bands, ci workflow, managed settings, production gate: strips wiki front-matter, replaces [Repository / Microservice Name], etc.
export function parseVerdict(text: string): 'PASS' | 'FAIL' | null          // "### Verification Verdict: PASS"
export function parseReview(text: string, cfg: Pick<LoopConfig, 'review'>): { passes: string[]; importantOpen: number; importantResolved: number; nits: number; nitOverflowSummarized: boolean; verdict: 'CLEAN' | 'BLOCKED' | null; issues: LintIssue[] }
export function planFiles(planText: string): string[]
export function driftFiles(edited: string[], planned: string[]): string[]    // edited files not covered by the plan (glob/dir prefix aware)
export function appendTwiceRule(claudeMd: string, lesson: string, date: string): string   // adds under "Things Claude Gets Wrong"; creates the section if missing
export function flaggedConcernCount(specText: string): number
export function sectionNames(text: string): string[]
export const REQUIRED_SECTIONS: Record<'intent' | 'spec' | 'plan', string[]>
```
`REQUIRED_SECTIONS`: intent `Problem`, `Proposed Outcome`, `Affected Users and Systems`, `Constraints`, `Open Questions`;
spec `Executive Summary & Scope`, `Requirements & Functional Contracts`, `Technical Architecture & Interfaces`, `Policy Compliance Matrix`, `Flagged Areas of Concern`, `Sign-off & Progression`;
plan `Files That Change`, `Order of Work`, `Risks & Mitigations`, `Proof of Correctness`. Matching is case-insensitive, ignores numbering and leading `Risks`/`Risks & Mitigations`-style variants ("Risks" alone is accepted for plan; "Files that change" etc.).
Placeholder detection: an artifact whose body still contains template placeholders like `[Short Descriptive Title]` / `[Describe in plain language` is `draft` with warn issue `placeholder` — and must **not** count as "ready to put to a human" (that is stages.ts's call via `issues`).

### 4.7 `ledger.ts` (A2)
```ts
export function makeEntry(e: Omit<LedgerEntry, 'ts'>, ts: number): LedgerEntry
export function toLine(entry: LedgerEntry): string                 // single-line JSON (no newline)
export function parseLedger(text: string, limit?: number): LedgerEntry[]   // tolerant of blank/corrupt lines; keeps the newest `limit`
export function appendEntry(existing: string, entry: LedgerEntry): string  // ensures trailing newline, appends one line
export function filterLedger(entries: LedgerEntry[], filter: LedgerFilter): LedgerEntry[]
export function ledgerIcon(kind: LedgerKind): string
export function describeEntry(entry: LedgerEntry): string         // one human sentence
export function auditMarkdown(entries: LedgerEntry[], opts: { project: string; generatedAt: number; run?: string }): string   // chain-of-custody table per run + chronological log, in the style of governance/audit-trail-and-chain-of-custody.md
export const DEFAULT_LEDGER_FILTER: LedgerFilter
```

### 4.8 `stages.ts` (A2)
```ts
export type DeriveInput = {
  record: RunRecord
  docs: Partial<Record<ArtifactKind, ArtifactDoc>>      // intent, spec, plan, proof, review (missing → exists:false doc or absent)
  proofVerdict: 'PASS' | 'FAIL' | null                  // parseVerdict(proof text)
  review: { passes: string[]; importantOpen: number; nits: number; verdict: 'CLEAN' | 'BLOCKED' | null } | null
  config: Pick<LoopConfig, 'autonomy' | 'review' | 'paths'>
  releaseGranted: boolean                                // env token or a live human grant
  now: number
}
export function deriveRun(input: DeriveInput): RunSnapshot
export function evaluateGate(id: GateId, input: DeriveInput): GateReport
export function nextAction(snapshotStages: StageSnapshot[], record: RunRecord, config: Pick<LoopConfig, 'autonomy'>): NextAction
export function newRunRecord(args: { slug: string; title: string; source: RunSource; now: number }): RunRecord
export function recordApproval(record: RunRecord, gate: GateId, by: string, now: number, note?: string): RunRecord
export function recordRejection(record: RunRecord, gate: GateId): RunRecord   // clears the approval, resets autoTurns
export function statusForApproval(gate: GateId): { kind: ArtifactKind; status: ArtifactStatus } | null   // intent.approve→intent/approved, spec.approve→spec/approved, plan.accept→plan/accepted
export function statusForRejection(gate: GateId): { kind: ArtifactKind; status: ArtifactStatus } | null // →rejected (intent) / under-review→draft (spec, plan: draft)
export function summarizeRuns(snapshots: RunSnapshot[]): RunSummary[]
export function currentStage(stages: StageSnapshot[]): StageId
```
Stage derivation (authoritative; implement exactly):

1. **plan** — artifact `intent`. `intent.approve` (human): requirements — *machine*: artifact exists; all `REQUIRED_SECTIONS.intent` present; no `error` issues; no template placeholders. *human*: Status is `approved`. Gate `approved` ⇔ Status `approved`.
   State: missing artifact → `active`; exists and machine reqs unmet → `active`; machine reqs met and not approved → `awaiting-human`; `rejected` → `active` (rework); approved → `done`.
2. **design** — artifact `spec`; pending until intent approved. `spec.approve` machine reqs: exists; all `REQUIRED_SECTIONS.spec`; no placeholders; `checklist` sign-offs exist (total>0). human: Status `approved`. Open flagged concerns do not block *readiness* (the human resolves them) but the gate card must list `flaggedConcerns` as a human requirement ("N flagged concerns to resolve").
3. **build** — artifact `plan`; pending until spec approved. `plan.accept` machine reqs: exists; all `REQUIRED_SECTIONS.plan`; no placeholders; `planFiles` non-empty. human: Status ∈ {accepted, in-progress, complete}. After acceptance the stage is `active` (implementing) until plan Status `complete` → `done`.
4. **test** — artifact `proof`; pending until the plan is `complete`. `verify.pass` (machine): proof exists; verdict `PASS`; proof `mtimeMs` ≥ `record.proof.lastEditAt` (nothing edited after the proof); and (`record.proof.lastEditAt === 0` **or** (`lastRunPassed === true` **and** `lastRunAt ≥ lastEditAt`)). Verdict `FAIL` → stage `blocked` (next action `implement` to fix). `approved` ⇔ all machine reqs ok.
5. **deploy** — pending until verify.pass. `review.pass` (machine): review file exists with all configured pass tags; `importantOpen === 0`; `nits ≤ review.nitCap` (or overflow summarized); verdict not `BLOCKED`. If the review has open Important findings → stage `blocked`, next `implement`. After review.pass: `release.approve` (human): machine req review.pass; human: `record.approvals['release.approve']` exists ⇔ approved (the human's grant records it). Stage `awaiting-human` once review passes; `done` once release approved.
6. **maintain** — `monitoring` once deploy is done; `pending` before. No gates; it feeds `intent` runs (source `anomaly`).

`current` = the first stage not `done`. `progress` = approved gates / 6. `health`: `blocked` if any stage `blocked`; `attention` if any `awaiting-human`; else `ok`.
`nextAction` (first unmet step): plan: no intent → `interview` (promptKey `interview`, auto false, byHuman false); intent not ready → `interview` (continue); ready → `await-human` (gate `intent.approve`, byHuman true). design: no/unready spec → `draft-spec`; ready → `await-human` (`spec.approve`). build: no/unready plan → `draft-plan`; ready → `await-human` (`plan.accept`); accepted → `implement` until complete. test: no proof or stale → `verify`; FAIL → `implement`. deploy: no review → `review`; blocked → `implement`; clean → `release` (kind `release`, gate `release.approve`, byHuman true). maintain: `monitor`. `auto` = `autonomy.autoKinds.includes(kind) && !byHuman`.
`humanGates` config: a gate listed there is human-required. A **machine/human gate not listed** (except `release.approve`, always human) is auto-passed when its machine requirements are met: its human requirement is dropped and approval is implicit (`approved` true once `ready`). Document this in code comments.

### 4.9 `autopilot.ts` (A2)
```ts
export type AutopilotDecision =
  | { kind: 'run'; action: NextAction; code: 'running'; reason: string }
  | { kind: 'suggest'; action: NextAction; code: 'guided'; reason: string }
  | { kind: 'halt'; code: 'manual' | 'paused' | 'human-gate' | 'needs-human' | 'budget' | 'blocked-streak' | 'verify-fail-streak' | 'no-run' | 'done'; reason: string; action?: NextAction }
export function decideAutopilot(args: { snapshot: RunSnapshot | null; config: Pick<LoopConfig, 'autonomy'>; mode: Mode }): AutopilotDecision
export function consumeTurn(record: RunRecord): RunRecord          // autoTurns + 1
export function resetBudget(record: RunRecord): RunRecord          // autoTurns 0, streaks 0 (after a human gate)
export function noteBlock(record: RunRecord): RunRecord            // blockStreak + 1
export function noteGoodStep(record: RunRecord): RunRecord         // blockStreak 0
export function noteVerify(record: RunRecord, passed: boolean): RunRecord   // streak + 1 on fail, 0 on pass
export function autopilotView(args: { decision: AutopilotDecision | null; record: RunRecord | null; config: Pick<LoopConfig, 'autonomy'>; mode: Mode }): AutopilotView
```
Order of checks: no snapshot → `no-run`; mode `manual` → `manual`; `record.paused` → `paused`; all stages done/monitoring → `done`; `next.byHuman` or kind `await-human`/`release` → `human-gate`;
`!next.auto` → in `guided` suggest, in `semi` `needs-human`; `autoTurns ≥ maxAutoTurns` → `budget`; `blockStreak ≥ haltOnBlocks` → `blocked-streak`; `verifyFailStreak ≥ haltOnVerifyFails` → `verify-fail-streak`; mode `guided` → `suggest`; else `run`. Reasons are one plain sentence that names the gate/artifact.

### 4.10 `metrics.ts` (A2)
```ts
export function computeMetrics(args: { entries: LedgerEntry[]; snapshots: RunSnapshot[]; now: number }): MetricView[]
export function formatDuration(ms: number): string        // "42s", "7m", "1h 12m", "2d 3h"
```
Metrics (from `governance/leading-and-lagging-metrics.md`; compute what the ledger can):
Plan·leading **Elicitation latency** (`run.created`→first `gate.approved intent.approve`, median; target "< 2 hours": good ≤2h, warn ≤8h, else bad) ·
Plan·lagging **Intent survival** (approved ÷ (approved+rejected)) ·
Design·leading **Design compression** (intent.approve→spec.approve, median) ·
Design·lagging **Requirements rework** (`artifact.written` with `data.kind==='spec'` after `plan.accept` approved, count) ·
Build·leading **Plan-to-proof time** (plan.accept→verify.pass) ·
Build·lagging **Plan drift** (share of edited files outside the plan, from snapshots' `record.edits` vs `planFiles`; 0% good, ≤20% warn) ·
Test·leading **First-pass green rate** (`proof.pass` ÷ all proofs; target "≥ 90%") ·
Test·lagging **Failed verifications** (count `proof.fail`) ·
Deploy·leading **Gate wait** (`gate.opened`→`gate.approved`, human gates, median) ·
Deploy·lagging **Guard interceptions** (count `guard.blocked`, grouped hint "3 production-gate, 2 protect-paths") ·
Maintain·leading **Breach-to-intent latency** (`band.breach`→`incident.intent`; target "< 5 minutes") ·
All·leading **Parallel runs** (runs not fully done; target "2–3": good 1–3, warn 4–5, bad >5).
No data → `value:'n/a'`, `status:'n/a'`, `raw:null`. `hint` explains the definition in one line.

### 4.11 `prompts.ts` + `agents/*.md` (D)
```ts
export type PromptContext = {
  slug: string; title: string; date: string; stage: StageId
  paths: { intent: string; spec: string; plan: string; proof: string; review: string; claudeMd: string; reviewPolicy: string; incident: string; lesson: string; eval: string }
  policySkills: string[]; knowledgeRoot: string; verifyCommands: string[]; nitCap: number
  planFiles?: string[]; notes?: string; blockedBy?: string[]; gateFeedback?: string
}
export function buildPrompt(key: PromptKey, ctx: PromptContext, overrides?: Partial<Record<PromptKey, string>>): string
export function systemSection(a: { snapshot: RunSnapshot | null; mode: Mode; enabledPlays: number[]; paths: LoopConfig['paths'] }): string   // the contract injected into the system prompt: ≤ 30 lines
export function diagnosisPrompt(a: { reading: BandReading; spec: BandSpec | null; date: string; recentCommits?: string }): string
export function expandPlaceholders(template: string, vars: Record<string, string>): string   // {{slug}} {{title}} {{date}} {{intent_path}} …; unknown placeholders kept visible
export const PROMPT_KEYS: PromptKey[]
export const OVERRIDABLE_PLACEHOLDERS: string[]
```
Prompt content comes from `.agents/skills/ai-native-sdlc/SKILL.md` phases + the plays/stages. Every stage prompt: names the input artifacts and the **exact output path**, states the output template sections, the status vocabulary, **what the agent must not do** (never set `approved`/`accepted`; never edit files outside the stage's scope; stop at the gate and say what the human must review), the completion criteria, and — for `implement` — the Plan-sync rule, the verification block, "paste literal output", worktree/auto-mode notes, "Twice Rule". `verify` tells the agent to spawn `okf-loop:verifier` and write its **verbatim report** to the proof path; `review` spawns `okf-loop:reviewer` and writes the review file in the §5.6 format; `release` tells the agent a human has authorized and which command class is unlocked for the grant window; `fix` is the Play 08 three-step protocol; `incident` turns a diagnosis into an intent; `lesson` writes the post-mortem. Agents (`agents/verifier.md`, `reviewer.md`, `diagnoser.md`) follow `openknowledge/templates/verifier-agent.template.md` / `review-policy.template.md` / `bands.template.yaml` and emit exactly the formats `artifacts.ts` parses (§5.6). Agent front-matter: `name`, `description`, `tools` (reviewer: `Read, Grep, Glob, Bash`; verifier: `Bash, Read`; diagnoser: `Read, Grep, Bash`). Agents are REPORT ONLY.

### 4.12 `controller.ts`, `commands.ts`, `view.ts`, `register.tsx` (E)
The glue; pure where possible (`controller.ts` returns **effects as data**, `register.tsx` executes them).
```ts
// commands.ts
export type Parsed =
  | { cmd: 'open' } | { cmd: 'status' } | { cmd: 'help' } | { cmd: 'init' }
  | { cmd: 'new'; idea: string } | { cmd: 'next' } | { cmd: 'approve'; gate: GateId | null } | { cmd: 'reject'; gate: GateId | null; reason: string }
  | { cmd: 'mode'; mode: Mode } | { cmd: 'pause' } | { cmd: 'resume' } | { cmd: 'use'; slug: string }
  | { cmd: 'plays'; action: 'list' | 'enable' | 'disable'; n?: number }
  | { cmd: 'fix'; description: string } | { cmd: 'fixed' } | { cmd: 'release'; action: 'grant' | 'revoke'; minutes?: number }
  | { cmd: 'twice'; lesson: string } | { cmd: 'lesson'; title: string } | { cmd: 'bands'; action: 'check' | 'status' }
  | { cmd: 'audit' } | { cmd: 'reload' } | { cmd: 'guards' } | { cmd: 'error'; message: string }
export function parseCommand(args: string): Parsed
export const HELP_TEXT: string
```
`controller.ts` exports `reduce(model: Model, action: Action): { model: Model; effects: Effect[]; reply?: string }` where `Model` carries config, knowledge, runs+snapshots, ledger tail, guard stats, release grant, autopilot state, and `Effect` is a tagged union of: `write {path,text,overwrite}`, `ledger {entry}`, `saveRun {record}`, `saveConfig`, `setActive {slug}`, `prompt {text, key}`, `toast`, `status`, `pane {open}`, `refresh`, `grant {until}`, `spawn`, `process`. Actions: `command`, `turn.complete`, `tool.done` (edit/proof/block observed), `gate.press`, `tick` (bands), etc. E owns this contract; the point is: **decisions are pure and tested; `register.tsx` only performs I/O.**
`view.ts`: `buildView(model, now): ViewModel` (assembles §types ViewModel from derived snapshots, guard stats, metrics, setup checklist, play views with evidence).
`register.tsx`: hooks listed in §6.

### 4.13 `hooks/ui/*` (C)
```ts
// Pane.tsx
export type PaneProps = { vm: ViewModel; ui: UiState; act: UiActions; columns: number; rows: number; surface: 'terminal' | 'desktop' | 'vscode' | 'mobile' }
export function renderPane(el: PaneElements, p: PaneProps): RenderElement
// Band.tsx
export type BandProps = { vm: ViewModel; ui: UiState; act: UiActions; columns: number; surface: PaneProps['surface'] }
export function renderBand(el: PaneElements, p: BandProps): RenderElement | null    // null → the hook returns next(e)
export function statusText(vm: ViewModel): string | undefined                         // $.ui.status line
// theme.ts
glyph/colour/format helpers: stageGlyph(state), stageColor(state), tierColor, bar(progress, width), clip(text, width), pad, ago(ms), healthChip …
```
`PaneElements` = the shared subset every surface has plus optional `Input`/`Select`: `{ Box, Text, Button, Markdown, Link, Code } & { Input?: …; Select?: … }`; export it from `ui/elements.ts`. Details in §7.

## 5. Behaviour rules that cut across modules

### 5.1 Plays and customization
Plays are adopted from `LoopConfig.plays.enabled`; enabling needs every prerequisite enabled, disabling needs no enabled dependent.
A guard is *active* only if its play is enabled and it is not in `guards.disabled`. Autopilot needs plays 3 and 8 (INDEX: Play 04 depends on 03, 08): with Play 04 disabled, `semi` degrades to `guided`.

### 5.2 Human gates and who may pass them
Approvals come only from (a) a `/sdlc approve|reject|release grant` command typed by a person (`command.run` with a person origin),
(b) a Button press in the pane/band (`ui.press` is always a person), (c) the person editing the artifact in their editor (the engine then records an implicit approval in the ledger with actor `human`, by `file`).
The agent can do none of these; gate-integrity and the production-gate stop it from forging them.

### 5.3 Autopilot loop (register.tsx / controller)
`turn.complete` → refresh derived state from disk → `decideAutopilot` → on `run`: `consumeTurn`, ledger `autopilot.queued`, `$.prompt.submit({ text })` with `buildPrompt(action.promptKey)`; on `halt`: ledger `autopilot.halted` once per distinct code, toast for `human-gate` ("Spec is ready for your sign-off"), status line updated. A human gate passing → `resetBudget`, then the next decision. The agent's own turns started by autopilot count; the human's typed prompts do not. Never queue while a prior autopilot prompt is still unanswered (guard with a flag cleared at `turn.complete`).

### 5.4 Ledger discipline
Every state change appends a ledger entry via one serialized writer (read file → `appendEntry` → write). Entry kinds in `types/index.d.ts`. `gate.opened` is written once per (run, gate) when it first becomes ready and is not approved; written again after a rejection.

### 5.5 Proof tracker (Play 08)
After a `Bash` tool result: if `isProofCommand` → `record.proof.lastRunAt = now`, `lastRunPassed = !isError`, `lastCommand`, ledger `proof.pass|fail`. After an Edit/Write that is not an artifact path → `lastEditAt = now`, add to `record.edits` (repo-relative, unique, cap 200).

### 5.6 Formats that three modules must agree on
* proof: any text containing the line `### Verification Verdict: PASS` or `### Verification Verdict: FAIL`.
* review (`reviews/<slug>.review.md`):
  ```
  # Review: <title>
  ### Pass 1 — Logic & Regressions [Bugs]
  - [ ] **Important** [Bugs] path:line — what breaks and why
  - **Nit** [Bugs] path:line — …
  ### Pass 2 — Security & Privacy [Security]
  …
  ### Pass 3 — Specification & Architecture Alignment [Compliance]
  …
  Found 4 additional minor naming/formatting nits; skipping detail to prevent review fatigue.   (optional overflow line)
  ### Review Verdict: CLEAN|BLOCKED
  ```
  An unchecked `- [ ] **Important**` is open; `- [x] **Important**` is resolved. `parseReview` counts `**Nit**` bullets; the overflow line sets `nitOverflowSummarized`.
* Status line shape in artifacts: `**Status:** draft` (bold label, one space). `setArtifactStatus` must also accept `Status: draft` without bold and keep the author's style.

## 6. Hooks `register.tsx` wires (E) — names are the event names of the API

`session.start` (register `/sdlc`, load config/knowledge/runs/ledger/bands, build view, status line, start the bands timer if enabled, open pane if `ui.openPaneOnStart`),
`command.run {command:'sdlc'}`, `prompt.compose` (add `systemSection`, session scope; invalidate after state changes),
`tool.call` (guards: matchers for `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `Bash`, `Read`, `WebFetch`; each fail-closed with `.catch`; on deny: ledger `guard.blocked`, `noteBlock`, toast once per guard per minute),
tool results (proof tracker and edit tracker — `next(e)` result inspected after the call),
`turn.complete` (refresh, autopilot, bookkeeping),
`ui.render {component:'Pane', requestId: PANE_ID}` and `ui.render {component:'AbovePrompt'}`,
timers via `$.clock.every` for bands and a cheap refresh when files change under `.okf`/artifact dirs (poll every 5 s while the pane is open).
Plus `userConfig` in `plugin.json`: `mode` (picker `manual|guided|semi`), `maxAutoTurns` (number), `openPaneOnStart` (boolean).

## 7. UI specification (C builds the views; E mounts them)

Design intent: opening `/sdlc` should make the Loop *visible and operable*: where the change is, what holds it, who owes the next move, and one key to move it.

**Pane (tabs `Loop · Plays · Guards · Ledger · Setup`, hotkeys 1–5)** — one header, one body, one footer:
* **Header**: `◉ The Loop` + mode chip (`semi-auto` / `guided` / `manual`, click/`m` cycles), autopilot state chip (`▶ running 4/12`, `⏸ paused`, `■ human gate`), run picker (active run title, `‹ ›` to switch), release grant chip (`🔓 release grant 12m` / `🔒`).
* **Loop tab**: (1) the **stage ribbon**: six nodes `① Plan ─▶ ② Design ─▶ …` with state glyph and colour (`✔` done green, `●` active cyan, `◆` awaiting human yellow, `✖` blocked red, `○` pending dim, `◌` monitoring blue) and a return arc `⟲ anomaly → intent` under Stage 6; narrower than ~110 columns collapses to a vertical list. (2) the **gate card** for the current stage: each requirement as `✔/✖/☐` line, who owes it (machine/human), and Buttons `Approve` (primary, hotkey `a`) and `Reject` (`r`) when a human gate is ready, disabled-looking text otherwise. (3) the **next-action card**: label, reason, `Run next ▸` (`n`) when the agent can do it. (4) the **artifact chain**: `intent → spec → plan → proof → review → bands` each with its status chip and path. (5) **metrics row**: up to 4 `MetricView`s (status-coloured). (6) a **new run** Input (`What should change?`, Enter submits) when there is no active run or `+` pressed. (7) when bands have a non-`in-control` tier, a **breach strip** with sparkline.
* **Plays tab**: 14 plays grouped by stage in INDEX order; each row `★` for entry points, `[x]/[ ]` adoption Button, title, unmet-prerequisite hint; selecting a row shows the detail card (summary, prerequisites/dependents, `enforcedBy`, evidence checklist, link to the doc path). Dependency lines `Play 07 → Play 11 → Play 10`.
* **Guards tab**: one card per guard: label, play badge, on/off Button, hits, last blocked message (clipped), `dormant` chip when its play is off; **Production gate panel**: env token present?, grant countdown, `Grant 15m` / `Revoke`; a recent-interceptions list (last 8 `guard.blocked`).
* **Ledger tab**: filter chips (All · Gates · Guards · Proof · Autopilot · Bands) + run filter, reverse-chronological rows `HH:MM  icon  actor  summary`, `Export AUDIT.md` Button.
* **Setup tab**: checklist of scaffolds (`SetupItem`s) with `Create` Buttons and `Create all missing`; knowledge source line (`bundled snapshot` vs `repo: openknowledge/`), config issues, autonomy mode Select (`Select` where the surface has it, else Buttons), `Reload knowledge`; bands section (metrics, tier, sparkline, `Check now`).
* **Footer**: hotkey legend and `Esc closes`.
* **Responsive**: use `columns`/`rows`; clip text; never rely on a width > `columns`. No fixed-width tables wider than `columns`.
* **Surfaces**: `terminal` and `desktop` fully; `vscode` = desktop; `mobile` = read-only summary (no Input/Select). A view must validate on all four tables.

**Band above the prompt** (when a run exists or an alert is live, unless hidden/`ui.showBand` false): one line `◉ Loop ③ Build ▸ plan accepted · ▶ autopilot 3/12  [Open] [Next] [Pause] [Hide]`, turning yellow with `◆ spec.md awaits your sign-off  [Approve] [Open]`, red when blocked. Expanded (`[+]`): second line with the gate requirements. `statusText(vm)`: `Loop 3/6 Build · semi` (undefined with no run).

Toasts: gate ready for a human, guard block (rate limited), autopilot halted for a reason a human must resolve, band breach tier ≥ 2.

## 8. Tests (everyone)
Each owner ships tests for their files: happy paths **and** edge cases that matter (guards: every deny and the matching allow;
stages: every derivation branch in §4.8; SPC: textbook series; yaml: every front-matter in `openknowledge/`, since tests cannot read the
fs, embed representative strings — but `build-knowledge.ts` runs under `bun` with the real fs and A1 verifies against the real files).
Run `claude plugin test` from the mod dir and `claude plugin validate .`. Report the exact pass counts.

### How to run things (all from `/Users/matheus/rea/mods/okf-loop` unless noted)
* Only your tests: `../../scripts/test-subset.sh tests/yours.test.ts [more…]` (a plain `claude plugin test` runs *every* test file in the dir, including other agents' unfinished ones).
* Type-check: `bunx -p typescript tsc -p .` (TypeScript 7, strict). Other owners' files may be mid-edit: judge only the errors in files you own (`… | grep -E 'hooks/core/yours|tests/yours'`).
* Validate: `claude plugin validate .`
* Bun scripts (`scripts/build-knowledge.ts`): `bun scripts/build-knowledge.ts` from the repo root `/Users/matheus/rea`.
* Do not run `git` operations (the repo is not a git repository) and do not touch files you do not own.

### Cross-module contract on `ArtifactDoc` (A1 produces, A2 consumes — A2 must not import `artifacts.ts`)
`missingSections` = `REQUIRED_SECTIONS[kind]` entries absent (always `[]` for kinds without a required list).
`issues` codes: `placeholder` (warn: template placeholders such as `[Short Descriptive Title]` remain), `empty` (error: file has no body), `status-invalid` (error: unreadable/unknown Status line), `missing-section` (warn per missing section), `no-files` (warn, plan: nothing under "Files That Change"). A doc is **ready for a human** iff `exists && missingSections.length===0 && !issues.some(i => i.severity==='error' || i.code==='placeholder')` (plus `planFiles.length>0` for plans, `checklist.total>0` for specs).

## 9. Report format (end of your task)
1. Files written (paths). 2. Public API deviations from §4 (and why). 3. What you verified, with command outputs summarized (`claude plugin test` counts, validate result).
4. Known gaps/risks. 5. Requests for the lead. Keep it under 60 lines.
