---
name: shape
description: 'Use when a feature has settled intent and codebase facts but multiple viable implementation approaches remain.'
when_to_use: 'Use optionally after Query ↔ Research and before Spec when the solution direction is not obvious. Skip it and use `qrspi-x:spec` when one reasonable approach is clear; use `qrspi-x:query` or `qrspi-x:research` when intent or codebase facts are still unclear.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Shape

## Core Philosophy
- Resolve meaningful implementation alternatives before freezing the behavioral contract

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-x:workflow`. It may also be invoked directly.

Runtime contract: read `../workflow/references/runtime.md` before dispatch. It defines the fresh-context, capability, fallback, and on-disk evidence requirements; this skill adds only Shape-specific inputs and output.

## The helper
Helper installation, recovery, and artifact-only fallback are defined by `qrspi-x:workflow`. Shape has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a rerun, per the Task steps below. `status`'s optional `current.step` convenience reads `approach.md`'s `## Decision` section, but never gates on it. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Explore and compare candidate implementation approaches for a settled feature. Shape is an optional, human-gated definition step: it decides how the feature should be approached, but it does not write product code, define the behavioral spec, or create an implementation plan.

The shaper uses all available pre-definition context:
- `./qrspi/<feature>/request.md` — the settled intent
- `./qrspi/<feature>/background.md` — optional human context and prior art
- `./qrspi/<feature>/queries.md` — the questions that framed research
- `./qrspi/<feature>/research.md` — codebase facts and constraints

1. Verify that `request.md`, `queries.md`, and `research.md` exist. If any is missing, stop and direct the caller to Init, Query, or Research. `background.md` is optional.
2. If `research.md` has a non-empty `## New Questions`, stop and return to Query before shaping; do not design around unresolved facts.
3. If `approach.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/approach-<n>.md`, where `n` is one greater than the highest `n` already present for the `approach` stem, starting at 1 (if the helper is available, `qrspi-x next-file approach --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it.
4. Before spawning, prefer the declared agent when the runtime supports named agents:
   - If `qrspi-x:shaper` is registered, spawn it directly so the runtime can apply its declared settings.
   - Otherwise, read `../../agents/shaper.md`, resolved relative to this `SKILL.md`, and spawn a general-purpose subagent with its full contents as the role instructions.
5. Pass the feature name so the agent can locate the four artifacts, noting that `background.md` may be absent. The agent may read the codebase to validate candidate approaches, but it must write only `./qrspi/<feature>/approach.md`.
6. If `approach.md` already exists, preserve its prior decision and rationale while refining the alternatives; never silently replace a recorded decision.

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

Do not write `spec.md` or plan files. If the approach is obvious, skip this step entirely and use `qrspi-x:spec`.
