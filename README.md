# QRSPI-X

A modified version of Dexter Horthy's QRSPI method for spec-driven, human-gated feature development with coding agents. This branch provides runtime-neutral skills and isolated role contracts for use with Codex.

This README is for the human running the workflow. `AGENTS.md`, `skills/*/SKILL.md` and `agents/*.md` files are instructions for the agents. This file explains what the workflow is, why it is structured this way, and how to [install](#installation) it. Maintainer and contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).

> [!WARNING]
> An optional utility, `qrspi-x` is still experimental and the official `@ebullient/qrspi-x` npm package has not been published yet. The skills and agents do not require it. Until it is released, use the [local helper install](#install-the-helper-locally) described below if you want helper-assisted workflows.

## What QRSPI-X does

QRSPI-X gives coding-agent work a sequence of small, human-approved stages:

```md
(Explore) → Init → Query ⇄ Research → [Shape] → Spec → Plan → Implement → Review
```

Each stage has one job. The human approves the result before the workflow advances, and can send the work back to an earlier stage when the request, evidence, design, or plan needs revision.

The workflow is designed to make the important decisions visible before code is written:

- intent is captured before research begins;
- research is separated from the feature discussion so it gathers facts rather than rationalizing a solution;
- optional Shape compares approaches when the direction is not obvious;
- phase boundaries are approved before the detailed plan is written;
- implementation happens in small, reviewable steps;
- Review checks the code against the approved specification.

## Why this exists

Horthy's retrospective on Research-Plan-Implement (['Everything We Got Wrong About Research-Plan-Implement'](https://www.youtube.com/watch?v=YwZR6tc7qYg)) found four recurring problems:

- Research done with knowledge of the intended feature turns into opinions instead of facts.
- One giant planning prompt overloads the model.
- 1,000-line plans take as long to read as the code they produce.
- Plans that go layer by layer (all DB, then all services, then all API) hide integration bugs until the end.

QRSPI-X addresses each one:

- **Research gets biased by the feature idea** → Query and Research each run in a fresh context without the main conversation or each other's reasoning. Query works from the raw brief and must not inspect the repository; Research receives only the resulting questions and source locations. Tool-use instructions are not an enforced access boundary; see [the runtime contract](docs/runtime.md).
- **Plans are unreadable** → the plan has two layers: a short phase overview (`plan.md`) you can read in one pass, and per-phase detail files you open when implementing that phase.
- **Layer-by-layer plans hide integration bugs** → you approve phase boundaries *before* `plan.md` is written, not after. You are approving how the work is cut up, not just what is inside each piece.
- **One prompt does too much** → each stage is its own skill with one job, run fresh instead of piled into a single prompt.

## The workflow

| Phase | What it does | Runs as |
|---|---|---|
| Explore *(optional)* | Look around an area of the codebase before a feature request exists; suggest candidate directions | subagent, broad tools |
| Init | Write down the feature request as-is, into `request.md` | main conversation |
| Query | Generate questions from the request — no codebase access | fresh subagent, no repository reads |
| Research | Answer those questions by reading the codebase — facts only, no opinions | isolated subagent, full read tools |
| Shape *(optional)* | Compare viable implementation approaches using the request and research context | isolated subagent, broad read tools |
| Spec | Define what changes and what does not | main conversation |
| Plan | Break the spec into small, ordered steps; approve phase boundaries before files are written | main conversation |
| Implement | Execute one step at a time, commit per phase or per step, and pause for approval | main conversation |
| Review | Adversarially check the change against the spec and plan | isolated subagent(s), full read tools |

Query and Research can loop: if research surfaces a question the code cannot answer, return to Query and then Research. Shape is optional; use it when multiple implementation approaches remain. Everything after Spec runs in order, but an approval point can send the work back to Research, Shape, Spec, or Plan.

To start a normal workflow, invoke the workflow skill with a feature name; it will capture the feature request in the Init step. For example:

```text
$qrspi-workflow add-refresh-token-rotation
```

The workflow creates artifacts under `./.qrspi/<feature>/`. Existing `qrspi/` workspaces need an explicit move to `.qrspi/`; preserve their contents and stop if the destination already exists. Rebuild older helper installations so they use the new location. These artifacts are disposable scaffolding; the code is the source of truth. Add `.qrspi/` to the project's `.gitignore`. If the artifacts are visible to git, they appear as uncommitted work and the helper reports a `dirty-tree` finding on every command. Init checks this and offers to add the entry.

Per-phase plan files live in `./.qrspi/<feature>/plans/`, while the `plan.md` overview stays alongside the other feature artifacts. When Query, Research, Shape, or Spec reruns, the artifact it replaces moves to `./.qrspi/<feature>/backups/` so no prior version is lost. An optional `background.md` can preserve human-supplied context and prior-art comparisons; it is not authoritative intent and is not automatically given to Query or Research. When Shape runs, `approach.md` records the alternatives, tradeoffs, and human-selected direction before Spec.

### Completion

Once the final review passes, helper-assisted mode may offer to stop tracking the feature as active. This is advisory bookkeeping only; it does not delete the workflow artifacts. Interactive-only mode reports completion without state tracking. The workflow never cleans up `./.qrspi/<feature>/` itself; disposing of any artifact there, done or not, is your call.

## How to run this well

The tooling does not enforce all of these practices. They are what make the process work in practice.

**Use Query and Research to find the real intent, not just to check a finished task.** No fully formed feature request yet? Run them against a rough idea and use the results to rewrite `request.md` before Spec.

**Review independently.** Agents inherit the session model and reasoning settings unless you choose otherwise, so isolation removes conversation history but retains the model's blind spots. Run final Review in a different harness or with a different model than the one that ran Implement.

**Review the code and diff, not only the plan.** Skim the per-phase plan, inspect the actual diff at each phase boundary, and do one full pass at the end for how the phases fit together.

## Traceable decisions and verification

Specs label acceptance criteria `S1`, `S2`, and so on. Plans map behavior-sized steps to those IDs; implementation records actual verification and recoverable commits; reviews connect each conformance result and supported finding to its requirement. Findings need a reachable scenario and code or reproduction evidence.

Spec and Plan record the input revisions they used. Human approvals and reviews identify exact artifact and code snapshots, including staged or dirty changes. Changed inputs require reassessment before execution or acceptance; progress-marker updates alone do not invalidate plan approval. These checks live in the skills, alongside the existing helper. Older artifacts need a human-reviewed migration that preserves progress and history.

Each gate presents what changed, unresolved questions, tradeoffs, verification evidence, and the specific decision needed, with the full artifact available. See [the runtime contract](docs/runtime.md) for revision and evidence rules.

## Optional helper

The `qrspi-x` CLI is an optional implementation detail of the workflow. When it is available, the skills call it automatically rather than editing workflow state directly. You normally do not need to invoke the CLI yourself or learn its individual commands.

With the helper, the workflow gets:

- durable position and resume support;
- recovery after an interrupted session;
- history and staleness findings;
- generated review labels;
- phase diff scope; and
- explicit state for the execution loop.

You can also fetch a GitHub issue or PR into `request.md` via `qrspi-x import <number> [--repo <owner/repo | url>]`.

Without the helper, interactive steps still run and remain human-gated. They use the artifacts and plan markers directly, but there is no automatic recovery, durable history, or helper-managed bookkeeping. `autoloop` is the exception: it requires the helper. If a skill reports an ambiguity or recovery issue, follow the instructions it gives; do not hand-edit helper state.

## Optional autoloop

`qrspi-autoloop` is an advanced execution mode for an approved specification and plan. It runs implementation and interim review unattended for one phase or all remaining phases:

```md
implement phase → review → PASS: next phase
                         → FAIL: one repair pass → re-review → PASS: next phase
                                                             → FAIL: stop for you
```

Compared with `qrspi-implement`:

- implementation runs in one subagent per phase;
- the loop gates at the phase or whole-plan boundary instead of every step;
- a failed phase gets one repair attempt, then the loop stops;
- each step gets its own commit, and each repair pass gets one separate commit; you can squash these before final review if you want; and
- it stops before final review and never opens a pull request.

Interim reviews use the same model that wrote the code, so they are a fast filter rather than an independent check. Run the final Review yourself, preferably in a different harness or with a different model or provider, before integrating the result. `PASS WITH CONDITIONS` findings do not stop the loop; they accumulate for you to triage at the end.

Autoloop records its position through the helper before acting, so an interrupted session can resume without redoing a phase. The helper operations are internal to autoloop; you only need to choose whether to start or resume autoloop and how to handle the result.

## Installation

### Codex skills and roles

Each `skills/qrspi-*` folder is self-contained, including its runtime and role references. Copy those folders into the project's `.agents/skills/` directory or your personal `~/.agents/skills/` directory. Individual skill folders may also be symlinked. The full checkout does not need to sit under the discovery directory.

```bash
mkdir -p /path/to/project/.agents/skills
cp -R /path/to/qrspi-x/skills/qrspi-* /path/to/project/.agents/skills/
```

Use `$qrspi-workflow <feature-name>` in a Codex prompt, or invoke an individual skill such as `$qrspi-query` or `$qrspi-review`. These are prompt invocations; `qrspi-x` remains the separate helper command. If a newly copied skill does not appear, restart Codex.

Read [Codex setup and migration](docs/codex.md) for the delegation authorization snippet and fresh-context requirements. Named-agent registration is optional: each caller supplies its complete bundled role and explicitly allowed inputs. If the client cannot start a role without inherited conversation history, Query, Research, and Review stop; run the role in a separate clean session with only its allowed inputs.

The legacy Claude manifest and release machinery remain unmodified on this branch. These portable role files are not Claude named-agent definitions; the old plugin packaging is outside this port's finalized scope.

### Install the helper locally

Use Node 22 or newer for the optional helper CLI.

#### Local development install

The npm package is not published yet. From a source checkout:

```bash
cd tools
npm ci
npm run build
npm link
```

This registers the local `@ebullient/qrspi-x` package globally and makes its `qrspi-x` binary available on your `PATH`. The linked command runs the bundled file at `tools/dist/qrspi-x.mjs`; after changing TypeScript under `tools/src/`, run `npm run build` again.

If you are testing the helper as a dependency of another local project, run `npm link @ebullient/qrspi-x` from that project's directory after creating the global link above.

To remove the local global link:

```bash
npm unlink -g @ebullient/qrspi-x
```

### Published helper install

After the first release, the normal user install will be:

```bash
npm i -g @ebullient/qrspi-x
```

Releases are produced explicitly from the repository's manual release workflow and published to npm.

For maintainer checks, helper development, and skill and role contribution conventions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## See also

- [Everything We Got Wrong About Research-Plan-Implement](https://www.youtube.com/watch?v=YwZR6tc7qYg) — Dexter Horthy's retrospective this workflow is built from
