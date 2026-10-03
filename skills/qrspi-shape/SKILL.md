---
name: qrspi-shape
description: "Use when a feature has settled intent and codebase facts but multiple viable implementation approaches remain."
---

# QRSPI Shape

## When to use

Use optionally after Query ↔ Research and before Spec when the solution direction is not obvious. Skip it and use `qrspi-spec` when one reasonable approach is clear; use `qrspi-query` or `qrspi-research` when intent or codebase facts are still unclear.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Resolve meaningful implementation alternatives before freezing the behavioral contract

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). Shape has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a rerun, per the Task steps below. `status`'s optional `current.step` convenience reads `approach.md`'s `## Decision` section, but never gates on it. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Explore and compare candidate implementation approaches for a settled feature. Shape is an optional, human-gated definition step: it decides how the feature should be approached, but it does not write product code, define the behavioral spec, or create an implementation plan.

The shaper uses all available pre-definition context:
- `./qrspi/<feature>/request.md` — the settled intent
- `./qrspi/<feature>/background.md` — optional human context and prior art
- `./qrspi/<feature>/queries.md` — the questions that framed research
- `./qrspi/<feature>/research.md` — codebase facts and constraints

1. Verify that fresh-context delegation is available before moving any artifact, then verify that `request.md`, `queries.md`, and `research.md` exist. If any is missing, stop and direct the caller to Init, Query, or Research. `background.md` is optional.
2. If `research.md` has a non-empty `## New Questions`, stop and return to Query before shaping; do not design around unresolved facts.
3. If `approach.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/approach-<n>.md`, where `n` is one greater than the highest `n` already present for the `approach` stem, starting at 1 (if the helper is available, `qrspi-x next-file approach --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it.
4. Read [the Shaper role](references/shaper.md) and launch a fresh-context subagent with the role, project root, feature locator, and the four listed input paths. If an approach was moved aside, also pass its exact backup path as `Prior approach`; the role reads that path to preserve the recorded decision and rationale. Do not pass a parent design summary in place of the artifacts.
5. The agent may read the codebase to validate candidate approaches, but it must write only `./qrspi/<feature>/approach.md`. Its output preserves any prior human decision unless the human explicitly requested reconsideration; changed facts that conflict with the decision are surfaced for a new human gate.

The approach artifact should make the choice reviewable:

```markdown
# QRSPI Approach: <feature>

## Context
...

## Constraints and Facts
...

## Candidate Approaches
### Option A: ...
...

## Recommendation
...

## Decision
None.

## Open Questions
...
```

## After the Agent Returns

1. Read the agent's report and inspect `approach.md` for candidate approaches, tradeoffs, and a recommendation.
2. If the comparison exposes missing facts, stop and return to Query/Research rather than guessing.
3. Stop for human review. The human may approve the recommendation, select another option, or edit `approach.md`; replace `None.` under `## Decision` with the selected approach and rationale before proceeding to Spec. The shaping pass is complete when `approach.md` is written, but the human decision is a separate gate.
4. Leave `None.` in place under `## Decision` until the human decides — any other text, including a comment, reads as a decision. `status`'s optional `current.step` convenience reads this same section to tell `shape` from `spec`, but never gates on it; the Shape gate itself stays this skill's own read of `approach.md`.

Do not write `spec.md` or plan files. If the approach is obvious, skip this step entirely and use `qrspi-spec`.
