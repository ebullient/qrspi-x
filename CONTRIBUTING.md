# Contributing to QRSPI-X

This guide is for people modifying the QRSPI-X package itself. For installing and running the workflow, see [README.md](README.md). The skills and agents under this repository are prompts that execute the workflow; the private TypeScript helper under `tools/` provides optional durable state and loop bookkeeping.

## Repository layout

```text
skills/<name>/SKILL.md    one skill per directory, always named SKILL.md
agents/<name>.md          one agent per file
plugin.json               portable Agent Plugins manifest
.claude-plugin/           Claude compatibility manifest
tools/                    published helper source and build metadata
docs/                     helper and repository invariants
```

Skills are invoked as `qrspi-x:<name>`. Agents are spawned by skills as `qrspi-x:<name>`.

## Package structure and runtimes

QRSPI-X is packaged around the root `skills/` and `agents/` layout. `plugin.json` is the portable package identity, while `.claude-plugin/plugin.json` preserves Claude-specific compatibility. Claude Code and IBM Bob recognize the plugin structure directly; Codex discovers the nested skill directories by finding `SKILL.md` files under `skills/`.

Runtime-specific discovery, named-agent registration, and tool enforcement are adapters around the same package. Keep portable role requirements in the role and skill guidance, and label adapter instructions with the runtime they target. A runtime that cannot enforce a required capability must be documented as degraded for that guarantee rather than treated as equivalent.

Keep role definitions bundled in an `agents/` directory that is a peer of `skills/` at the package root:

```text
<package-root>/
├── agents/
│   └── <agent>.md
└── skills/
    └── <skill>/
        └── SKILL.md
```

Caller skills resolve role files package-relatively, for example `../../agents/query.md` from `skills/query/SKILL.md`. Keep the agent frontmatter for runtimes that support it.

## Skills and agents

A skill runs in the main conversation. It orchestrates the workflow, talks to the human, records state through the helper when available, and spawns agents.

An agent runs in an isolated subagent with its own context. It does the heavy reading or writing, then discards its context when it returns. Use an agent when isolation is part of the guarantee or when its work would otherwise flood the main conversation with source files and diffs.

The split is load-bearing: Query must not see the codebase, Research must not see Query's reasoning, and Review must not see the implementer's conversation.

### Agent frontmatter

Agent files must not select a concrete model or set `model: inherit`. Model selection belongs to the runtime and human session so the package remains portable and a reviewer can be run in a different harness or on a different model. Keep only frontmatter that the runtime actually consumes, such as the minimum `tools:` declaration for runtimes that enforce it.

List the minimum toolset the agent needs. `query` gets `Write` only — it cannot read the codebase even if it tried. `implementer` is the only agent with `Edit`, because it is the only one that edits existing files.

When a runtime cannot register a named agent and a skill uses a generic fallback, the caller must preserve the role's guarantees by construction:

- spawn with a fresh context and no inherited conversation turns;
- pass only the role definition and its explicitly listed inputs; and
- restrict tools to the narrowest set the runtime can express.

A generic fallback is not behaviorally equivalent to a registered agent when the runtime cannot enforce the frontmatter allowlist; document that limitation at the adapter boundary.

### Skill frontmatter and style

`when_to_use` should distinguish the skill from adjacent skills and say what to use instead. Each skill should open with a short `## Core Philosophy` section stating the one rule it exists to enforce.

Write instructions in the order they should be followed, with the reason attached to counterintuitive rules. Prefer mechanical criteria over judgment where a rule must hold. Use second person for agents and imperative voice for skills.

## Helper development

The helper is the only TypeScript package in this repository. Its source and tests are under `tools/`:

```text
tools/
├── src/       helper implementation
├── test/      helper tests
├── build.mjs  bundle entry point
└── package.json
```

Install dependencies and run the complete local check before committing helper changes:

```bash
cd tools
npm ci
npm run fullbuild
```

`fullbuild` runs linting, tests, typechecking, and the production bundle. Edit `tools/src/`; do not edit `tools/dist/` directly. The generated bundle is ignored and is rebuilt for releases.

The release workflow publishes the helper and updates the release metadata. Do not bump versions by hand.

To try the `qrspi-x` binary itself from a source checkout, instead of the published package, link it onto your `PATH`:

```bash
cd tools
npm ci
npm run build
npm link
```

This registers the local `@ebullient/qrspi-x` package globally. The linked command runs the bundled file at `tools/dist/qrspi-x.mjs`, so re-run `npm run build` after changing TypeScript under `tools/src/` to pick up the change. If you are testing the helper as a dependency of another local project, run `npm link @ebullient/qrspi-x` from that project's directory after creating the global link above. To remove the local global link: `npm unlink -g @ebullient/qrspi-x`.

## Artifacts and persisted state

Workflow artifacts belong to the project using QRSPI-X, not this repository. They live under `./qrspi/<feature>/`, are disposable scaffolding, and are never committed as product files.

Persisted helper state lives in `loop-state.json`, `history.jsonl`, and `decisions.md`. [docs/workspace.md](docs/workspace.md) and [docs/interaction.md](docs/interaction.md) describe their shape and invariants; update those documents when persisted state or interactive behavior changes.

Updates must be idempotent. Helper records should be no-ops when they would change nothing, while history remains append-only for completed transitions. Each skill owns its own completion fields; the orchestrator owns navigation and `--step` jumps. Record transitions before acting, especially in autoloop, so an interrupted session records what it was doing rather than what it last finished.

Review and explain artifacts use non-empty, never-reused kebab-case labels such as `phase-2`, `phase-2-r2`, and `final`. A reused label must stop rather than overwrite an existing artifact.

## Keep duplicated contracts synchronized

Several facts are intentionally repeated across skills, agents, and the helper. Before changing one, check [docs/duplication.md](docs/duplication.md), especially for:

- per-step implementation mechanics in `skills/implement/SKILL.md` and `agents/implementer.md`;
- the helper's command and transition contract;
- diff-scope resolution in the reviewer and explainer;
- the workflow artifact inventory and staleness rules; and
- backup naming and no-overwrite behavior in Query, Research, Shape, and Spec.

If helper behavior changes, update the skills and user-facing README when the workflow runner can observe the change. If the helper's persisted state changes, update the workspace or interaction documentation too.

## Before submitting a change

- Re-read every file you edited in full.
- Run `cd tools && npm run fullbuild` for helper or helper-contract changes.
- Check `git diff --check`.
- Confirm no `qrspi/` workflow artifacts or generated `tools/dist/` files are included.
- Match the repository's gitmoji commit style (`✨`, `🐛`, `📝`, `🔧`, or `🔖`) when writing a commit message.
