---
name: qrspi-workflow
description: "Use when starting or resuming a feature through the full QRSPI workflow."
---

# QRSPI Workflow Orchestrator

## When to use

Use for `$qrspi-workflow <feature-name>`. For one step, such as a standalone review, use that step's skill directly.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Overview

Guides the human through the complete QRSPI (Init, Query, Research, optional Shape, Spec, Plan, Implement, Review) workflow for feature development. Handles human gates between steps and supports iterative Query ↔ Research cycles.

## Core Philosophy

These apply to all QRSPI skills:
- **Code is the source of truth** — QRSPI artifacts are disposable scaffolding
- **Humans gate every transition** — present the artifact at each gate and continue only with human authorization covering that transition. An explicit authorization already given for the same reviewed artifact and scope satisfies the gate; do not request it again. Approval of a broad task does not silently approve an unseen stage result. The granularity varies: `qrspi-workflow` gates every step, `qrspi-autoloop` gates at the phase or the whole plan. The gate itself does not move — nothing is integrated without a human reviewing it.
- **Single responsibility** — each step does one job and nothing from the steps around it

## The helper

The helper is recommended for interactive work and required for `autoloop`. Use the local helper build while the `@ebullient/qrspi-x` npm package is unpublished; see the runtime contract. After publication, the global package is also an option. Choose the Helper-assisted or Interactive-only workflow below; never read or edit `loop-state.json` or `history.jsonl` directly.

## Workflow Phases

### Optional Pre-Discovery: Explore
Use `qrspi-explore` when the human doesn't yet know what to build — e.g. surveying what a reference framework provides that isn't yet adapted here. Produces `./.qrspi/explore/<exploration-name>/explore.md`: observations, gaps, and candidate directions. Not tied to a specific feature, not part of the phase progression below, and has no `qrspi-x` state of its own — when a direction is chosen, start the normal flow with `qrspi-init` for that feature. Skip this entirely when the feature is already clear.

### Discovery Phase (Iterative)
0. **Init** - Capture feature intent (`qrspi-init`)
1. **Query** - Surface critical questions (`qrspi-query`)
2. **Research** - Gather facts from codebase (`qrspi-research`)
   - **Cycle back to `qrspi-query`** if research surfaces new questions
   - Repeat until discovery is complete

### Definition Phase (Shape optional)
3. **Shape** *(optional)* - Compare implementation approaches (`qrspi-shape`)
4. **Spec** - Define behavioral delta (`qrspi-spec`)
5. **Plan** - Break into atomic steps (`qrspi-plan`)

### Execution Phase (Linear with Checkpoints)
6. **Implement** - Execute plan steps (`qrspi-implement`)
7. **Review** - Adversarial code review (`qrspi-review`)
   - Can run checkpoint reviews during implementation
   - Final review before completion

### Alternate Execution: Autoloop

When the spec and plan are trusted, `qrspi-autoloop` can automate the Execution Phase for one plan phase or all remaining phases. It runs implement → review unattended, allows one repair after a failed review, and stops on anything unresolved. It gates at a coarser granularity than this workflow — the phase, or the whole plan, rather than every step. The human still approves the scope going in and reviews the result before anything is integrated. Offer it after Plan, and let the human choose it based on how much work they want to accumulate behind one gate: a short, straightforward plan is faster to review in one pass than in six. Use it only when the human chooses it.

## Usage

```text
# Start new workflow
$qrspi-workflow <feature-name>

# Resume existing workflow
$qrspi-workflow <feature-name>

# Jump to specific step
$qrspi-workflow <feature-name> --step research
```

`--step <name>` runs that step next instead of the reported or artifact-derived position. Check that step's input artifacts first. A backward jump is a normal rerun of the target step — Discovery/Definition steps have no helper state to update, only their own artifacts and backups (`next-file`). Shape is skipped when `approach.md` is absent; when it exists, its `## Decision` section is the gate.

## Helper-assisted workflow

