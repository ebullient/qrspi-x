# Workspace model

The helper operates on `./.qrspi/<feature>/` under the project root. Workflow artifacts are disposable scaffolding. Product code remains outside `.qrspi/` and is the source of truth.

## Files and directories

The normal artifact flow is:

`request.md` → `queries.md` → `research.md` → optional `approach.md` → `spec.md` → `plan.md` → `plans/plan-phase-<id>.md` → `reviews/<label>.md`

The helper also uses:

- `backups/` for numbered replacements of query, research, approach, and spec artifacts (`<type>-1.md`, `<type>-2.md`, …).
- `decisions.md` for human rationale, appended as Markdown bullets.
- `history.jsonl` for timestamped events and notes.
- `loop-state.json` while an unattended run is active. It is removed when that run is abandoned or reaches the end of its selected scope.

The helper does not infer meaning from arbitrary extra files under `.qrspi/<feature>/`.

## Progress detection

Outside a parked feature, the current step is derived from artifact presence:

1. no `plan.md` but `spec.md` exists → planning;
2. no `spec.md` but a decided `approach.md` exists → specification;
3. an undecided `approach.md` exists → shaping;
4. `research.md` or `queries.md` exists → research;
5. otherwise → query.

Once `plan.md` exists, the helper reports implementation until every plan-table row is `[x]`; only then is the workspace done. A feature is parked when the latest non-note history event is `park`.

The `## Decision` body in `approach.md` is undecided only when it is missing, blank, or exactly `None.`. Other non-blank content counts as decided.

## Plan and phase files

`plan.md` is a Markdown table. The `Depends On` column, not row order alone, defines the phase graph. A phase is satisfied only when all of its dependencies are complete. Scope selection expands dependencies, removes already complete phases, detects cycles, and returns dependencies before dependents.

Phase files are `plans/plan-phase-<id>.md`. Their step markers are parsed from headings of the form `### Step N` followed, optionally after blank lines, by `- [ ]`, `- [~]`, `- [x]`, or `- [!]`. A phase is complete only when it has at least one step and every marker is `[x]`. The plan-table row is a separate completion fact: advancing an unattended run is gated on that row being `[x]`.

## Generated labels

Do not invent artifact labels. Ask the workspace for the next path/label so finished artifacts are never overwritten.

- Query, research, approach, and spec replacements use `backups/<type>-N.md`.
- Phase reviews use `reviews/phase-<id>.md`, then `-r1`, `-r2`, and so on. Step-scoped reviews include `-step-<N>` before the rerun suffix.
- Final reviews use `reviews/final.md`, then `final-r1`, `final-r2`, and so on.

Review-file existence means a review was launched; it does not mean the review has finished. A pending review is recognized by the exact `## Verdict: PENDING` line.
