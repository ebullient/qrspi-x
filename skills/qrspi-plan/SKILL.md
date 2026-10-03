---
name: qrspi-plan
description: "Use when turning an approved QRSPI spec into phased implementation steps."
---

# QRSPI Plan

## When to use

Use for the Plan step after Spec is approved. Use `qrspi-workflow` for orchestration or `qrspi-implement` to execute an existing plan.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Only create the implementation roadmap

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). Plan has no `qrspi-x` state or backup stem of its own; when the helper is available it's used only for recording why on a revision, per the Task steps below. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Turn the spec into a dependency-aware roadmap of small, testable steps. Ensure:

1. Each step is independently testable and names its files.
2. Each dependency names a concrete output from another phase; phase order alone is not a dependency.
3. Include test creation/updates in or as appropriate steps.
4. Risky work and rollback points are explicit.

## Plan Format

The plan is always two layers:

**`plan.md` — phase overview (short, readable in one pass):**
```
## QRSPI Plan: <feature>

## Inputs
- Spec: spec.md — SHA-256: <digest>
- Research: research.md — SHA-256: <digest>
- Selected approach: approach.md — SHA-256: <digest>, when present

| Phase | Name | Depends On | Description | Steps | Status |
|-------|------|------------|-------------|-------|--------|
| 1 | [Short name] | none | [What this phase accomplishes] | 5 | [ ] |
| 2 | [Short name] | 1 | [What this phase accomplishes] | 4 | [ ] |
| 3 | [Short name] | 1, 2 | [What this phase accomplishes] | 3 | [ ] |
```

`Depends On` contains only direct prerequisite phase IDs, or `none`. The table's phase order is the default presentation/execution order; it does not imply a dependency.

A phase id is a number, optionally followed by one lowercase letter (`1`, `2`, `2a`, `12`, `12b`). Which phase comes before which is decided entirely by row order in this table, never by comparing ids numerically — this is what makes inserting a phase possible without renumbering anything else. See **Inserting a Phase**, below.

**`plans/plan-phase-N.md` — detailed steps for each phase (one file per phase):**
```
## Phase N: [Phase Name]

### Dependencies
- Depends on: [Phase IDs, or none]
- Why: [Concrete interface, type, schema, artifact, or other output required from those phases; explain why `none` when independent]

### Step 1: [Brief description]
- [ ] Status marker
- Criteria: S1, S2 — behavior delivered or preserved
- Files: path/to/file1.ts, path/to/file2.ts
- Changes: Specific changes to make
- Tests: S1 — concrete check and expected observable result
- Recovery: What this commit establishes and how to revert or resume it safely
- Risk: [Low/Medium/High] - why

### Step 2: [Brief description]
...
```

Phase files live in `./.qrspi/<feature>/plans/`; `plan.md` stays in the workspace root. Step numbers are local to each phase file — each phase starts at Step 1. For small plans (≤5 steps total), use a single phase; `plan.md` is still the overview, `plans/plan-phase-1.md` has all steps.

## Inserting a Phase

Discovering mid-implementation that the plan is missing a piece of work — a gap the spec covers but no existing phase does — doesn't require rewriting the plan. Insert one phase between the two it belongs between, without touching anything already completed:

1. Pick an id: the earlier neighboring phase's id, plus the next unused lowercase letter. Between phase `2` and phase `3`, that's `2a`; a second insertion in the same gap is `2b`. Between `2a` and `3`, it's still `2a`'s neighbor's letter sequence — `2b` — not a new format.
2. Add one row to `plan.md`'s table, positioned between the two phases it goes between — row order is what makes it "between" them, not the id's numeric value (see Plan Format, above). Give it its own `Depends On`, same rule as any phase: name concrete prerequisite outputs, not position.
3. Write `plans/plan-phase-2a.md` the same way any phase file is written — its own Step 1, Step 2, ….
4. If a later, already-written phase actually depends on this new phase's output, update that phase's `Depends On` and `### Dependencies` section to name it. Do not touch phases that don't.
5. Leave every existing phase's id, `plan-phase-N.md` filename, and completed step markers exactly as they are. Nothing downstream needs renumbering — a loop or reviewer scoped to a range (e.g. `2..4`) picks up `2a` automatically, because ranges resolve by table row order.

This is the mechanism behind `qrspi-workflow`'s "Back to Plan" option after a FAIL. Realizing mid-implementation that the plan missed something is an ordinary outcome of doing the work, not a failure to avoid — that's exactly what this exists for.

## Planning Principles
- Size each step around one independently verifiable behavior and a recoverable commit, rather than an estimated duration. Split work that has multiple unrelated outcomes; keep code and its meaningful verification together. Supporting setup must name the criterion it enables and a concrete check of that setup.
- Map every active spec criterion to one or more steps; make intentional coverage overlap explicit. Never invent a criterion or silently omit one.
- Steps within a phase should be ordered to minimize breaking changes
- Include test updates alongside code changes
- Flag steps that might need extra attention
- Ensure each step is independently reviewable
- Phases are vertical slices: each phase ends with a thin, working, testable piece of behavior that cuts through every layer it needs (e.g. "create item end to end", then "list items end to end"), not a horizontal layer (all data layer, then all API). Layer-by-layer phases hide integration bugs until the last phase.
- Phases may be listed in a convenient default order, but only concrete prerequisites create dependencies. Independent phases remain unlinked even when they are listed consecutively.

## Process

This is the full-plan process, for a fresh plan or a ground-up revision. To add one phase to an existing plan without touching the rest, see **Inserting a Phase**, above, instead.

1. Read `./.qrspi/<feature>/spec.md`, `./.qrspi/<feature>/research.md`, and `./.qrspi/<feature>/approach.md` when Shape was run
2. If `approach.md` exists, stop unless its `## Decision` section is decided (holds something other than `None.`); the plan must not bypass the Shape decision gate.
3. Validate the spec's input provenance against current artifacts and verify approval covers this exact spec revision. Stop on stale or missing provenance/approval; use the runtime migration rule for legacy artifacts. Draft the full list of behavior-sized steps, honoring the selected approach when `approach.md` exists
4. If total steps > 5: group into phases, each with a clear name and goal; pause and present the proposed phase breakdown to the user for approval before writing files
5. Once the phase structure is approved (or steps ≤ 5), perform the dependency check for every phase:
   - Ignore the phase's position in the table and identify the concrete inputs it requires from work in another phase.
   - If another phase produces a required input, record that phase's ID in `Depends On` and name the required output in the phase's `Dependencies` section.
   - If the phase can be implemented and reviewed without output from another phase, record `none`.
   - Do not create an edge merely because a phase is listed earlier or because serial execution is more convenient.
6. Write `./.qrspi/<feature>/plan.md` with the phase overview table, then write each `./.qrspi/<feature>/plans/plan-phase-N.md`
7. Plan has no `qrspi-x` backup stem of its own — `plan.md`/`plans/plan-phase-<id>.md` are edited in place, not versioned to `backups/`. If the helper is available and this is a revision, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`. `status`'s `current.phase`/`current.planProgress` read the phase markers directly once implementation begins; nothing needs to be recorded here for that to work.
8. Present the decision summary, criterion-to-step coverage, and exact overview/phase revisions; stop for human review of the complete plan. Changing step content or inserting a phase requires reassessment of the affected plan approval while preserving completed markers.

Do not start implementation. Your job ends when all plan files are written.