When `qrspi-x` is available, run `status --feature <feature> --project <path>` to read position and the next action, and call whichever step-owning command (`start`/`log`/`decision`/`history`) the current step calls for. `qrspi-x` describes its own commands, flags, and output shape — `--help`, `--help <command>`, `--help <command> <action>` — so this skill does not restate them; treat `--help` as the source for exact invocations if something is ambiguous.

If `status` reports a `loop` in progress, hand the run to `qrspi-autoloop` to resume — autoloop drives its own loop state end to end; this skill does not need to know how.

Never read or edit `loop-state.json` or `history.jsonl` by hand.

Staleness flows forward: changes to `request.md`, `queries.md`, or `research.md` invalidate `approach.md`, `spec.md`, plan files, and implementation progress; changes to `approach.md` invalidate `spec.md`, plan files, and implementation progress. Existing files do not prove freshness. Run the affected steps forward before using a downstream artifact. A skill may replace its own current artifact in place; Query, Research, Shape, and Spec each back up their previous artifact to `backups/`, and in every case the newest artifact is the authoritative one. Writing a backup does not make anything stale — the rerun that produced it is what drives staleness, and backups are historical only, except the explicit `Prior approach` input used by Shape to preserve a human decision.

Implementation verification reports under `verification/` are implementation evidence for the caller and human; they are not Research inputs or reviewer test claims.

A human may leave other files under `./.qrspi/<feature>/` beyond the ones this workflow writes — notes, reference material, an optional `background.md`. These are not general automatic inputs. Shape explicitly reads `background.md` when present; Query and Research never read it. If the human points a compatible step at another artifact, use it only within that role's input contract. To add context to intent, route it through Init; do not silently widen Query or Research inputs.

## Interactive-only workflow

When `qrspi-x` is unavailable, continue with human-gated execution:

- Use the artifacts, plan overview, and phase-file markers to determine progress.
- Keep navigation in the conversation and confirm each transition with the human.
- Use the direct-review rules for review scope and deterministic labels.
- There is no recovery, durable history, autoloop, or helper-derived diff scope.
- No `qrspi-x` state exists in this mode; there is nothing to create or edit by hand.

## Orchestrator Behavior

### Revision checks and decision summaries

Before dispatching any downstream step or resuming in either mode, validate the required upstream Spec/Plan provenance when those artifacts exist and recover approval evidence for their exact revisions under the runtime contract. A helper position, completed marker, or old PASS does not establish freshness. Stop and route stale inputs to their owning stage; preserve completed progress while the human assesses what needs rework. Check review snapshot freshness before declaring completion or offering to proceed from its verdict.

At every gate, precede the navigation options below with the runtime decision summary and full artifact link. Include criterion IDs and exact revisions at Spec, Plan, implementation and Review gates. At early discovery gates, use the same summary without inventing acceptance IDs or test results. For autoloop entry, summarize the resolved phases, their behavioral outcomes, risks, verification and approved revisions.

### At Each Step
1. In helper-assisted mode, run `status` to read the position; in interactive-only mode, determine the next step from the workflow artifacts (or invoke `qrspi-init` if the workspace is new).
2. Announce and invoke the current step skill.
3. Wait for human review of its artifact.
4. Present the next-step options. In helper-assisted mode, update navigation through the helper; in interactive-only mode, keep navigation in the conversation. Do not duplicate the completion or history entry written by the skill.

### After Init Step
**Prompt:** "Feature intent captured in `./.qrspi/<feature>/request.md`. Next steps:
1. **Query** - Generate questions from this intent
2. **Refine Request** - Edit request.md before continuing
3. **Cancel** - Stop workflow"

### After Query Step
**Prompt:** "Queries generated in `./.qrspi/<feature>/queries.md`. Next steps:
1. **Research** - Gather facts to answer these questions
2. **Regenerate Queries** - Rerun Query while preserving still-relevant questions
3. **Cancel** - Stop workflow"

