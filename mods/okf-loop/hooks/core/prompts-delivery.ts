// Stage prompts for Build, Test and Deploy: implement, verify, review, release and the bug-fix protocol.

import type { PromptContext } from './prompts-kit'
import { AGENT_DEFS, DEFAULT_REVIEW_PASSES, GUARD_RULE, NEVER_APPROVE, code, doc, header, lines, list, playbook, situation, verifyBlock } from './prompts-kit'

// -- 4. implement ------------------------------------------------------------------------------

export function implement(ctx: PromptContext): string {
  const plan = ctx.paths.plan
  const files = ctx.planFiles ?? []
  return doc(
    header(
      'implement',
      ctx,
      'Execute the accepted plan in auto mode: work through the Order of Work, verify as you go, and stop only when every step is done and the verification commands pass. The plan is the contract; stay inside it.',
    ),
    situation(ctx),
    ctx.blockedBy && ctx.blockedBy.length > 0
      ? lines(
          '## Start with what is blocking',
          'Open the proof or review file named above, reproduce the failure or finding, and fix the implementation. Do not edit the proof or review files: only a fresh verification and a fresh review can supersede them, and the agent that wrote the code never clears its own findings.',
        )
      : false,
    lines(
      '## Inputs',
      list([
        `${code(plan)}: must say \`accepted\` (or \`in-progress\` when resuming). If it says \`draft\`, stop and tell the human; do not edit any source.`,
        `${code(ctx.paths.spec)} and ${code(ctx.paths.intent)}: what was asked for and decided.`,
        `${code(ctx.paths.claudeMd)}: commands, conventions, things Claude gets wrong.`,
      ]),
    ),
    lines(
      '## Plan files',
      files.length > 0
        ? lines('Files That Change, as the plan lists them. Edit only these:', list(files.map(code)))
        : `Read Files That Change from ${code(plan)} before the first edit. Edit only those files.`,
    ),
    lines(
      '## How to work',
      list([
        `First edit: set ${code(plan)} to \`**Status:** in-progress\`.`,
        'Take the Order of Work step by step. After each step run the narrowest build, test and lint check that covers it. Read the output, fix the implementation, repeat until green. This inner loop is how you finish without a human typing.',
        'Never edit, weaken, skip or delete a test to make it pass. If a test fails, fix the code. Do not touch protected paths (generated code, frozen APIs, .env, secrets); the guards refuse it.',
        'You are in auto mode inside an accepted plan: decide routine matters yourself. If this is a git worktree, keep every edit in it, and touch only this plan’s files because other sessions may be running other plans.',
        'If you commit, commit to the current feature branch only. Never push to or merge into a protected branch (main, master) and never open or approve a merge: you wrote the code, so you have no authority to release it.',
      ]),
    ),
    lines(
      '## Plan-sync rule',
      `The plan and the code never disagree. When something forces a deviation (an extra file, a different approach, a new risk), update ${code(plan)} FIRST (Files That Change, Order of Work, Risks & Mitigations), in the same change as the code that needs it, and in the same commit if you commit. A file edited outside Files That Change counts as plan drift and is reviewed in Stage 5.`,
    ),
    lines(
      '## Verification block',
      verifyBlock(ctx),
      list([
        'Run them as the last thing you do, after every source edit and after any CLAUDE.md edit. The harness trusts a passing proof run only if it came after your last edit.',
        'Paste the literal terminal output of each command into your final message. Not a summary, not "all green": the output itself.',
        'If anything fails, fix the code and run them again.',
      ]),
    ),
    lines(
      '## Status vocabulary',
      'draft | accepted | in-progress | complete',
      list([
        `Set ${code(plan)} to \`**Status:** complete\` ONLY when every step of the Order of Work is done AND the verification commands passed in this session after your last edit, with their literal output pasted. Otherwise leave it \`in-progress\` and say what remains.`,
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Twice Rule',
      `When you make the same mistake twice in this run, or the human or a review corrects you twice, add the correction as one line under "Things Claude Gets Wrong" in ${code(ctx.paths.claudeMd)} (the only edit allowed outside the plan’s files) and mention it in your final message. A human can also record one with ${code('/sdlc twice <lesson>')}.`,
    ),
    lines(
      '## Completion criteria',
      list([
        'Every Order of Work step is done and the plan matches what you built.',
        'The verification commands passed after the last edit, with literal output pasted.',
        `${code(plan)} Status is \`complete\`.`,
        'Final message: files changed, plan deviations (and the plan edit that recorded each), literal verification output, anything the human should know.',
      ]),
      'Then stop. Independent verification is the next stage; do not run it yourself.',
    ),
    GUARD_RULE,
    playbook('implement', ctx),
  )
}

// -- 5. verify ---------------------------------------------------------------------------------

export function verify(ctx: PromptContext): string {
  const proof = ctx.paths.proof
  return doc(
    header(
      'verify',
      ctx,
      'Have an independent verifier prove the work against the plan, in a fresh context with no memory of how you built it, and record its report unchanged as the proof. Self-verification happened while implementing; this is the objective check.',
    ),
    situation(ctx),
    lines(
      '## Inputs',
      list([
        `${code(ctx.paths.plan)}: Status must be \`complete\`. Its Proof of Correctness is what gets checked.`,
        verifyBlock(ctx),
      ]),
    ),
    lines(
      '## Steps',
      list([
        'If you edited anything since your last passing proof run, run the verification commands once more first. The harness accepts a proof only if a passing run came after the last edit.',
        `Spawn the verifier with the Agent tool, subagent_type ${code(AGENT_DEFS.verifier.type)}. Its prompt gives paths and commands only: the plan (${code(ctx.paths.plan)}), the spec (${code(ctx.paths.spec)}), the commands to run, and "report only, change nothing". Do not tell it what you believe works; its value is that it has no implementation bias. Wait for it to finish.`,
        `Write the verifier’s report VERBATIM to ${code(proof)}: a first line \`# Proof: ${ctx.title}\`, then the report exactly as returned. Do not summarise, soften, reorder or annotate it.`,
        'The report must contain exactly one line `### Verification Verdict: PASS` or `### Verification Verdict: FAIL`, followed by `### Commands Executed` and `### Discrepancies vs plan.md`. If that verdict line is missing, spawn the verifier again. Never write or edit a verdict yourself, and if the verifier cannot be spawned, stop and say so instead of producing a proof.',
      ]),
    ),
    lines(
      '## Do not',
      list([
        `Edit any file other than ${code(proof)}. Editing source now makes the proof stale.`,
        'Fix a failure in this stage. A FAIL is recorded as it is; the loop routes back to implementation with the proof as the reason.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        `${code(proof)} holds the verifier’s unchanged report with a verdict line.`,
        'Final message: the verdict, the commands it ran, and for a FAIL each discrepancy in one line each.',
      ]),
      'Then stop. The verification gate is checked by the harness from the proof file, not by you.',
    ),
    GUARD_RULE,
    playbook('verify', ctx),
  )
}

// -- 6. review ---------------------------------------------------------------------------------

export function review(ctx: PromptContext): string {
  const out = ctx.paths.review
  const passes = ctx.reviewPasses && ctx.reviewPasses.length > 0 ? ctx.reviewPasses : DEFAULT_REVIEW_PASSES
  const example = passes.flatMap((p, i) => [
    `### Pass ${i + 1} — ${p.title} [${p.tag}]`,
    i === 0
      ? `- [ ] **Important** [${p.tag}] path/to/file.ext:42 — what breaks and why`
      : `- **Nit** [${p.tag}] path/to/file.ext:7 — minor point`,
  ])
  return doc(
    header(
      'review',
      ctx,
      'Run the three-pass AI review of the final diff with an independent reviewer and record its findings in the review file. The agent that wrote the code does not review it, and has no authority to approve or merge it.',
    ),
    situation(ctx),
    lines(
      '## Inputs',
      list([
        `${code(ctx.paths.proof)}: the verification must have passed.`,
        `${code(ctx.paths.spec)} and ${code(ctx.paths.plan)}: what the diff must satisfy; Files That Change is the authorised scope.`,
        `${code(ctx.paths.reviewPolicy)} (if it exists) and ${code(ctx.paths.claudeMd)}: review policy and architectural invariants.`,
        `${code(out)}: if it exists it is the previous round.`,
      ]),
    ),
    lines(
      '## Steps',
      list([
        `Spawn the reviewer with the Agent tool, subagent_type ${code(AGENT_DEFS.reviewer.type)}. Its prompt gives: the run title "${ctx.title}", the spec, plan, ${code(ctx.paths.reviewPolicy)} and ${code(ctx.paths.claudeMd)} paths, the nit cap (${ctx.nitCap}), the passes (${passes.map((p, i) => `Pass ${i + 1} ${p.title} [${p.tag}]`).join('; ')}), and the review file path if a previous round exists.`,
        `Write the reviewer’s report to ${code(out)} exactly as returned.`,
        `The only edit you may make is enforcing the nit cap: keep at most ${ctx.nitCap} \`**Nit**\` bullets and replace the rest by the single overflow line. You may never delete a finding, lower an Important to a Nit, or flip a checkbox.`,
        'Check the file before you stop: the title line, one heading per pass, every finding tagged, and the verdict line all present (format below). If the format is wrong, spawn the reviewer again.',
      ]),
    ),
    lines(
      `## Required format of ${code(out)}`,
      '```markdown',
      `# Review: ${ctx.title}`,
      ...example,
      'Found 4 additional minor naming/formatting nits; skipping detail to prevent review fatigue.',
      '### Review Verdict: BLOCKED',
      '```',
      list([
        'An unchecked `- [ ] **Important**` is an open blocker; `- [x] **Important**` is one the reviewer confirms fixed since the last round.',
        `\`**Nit**\` bullets: at most ${ctx.nitCap}. Only when more nits exist, add one aggregated overflow line after the last pass with the real count of omitted nits, in exactly the wording above; no detail.`,
        'A pass without findings says `No findings.`',
        'The last line is `### Review Verdict: CLEAN` (no open Important) or `### Review Verdict: BLOCKED` (at least one).',
        'Important is reserved for findings that break behaviour, leak data or violate compliance. Naming, formatting and idiom are Nit.',
      ]),
    ),
    lines(
      '## Do not',
      list([
        `Edit any file other than ${code(out)}, and do not fix findings in this stage.`,
        'Approve, merge, push, or comment on a pull request: separation of duties. CLEAN means no open Important finding, not permission to ship.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        `${code(out)} holds the reviewer’s report with every pass and a verdict line, nits within the cap.`,
        'Final message: verdict, count of open Important findings with one line each, nit count.',
      ]),
      'Then stop. BLOCKED sends the run back to implementation by itself. CLEAN opens the release gate, which only a human can pass: tell the release manager to read the review file and the diff, then authorise with `/sdlc release grant` (or the Grant button in the /sdlc pane).',
    ),
    GUARD_RULE,
    playbook('review', ctx),
  )
}

// -- 7. release --------------------------------------------------------------------------------

export function release(ctx: PromptContext): string {
  return doc(
    header(
      'release',
      ctx,
      'A named human has authorised this release for a limited window. Within that window the production gate lets the deploy command class through; carry the release out, report exactly what ran, and stop. The agent does everything up to the gate and nothing past it, and the gate is now open only as far as the human opened it.',
    ),
    situation(ctx),
    lines(
      '## Before you run anything',
      list([
        `Confirm ${code(ctx.paths.plan)} is \`complete\`, ${code(ctx.paths.proof)} says PASS and ${code(ctx.paths.review)} says CLEAN. If any is not true, stop and tell the human; do not deploy.`,
        'The window is short (the /sdlc pane shows the countdown). Deploy first, write notes after.',
        'Prepare the release candidate: clean working tree on the reviewed branch, the verification commands pass once more, and the artifact or image is the one that was reviewed.',
        verifyBlock(ctx),
      ]),
    ),
    lines(
      '## Unlocked for this window',
      list([
        `The production deploy command class the gate watches (for example ${code('deploy ... production')}, ${code('helm ... prod')}, ${code('terraform apply ... prod')}, ${code('flyctl|wrangler deploy ... prod')}).`,
        `Run only the deploy that ${code(ctx.paths.claudeMd)} or the plan documents, once, to the environment the human authorised.`,
        'Afterwards check health with the documented status or smoke commands, and report the literal output.',
      ]),
    ),
    lines(
      '## Still forbidden, grant or no grant',
      list([
        'Destructive SQL (DROP, TRUNCATE, DELETE FROM): the guard refuses it even now. Do not attempt it.',
        'Merging or pushing to a protected branch (main, master), approving or merging a pull request. If the deploy needs a merged commit, say so and let a human merge.',
        'Reading credentials (~/.ssh, ~/.aws, .env, secrets/), setting RELEASE_APPROVAL yourself, or editing hooks, settings or the production gate.',
        'Rolling back, restarting or shifting traffic on your own. Tier 3 production actions need an explicit human instruction in the conversation.',
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## If the gate blocks you',
      'If the deploy is refused (grant expired or revoked, wrong command class), the human closed the window. Stop. Do not retry, rephrase, or look for another route; report what was refused and ask the human to grant again with `/sdlc release grant`. For every other guard, read the message, take its "Do instead" path, and never bypass it.',
    ),
    lines(
      '## Completion criteria',
      list([
        'The documented deploy ran, or you stopped with a precise reason.',
        'Final message: the exact command, its literal output, the health check and its output, the time, and draft release notes derived from the intent and spec.',
      ]),
      'Then stop. Release notes stay in your message unless the plan lists a file for them.',
    ),
    playbook('release', ctx),
  )
}

// -- 8. fix ------------------------------------------------------------------------------------

export function fix(ctx: PromptContext): string {
  return doc(
    header(
      'fix',
      ctx,
      `Fix this defect under the strict three-step bug-fix protocol: ${ctx.title}. A failing test that predates the fix and that you could not alter is the proof the defect is resolved.`,
    ),
    situation(ctx, 'Bug report'),
    lines(
      '## Step A: reproduce, and nothing else',
      list([
        `Find where tests live and how they are written (${code(ctx.paths.claudeMd)}, existing tests). Write ONE automated test that reproduces the reported failure. It asserts the correct behaviour, so it fails today.`,
        'Run it with the narrowest command. It must FAIL, and fail for the reported reason. Paste the literal failure output. A test that fails for another reason (import error, typo, wrong fixture) is not a reproduction: fix the test until it fails for the right reason. If you cannot make it fail, stop and tell the human you cannot reproduce it.',
        'Do not touch application code in this step.',
      ]),
    ),
    lines(
      '## Step B: commit the failing test',
      list([
        'Commit only the reproduction test, to the current branch and before any application change, for example `git commit -m "test: reproduce <symptom>"`. Never skip hooks, never push, never merge.',
        'Say "REPRODUCTION COMMITTED" with the commit id. From that moment test files are locked by the test-lock guard.',
      ]),
    ),
    lines(
      '## Step C: fix the implementation',
      list([
        'Change application code until the reproduction test passes.',
        'CRITICAL INVARIANT: do not edit, weaken, skip, rename or delete the reproduction test or any other test or assertion. If a test fails, fix the implementation. If you believe the test itself is wrong, STOP and give the human the evidence; do not touch it.',
        'Run the reproduction test (it must pass), then the full verification commands, and paste the literal output.',
        'Commit the fix on its own, for example `git commit -m "fix: <symptom>"`.',
      ]),
      verifyBlock(ctx),
    ),
    lines(
      '## Twice Rule',
      `If the cause is a mistake you or the team already made once, add one line under "Things Claude Gets Wrong" in ${code(ctx.paths.claudeMd)} in the same change.`,
    ),
    lines(
      '## Do not',
      list([
        'Reorder the steps. Fix first and test later is exactly what this protocol forbids.',
        `Edit outside the fix: if the plan ${code(ctx.paths.plan)} exists, stay inside its Files That Change and update it first if you must go beyond. If the plan-first guard blocks you, follow its message.`,
        NEVER_APPROVE,
      ]),
    ),
    lines(
      '## Completion criteria',
      list([
        'A reproduction test failed for the reported reason, was committed first, and passes now unchanged.',
        'The verification commands passed after the last edit, with literal output pasted.',
        'Final message: both commits, the failing output, the passing output, and the root cause in two sentences.',
      ]),
      `Then stop and tell the human the fix is ready to review; they close the protocol with ${code('/sdlc fixed')}.`,
    ),
    GUARD_RULE,
    playbook('fix', ctx),
  )
}
