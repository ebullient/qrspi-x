---
name: workflow
description: 'Use when starting or resuming a feature through the full QRSPI workflow.'
when_to_use: 'Use for `/qrspi-x:workflow <feature-name>`. For one step, such as a standalone review, use that step''s skill directly.'
disable-model-invocation: false
compatibility: Node 22+
---

# QRSPI Workflow Orchestrator

Guides the complete QRSPI workflow and stops for human approval between steps. Use a step skill directly for a one-off operation; use `qrspi-x:autoloop` only when the human explicitly chooses unattended execution.

## Core Philosophy

Code is the source of truth, and humans gate every transition. The workflow may automate navigation, never approval.

The canonical runtime contract is [references/runtime.md](references/runtime.md). Read it for role capabilities, isolation, fallback, and evidence requirements; keep orchestration rules here.

## Quick contract

1. Resolve the feature workspace and the next step.
2. Invoke exactly that step's skill with its named inputs.
3. Wait for its artifact, result, or review verdict.
4. Record the transition through the helper when available.
5. Stop and present choices to the human before continuing.

Other files under `./qrspi/<feature>/` are not automatic inputs; read one only when the human explicitly names it for the current step.
Never read or edit `loop-state.json` or `history.jsonl` by hand. QRSPI artifacts are disposable; product code and on-disk outputs are the source of truth.

## Phase map

| Phase | Skill | Purpose |
|---|---|---|
| Explore (optional) | `qrspi-x:explore` | Survey before intent exists. |
| Init | `qrspi-x:init` | Capture feature intent. |
| Query ⇄ Research | `qrspi-x:query` ⇄ `qrspi-x:research` | Ask questions, then gather codebase facts. |
| Shape (optional) | `qrspi-x:shape` | Compare approaches when direction is unclear. |
| Spec → Plan | `qrspi-x:spec` → `qrspi-x:plan` | Define behavior, then create phases. |
| Implement → Review | `qrspi-x:implement` → `qrspi-x:review` | Execute approved work, then check it against the spec. |
| Autoloop | `qrspi-x:autoloop` | Run Implement → Review unattended for a chosen scope; it never replaces final review. |

## Helper status and resume

If `./qrspi/<feature>/` is missing, invoke `qrspi-x:init`. If it exists but `request.md` is missing, route to Init and stop.

With the helper, run:

```bash
qrspi-x status --feature <feature> --project <path>
```

Surface findings and follow the reported `next` action. During implementation, trust `current.phase` and `current.planProgress`; use the phase skill named above for `start`, `log`, `decision`, or `history`, and use `--help` for exact syntax. If a loop is in progress, hand it to `qrspi-x:autoloop`.

Without the helper, use artifacts and markers directly. Read artifacts in workflow order and choose the first incomplete step whose inputs are present.

Resume routing is deterministic:

- non-empty `## New Questions` in `research.md` → `Query` refinement;
- undecided `approach.md` (`## Decision` blank or `None.`) → stop at the Shape gate;
- implementation started → first incomplete phase, then first incomplete step;
- missing earlier artifact → its producer skill named above;
- otherwise → the next step in the phase map.

Changes to `request.md`, `queries.md`, or `research.md` invalidate downstream definition and implementation artifacts. Changes to `approach.md` invalidate Spec, Plan, and implementation progress. Run affected steps forward before using stale outputs.

## Execution modes

The normal workflow is interactive and gates every transition. `qrspi-x:autoloop` requires the helper, gates at phase or whole-plan boundaries, runs its own helper lifecycle, and still stops before final review. Do not switch modes implicitly.

At each transition, announce the current step, invoke its skill, inspect the result, call the helper transition command when available, and wait for the human's choice. Do not duplicate completion or history records owned by the step skill.

If the helper is unavailable, keep navigation in the conversation, use phase markers and artifacts for recovery, and apply the direct-review label and scope rules. There is no helper recovery, durable history, or helper-derived diff scope in this mode.

## Transition choices

After Init: Query, refine the request, or cancel.

After Query: Research, regenerate questions, or cancel.

After Research: Query again when `## New Questions` is non-empty; otherwise Shape, Spec, refine Research, or cancel. If Spec is chosen without Shape, helper mode records why with `history add`, not `decision add`.

After Shape: record the human's decision under `## Decision`, then choose Spec, return to Query/Research, refine Shape, or cancel.

After Spec: Plan, return to Shape or Query/Research, refine Spec, or cancel.

After Plan: Implement all, Implement one phase, Autoloop, refine Plan, or cancel.

During Implement: continue, checkpoint Review, or stop. After a phase: phase Review, continue to the next phase, or stop.

After Review: PASS continues; PASS WITH CONDITIONS or FAIL offers fix/re-implement, plan revision, or spec revision. After final PASS, helper mode may `log park`; offer completion/parking and leave `./qrspi/<feature>/` for the human to clean up.
