# QRSPI-X

A modified version of Dexter Horthy's QRSPI method for spec-driven, human-gated feature development with coding agents. QRSPI-X is a portable package of skills, role definitions, and an optional helper, with runtime adapters for Claude Code, Codex, and IBM Bob.

This README is for the human running the workflow. `AGENTS.md`, `skills/*/SKILL.md` and `agents/*.md` files are instructions for the agents. This file explains the portable workflow contract, runtime adapters, and how to [install](#installation) it. Maintainer and contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).

> [!WARNING]
> An optional utility, `qrspi-x` is still experimental and the official `@ebullient/qrspi-x` npm package has not been published yet. The skills and agents do not require it. Until it is released, use the [local helper install](#local-development-install) described below if you want helper-assisted workflows.

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

- **Research gets biased by the feature idea** → Query and Research each run in their own isolated subagent with limited tools. Query only gets `Write` — it cannot read the codebase even if it tried. Neither subagent sees the other's reasoning or the main conversation.
- **Plans are unreadable** → the plan has two layers: a short phase overview (`plan.md`) you can read in one pass, and per-phase detail files you open when implementing that phase.
- **Layer-by-layer plans hide integration bugs** → you approve phase boundaries *before* `plan.md` is written, not after. You are approving how the work is cut up, not just what is inside each piece.
- **One prompt does too much** → each stage is its own skill with one job, run fresh instead of piled into a single prompt.

## The workflow

| Phase | What it does | Runs as |
|---|---|---|
| Explore *(optional)* | Look around an area of the codebase before a feature request exists; suggest candidate directions | subagent, broad tools |
| Init | Write down the feature request as-is, into `request.md` | main conversation |
| Query | Generate questions from the request — no codebase access | isolated subagent, `Write`-only |
| Research | Answer those questions by reading the codebase — facts only, no opinions | isolated subagent, full read tools |
| Shape *(optional)* | Compare viable implementation approaches using the request and research context | isolated subagent, broad read tools |
| Spec | Define what changes and what does not | main conversation |
| Plan | Break the spec into small, ordered steps; approve phase boundaries before files are written | main conversation |
| Implement | Execute one step at a time, commit per phase or per step, and pause for approval | main conversation |
| Review | Adversarially check the change against the spec and plan | isolated subagent(s), full read tools |

Query and Research can loop: if research surfaces a question the code cannot answer, return to Query and then Research. Shape is optional; use it when multiple implementation approaches remain. Everything after Spec runs in order, but an approval point can send the work back to Research, Shape, Spec, or Plan.

To start a normal workflow, invoke the workflow skill with a feature name; it will capture the feature request in the Init step. For example:

```text
/qrspi-x:workflow add-refresh-token-rotation
```

The workflow creates artifacts under `./qrspi/<feature>/`. These artifacts are disposable scaffolding; the code is the source of truth. Add `qrspi/` to the project's `.gitignore`. If the artifacts are visible to git, they appear as uncommitted work and the helper reports a `dirty-tree` finding on every command. Init checks this and offers to add the entry.

Per-phase plan files live in `./qrspi/<feature>/plans/`, while the `plan.md` overview stays alongside the other feature artifacts. When Query, Research, Shape, or Spec reruns, the artifact it replaces moves to `./qrspi/<feature>/backups/` so no prior version is lost. An optional `background.md` can preserve human-supplied context and prior-art comparisons; it is not authoritative intent and is not automatically given to Query or Research. When Shape runs, `approach.md` records the alternatives, tradeoffs, and human-selected direction before Spec.

### Completion

Once the final review passes, helper-assisted mode may offer to stop tracking the feature as active. This is advisory bookkeeping only; it does not delete the workflow artifacts. Interactive-only mode reports completion without state tracking. The workflow never cleans up `./qrspi/<feature>/` itself; disposing of any artifact there, done or not, is your call.

## How to run this well

The tooling does not enforce all of these practices. They are what make the process work in practice.

**Use Query and Research to find the real intent, not just to check a finished task.** No fully formed feature request yet? Run them against a rough idea and use the results to rewrite `request.md` before Spec.

**Review independently.** Isolation removes the prior conversation from a role's context, but it does not remove the model's blind spots. Run final Review in a different harness or with a different model than the one that ran Implement. The runtime chooses the model; QRSPI-X does not require a particular provider or model name. Claude Code users can set `CLAUDE_CODE_SUBAGENT_MODEL` or pass a model override per invocation.

**Review the code and diff, not only the plan.** Skim the per-phase plan, inspect the actual diff at each phase boundary, and do one full pass at the end for how the phases fit together.

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

`qrspi-x:autoloop` is an advanced execution mode for an approved specification and plan. It runs implementation and interim review unattended for one phase or all remaining phases:

```md
implement phase → review → PASS: next phase
                         → FAIL: one repair pass → re-review → PASS: next phase
                                                             → FAIL: stop for you
```

Compared with `qrspi-x:implement`:

- implementation runs in one subagent per phase;
- the loop gates at the phase or whole-plan boundary instead of every step;
- a failed phase gets one repair attempt, then the loop stops;
- each step gets its own commit, and each repair pass gets one separate commit; you can squash these before final review if you want; and
- it stops before final review and never opens a pull request.

Interim reviews use the same model that wrote the code, so they are a fast filter rather than an independent check. Run the final Review yourself, preferably in a different harness or with a different model or provider, before integrating the result. `PASS WITH CONDITIONS` findings do not stop the loop; they accumulate for you to triage at the end.

Autoloop records its position through the helper before acting, so an interrupted session can resume without redoing a phase. The helper operations are internal to autoloop; you only need to choose whether to start or resume autoloop and how to handle the result.

## Installation

### Portable package

The package root contains `skills/` and `agents/` directories. A runtime that can discover `SKILL.md` files can load the workflow from that layout. The portable package manifest is `plugin.json`; it identifies the package without changing skill names, agent names, or the `qrspi/` workspace.

### Runtime adapters

The workflow contract is runtime-neutral: skills orchestrate stages, role definitions describe isolated work, artifacts record durable outputs, and humans approve transitions. Each runtime must supply the capabilities a role needs, including fresh context, tool restrictions, filesystem access, durable writes, and human gates. A prompt describes these requirements but cannot create a runtime-enforced security boundary by itself.

#### Claude Code

Claude Code loads the existing `.claude-plugin/plugin.json` package entry and its named agents. From a source checkout, link the repository into the workspace's Claude plugin location:

```bash
git clone <repository-url> <path-to-qrspi-x>
ln -s <path-to-qrspi-x> <workspace>/.claude/skills/qrspi-x
```

#### Codex and IBM Bob package links

For runtimes that use workspace-local skill or plugin directories, the same checkout can be linked into the corresponding runtime location:

```bash
ln -s <path-to-qrspi-x> <workspace>/.agents/skills/qrspi-x
ln -s <path-to-qrspi-x> <workspace>/.bob/plugins/qrspi-x
```

#### Codex

Codex can discover the nested skill directories by finding `SKILL.md` files under `skills/`. When named-agent registration is unavailable, the caller uses the package-relative `agents/*.md` definition with a fresh context and the narrowest available tools. If the runtime cannot enforce one of those capabilities, the corresponding isolation or permission guarantee is degraded rather than assumed.

#### IBM Bob

IBM Bob can use the Claude-compatible plugin directory structure for distributing the nested skills and named agents. Bob's discovery scoping remains runtime-specific; it is not a prerequisite for the portable workflow contract.

The package-relative layout is shared across runtimes; the discovery and named-agent behavior above are adapters, not new QRSPI names or paths. If linking is not convenient, copy the checkout into the appropriate runtime location and repeat the copy after pulling updates.

On Windows, use a directory junction (`mklink /J`) if available. Use the appropriate workspace or home-level location for the runtime you are configuring. Once the links or copies exist, the `qrspi-x:<skill>` skills and their bundled agents are available. No npm package or helper CLI is required for the normal human-gated workflow.

### Optional helper (all runtimes)

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

For maintainer checks, helper development, and plugin contribution conventions, see [CONTRIBUTING.md](CONTRIBUTING.md).

## See also

- [Everything We Got Wrong About Research-Plan-Implement](https://www.youtube.com/watch?v=YwZR6tc7qYg) — Dexter Horthy's retrospective this workflow is built from
