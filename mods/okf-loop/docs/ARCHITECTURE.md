# Architecture

`okf-loop` turns `openknowledge/INDEX.md` into a running system. This page explains how it
is put together and, more importantly, *why*, so you can change it with confidence.

## The one rule that shapes everything

The Claude Code mod engine reads a module's source to list what it calls, and it **will not
follow `$` across an `import`**. So the mod is split along the only seam the engine allows:

```
hooks/register.tsx      the ONLY file that touches `$` (files, prompts, panes, timers, tools)
hooks/core/*.ts         pure decisions: data in → data out. No `$`, no I/O, time is a parameter
hooks/ui/*.tsx          pure views: (element table, view model, callbacks) → tree
```

Everything decidable is therefore a pure function with unit tests; `register.tsx` only
*performs* the effects the core asks for. A reload of the module loses nothing that matters,
because truth lives on disk.

## Truth lives in the repo

```
intent/<slug>.md  →  specs/<slug>.spec.md  →  plans/<slug>.plan.md  →  proofs/<slug>.proof.md
                                                         →  reviews/<slug>.review.md  →  bands.yaml
.okf/config.json   customization           .okf/ledger.jsonl   append-only audit trail
.okf/runs/*.json   facts artifacts can't hold (proof timestamps, fix mode, autopilot budget)
```

A stage's state is **derived** from those files — the artifact exists, its sections are
complete, its `Status:` line says `approved` — exactly the playbook's "the committed artifact
is the single source of truth". The mod never keeps a private idea of where a change is.
Because of that, a human can move a gate by editing a file in their editor, a teammate can
`git pull` a run into the pane, and the audit trail is `git log` plus the ledger.

## Data flow

```
 disk ──read──▶ DiskState ──ingest──▶ Model ──buildView──▶ ViewModel ──▶ pane / band / status
                                        ▲                                   │ (UiActions)
                                        │                                   ▼
 tool.call · turn.complete · command · press ──▶ reduce(model, action) ──▶ effects ──▶ register.tsx runs them
```

* **`stages.ts`** derives a `RunSnapshot` from artifacts + the run record: per-stage state,
  gate reports (each requirement tagged machine/human), the next action, health, progress.
* **`autopilot.ts`** decides, from that snapshot and the config, whether to run, suggest or
  halt. It never decides to pass a human gate.
* **`guards.ts`** classifies a tool call (`Edit`, `Write`, `Bash`, …) as allow/deny with a
  self-explaining message. It is the Play 07/08/11 hooks ported to pure TypeScript.
* **`ledger.ts` / `metrics.ts`** turn every state change into audit entries and the playbook's
  leading/lagging indicators.
* **`spc.ts` / `bands.ts`** are Stage 6: deterministic Western Electric control bands; no model
  is ever in the detection path.
* **`knowledge.ts`** parses the plays and templates out of `openknowledge/` front-matter. A
  snapshot generated from this repo is bundled; if the project has its own `openknowledge/`, that
  wins. That is what makes the mod *run INDEX.md* rather than hard-code it.

## Where humans stay above the loop

| Mechanism | What it guarantees |
| --- | --- |
| Human gates (`intent.approve`, `spec.approve`, `plan.accept`, `release.approve`) | The autopilot halts there. Only a command typed by a person, a button press, or a file edit by a person passes them. |
| Gate-integrity guard | The agent cannot write `Status: approved` / `accepted` into an artifact, or anything into `.okf/`. |
| Production gate + release grant | Deploy commands need `RELEASE_APPROVAL` in the process environment or a time-boxed grant a person pressed. The grant lives in host memory (`$.state`), not in a file. |
| Separation of duties | The agent never merges or pushes to a protected branch. |
| Autopilot budget | `maxAutoTurns` between human gates; halts on block streaks and verification-failure streaks. |
| Control-band tiers | 2σ → read-only diagnosis, the harness (not the agent) writes the incident intent; 3σ → a proposal a person approves. |

## Failure model

* A guard that throws fails **closed** (`.catch` answers `deny`).
* A view the engine refuses falls back to the engine's own drawing; every view is tested against
  the terminal, desktop, vscode and mobile element tables.
* Corrupt ledger lines, malformed config keys, missing knowledge files: ignored with an issue
  message in the Setup tab, never a crash.

## Extending it

* New guard: add a `GuardId` in `types/index.d.ts`, a `GuardDef` in `constants.ts`, a branch in
  `guards.ts` with its allow/deny tests.
* New stage prompt: add a `PromptKey` and a template in `prompts.ts`; override per project in
  `.okf/prompts/<key>.md` without touching code.
* New play behaviour: add its capability list to `PLAY_ENFORCEMENT` so the Plays tab shows it.
* Rebuild the bundled knowledge after editing `openknowledge/`: `bun scripts/build-knowledge.ts`.
