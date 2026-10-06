# QRSPI-X

A modified version of Dexter Horthy's QRSPI method for spec-driven, human-gated feature development with coding agents. QRSPI-X is a portable package of skills, role definitions, and an optional helper, with runtime adapters for Claude Code, Codex, and IBM Bob.

This README is for the human running the workflow; `AGENTS.md`, `skills/*/SKILL.md`, and `agents/*.md` are instructions for the agents. Maintainer and contributor guidance lives in [CONTRIBUTING.md](CONTRIBUTING.md).

> [!NOTE]
> The optional [`qrspi-x` helper](#optional-helper) is still experimental. Only the [autoloop](#optional-autoloop) skill requires it.

## Quick start

```bash
npm i -g @ebullient/qrspi-x
qrspi-x plugin install
qrspi-x plugin init --agent claude   # or codex, or bob
```

Then, in your project, talk to your agent and start the workflow with a short name for what you're building (letters, numbers, and dashes; this becomes a folder name, not a file you write first):

```text
/qrspi-x:workflow add-refresh-token-rotation
```

The agent will ask you to describe the feature in your own words: a sentence or a paragraph, whatever you've got. That's the whole "getting started" step: no file to write by hand, no form to fill out first. Starting from a GitHub issue or PR instead? `qrspi-x import <number>` pulls its title and description in as the starting request for you. From there, see [The workflow](#the-workflow) for what happens at each stage and [How to run this well](#how-to-run-this-well) for tips on using it.

See [Installation](#installation) for the manual (no-npm) install path and other options.

## The problem

Research-Plan-Implement is a common pattern for working with a coding agent on a real feature: have it research the codebase, write a plan, then build it. In practice, that pattern tends to fail in the same four ways, as Dexter Horthy's retrospective lays out (['Everything We Got Wrong About Research-Plan-Implement'](https://www.youtube.com/watch?v=YwZR6tc7qYg)):

- **Research gets biased by the feature idea.** Once the agent knows what you want to build, "research" quietly turns into justifying that idea instead of checking it against the facts.
- **Plans are unreadable.** A plan detailed enough to actually implement is often as long as the code it produces, so nobody reads a 1,000-line plan closely enough to catch its mistakes.
- **Layer-by-layer plans hide integration bugs.** Building all the database work, then all the service work, then all the API work looks tidy on paper, but the pieces don't actually fit together until the very end, which is the worst time to find out they don't.
- **One prompt does too much.** Research, planning, and implementation crammed into a single conversation overload the model and blur which part of the output to trust.

## What QRSPI-X does

QRSPI-X gives coding-agent work a sequence of small, human-approved stages:

```md
(Explore) → Init → Query ⇄ Research → [Shape] → Spec → Plan → Implement → Review
```

Each stage has one job. The human approves the result before the workflow advances, and can send the work back to an earlier stage when the request, evidence, design, or plan needs revision. This is how QRSPI-X answers each problem above:

- **Research gets biased by the feature idea** → Query and Research each run in their own isolated subagent with limited tools. Query only gets `Write`; it cannot read the codebase even if it tried. Neither subagent sees the other's reasoning or the main conversation.
- **Plans are unreadable** → the plan has two layers: a short phase overview (`plan.md`) you can read in one pass, and per-phase detail files you open when implementing that phase.
- **Layer-by-layer plans hide integration bugs** → you approve phase boundaries *before* `plan.md` is written, not after. You are approving how the work is cut up, not just what is inside each piece.
- **One prompt does too much** → each stage is its own skill with one job, run fresh instead of piled into a single prompt.

## The workflow

| Stage | What it does | Command | Runs as |
|---|---|---|---|
| Workflow | Walks you through every stage below in order, prompting you at each step | `/qrspi-x:workflow <feature-name>` | main conversation |
| Explore *(optional)* | Look around an area of the codebase before a feature request exists; suggest candidate directions | `/qrspi-x:explore` | subagent, broad tools |
| Init | Write down the feature request as-is, into `request.md` | `/qrspi-x:init` | main conversation |
| Query | Generate questions from the request (no codebase access) | `/qrspi-x:query` | isolated subagent, `Write`-only |
| Research | Answer those questions by reading the codebase (facts only, no opinions) | `/qrspi-x:research` | isolated subagent, full read tools |
| Shape *(optional)* | Compare viable implementation approaches using the request and research context | `/qrspi-x:shape` | isolated subagent, broad read tools |
| Spec | Define what changes and what does not | `/qrspi-x:spec` | main conversation |
| Plan | Break the spec into small, ordered steps; approve phase boundaries before files are written | `/qrspi-x:plan` | main conversation |
| Implement | Execute one step at a time, commit per phase or per step, and pause for approval | `/qrspi-x:implement` | main conversation |
| Review | Adversarially check the change against the spec and plan | `/qrspi-x:review` | isolated subagent(s), full read tools |

Run `/qrspi-x:workflow` (see [Quick start](#quick-start)) and it captures your feature request in Init, then carries you through the rest of the stages below; you normally won't need their individual commands. Use one directly only to jump to a specific stage, rerun it, or resume after an interruption.

Query and Research can loop: if research surfaces a question the code cannot answer, return to Query and then Research. Shape is optional; use it when multiple implementation approaches remain. Everything after Spec runs in order, but an approval point can send the work back to Research, Shape, Spec, or Plan.

Plan turns the spec into an implementation plan broken into _phases_, small, ordered groups of steps, each one a reviewable unit rather than a wall of detail. You approve the phase boundaries before `plan.md` is written, so you're approving how the work is cut up, not just what's in each piece; Implement then builds one phase at a time, and Review checks the result against the spec.

## Workspace and artifacts

The workflow creates artifacts under `./qrspi/<feature>/`, disposable scaffolding, not the source of truth:

```text
qrspi/<feature>/
├── request.md      the feature request, from Init
├── background.md   optional: whatever context the human brings (prior art, an Explore summary, ...), staged by Init, not given to Query or Research
├── queries.md      Query's questions
├── research.md     Research's answers, facts only
├── approach.md     alternatives and tradeoffs, from optional Shape
├── spec.md         what changes and what does not
├── plan.md         phase overview
├── plans/          per-phase plan detail files
├── reviews/        Review's reports, one file per label
└── backups/        prior queries/research/approach/spec, kept whenever one of those reruns
```

The helper (see [Optional helper](#optional-helper)) also keeps `decisions.md`, `history.jsonl`, and `loop-state.json` here for its own bookkeeping.

Add `qrspi/` to the project's `.gitignore`. Init checks for this and offers to add the entry. Uncommitted artifacts otherwise show up as a dirty tree, and the helper reports a `dirty-tree` finding on every command.

Some runtimes, like IBM Bob, follow `.gitignore` themselves, so the same entry that hides `qrspi/` from git also hides it from the agent that needs to read it; you may need to add an agent-specific rule to unhide it. See [Running with your agent](#running-with-your-agent) for details.

## How to run this well

**Use Explore when your idea is still too rough to write down.** Point it at an area of the codebase and let it poke around and suggest candidate directions, to turn a fuzzy notion into a starting request you can hand to Init.

**Use Query and Research to clarify the real intent.** The Query ↔ Research cycle usually surfaces questions that expose a gap or gray area in scope or intent. Run it against a rough idea and use the answers to refine `request.md` before Spec.

**Review independently.** Isolation removes the prior conversation from a role's context, but it does not remove the model's blind spots. Run final Review in a different harness or with a different model than the one that ran Implement. The runtime chooses the model; QRSPI-X does not require a particular provider or model name. Claude Code users can set `CLAUDE_CODE_SUBAGENT_MODEL` or pass a model override per invocation.

**Review the code and diff, not only the plan.** Skim the per-phase plan, inspect the actual diff at each phase boundary, and do one full pass at the end for how the phases fit together.

**A gap found mid-implementation doesn't mean starting over.** Implement uncovering work the spec didn't anticipate is an ordinary outcome of doing the work, not a failure. Update the spec, have Plan insert a new phase to cover the gap, check whether any later phase actually depends on it, and continue; you don't have to invalidate the whole plan or redo the phase already in progress.

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

The package root contains `skills/` and `agents/` directories; a runtime that can discover `SKILL.md` files can load the workflow from that layout. This contract is runtime-neutral: each runtime supplies its own fresh context, tool restrictions, and human gates for a role, since a prompt alone can't enforce them.

### Installing with the helper (recommended)

Use Node 22 or newer.

```bash
npm i -g @ebullient/qrspi-x
qrspi-x plugin install
```

`plugin install` downloads and verifies the latest release into `~/.qrspi/plugin`, a central copy shared by every agent. Then run `plugin init --agent <claude|codex|bob>` to place that content (symlinking, falling back to copying) at one agent's fixed location. See [Running with your agent](#running-with-your-agent) for the exact commands.

For later maintenance:

```bash
qrspi-x plugin update
qrspi-x plugin status
```

`plugin update` re-runs the install and re-places every already-initialized agent. `plugin status` reports what's installed and whether a newer release exists, without changing anything. `plugin remove --agent <claude|codex|bob>` removes one agent's placement. See [Running with your agent](#running-with-your-agent) for the exact commands.

Beyond installation, the helper is only required for the [autoloop](#optional-autoloop) skill. See [Optional helper](#optional-helper) above for what the workflow gains from having it available, and [CONTRIBUTING.md](CONTRIBUTING.md#helper-development) to run the CLI from a source checkout instead of the published package.

### Manual install (no npm)

An alternative to the helper above: clone the repository, then either symlink or copy it into each runtime's plugin location directly. Use this if you're on a source checkout, can't install from npm, or are contributing to the package itself. Use one approach or the other for a given agent, not both.

Symlink is the better default: it tracks `git pull` automatically. Copy instead for a pinned snapshot, or if your runtime can't follow a symlink; repeat the copy after each update. On Windows, use a directory junction (`mklink /J`) in place of `ln -s`. See [Running with your agent](#running-with-your-agent) for the exact commands.

## Running with your agent

Jump to: [Claude Code](#claude-code) · [Codex](#codex) · [IBM Bob](#ibm-bob)

### Claude Code

Claude Code loads the existing `.claude-plugin/plugin.json` package entry and its named agents.

```bash
qrspi-x plugin init --agent claude
```

```bash
# or, manual install from a source checkout:
git clone <repository-url> <path-to-qrspi-x>
mkdir -p ~/.claude/skills
ln -s <path-to-qrspi-x> ~/.claude/skills/qrspi-x
# or: cp -R <path-to-qrspi-x> ~/.claude/skills/qrspi-x
```

To remove a helper-managed placement:

```bash
qrspi-x plugin remove --agent claude
```

### Codex

Codex can discover the nested skill directories by finding `SKILL.md` files under `skills/`.

```bash
qrspi-x plugin init --agent codex
```

```bash
# or, manual install from a source checkout:
git clone <repository-url> <path-to-qrspi-x>
mkdir -p ~/.agents/skills
ln -s <path-to-qrspi-x> ~/.agents/skills/qrspi-x
# or: cp -R <path-to-qrspi-x> ~/.agents/skills/qrspi-x
```

When named-agent registration is unavailable, the caller uses the package-relative `agents/*.md` definition with a fresh context and the narrowest available tools. If the runtime cannot enforce one of those capabilities, the corresponding isolation or permission guarantee is degraded rather than assumed.

To remove a helper-managed placement:

```bash
qrspi-x plugin remove --agent codex
```

### IBM Bob

IBM Bob can use the portable agent plugin directory structure for distributing the nested skills and named agents.

```bash
qrspi-x plugin init --agent bob
```

```bash
# or, manual install from a source checkout:
git clone <repository-url> <path-to-qrspi-x>
mkdir -p ~/.bob/plugins
ln -s <path-to-qrspi-x> ~/.bob/plugins/qrspi-x
# or: cp -R <path-to-qrspi-x> ~/.bob/plugins/qrspi-x
```

Bob does not currently namespace skills by plugin: invoke `/qrspi-x:implement` as `/implement`, and likewise for the other skills.

Bob can follow `.gitignore` (in Bob IDE: Bob Settings → `Chat` → `Respect .gitignore`, in `~/.bob/settings/settings.json`: `"session": {""respectGitInore": true}`). If that is enabled, the same entry that hides `qrspi/` from git (see [Workspace and artifacts](#workspace-and-artifacts)) also hides it from Bob. Unhide it by adding to `.bobignore`:

```text
!qrspi
!qrspi/**
```

To remove a helper-managed placement:

```bash
qrspi-x plugin remove --agent bob
```

## Contributing

For maintainer checks, helper development, and plugin contribution conventions, see [CONTRIBUTING.md](CONTRIBUTING.md).