### After Research Step
**Prompt:** "Research complete in `./.qrspi/<feature>/research.md`. Next steps:
1. **Query Again** - Research surfaced new questions (iterations: N) — show only when `## New Questions` is non-empty; runs `qrspi-query` in refinement mode
2. **Shape** - Compare implementation approaches when the direction is not obvious — show only when `## New Questions` is empty.
3. **Spec** - Proceed directly to define the behavioral delta when the approach is obvious, or after an approved `approach.md`. If choosing Spec directly, helper-assisted mode notes that Shape was skipped with `history add --text "<why>"` — a fact about what happened, not a design decision (`decision add` is for the standing rationale behind a choice, e.g. "we'll never use Shape for features under N files" — see `qrspi-workflow`'s helper-assisted section). Interactive-only mode states the reason to the human.
4. **Refine Research** - Modify research.md
5. **Cancel** - Stop workflow"

### After Shape Step
**Prompt:** "Approach options are in `./.qrspi/<feature>/approach.md`. When the human selects an option, replace the `None.` placeholder under `## Decision` with the option and rationale before offering Spec. Then choose:
1. **Spec** - Define the behavioral delta using the selected approach
2. **Back to Query/Research** - Resolve an evidence gap exposed by shaping
3. **Refine Shape** - Recompare the approaches
4. **Cancel** - Stop workflow"

### After Spec Step
**Prompt:** "Spec complete in `./.qrspi/<feature>/spec.md`. Next steps:
1. **Plan** - Break into implementation steps
2. **Back to Shape** - Reconsider the implementation approach
3. **Back to Query/Research** - Need more codebase facts (regenerate questions while preserving prior ones, then research them)
4. **Refine Spec** - Modify spec.md
5. **Cancel** - Stop workflow"

### After Plan Step
**Prompt:** "Plan complete. Show the phase overview from `plan.md`. Next steps:
1. **Implement All** - Execute all phases in order
2. **Implement Phase N** - Execute a specific phase
3. **Autoloop** - Run implement → review unattended for one phase or all phases, gated only at entry and before the final review (`qrspi-autoloop`)
4. **Refine Plan** - Modify plan files
5. **Cancel** - Stop workflow"

### During Implementation (within a phase)
**Prompt after each step:** "Step N of phase M complete. Next steps:
1. **Continue** - Next step in this phase
2. **Checkpoint Review** - Review changes so far
3. **Stop** - Pause implementation"

### After Phase Completion
**Prompt:** "Phase M complete. Next steps:
1. **Phase Review** - Checkpoint review of phase M before continuing
2. **Continue to Phase M+1** - Start next phase immediately
3. **Stop** - Pause implementation"

### After All Phases Complete
**Prompt:** "All phases complete. Next steps:
1. **Final Review** - Full adversarial review of the branch
2. **Back to Plan** - Adjust plan and resume. A gap found this late is often one missing phase, not a rewrite — see `qrspi-plan`'s Inserting a Phase.
3. **Stop** - Pause workflow"

### After Checkpoint Review
**Prompt based on verdict:**
- **PASS, phase still in progress**: "Checkpoint review passed. Continue with the next step in phase M?"
- **PASS, phase complete**: "Checkpoint review passed. Continue to the next phase (or Final Review if this was the last phase)?"
- **PASS WITH CONDITIONS** / **FAIL**: same options as After Final Review, then return to implementation of the current phase

### After Final Review
**Prompt based on verdict:**
- **PASS**: "Review PASSED. Workflow complete. In helper-assisted mode, stop tracking this feature as active? In interactive-only mode, report completion?" On yes, if the helper is available, run `log park` — this marks the feature inactive for browsing, not a claim that it's finished forever, and nothing later refuses to proceed because of it. `./.qrspi/<feature>/` is left as-is either way; cleaning it up is the human's call, not the workflow's.
- **PASS WITH CONDITIONS**: "Review passed with conditions. Address findings then re-review?"
- **FAIL**: "Review FAILED. Options: 1) Fix and re-implement 2) Revise plan (often just inserting one phase — see `qrspi-plan`'s Inserting a Phase) 3) Revise spec"

## Key Features

1. **Iterative Discovery** - Query ↔ Research cycles are expected and tracked
2. **Human Gates** - Every transition requires explicit approval
3. **Resumable in helper-assisted mode** - Can pause and resume at any step
4. **State Persistence in helper-assisted mode** - Tracks history and current position
5. **Flexible Navigation** - Can jump back to earlier phases if needed
6. **Optional Shaping** - Compare implementation approaches only when the direction is not obvious
7. **Checkpoint Reviews** - Support incremental reviews during implementation

## Helper-driven workflow

1. Check whether `./.qrspi/<feature>/` exists
2. If it does not exist: invoke `qrspi-init`; that skill writes `request.md`. There is no helper call for Init — Discovery/Definition steps (Init, Query, Research, Shape, Spec, Plan) have no `qrspi-x` state of their own; the helper's only involvement there is `next-file` for backup naming.
3. If it exists, ensure that `request.md` captures the feature intent. If `request.md` is missing, route back through `qrspi-init` to capture it and stop. If it exists, this is a resume — go to the resume path below.

When resuming:

1. Run `status --feature <feature> --project <path>` and surface any findings. `current.step` (a convenience, never required) reports which Discovery/Definition/Implement step the feature is currently at, derived from artifact presence — read the artifacts for that step directly.
2. If `approach.md` exists and its `## Decision` section is undecided (blank or literally `None.`), remain at the human Shape gate and do not dispatch `qrspi-spec` — this is this skill's own read of `approach.md`, not a `status` finding.
3. During implementation, use `current.phase`/`current.planProgress`; do not infer the next phase or step from the files when `status` provides it.
4. If `status` reports a `loop` in progress, hand the run to `qrspi-autoloop` to resume.
5. Summarize the position, findings, and next action reported by `status`.
6. Offer to continue from `next.label`/`next.action` or jump to another phase.

After every step transition, the owning skill calls the helper before presenting options to the user.

## Interactive-only workflow

1. Check whether `./.qrspi/<feature>/` exists
2. If it does not exist: invoke `qrspi-init`; that skill writes `request.md` and continues without state tracking.
3. If it exists, ensure that `request.md` captures the feature intent. If `request.md` is missing, route back through `qrspi-init` to capture it and stop. If it exists, this is a resume — determine the next step from the artifacts and plan markers.

After Init completes, present the After Init Step prompt and wait for the human's choice.

When resuming:

1. Read the artifacts in workflow order: `request.md`, `queries.md`, `research.md`, optional `approach.md`, `spec.md`, `plan.md`, and the phase files.
2. If an earlier required artifact is missing, resume at the skill that creates it. If `research.md` has a non-empty `## New Questions`, resume at `qrspi-query`.
3. If `approach.md` exists, inspect its `## Decision` section. If it is undecided, stop at the human Shape gate; do not dispatch `qrspi-spec`.
4. If implementation has begun, read the plan table and phase-file markers. Select the first incomplete phase whose dependencies are complete, then the first incomplete step in that phase. Stop on an ambiguous or `[!]` marker and ask the human.
5. For a review, inspect the relevant plan and diff scope, then use the direct-review label rules; do not infer helper labels or phase diff commands.
6. Summarize the artifacts examined, the proposed next step, and any ambiguity. Ask the human to confirm before continuing.

After every step transition, the step's artifact and the human's choice are the progress record.

## Completion

After a final review PASS, helper-assisted mode may offer to stop tracking the feature as active with `log park` (see **Helper-assisted workflow**). Interactive-only mode reports completion without state tracking. The workflow does not clean up `./.qrspi/<feature>/` itself, before or after parking — disposing of any artifact there, including the generated ones, is the human's call.
