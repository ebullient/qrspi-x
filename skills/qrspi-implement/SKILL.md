---
name: qrspi-implement
description: "Use when executing or resuming a QRSPI implementation plan."
---

# QRSPI Implement

## When to use

Use for the Implement step of a QRSPI workflow or to resume an interrupted implementation. Use `qrspi-autoloop` only when the human explicitly chooses unattended execution.

Read [the runtime contract](references/runtime.md) before running this step. Skill names such as `qrspi-query` identify portable skills; in Codex, invoke them as `$qrspi-query`.

## Core Philosophy
- Execute the plan, don't deviate

This skill is part of the QRSPI workflow and is normally invoked by `qrspi-workflow`. It may also be invoked directly.

## The helper
Helper installation, recovery, and artifact-only fallback are defined in [the runtime contract](references/runtime.md). When the helper is available, run `qrspi-x start implement --feature <feature> --project <path> --phase <id>` to begin or resume a phase, `qrspi-x log implement --feature <feature> --project <path> --phase <id>` when a phase completes, and `qrspi-x decision add --feature <feature> --project <path> --text "<decision>"` for durable decisions (see Process). `qrspi-x` has no commit-mode concept — how many commits a phase produces is entirely this skill's own choice, made with plain git, never something the helper tracks or is told about. If it exits 127, continue this interactive step without it. Never edit any helper state manually.

## Task
Execute `./qrspi/<feature>/plans/plan-phase-N.md` in order. For each step:

1. Read the step.
2. Make only its specified changes.
3. Run its verification.
4. Mark progress.
5. Pause where the execution mode requires.

## Implementation Principles
- Follow the plan exactly - don't add "improvements"
- Make one commit per step by default. If the human asks for one commit covering the whole phase instead, stage each step's changes without committing and make a single commit at the end (see Process, step 6) — never `commit --amend`; it isn't reliably available, and a commit made once at the end needs no revising anyway.
- Run the verification specified for each step.
- If a step fails, stop and report the issue
- If you discover the plan is wrong, stop and explain why

## Execution Modes
The mode sets both the range of steps and where to pause for human approval:
- Single step: only step N within the current phase — pause after the step
- Partial execution: steps N through M within the current phase — pause after each step
- Phase execution: all steps within a specified phase — pause at the end of the phase
- Full execution: all phases, all steps — pause at each phase boundary

In every mode, stop immediately and wait for the human when a step fails, a blocker appears, or a step can't be done as written. If no mode was specified, use single step.

## Changing the Plan
Do not modify, skip, reorder, or trim a step on your own. If a step can't be done as written, stop, explain why, and propose the change. Only after the human approves: update the phase file; in helper-assisted mode, also run `qrspi-x decision add --text "<decision>"` (see Process). In interactive-only mode, report the decision to the human without editing any helper state.

## Progress Tracking
Mark steps in the active phase file (`plans/plan-phase-N.md`):
- `[ ]` - Not started
- `[~]` - In progress
- `[x]` - Complete
- `[!]` - Blocked or failed

Mark phases in `plan.md` the same way. A phase is complete when all its steps are `[x]`.

## Process
When the helper is available, run `qrspi-x status`/`start`/`log`/`decision` as each step below calls for; otherwise continue this interactive step from the plan and phase-file markers without state tracking.

1. Read `./qrspi/<feature>/plan.md` to understand the phase overview
2. Orient yourself:
    - If the helper is available, run `status --feature <feature> --project <path>` to orient. `current.phase`/`current.planProgress` show the active phase and which steps the markers say are done, when a phase is in progress.
    - Without the helper, or when no phase is yet in progress, determine the phase from the plan and markers and confirm it with the human.
3. Start the phase:
    - If the helper is available, run `start implement --phase <id> --feature <feature> --project <path>`. The same command starts a fresh phase and confirms the active one on a repeat call; it already checks for a dirty tree and an incomplete dependency — surface any findings it returns before continuing, and skip the manual check below, since this call already did it.
    - Without the helper, inspect `git status --short --untracked-files=all` and stop for unexpected changes before proceeding.
4. Load `./qrspi/<feature>/plans/plan-phase-<id>.md`; start from the first `[ ]` or `[~]` step. A `[~]` step was interrupted mid-execution by a previous run — inspect the working tree and the git log to determine what actually landed before continuing it, rather than redoing it from scratch.
5. For each step, in order:
   - Mark as in progress `[~]` in the phase file
   - Implement the changes
   - Run verification. If it fails, or the step is blocked, follow Error Handling; do not commit (or, in one-commit-for-the-phase mode, stage) a half-finished step.
   - Stage and commit the step's changes, unless the human asked for one commit covering the whole phase instead — then stage without committing; the single commit happens once, after the last step, in step 7 below.
   - Mark as complete `[x]` in the phase file. By default, commit first, so a step marked `[x]` is always committed. In one-commit-for-the-phase mode, mark `[x]` once the step's changes are staged — the resume evidence for that step is the staged diff, not a commit, until the phase's single commit lands.
   - Decisions: When the helper is available, run `qrspi-x decision add --text "<decision>"` to create a record of the decision, otherwise, report it to the human.
   - Report the result
6. Pause where the execution mode requires.
7. When all steps in a phase are `[x]`, mark the phase `[x]` in `plan.md`. In one-commit-for-the-phase mode, make that single commit now, covering everything staged since the phase started, naming the phase. Ensure all implementation changes are tracked or committed. If the helper is available, run `qrspi-x log implement --phase <id> --feature <feature> --project <path>`.
8. Offer a checkpoint review. On yes, hand off to `qrspi-review` — it owns getting the label and resolving scope, with or without the helper.

## Error Handling
If a step fails:
1. Mark it as blocked `[!]` in the phase file (`plans/plan-phase-N.md`)
2. Leave the step `[!]` and report the reason; interactive implementation does not write loop blockers.
3. Explain what went wrong
4. Suggest whether to fix the plan or adjust the implementation
5. Wait for the human decision.

Your job is to faithfully execute the plan, not to improve it during implementation.
