---
name: review
description: 'Use when adversarially reviewing QRSPI changes against a spec.'
when_to_use: 'Use for a phase checkpoint, final review, or one-off review of a QRSPI change against its spec. Use `qrspi-x:implement` to fix findings; Review only reports them.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Review

## Core Philosophy
- Only review, never fix
- Review against the spec; the plan only sets the scope

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

Runtime contract: read `../workflow/references/runtime.md` before dispatch. It defines the fresh-context, capability, fallback, and on-disk evidence requirements; this skill adds only Review-specific inputs and output.

## The helper
Helper installation, state tracking, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. When the helper is available, get the next label from `qrspi-x next-file review`/`next-file final` (always pass the exact phase being reviewed via `--phase <N>` — `status` has no `--phase` option and silently ignores it, falling back to whatever phase it derives as currently active, which is the *next* phase to implement once the one just reviewed is complete, not the one being reviewed) and record the verdict with `qrspi-x log review --feature <feature> --project <path> --label <label>`; never compose a label by hand. If it exits 127, continue this interactive step without state tracking. Never edit any helper state manually.

## Task

1. **Resolve the scope** to an exact diff command, so neither agent has to guess. See **Reviewer Agent → Scope guidance**.
2. **Get a unique label.** 
    - If the helper is available: for a completed-phase review, run `qrspi-x next-file review --phase <N> --feature <feature> --project <path>`, with `<N>` the phase just completed (never read `status`'s `next.label` for this — see **The helper**); for a mid-phase checkpoint, add `--step <k>`; for a final review, run `qrspi-x next-file final --feature <feature> --project <path>` — take the label these return as-is, never recompute or adjust it.
    - Without the helper, use the phase name converted to a kebab-case path component; for an unphased final review use `final`. If that label already exists, append `-r2`, then `-r3`, and so on until unused.
3. **Offer optional delegated reviews** — compatible review skills such as `/code-review` or `/security-review` may run their own specialist subagents. Ask each selected skill to collate every subagent result into one complete, readable report over the exact same diff, persist it under `./qrspi/<feature>/reviews/supplemental/`, and return its path before the QRSPI reviewer is spawned. See **Running other review tools**.
4. **Ask whether to run the explainer too** — it is opt-in, and the reviewer and explainer must spawn in the same turn after any delegated reports are ready. See **Explainer Agent**.
5. **Spawn** the reviewer, plus the explainer on a clear yes, in a single turn so neither sees the other's output.

```
If registered: Spawn qrspi-x:reviewer agent for feature: <feature-name>
Otherwise: Role instructions: <contents of ../../agents/reviewer.md>; spawn a general-purpose subagent for feature: <feature-name>
Diff: <exact git diff command, or "staged">
Phase: <N, or omit>
Checkpoint step: <M for a mid-phase checkpoint, or omit when the whole phase is complete>
Label: <unique label, e.g. "phase-2", "phase-2-step-1", or "final">
Supplemental review reports: <paths to collated reports, or "none">
```

```
Only on a clear yes to the explainer:
If registered: Spawn qrspi-x:explainer agent for feature: <feature-name>
Otherwise: Role instructions: <contents of ../../agents/explainer.md>; spawn a general-purpose subagent for feature: <feature-name>
Diff / Phase / Label: identical to the reviewer's
```

Prefer the declared agents whenever the runtime supports named agents, so it can apply their declared settings. For a role that is not registered, read its bundled definition (`../../agents/reviewer.md` or `../../agents/explainer.md`), resolved relative to this `SKILL.md`, and spawn a general-purpose subagent with the file contents as its role instructions.

Then go to **After the Reviewer Returns**.

## Reviewer Agent

The reviewer reads `spec.md` as the standard it reviews against and the plan files to establish the boundaries of the review, runs the diff, and writes a verdict to `./qrspi/<feature>/reviews/<label>.md`.

Running it as a subagent keeps diff output and file reads out of the main conversation context while preserving the QRSPI-specific spec conformance check that generic code review tools lack.

### Scope guidance

First check the working tree with `git status --short --untracked-files=all`. An untracked source file outside `qrspi/` must be tracked or staged, or it escapes the diff and the reviewer fails the review on it. Tracked modifications are already in the diff and need no action. Anything under `qrspi/` is the project's business, tracked or not: the reviewer ignores it either way.

Then pick the scope:

| Scope | Diff to pass |
|-------|--------------|
| Phase checkpoint / full branch / final | `git diff $(git merge-base HEAD <default-branch>)`, where `<default-branch>` comes from `git symbolic-ref refs/remotes/origin/HEAD`, else `main` |
| Specific files | the base diff with paths appended: `git diff <base> -- path/a.ts` |
| Staged changes | `staged` |
| Explicit | the human's command, unchanged |

For a phase checkpoint also pass `Phase: N`, and `Checkpoint step: M` mid-phase — the explicit step is authoritative.

## Explainer Agent

Optional and opt-in, never a standing part of the flow. Ask: "Also generate an explanation of this change? (`qrspi-x:explainer` — a narrative walkthrough of what changed and why, independent of and isolated from the reviewer; not a verification step, just faster orientation.)" It can be offered for either final or checkpoint reviews. Wait for the answer, and spawn it only on a clear yes.

### Output

The explainer writes to `./qrspi/<feature>/explain/<label>.md`, reusing the reviewer's label so the pair is findable together. Labels must be non-empty kebab-case path components.

Treat the explainer's output as unverified narrative, not a substitute for the diff or for the reviewer's findings — if the two disagree about what the code does, that disagreement is itself worth looking at before trusting either one.

## Running other review tools

This review's contribution is narrow — it checks the diff against `spec.md` and writes the verdict artifact the workflow records — and it is not a better bug-finder than a dedicated review tool. So:

- **Offer compatible reviewers as delegated inputs.** `/code-review`, `/security-review`, a project reviewer, a linter, or a human may be useful. Run selected review skills over the exact same diff and ask each to run its normal subagents, then collate every result — including source attribution and disagreements — into one complete, readable report under `./qrspi/<feature>/reviews/supplemental/` before the QRSPI reviewer starts.
- **Give the collated reports to the QRSPI reviewer.** Pass their paths in `Supplemental review reports`; do not pass an uncollated pile of specialist replies when the delegated skill can summarize them.
- **Keep the QRSPI reviewer authoritative.** Delegated reports are advisory leads. The reviewer independently checks the code, then validates each relevant finding against the spec and scope. Accepted findings go into the normal review artifact; duplicates, rejected findings, and out-of-scope observations are recorded in `## Supplemental Reviews` only.
- **Do not require delegation in unattended loops.** `autoloop` may use a supplemental reviewer only when it has a stable non-interactive contract and report output; otherwise it keeps the existing QRSPI-only review.

## After the Reviewer Returns

1. Confirm `./qrspi/<feature>/reviews/<label>.md` exists before anything else. Do not write it yourself from the reviewer's reply: that reply is a verdict line, so the artifact would have no findings table and no Spec Conformance list — and a repair pass reads its fixes from those. Re-spawn the reviewer with the same label and diff, asking it to write the artifact.
2. Read the verdict the reviewer reports (PASS / PASS WITH CONDITIONS / FAIL).
3. If the explainer was also spawned, note that `explain/<label>.md` is available as supplementary reading — do not merge its content into the verdict or treat it as part of the review.
4. If the helper is available, run `qrspi-x log review --feature <feature> --project <path> --label <label>` and surface returned findings. The helper reads the verdict from the artifact.
5. Stop and wait for the human's decision on how to proceed:
   - **FAIL** — offer to fix and re-implement, revise the spec, or revise the plan. A finding means the code missed the spec, so fixing the code is usually the answer; revise the spec only when the finding shows the spec itself was wrong, and the plan only when the remaining steps no longer fit.
   - **PASS WITH CONDITIONS** — offer to address findings, then re-review.
   - **PASS, mid-phase checkpoint** — offer to continue with the next incomplete step in the same phase.
   - **PASS, phase complete** — offer to continue with the next phase, or Final Review if this was the last one.

Do not fix issues or create PRs automatically.

### Accepting fixes without another agent review

When the human explicitly accepts fixes without another agent review, write the next review artifact (the next label from `status`/`next-file`, or the deterministic no-helper label described above) with a `## Verdict: PASS` line and a short note of what was fixed and where. If the helper is available, then run `qrspi-x log review --feature <feature> --project <path> --label <that label>` on the human's behalf. The human's explicit approval is required; the artifact is the durable evidence, and an acceptance recorded only in helper state can be lost during recovery.
