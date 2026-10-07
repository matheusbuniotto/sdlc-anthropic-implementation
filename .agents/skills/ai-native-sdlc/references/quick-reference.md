# AI-Native SDLC Quick Reference Cheatsheet

## The 6 Lifecycle Artifacts
1. **Plan:** `intent.md` — Originator vision in their own words. Problem, outcome, constraints.
2. **Design:** `spec.md` — Synthesized spec guided by policy skills. Flagged dilemmas.
3. **Build:** `plan.md` — Files changed, order of work, risks, proof.
4. **Test:** `evals/*.json` & proof logs — Verification before done; tests never modified during fix.
5. **Deploy:** `REVIEW.md` & `production-gate.sh` — Three-pass review, nit cap, human gate hook.
6. **Maintain:** `bands.yaml` & `lessons/*.md` — Statistical control bands; autonomous closed loop.

## The Core Invariants
- **Plan Mode First:** Never write code before an interrogated plan is approved.
- **Bug Fix Protocol:** Write reproduction test $\rightarrow$ commit failing test $\rightarrow$ fix code without touching test.
- **Production Gate:** The agent does everything up to the production gate, and cannot pass it.
- **Twice Rule:** When Claude makes the same mistake twice, put the correction in `CLAUDE.md`.
- **Closed Loop:** $2\sigma$ breaches diagnose and write `intent.md`; $3\sigma$ breaches rollback and alert.
