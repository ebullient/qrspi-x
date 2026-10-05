# Working on this repo

Conventions for editing QRSPI-X itself. This file is for whoever (human or agent) is **modifying** the package. It is not shipped guidance for running a QRSPI workflow — that's [README.md](README.md), and the skills and agents are instructions to the agents that execute the workflow.

Most of this repo is markdown, with the private TypeScript helper under `tools/`. Read the file you're changing in full before changing it. For a concise, implementation-backed map of the helper's workspace and interactive behavior, see [docs/helper.md](docs/helper.md); consult the source and tests when a detail matters.

## Layout

```text
skills/<name>/SKILL.md    one skill per directory, always named SKILL.md
agents/<name>.md          one agent per file
plugin.json               portable package manifest
.claude-plugin/           Claude compatibility manifest (name, version)
tools/                    published helper source and build metadata
```

Skills are invoked as `qrspi-x:<name>`. Agents are spawned by skills as `qrspi-x:<name>`.

## Skills vs agents

The split is deliberate and load-bearing:

- **A skill** runs in the main conversation. It orchestrates: it decides what happens next, talks to the human, records state through the helper, and spawns agents.
- **An agent** runs in an isolated subagent with its own context. It does the heavy reading and writing, then discards its context when it returns.

Work goes in an agent when it would otherwise flood the main conversation with diffs or file contents, or when fresh context is part of the role contract — Query must not see the codebase, Research must not see Query's reasoning, and the reviewer must not see the implementer's.

When a step needs both, the skill is the thin caller and the agent holds the contract. `review` and `autoloop` are the clearest examples.

### Agent frontmatter

**Leave `model` out of every agent's frontmatter, always.** Never name a specific model, and never set `model: inherit` explicitly either. Model selection belongs to the runtime and human session, so the package remains portable and a reviewer can run in a different harness or on a different model. Claude Code users should rely on Claude Code's own subagent model resolution or an explicit invocation override; do not encode that adapter policy in role files.

The `tools:` frontmatter field should list the minimum toolset the agent needs.

- `query` gets `Write` only — it *cannot* read the codebase even if it tried, which is the entire mechanism behind unbiased question generation. Don't widen a toolset for convenience; a narrower toolset is often the guarantee.
- `implementer` is the only agent with `Edit`, because it's the only one that edits existing files.

### Skill frontmatter

`when_to_use` should always say what to use *instead* for adjacent cases. Most of these skills are near-misses for each other, and the disambiguation is what stops the wrong one firing.

Each skill opens with a `## Core Philosophy` section of one or two lines — the single rule that skill exists to enforce ("Only review, never fix", "Execute the plan, don't deviate"). Keep it that short. It's the line that survives when everything else is skimmed.

## Artifacts and state

Workflow artifacts live in `./qrspi/<feature>/` in the *user's* project, never in this repo. They are disposable scaffolding; the code is the source of truth.

- Per-phase plan files live in the `plans/` subdirectory.
- `plan.md` and the other artifacts stay in the workspace root.
- Reviews stay in `reviews/`.
- Artifacts Query, Research, Shape, and Spec displace on a rerun go to `backups/` as `<stem>-<n>.md`.

Persisted state lives in `loop-state.json`, `history.jsonl`, and `decisions.md`, owned by the helper. [docs/workspace.md](docs/workspace.md) and [docs/interaction.md](docs/interaction.md) describe their shape and invariants; update them when you change what the helper persists or how it derives state.

Rules that hold across every skill:

- **Updates are idempotent.** Helper records are no-ops when they would change nothing; history is append-only for completed transitions.
- **Each skill owns its own completion fields.** The orchestrator owns navigation and `--step` jumps, and nothing else. Don't write another skill's fields.
- **Record transitions before acting, not after.** Especially in `autoloop`: a session that dies mid-spawn must leave behind what it was *doing*, not what it last *finished*. Use the helper's `loop --begin` commands.
- **QRSPI artifacts are never committed** to the user's project and never counted as product files in a diff.

## Labels

Review and explain artifacts are keyed by label (`phase-2`, `phase-2-r2`, `final`). Labels must be non-empty kebab-case path components, and **never reused** — the reviewer stops rather than overwrite an existing artifact. That stop is correct behavior, but it will strand an automated loop, so any skill generating labels must generate fresh ones (see `autoloop`'s re-review).

## Duplication to keep in sync

Several facts are intentionally repeated across skills, agents, and the helper: per-step implementation mechanics (`implement` skill vs. `implementer` agent), the helper's transition table vs. its command implementations, diff-scope resolution (`reviewer` vs. `explainer`), the artifact inventory in workflow staleness rules, and the backup rule (`query`, `research`, `shape`, `spec`). See [docs/duplication.md](docs/duplication.md) for the full list and why each copy exists — check it before editing any file it names.

## Gate contracts

`workflow` and `autoloop` both gate; they differ in granularity. `workflow` gates every step, `autoloop` gates the phase or the whole plan, and says which it is.

If you add another orchestrator, state its gate granularity in the skill itself. "Humans gate every transition" holds across the plugin — what an orchestrator may choose is how much work sits behind one gate, never whether a human sees the result before it is integrated.

## Style

Write instructions that say what to do and why, in that order, with the reason attached to anything counterintuitive. An agent that knows *why* a rule exists follows it in situations the rule didn't anticipate; one that only knows the rule optimizes it away the first time it looks redundant. The "never batch the bookkeeping" note in `implementer` is the pattern: the rule, then one sentence on what breaks without it.

Prefer mechanical criteria over judgment where a rule has to hold. The reviewer's verdict rules are a table, not a vibe, which is why the verdict is reproducible.

Use braced blocks for returns controlled by `if` statements; do not use single-line returns, even though they are syntactically valid, because they are easy to miss during review.

Second person for agents ("You are a QRSPI..."), imperative for skills. Match the surrounding file.

## Before committing

- Re-read the whole file you edited. A skill is a prompt; a contradiction two sections apart is a bug.
- Check whether the change affects one of the duplicated sections above.
- If behavior visible to a workflow-runner changed, update [README.md](README.md).
- If persisted state changed, update [docs/workspace.md](docs/workspace.md) or [docs/interaction.md](docs/interaction.md).

Commit messages in this repo use a gitmoji prefix (`✨`, `🐛`, `📝`, `🔧`, `🔖`) — match what's already in `git log`.
