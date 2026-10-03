---
name: qrspi-spec
description: "Use when defining the behavioral delta for a QRSPI feature."
---

# QRSPI Spec

## When to use

Use for the Spec step after Query ↔ Research and, when needed, optional Shape are complete. Use `qrspi-shape` if multiple implementation approaches remain; use `qrspi-query` or `qrspi-research` if intent or codebase facts are still unclear.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Specs describe changes, not the entire system — only define the behavioral contract

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). Spec has no `qrspi-x` state of its own; when the helper is available it's used only for backup naming on a rerun and for recording why, per the Task steps below. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Using the settled request, queries, research, and the selected approach when `approach.md` exists, define exactly what changes. Cover:

1. **Behavioral Changes**: What new behaviors are being added?
2. **API Contracts**: What interfaces will change or be added?
3. **Data Changes**: What data structures or schemas will change?
4. **Integration Points**: Which existing systems, contracts, or boundaries are affected?
5. **Backwards Compatibility**: What existing behavior must be preserved?
6. **Success Criteria**: How will we verify this works correctly?
7. **Out of Scope**: What explicitly will NOT change?

## Spec Format
Create `./qrspi/<feature>/spec.md` with:
- Clear before/after descriptions for each change
- Concrete examples of inputs and outputs
- Explicit statements about what stays the same
- No implementation details (no "how", only "what")
- Testable acceptance criteria, each labeled with a stable `S<number>` ID
- `## Inputs` with the paths and SHA-256 digests of the exact request, queries, research, and selected approach used
- A revision summary naming changed and retired criteria on reruns; never recycle IDs

Example criterion: `S1 — Given an expired token, refresh returns the documented rejection and creates no session.` Keep the ID when refining this requirement; allocate a new ID for a different requirement. Preserve existing IDs before backing up the old spec. The provenance identifies the evidence informing this spec, not approval of its contents.

## Process

### Step 0 — Verify the request is settled
Before writing any spec, confirm that `request.md` captures a clear, agreed-upon intent:

1. Read `./qrspi/<feature>/request.md`.
2. Read `./qrspi/<feature>/queries.md` and `./qrspi/<feature>/research.md`.
3. If `approach.md` exists, verify that its `## Decision` section is decided (holds something other than `None.`). If not, stop and ask the human to approve or refine the approach.
4. Check `request.md` for a non-empty `## Open Questions` section — these are Questions for the User from the query cycles that haven't been answered yet. If any remain, **stop**, surface them to the human, and wait for answers; move each answered question to `## Clarifications` with its answer before continuing. Check `research.md`'s `## New Questions` too: if it is non-empty, **stop** and return to Query before writing the spec.
5. Confirm the request reads as a concrete feature intent, not as a conversational fragment or a list of still-open options. If it is too vague or contradictory to support a behavioral delta, **stop**, describe what is unclear, and wait for the human to refine `request.md`.
6. Only proceed once `request.md` is settled and any existing approach is selected. If the request is already clear and no approach artifact exists, continue without requiring Shape — this is an optional step.

### Step 1 — Define the behavioral delta
1. Using the settled `request.md`, `queries.md`, `research.md`, and selected `approach.md` when present, define the behavioral delta
2. If `spec.md` exists, retain its complete contents and move it to `./qrspi/<feature>/backups/spec-<n>.md`, where `n` is one greater than the highest `n` already present for the `spec` stem, starting at 1 (if the helper is available, `qrspi-x next-file spec --feature <feature> --project <path>` returns this path directly — same result, no need to list `backups/` and compute `n` by hand). Never rename, rotate, or overwrite an existing backup — writing one is always a pure addition. Create `backups/` only when there is something to put in it.
3. Write to `./qrspi/<feature>/spec.md`
4. If the helper is available and this is a rerun after a backward jump, note why with `qrspi-x history add --feature <feature> --project <path> --text "<why>"`.
5. Present the runtime contract's decision summary and exact spec revision, then stop for human review

Do not create implementation plans. Your job ends when spec.md is written.
