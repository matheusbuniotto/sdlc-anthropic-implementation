# okf-loop

**Run `openknowledge/INDEX.md` instead of reading it.**
`okf-loop` is a [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that turns the
AI-Native SDLC playbook in this repository into a live, customizable, semi-autonomous loop:

```
intent.md ─▶ spec.md ─▶ plan.md ─▶ proof ─▶ REVIEW ─▶ release ─▶ bands ─┐
   ▲   Plan      Design     Build     Test     Deploy    Maintain       │
   └────────────────────── anomaly → intent.md ◀─────────────────────────┘
```

The agent works up to each human gate and **cannot pass it**. You stay above the loop: you approve intent,
sign off the spec, accept the plan and authorize the release; the agent drafts, implements, verifies and
reviews in between.

## Install

In a Claude Code terminal session:

```
/plugin install okf-loop --marketplace <owner>/<repo>
```

(answer `y` to add the marketplace, then pick the user scope), or try it from a checkout:

```
claude --plugin-dir ./mods/okf-loop
```

Requires Claude Code 2.1.287 or newer. Nothing else to install.

## Five minutes

```
/sdlc init                     # scaffold CLAUDE.md, REVIEW.md, bands.yaml, CI evals, production gate… (never overwrites)
/sdlc new add rate limiting    # starts a run and the Socratic intent interview
/sdlc                          # open the Loop pane (or press 1–5 inside it)
```

The agent interviews you, writes `intent/<run>.md`, and stops. Read it, then `a` in the pane (or
`/sdlc approve intent`). In `semi` mode the next stage's prompt is queued for you — spec, then plan —
and the loop halts at each gate until you decide. After plan acceptance the agent implements inside the
plan, a verifier subagent proves the result, a three-pass reviewer reads the diff, and the loop waits for
the one thing it never does for you: **authorizing the release** (`/sdlc release grant`).

## What you get

| Surface | What it is |
| --- | --- |
| **The Loop pane** (`/sdlc`) | Tabs **Loop · Plays · Guards · Ledger · Setup**. The stage ribbon with a state glyph per stage, the gate card with who owes each requirement (machine or human), the next-action card, the artifact chain, live metrics, and a control-band strip when Stage 6 fires. |
| **Band above the prompt** | One line: `◉ Loop ③ Build ▸ plan accepted · ▶ autopilot 3/12 [Open] [Next] [Pause]`; turns yellow when a gate waits for you and red when blocked. |
| **Status line & toasts** | `Loop 3/6 Build · semi`, and a toast when a gate is ready, a guard blocks, or a breach needs you. |
| **`/sdlc` command** | `status`, `new`, `next`, `approve`, `reject`, `mode`, `pause`, `use`, `fix`, `release`, `plays`, `guards`, `twice`, `lesson`, `bands`, `init`, `audit`, `reload` — run `/sdlc help`. |
| **Guards** | Deterministic `tool.call` hooks (Plays 03, 07, 08, 10, 11, 12): protected paths, secret leaks, plan-before-code, test lock during bug fixes, the production gate, destructive SQL, credential shield, separation of duties, and gate integrity. Every denial explains itself and what to do instead. |
| **Subagents** | `okf-loop:verifier` (report-only proof), `okf-loop:reviewer` (three passes, nit cap), `okf-loop:diagnoser` (read-only band diagnosis). |
| **Audit trail** | `.okf/ledger.jsonl` (append-only) and `/sdlc audit` → `.okf/AUDIT.md`, a chain-of-custody report per run. |

## Autonomy modes

| Mode | Behaviour |
| --- | --- |
| `manual` | Guards and the ledger only. Nothing is queued for you. |
| `guided` | The mod proposes the next step; you press **Run next** (`n`). |
| `semi` *(default)* | After each human approval the mod queues the next non-human step itself, chains verify → review, and **halts at the next human gate**, when the turn budget (`maxAutoTurns`, default 12) is spent, after 3 guard blocks or 3 failed verifications in a row, when a step makes no progress, or when you pause. |

The autopilot never passes a human gate, never grants a release, and continues only after a turn it queued
itself. Play 04 (parallel sessions) must be adopted for `semi`; otherwise the mod degrades to `guided`.

## The plays are modular

The Plays tab lists all 14 plays from the knowledge base, grouped by stage, with entry points marked ★.
Enable or drop a play (`/sdlc plays enable 9`); prerequisites are enforced — you cannot adopt Play 11
before Play 07, or drop Play 07 while Play 11 depends on it. A guard whose play is off is dormant. The play
graph, titles and templates are **parsed from the front-matter of `openknowledge/`** — a snapshot of this
repository is bundled, and if your project has its own `openknowledge/`, yours wins.

## Customize everything

Write `.okf/config.json` (partial files are fine; `/sdlc init` creates one). See
[docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) for every key and [schemas/okf-config.schema.json](schemas/okf-config.schema.json)
for editor completion. A taste:

```jsonc
{
  "autonomy": { "mode": "guided", "maxAutoTurns": 6 },
  "plays": { "enabled": [1, 2, 3, 5, 7, 8, 11] },
  "paths": { "spec": "docs/specs/{slug}.md" },
  "guards": { "protectedPaths": ["schemas/generated/**", "infra/prod/**", ".okf/**"], "grantMinutes": 10 },
  "verify": { "commands": ["make test", "make lint"] },
  "bands": { "enabled": true, "sources": [{ "metric": "ci_failure_rate", "argv": ["./scripts/ci-failure-rate.sh"],
    "parse": "number", "intervalMinutes": 60, "higherIsWorse": true, "description": "Failed CI runs on main" }] }
}
```

Stage prompts are overridable per project in `.okf/prompts/<key>.md` (`interview`, `draft-spec`, `draft-plan`,
`implement`, `verify`, `review`, `release`, `fix`, `incident`, `lesson`) with `{{placeholders}}`.

## Stage 6: control bands

Detection is deterministic — Western Electric rules over a rolling window, no model in the path. A source in
`bands.sources` is run on its interval; at **2σ** a read-only diagnoser investigates and the *harness* writes
`intent/incident-<date>-<metric>.md`, opening a new run (the loop closes); at **3σ** the mod only *proposes*
(a rehearsed runbook can be run once with `/sdlc bands runbook`, by you).

## What this does not do — read this

The guards run **inside** Claude Code and are best-effort at the tool-call level. They cannot see inside an
inline interpreter (`python -c`, `node -e`), an obfuscated shell command or a symlink trick, and an agent with an
unrestricted shell can ultimately defeat any in-process rule. Defense in depth is the playbook's own answer:
the mod's provenance check quarantines any approval that appears while the agent was working, the release grant
lives in host memory (not a file), and `/sdlc init` scaffolds the OS-sandbox and managed-settings template
(Play 12) — **use the sandbox** for anything that matters. See `docs/ARCHITECTURE.md` (failure model).

Other limits: a queued autopilot prompt is lost if a `claude -p` process exits right after the command;
two Claude sessions writing one repo's ledger at once can lose an entry; the pane has been verified through
the engine's element tables on terminal, desktop, VS Code and mobile, not on every renderer's pixels.

## Develop

```
bun scripts/build-knowledge.ts        # regenerate the bundled snapshot from openknowledge/ (repo root)
cd mods/okf-loop
claude plugin validate .
claude plugin test .
bunx -p typescript tsc -p .
```

Layout: `hooks/register.tsx` is the only file that touches `$`; `hooks/core` is pure decisions;
`hooks/ui` is pure views. Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before changing anything and
[docs/SPEC.md](docs/SPEC.md) for the contract. MIT licensed — see `../../LICENSE`.
