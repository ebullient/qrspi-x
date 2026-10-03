# Working on this repo

Conventions for editing QRSPI-X itself. This file is for whoever (human or agent) is **modifying** QRSPI-X. It is not shipped guidance for running a QRSPI workflow — that's [README.md](README.md), and the skills and agents are instructions to the agents that execute the workflow.

Most of this repo is markdown, with the private TypeScript helper under `tools/`. Read the file you're changing in full before changing it. For a concise, implementation-backed map of the helper's workspace and interactive behavior, see [docs/helper.md](docs/helper.md); consult the source and tests when a detail matters.

## Layout

```
skills/qrspi-<name>/SKILL.md  portable skill entrypoints
skills/qrspi-<name>/references/  self-contained runtime/role instructions
agents/<name>.md          canonical runtime-neutral role contracts
docs/runtime.md           canonical runtime contract
.claude-plugin/           legacy manifest; packaging is outside this port
tools/                    published helper source and build metadata
```

Codex skills are invoked as `$qrspi-<name>`. Spawn fresh subagents with the complete bundled role and explicit task inputs; named-agent registration is optional. The helper command remains `qrspi-x`.

## QRSPI subagent authorization

When a user invokes or authorizes a QRSPI skill, spawn the subagents required by that skill within the authorized step: Query, Research, Shape, Review, and Explore delegate their role work; Review may add an explainer only when the user opts in; Autoloop delegates implementation, repair, and review within its approved phase scope. Independent prompt-validation subagents may be used when maintaining these skills, scoped to disposable test workspaces. Do not ask again merely because a required step uses a subagent.

This authorization is limited to the requested workflow or validation. It does not expand feature scope, authorize external messages, pushing, publishing, merging, deployment, or destructive operations, or override runtime permissions. Preserve the human gates defined by the skills. Query, Research, and Review require new contexts with no inherited conversation history; stop those steps if the runtime cannot provide them. Do not substitute work in the main conversation or reuse a contaminated agent.

## Skills vs agents

The split is deliberate and load-bearing:

- **A skill** runs in the main conversation. It orchestrates: it decides what happens next, talks to the human, records state through the helper, and spawns agents.
- **An agent** runs in an isolated subagent with its own context. It does the heavy reading and writing, then discards its context when it returns.

Work goes in an agent when it would otherwise flood the main conversation with diffs or file contents, or when isolation is the point — Query must not see the codebase, Research must not see Query's reasoning, the reviewer must not see the implementer's.

When a step needs both, the skill is the thin caller and the agent holds the contract. `review` and `autoloop` are the clearest examples.

### Role and runtime contracts

Role files are plain Markdown, with no Claude-only `tools`, `model`, or color frontmatter. Keep model selection with the user: spawned agents inherit the session's model and reasoning unless the user chooses otherwise.

Follow [the runtime contract](docs/runtime.md). Query receives only the brief, human clarifications, and question-only rerun inputs; it does not read the repository. Research receives questions and authorized source roots, never feature intent or Query reasoning. Review receives the spec, plan, scoped code, and explicit evidence, never the implementer's narrative. Restrict tools when the runtime supports it, but never describe role instructions as a hard permission boundary.

Each skill includes copies of the runtime contract and the roles it needs under `references/`, so it works when copied independently. Keep these copies identical to their canonical files; see [docs/duplication.md](docs/duplication.md).

### Skill frontmatter

Use portable `name` and `description` frontmatter. Names match the `qrspi-*` directory names. Put adjacent-step guidance in the description or the `## When to use` section; do not depend on Claude-only `when_to_use` or invocation fields.

Keep a short `## Core Philosophy` near the top: the single rule the skill exists to enforce ("Only review, never fix", "Execute the plan, don't deviate").

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
- **Record transitions before acting, not after.** Especially in `autoloop`: a session that dies mid-spawn must leave behind what it was *doing*, not what it last *finished*. Use the helper's `start <task> --loop` commands.
- **QRSPI artifacts are never committed** to the user's project and never counted as product files in a diff.

## Labels

Review and explain artifacts are keyed by label (`phase-2`, `phase-2-r2`, `final`). Labels must be non-empty kebab-case path components, and **never reused** — the reviewer stops rather than overwrite an existing artifact. That stop is correct behavior, but it will strand an automated loop, so any skill generating labels must generate fresh ones (see `autoloop`'s re-review).

## Duplication to keep in sync

Several facts are intentionally repeated across skills, agents, and the helper: per-step implementation mechanics (`implement` skill vs. `implementer` agent), the helper's transition table vs. its command implementations, diff-scope resolution (`reviewer` vs. `explainer`), the artifact inventory in workflow staleness rules, and the backup rule (`query`, `research`, `shape`, `spec`). See [docs/duplication.md](docs/duplication.md) for the full list and why each copy exists — check it before editing any file it names.

## Gate contracts

`workflow` and `autoloop` both gate; they differ in granularity. `workflow` gates every step, `autoloop` gates the phase or the whole plan, and says which it is.

If you add another orchestrator, state its gate granularity in the skill itself. "Humans gate every transition" holds across QRSPI-X — what an orchestrator may choose is how much work sits behind one gate, never whether a human sees the result before it is integrated.

## Style

Write instructions that say what to do and why, in that order, with the reason attached to anything counterintuitive. An agent that knows *why* a rule exists follows it in situations the rule didn't anticipate; one that only knows the rule optimizes it away the first time it looks redundant. The "never batch the bookkeeping" note in `implementer` is the pattern: the rule, then one sentence on what breaks without it.

Prefer mechanical criteria over judgment where a rule has to hold. The reviewer's verdict rules are a table, not a vibe, which is why the verdict is reproducible.

Second person for agents ("You are a QRSPI..."), imperative for skills. Match the surrounding file.

## Before committing

- Re-read the whole file you edited. A skill is a prompt; a contradiction two sections apart is a bug.
- Check whether the change affects one of the duplicated sections above.
- If behavior visible to a workflow-runner changed, update [README.md](README.md).
- If persisted state changed, update [docs/workspace.md](docs/workspace.md) or [docs/interaction.md](docs/interaction.md).

Commit messages in this repo use a gitmoji prefix (`✨`, `🐛`, `📝`, `🔧`, `🔖`) — match what's already in `git log`.
